import { isBlockId } from "./block-ids";
import { writtenLinks } from "./note-parser";
import { journalDateFromTitle, journalTitle, parseJournalDate } from "./note-ids";
import { normalizeTitle, titleKey } from "./page-title";

/**
 * Reading a Logseq graph for import (PRD F31, decisions 2026-11-05), as
 * pure functions: the browser reads the folder's files and turns them into
 * Mistlog pages here, so nothing is written until the import runs. Every
 * line keeps its text; only Logseq's own bookkeeping changes form:
 *
 * - indentation becomes tabs (Logseq's `\t - ` is one level); a line is
 *   never more than one level deeper than the line above;
 * - `id:: <uuid>` becomes the block's ID, `collapsed:: true` its fold, and a
 *   page's `title::` its title; other properties stay as text;
 * - a multi-line block keeps each continuation line as a plain line under
 *   its bullet (code keeps its own indentation);
 * - blank lines between blocks are dropped.
 */

export interface ImportFile {
  /** Path inside the picked folder, such as `Logseq/pages/Books.md`. */
  path: string;
  text: string;
}

export interface ImportLine {
  /** Mistlog text: tabs, then `- ` for a bullet. */
  text: string;
  blockId: string | null;
  collapsed: boolean;
}

export interface ImportPage {
  title: string;
  key: string;
  kind: "page" | "journal";
  /** YYYY-MM-DD for a journal day. */
  date: string | null;
  /** The file(s) it came from. */
  sources: string[];
  lines: ImportLine[];
}

export interface SkippedFile {
  path: string;
  reason: string;
}

export interface ImportStats {
  pages: number;
  journals: number;
  lines: number;
  links: number;
  tags: number;
  blockIds: number;
  folds: number;
  continuationLines: number;
  /** `id::` values used twice: kept on the first block only. */
  duplicateIds: number;
  /** Files in `assets/`: attachments aren't imported yet. */
  assets: number;
}

export interface ImportPlan {
  pages: ImportPage[];
  /** Titles that links and tags point at with no page in the graph: created empty, as typing a link does. */
  missingTitles: string[];
  skipped: SkippedFile[];
  /** Pages made from more than one file (same title, ignoring case, or a date page joining its journal day). */
  combined: string[];
  /** Titles Mistlog can't use as they are (with `[[` or `]]`), and what they became. */
  renamed: Array<{ from: string; to: string }>;
  stats: ImportStats;
}

