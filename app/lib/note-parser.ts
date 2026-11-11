import { WIKILINK_MARK, isWikilinkAttrs } from "./wikilink";

/**
 * The shared note parser (AGENTS.md invariant 7). Both the workspace index
 * and the editor use it, so links, tags and tasks are extracted one way.
 *
 * Input is a document as plain lines with mark ranges (see note-lines.ts
 * for converting from Yjs or ProseMirror). Output is what the index stores.
 * Bump PARSER_VERSION whenever the output for the same input changes; the
 * index rebuilds when it does (docs/technical-architecture.md).
 */
export const PARSER_VERSION = 4;

/** Task keywords (PRD F6, F42): TODO -> DOING -> DONE, and Logseq's LATER -> NOW -> DONE. */
export type TaskState = "TODO" | "DOING" | "DONE" | "LATER" | "NOW";

/** Logseq's priorities, written `[#A]`, `[#B]` or `[#C]` in a line. */
export type TaskPriority = "A" | "B" | "C";

export interface LineMark {
  type: string;
  from: number;
  to: number;
  attrs?: Record<string, unknown>;
}

export interface DocLine {
  text: string;
  marks: LineMark[];
  /** The line's permanent block ID (PRD F41), once it has one. */
  id?: string;
}

export interface LineShape {
  /** Number of leading tab characters. Spaces never count as indentation. */
  indent: number;
  /** Whether the line is a `- ` bullet (after the indentation). */
  bullet: boolean;
  task: TaskState | null;
  /** Offset where the line's content starts, after indent, bullet and task keyword. */
  bodyStart: number;
}

export interface ParsedLink {
  pageId: string;
  line: number;
}

export interface ParsedTag {
  /** As written, without the `#`. */
  name: string;
  /** Lowercase, for matching. */
  key: string;
  line: number;
}

export interface ParsedTask {
  line: number;
  state: TaskState;
  indent: number;
  /** The line's content after the task keyword. */
  text: string;
  /** The first `[#A]`–`[#C]` in the line (outside inline code), if any. */
  priority: TaskPriority | null;
  /** The line's permanent block ID, so the Tasks view can open it (zoomed). */
  blockId: string | null;
}

export interface ParsedNote {
  links: ParsedLink[];
  tags: ParsedTag[];
  tasks: ParsedTask[];
  /** All lines joined with newlines, as stored. */
  text: string;
  /**
   * The same text in runs, each link's text marked with the page it links
   * to, so search can index the linked page's current title instead of the
   * stored copy (PRD F13). Joining the runs' text gives `text`.
   */
  runs: TextRun[];
}

/** A piece of a note's text: plain text, or the text of a link to a page. */
export type TextRun = string | { pageId: string; text: string };

