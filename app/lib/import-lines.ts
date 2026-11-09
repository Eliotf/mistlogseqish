import * as Y from "yjs";
import { BLOCK_ID_ATTR, isBlockId, newBlockId } from "./block-ids";
import { COLLAPSED_ATTR } from "./folding";
import { isPageId } from "./note-ids";
import { WIKILINK_MARK } from "./wikilink";

/**
 * Lines a Logseq import adds to one document (PRD F31), as sent from the
 * browser to DocumentAgent.importLines, and how they are written into and
 * removed from its Yjs document. Shared by the browser (which builds them)
 * and DocumentAgent (which writes them); keep it free of editor and server
 * code.
 *
 * Each line is a paragraph like the editor's: its text (tabs, `- `), a
 * block ID, the fold, and `wikilink` marks on link titles and tag names,
 * stored as y-tiptap stores them ({ wikilink: { pageId } } on the text).
 */

export interface ImportedLink {
  /** The marked range: the title inside `[[...]]`, or a tag's name. */
  from: number;
  to: number;
  pageId: string;
}

export interface ImportedLine {
  text: string;
  /** Logseq's `id::`, or null for a new one. */
  blockId: string | null;
  collapsed: boolean;
  links: ImportedLink[];
}

/** An import that has not been undone: running (not finished), done, or being undone. */
export interface ImportRecord {
  importId: string;
  /** The name of the folder imported (null for imports from before names were kept). */
  label: string | null;
  state: "running" | "done" | "undoing";
  startedAt: number;
  finishedAt: number | null;
  /** Documents it wrote to or created, not yet undone. */
  pages: number;
  /** Of those, pages it created. */
  created: number;
}

/** Refused while another import is running or being undone; the result names it. */
export type StartImportResult = { ok: true } | { ok: false; current: ImportRecord };

/** "busy": another import is running or being undone, so this one can't be undone yet. */
export type StartUndoResult = "ok" | "missing" | "busy";

/** The longest folder name kept for an import. */
export const MAX_IMPORT_LABEL = 200;

/** An import's folder name as stored: trimmed and capped, or null if there is none. */
export function importLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  return raw.trim().slice(0, MAX_IMPORT_LABEL) || null;
}

export type ImportLinesResult = { ok: true; added: number } | { ok: false; code: "invalid" | "missing" };

/**
 * Titles or documents per import request (/api/import/:step). Each costs up
 * to five Durable Object calls (getAgentByName makes one of its own), and
 * Workers' free plan allows 50 subrequests per request.
 */
export const IMPORT_BATCH = 6;

/** Lines one write may carry: more than any real page, and keeps a request bounded. */
export const MAX_IMPORTED_LINES = 20000;
const MAX_LINE_LENGTH = 100_000;

/** Whether a value from the network is a list of well-formed imported lines. */
export function isImportedLines(value: unknown): value is ImportedLine[] {
  if (!Array.isArray(value) || value.length > MAX_IMPORTED_LINES) return false;
  return value.every((line: unknown) => {
    if (typeof line !== "object" || line === null) return false;
    const { text, blockId, collapsed, links } = line as Partial<Record<keyof ImportedLine, unknown>>;
    if (typeof text !== "string" || text.length > MAX_LINE_LENGTH || /[\n\r]/.test(text)) return false;
    if (blockId !== null && !isBlockId(blockId)) return false;
    if (typeof collapsed !== "boolean" || !Array.isArray(links)) return false;
    let end = 0;
    return links.every((link: unknown) => {
      if (typeof link !== "object" || link === null) return false;
      const { from, to, pageId } = link as Partial<Record<keyof ImportedLink, unknown>>;
      // In order, not overlapping, inside the text
      const ok = Number.isInteger(from) && Number.isInteger(to) && (from as number) >= end && (to as number) > (from as number) && (to as number) <= text.length && typeof pageId === "string" && isPageId(pageId);
      if (ok) end = to as number;
      return ok;
    });
  });
}

/** Block IDs already used in a document. */
function idsIn(fragment: Y.XmlFragment): Set<string> {
  const ids = new Set<string>();
  for (const child of fragment.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    const id: unknown = child.getAttribute(BLOCK_ID_ATTR);
    if (isBlockId(id)) ids.add(id);
  }
  return ids;
}

/**
 * Append lines at the end of a document, below what is there. A line keeps
 * its block ID unless the document already has it (it then gets a new one,
 * so IDs stay unique). Returns the block IDs of the added lines, in order:
 * what undo removes. The caller wraps it in a transaction.
 */
export function appendImportedLines(fragment: Y.XmlFragment, lines: readonly ImportedLine[]): string[] {
  const taken = idsIn(fragment);
  const added: string[] = [];
  const paragraphs = lines.map((line) => {
    const id = line.blockId && !taken.has(line.blockId) ? line.blockId : newBlockId();
    taken.add(id);
    added.push(id);
    const paragraph = new Y.XmlElement("paragraph");
    paragraph.setAttribute(BLOCK_ID_ATTR, id);
    // y-tiptap stores node attributes as they are; the editor reads a boolean
    if (line.collapsed) paragraph.setAttribute(COLLAPSED_ATTR, true as unknown as string);
    const text = new Y.XmlText();
    paragraph.insert(0, [text]);
    return { paragraph, text, line };
  });
  fragment.insert(fragment.length, paragraphs.map((p) => p.paragraph));
  // Text is filled once the paragraphs are in the document (Yjs types can't be edited before)
  for (const { text, line } of paragraphs) {
    // Text inserted without attributes takes the formatting before it, so plain runs say "no link"
    const plain = { [WIKILINK_MARK]: null };
    let at = 0;
    for (const link of line.links) {
      if (link.from > at) text.insert(text.length, line.text.slice(at, link.from), plain);
      text.insert(text.length, line.text.slice(link.from, link.to), { [WIKILINK_MARK]: { pageId: link.pageId } });
      at = link.to;
    }
    if (at < line.text.length) text.insert(text.length, line.text.slice(at), plain);
  }
  return added;
}

/**
 * Remove the lines with these block IDs, wherever they are now and whatever
 * they say now; every other line stays. Returns how many were removed. The
 * caller wraps it in a transaction.
 */
export function removeImportedLines(fragment: Y.XmlFragment, blockIds: readonly string[]): number {
  const wanted = new Set(blockIds);
  let removed = 0;
  // From the end, so earlier indexes stay valid
  const children = fragment.toArray();
  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child instanceof Y.XmlElement && wanted.has(child.getAttribute(BLOCK_ID_ATTR) as string)) {
      fragment.delete(i, 1);
      removed++;
    }
  }
  return removed;
}