const JOURNAL_FILE_RE = /^(\d{4})_(\d{2})_(\d{2})\.md$/i;
const PROPERTY_RE = /^([A-Za-z0-9_-]+)::(?:\s(.*))?$/;
const FENCE_RE = /^```/;

/** A page title from a Logseq file name: `___` (and the older `%2F`) mean `/`, other `%XX` are decoded. */
export function titleFromFileName(name: string): string {
  const base = name.replace(/\.md$/i, "").replace(/___/g, "/");
  return base.replace(/(%[0-9A-Fa-f]{2})+/g, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  });
}

/** The folder a file is in (`pages`, `journals`, `assets`, `logseq`, or null), and its name. */
function placeOf(path: string): { folder: string | null; name: string } {
  const parts = path.split("/").filter(Boolean);
  const name = parts[parts.length - 1] ?? "";
  // The nearest such folder: the graph's own folder may be called "Logseq" too
  const folder = parts
    .slice(0, -1)
    .reverse()
    .find((p) => ["pages", "journals", "assets", "logseq"].includes(p.toLowerCase()));
  return { folder: folder?.toLowerCase() ?? null, name };
}

interface Converted {
  title: string | null;
  lines: ImportLine[];
  continuationLines: number;
}

/** One Logseq Markdown file's text as Mistlog lines (see the module comment). */
export function convertPage(text: string): Converted {
  const raw = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");
  const lines: ImportLine[] = [];
  let title: string | null = null;
  let continuationLines = 0;
  /** The bullet the following lines belong to, or null before the first bullet. */
  let block: { line: ImportLine; depth: number; spaces: number } | null = null;
  let inFence = false;

  for (const rawLine of raw) {
    const lead = /^[\t ]*/.exec(rawLine)![0];
    const rest = rawLine.slice(lead.length);
    const tabs = lead.split("\t").length - 1;
    const spaces = lead.length - tabs;
    const isBullet = !inFence && (rest.startsWith("- ") || rest === "-");

    if (isBullet) {
      const deepest = block ? block.depth + 1 : 0;
      const depth = Math.min(tabs + Math.floor(spaces / 2), deepest);
      const content = rest === "-" ? "" : rest.slice(2);
      const line: ImportLine = { text: `${"\t".repeat(depth)}- ${content}`, blockId: null, collapsed: false };
      lines.push(line);
      block = { line, depth, spaces };
      if (FENCE_RE.test(content)) inFence = true;
      continue;
    }
    if (!inFence && rest.trim() === "") continue;

    const property = inFence ? null : PROPERTY_RE.exec(rest.trimEnd());
    if (property) {
      const key = property[1].toLowerCase();
      const value = (property[2] ?? "").trim();
      if (block && key === "id" && isBlockId(value.toLowerCase())) {
        block.line.blockId = value.toLowerCase();
        continue;
      }
      if (block && key === "collapsed") {
        block.line.collapsed = value === "true";
        continue;
      }
      if (!block && key === "title" && value) {
        title = value;
        continue;
      }
    }

    if (block) {
      // A continuation line: drop the block's own indentation (its tabs, then up to its spaces and two more)
      let at = 0;
      while (rawLine[at] === "\t") at++;
      let dropped = 0;
      while (rawLine[at] === " " && dropped < block.spaces + 2) {
        at++;
        dropped++;
      }
      const body = rawLine.slice(at);
      lines.push({ text: `${"\t".repeat(block.depth + 1)}${body}`, blockId: null, collapsed: false });
      continuationLines++;
      if (FENCE_RE.test(body.trimStart())) inFence = !inFence;
    } else {
      // Text before the first bullet: a plain line at the top level
      lines.push({ text: rest.trimEnd(), blockId: null, collapsed: false });
    }
  }
  return { title, lines, continuationLines };
}

/** Turn a picked Logseq graph folder into an import plan. */
export function convertGraph(files: readonly ImportFile[]): ImportPlan {
  const byKey = new Map<string, ImportPage>();
  const skipped: SkippedFile[] = [];
  const combined = new Set<string>();
  const renamed: Array<{ from: string; to: string }> = [];
  const stats: ImportStats = { pages: 0, journals: 0, lines: 0, links: 0, tags: 0, blockIds: 0, folds: 0, continuationLines: 0, duplicateIds: 0, assets: 0 };

  const add = (title: string, kind: "page" | "journal", date: string | null, path: string, converted: Converted) => {
    const key = titleKey(title);
    const existing = byKey.get(key);
    if (existing) {
      // Two files with one title, or a date page joining its journal day: one page, in file order
      existing.lines.push(...converted.lines);
      existing.sources.push(path);
      combined.add(existing.title);
    } else {
      byKey.set(key, { title, key, kind, date, sources: [path], lines: [...converted.lines] });
    }
    stats.continuationLines += converted.continuationLines;
  };

  // A fixed order (not the browser's locale), so the same folder always gives the same plan
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const file of sorted) {
    const { folder, name } = placeOf(file.path);
    if (folder === "assets") {
      stats.assets++;
      continue;
    }
    if (folder === "logseq" || folder === null || name.startsWith(".")) continue;
    if (!/\.md$/i.test(name)) {
      skipped.push({ path: file.path, reason: name.toLowerCase().endsWith(".org") ? "Org-mode files aren't supported" : "Not a Markdown file" });
      continue;
    }
    if (folder === "journals") {
      const m = JOURNAL_FILE_RE.exec(name);
      const date = m ? `${m[1]}-${m[2]}-${m[3]}` : null;
      if (!date || parseJournalDate(`journal-${date}`) === null) {
        const conflict = /\s\d+\.md$/i.test(name) || /conflict/i.test(name);
        const backup = /^\d{4}-\d{2}-\d{2}T[\d_.]+Z?\b/i.test(name);
        const reason = conflict ? "A conflict copy (keeping the original day)" : backup ? "A sync backup copy (keeping the original day)" : "Not a journal file name (YYYY_MM_DD.md)";
        skipped.push({ path: file.path, reason });
        continue;
      }
      add(journalTitle(date), "journal", date, file.path, convertPage(file.text));
      continue;
    }
    // A page
    const converted = convertPage(file.text);
    const wanted = converted.title ?? titleFromFileName(name);
    let checked = normalizeTitle(wanted);
    if (!checked.ok && /\[\[|\]\]/.test(wanted)) {
      // Titles can't hold [[ or ]] (they'd break links): keep the page, without the brackets
      checked = normalizeTitle(wanted.replace(/\[\[|\]\]/g, ""));
      if (checked.ok) renamed.push({ from: wanted, to: checked.title });
    }
    if (!checked.ok) {
      skipped.push({ path: file.path, reason: checked.reason });
      continue;
    }
    const date = journalDateFromTitle(checked.title);
    if (date) add(journalTitle(date), "journal", date, file.path, converted);
    else add(checked.title, "page", null, file.path, converted);
  }

  // Block IDs are unique: a repeated id:: stays on the first block only
  const seenIds = new Set<string>();
  const linked = new Map<string, string>();
  for (const page of byKey.values()) {
    if (page.kind === "journal") stats.journals++;
    else stats.pages++;
    for (const line of page.lines) {
      stats.lines++;
      if (line.blockId) {
        if (seenIds.has(line.blockId)) {
          line.blockId = null;
          stats.duplicateIds++;
        } else {
          seenIds.add(line.blockId);
          stats.blockIds++;
        }
      }
      if (line.collapsed) stats.folds++;
      for (const w of writtenLinks(line.text)) {
        const name = w.name.trim();
        if (!name) continue;
        if (w.kind === "tag") stats.tags++;
        else stats.links++;
        if (journalDateFromTitle(name)) continue;
        const key = titleKey(name);
        if (!byKey.has(key) && !linked.has(key)) linked.set(key, name);
      }
    }
  }

  return {
    pages: [...byKey.values()],
    missingTitles: [...linked.values()].sort((a, b) => a.localeCompare(b)),
    skipped,
    combined: [...combined],
    renamed,
    stats,
  };
}

/** What already exists in Mistlog, from POST /api/import/check: title keys of pages, and days with notes. */
export interface ExistingInMistlog {
  pages: string[];
  days: string[];
}

export interface ImportSummary {
  newPages: number;
  /** Pages you have already: the imported lines are added below what is there. */
  addedToPages: number;
  newDays: number;
  addedToDays: number;
  /** Linked titles with no page anywhere: created empty. */
  emptyPages: number;
}

/** The dry run's headline numbers, given what Mistlog already has. */
export function summarise(plan: ImportPlan, existing: ExistingInMistlog): ImportSummary {
  const pages = new Set(existing.pages);
  const days = new Set(existing.days);
  const graphPages = plan.pages.filter((p) => p.kind === "page");
  const graphDays = plan.pages.filter((p) => p.kind === "journal");
  const addedToPages = graphPages.filter((p) => pages.has(p.key)).length;
  const addedToDays = graphDays.filter((p) => p.date && days.has(p.date)).length;
  return {
    newPages: graphPages.length - addedToPages,
    addedToPages,
    newDays: graphDays.length - addedToDays,
    addedToDays,
    emptyPages: plan.missingTitles.filter((t) => !pages.has(titleKey(t))).length,
  };
}
