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
export const PARSER_VERSION = 1;

export type TaskState = "TODO" | "DOING" | "DONE";

export interface LineMark {
  type: string;
  from: number;
  to: number;
  attrs?: Record<string, unknown>;
}

export interface DocLine {
  text: string;
  marks: LineMark[];
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
}

export interface ParsedNote {
  links: ParsedLink[];
  tags: ParsedTag[];
  tasks: ParsedTask[];
  /** All lines joined with newlines, for full-text search. */
  text: string;
}

const TASK_RE = /^(TODO|DOING|DONE)(?= |$)/;
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

/** Replace the given ranges with spaces so offsets stay the same. */
function blank(text: string, ranges: Array<[number, number]>): string {
  const chars = text.split("");
  for (const [from, to] of ranges) {
    for (let k = Math.max(0, from); k < Math.min(chars.length, to); k++) chars[k] = " ";
  }
  return chars.join("");
}

function extractTags(text: string, marks: LineMark[], line: number): ParsedTag[] {
  // Link text is a title snapshot, and code is literal, so neither holds tags
  const hidden: Array<[number, number]> = marks
    .filter((m) => m.type === WIKILINK_MARK)
    .map((m) => [m.from, m.to]);
  for (const m of text.matchAll(INLINE_CODE_RE)) {
    hidden.push([m.index, m.index + m[0].length]);
  }
  const visible = blank(text, hidden);
  const tags: ParsedTag[] = [];
  for (const m of visible.matchAll(TAG_RE)) {
    const name = m[2];
    if (/^\p{N}+$/u.test(name)) continue;
    tags.push({ name, key: name.toLowerCase(), line });
  }
  return tags;
}

export function parseNote(lines: DocLine[]): ParsedNote {
  const links: ParsedLink[] = [];
  const tags: ParsedTag[] = [];
  const tasks: ParsedTask[] = [];
  const seenLinks = new Set<string>();
  let inFence = false;

  lines.forEach(({ text, marks }, line) => {
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
      tasks.push({ line, state: shape.task, indent: shape.indent, text: text.slice(shape.bodyStart) });
    }
    tags.push(...extractTags(text, marks, line));
  });

  return { links, tags, tasks, text: lines.map((l) => l.text).join("\n") };
}
