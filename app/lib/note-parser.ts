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
export const PARSER_VERSION = 3;

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
  /** All lines joined with newlines, for full-text search. */
  text: string;
}

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

  return { links, tags, tasks, text: lines.map((l) => l.text).join("\n") };
}