const TASK_RE = /^(TODO|DOING|DONE|LATER|NOW)(?= |$)/;
const PRIORITY_RE = /\[#([ABC])\]/;
// A tag starts at the line start or after whitespace, and is letters,
// digits, `_`, `-` or `/`. Tags made only of digits ("issue #42") are skipped.
const TAG_RE = /(^|\s)#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu;
const FENCE_RE = /^```/;
const INLINE_CODE_RE = /`[^`]*`/g;

export function parseLine(text: string): LineShape {
  let i = 0;
  while (text[i] === "\t") i++;
  const indent = i;
  let bullet = false;
  if (text.startsWith("- ", i)) {
    bullet = true;
    i += 2;
  } else if (text.slice(i) === "-") {
    bullet = true;
    i += 1;
  }
  const m = TASK_RE.exec(text.slice(i));
  let task: TaskState | null = null;
  if (m) {
    task = m[1] as TaskState;
    i += m[1].length;
    if (text[i] === " ") i++;
  }
  return { indent, bullet, task, bodyStart: i };
}

/** A line's priority and where its `[#X]` starts: the first `[#A]`, `[#B]` or `[#C]` outside inline code. */
export function priorityAt(text: string): { priority: TaskPriority; at: number } | null {
  const visible = text.replace(INLINE_CODE_RE, (code) => " ".repeat(code.length));
  const m = PRIORITY_RE.exec(visible);
  return m ? { priority: m[1] as TaskPriority, at: m.index } : null;
}

export function priorityOf(text: string): TaskPriority | null {
  return priorityAt(text)?.priority ?? null;
}

/** Replace the given ranges with spaces so offsets stay the same. */
function blank(text: string, ranges: Array<[number, number]>): string {
  const chars = text.split("");
  for (const [from, to] of ranges) {
    for (let k = Math.max(0, from); k < Math.min(chars.length, to); k++) chars[k] = " ";
  }
  return chars.join("");
}

/** Whether a page title can be written as a plain `#name` tag; otherwise it needs `#[[...]]`. */
export function isPlainTagName(name: string): boolean {
  return /^[\p{L}\p{N}_][\p{L}\p{N}_/-]*$/u.test(name) && !/^\p{N}+$/u.test(name);
}

/** One tag in a line: `#name` or `#[[multi word name]]` (PRD F45). */
export interface TagMatch {
  /** Where the `#` is. */
  from: number;
  to: number;
  /** The name's own range (inside the brackets for `#[[...]]`). */
  innerFrom: number;
  innerTo: number;
  name: string;
  bracketed: boolean;
}

const BRACKETED_TAG_RE = /(^|\s)#\[\[([^[\]\n]*)\]\]/g;
const LINK_TEXT_RE = /\[\[[^[\]\n]*\]\]/g;

/**
 * The tags in a line, in order. A tag starts at the line start or after
 * whitespace: `#name` (letters, digits, `_`, `-`, `/`, not only digits) or
 * `#[[any name]]`. Not inside inline code, and not inside a `[[link]]`'s
 * text (a title snapshot). Used by the index and the editor alike
 * (invariant 7).
 */
export function tagsInLine(text: string): TagMatch[] {
  const tags: TagMatch[] = [];
  const hidden: Array<[number, number]> = [];
  for (const m of text.matchAll(INLINE_CODE_RE)) hidden.push([m.index, m.index + m[0].length]);
  const inCode = (at: number) => hidden.some(([a, b]) => at >= a && at < b);
  for (const m of text.matchAll(BRACKETED_TAG_RE)) {
    const from = m.index + m[1].length;
    const name = m[2];
    if (inCode(from) || !name.trim()) continue;
    tags.push({ from, to: from + 3 + name.length + 2, innerFrom: from + 3, innerTo: from + 3 + name.length, name, bracketed: true });
  }
  // Brackets (a link's title, or a bracketed tag) and code hold no #name tags
  for (const m of text.matchAll(LINK_TEXT_RE)) hidden.push([m.index, m.index + m[0].length]);
  const visible = blank(text, hidden);
  for (const m of visible.matchAll(TAG_RE)) {
    const name = m[2];
    if (/^\p{N}+$/u.test(name)) continue;
    const from = m.index + m[1].length;
    tags.push({ from, to: from + 1 + name.length, innerFrom: from + 1, innerTo: from + 1 + name.length, name, bracketed: false });
  }
  return tags.sort((a, b) => a.from - b.from);
}

/** A `[[link]]`, `#tag` or `#[[tag]]` written in a line, found from its text alone. */
export interface WrittenLink {
  kind: "link" | "tag";
  /** `[[...]]` or `#[[...]]`, rather than a plain `#tag`. */
  bracketed: boolean;
  from: number;
  to: number;
  innerFrom: number;
  innerTo: number;
  /** The title as written (not trimmed). */
  name: string;
}

const LINK_RE = /\[\[([^[\]\n]*)\]\]/g;

/**
 * Every link and tag written in a line, in order, from the text alone: the
 * editor uses it to find what to show and link, and the Logseq import to
 * find titles to link (invariant 7). The brackets of a `#[[tag]]` belong to
 * the tag, not a separate link.
 */
export function writtenLinks(text: string): WrittenLink[] {
  const tags = tagsInLine(text);
  const found: WrittenLink[] = tags.map((t) => ({ kind: "tag", bracketed: t.bracketed, from: t.from, to: t.to, innerFrom: t.innerFrom, innerTo: t.innerTo, name: t.name }));
  for (const m of text.matchAll(LINK_RE)) {
    if (tags.some((t) => t.bracketed && t.from + 1 === m.index)) continue;
    found.push({ kind: "link", bracketed: true, from: m.index, to: m.index + m[0].length, innerFrom: m.index + 2, innerTo: m.index + 2 + m[1].length, name: m[1] });
  }
  return found.sort((a, b) => a.from - b.from);
}

function extractTags(text: string, line: number): ParsedTag[] {
  const tags: ParsedTag[] = [];
  for (const { name } of tagsInLine(text)) {
    tags.push({ name, key: name.trim().toLowerCase(), line });
  }
  return tags;
}

export function parseNote(lines: DocLine[]): ParsedNote {
  const links: ParsedLink[] = [];
  const tags: ParsedTag[] = [];
  const tasks: ParsedTask[] = [];
  const seenLinks = new Set<string>();
  let inFence = false;

  lines.forEach(({ text, marks, id }, line) => {
    // Links are explicit marks, so they count even inside code fences.
    // A link split into several runs (by other marks) is reported once per line.
    for (const mark of marks) {
      if (mark.type !== WIKILINK_MARK || !isWikilinkAttrs(mark.attrs)) continue;
      const key = `${line}\u0000${mark.attrs.pageId}`;
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      links.push({ pageId: mark.attrs.pageId, line });
    }

    const shape = parseLine(text);
    const afterBullet = text.slice(shape.indent).replace(/^-( |$)/, "");
    if (FENCE_RE.test(afterBullet)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;

    if (shape.task) {
      tasks.push({ line, state: shape.task, indent: shape.indent, text: text.slice(shape.bodyStart), priority: priorityOf(text), blockId: id ?? null });
    }
    tags.push(...extractTags(text, line));
  });

  const runs: TextRun[] = [];
  const pushPlain = (text: string) => {
    if (!text) return;
    const last = runs.length - 1;
    if (typeof runs[last] === "string") runs[last] += text;
    else runs.push(text);
  };
  lines.forEach((line, i) => {
    if (i > 0) pushPlain("\n");
    let at = 0;
    for (const link of linkRanges(line)) {
      pushPlain(line.text.slice(at, link.from));
      runs.push({ pageId: link.pageId, text: line.text.slice(link.from, link.to) });
      at = link.to;
    }
    pushPlain(line.text.slice(at));
  });

  return { links, tags, tasks, text: lines.map((l) => l.text).join("\n"), runs };
}

/**
 * A line's links as whole ranges, in order. A link split into several runs
 * (another mark starting or stopping inside it) is one range; ranges that
 * overlap a different link, or fall outside the text, are dropped.
 */
function linkRanges({ text, marks }: DocLine): Array<{ from: number; to: number; pageId: string }> {
  const found = marks
    .flatMap((m) => (m.type === WIKILINK_MARK && isWikilinkAttrs(m.attrs) ? [{ from: Math.max(0, m.from), to: Math.min(text.length, m.to), pageId: m.attrs.pageId }] : []))
    .filter((r) => r.from < r.to)
    .sort((a, b) => a.from - b.from || a.to - b.to);
  const ranges: Array<{ from: number; to: number; pageId: string }> = [];
  for (const r of found) {
    const last = ranges[ranges.length - 1];
    if (last && r.from <= last.to) {
      if (r.pageId === last.pageId) last.to = Math.max(last.to, r.to);
      continue;
    }
    ranges.push({ ...r });
  }
  return ranges;
}

/**
 * A note's text for search: each link's text replaced by the current title
 * of the page it links to, or kept as stored when `titleOf` has none (a
 * deleted page, or one not indexed yet).
 */
export function textWithTitles(runs: TextRun[], titleOf: (pageId: string) => string | undefined): string {
  return runs.map((run) => (typeof run === "string" ? run : (titleOf(run.pageId) ?? run.text))).join("");
}
