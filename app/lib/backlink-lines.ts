import { parseLine, type DocLine, type TextRun } from "./note-parser";
import { WIKILINK_MARK, isWikilinkAttrs } from "./wikilink";

/**
 * Linked references (PRD F4): what the backlinks route returns, and how one
 * stored line is shown. Shared by the route (server) and the section (browser).
 */

export interface BacklinkLine {
  line: number;
  text: string;
  /** Link marks in the line: [from, to) offsets of a title, and its page. */
  links: Array<{ from: number; to: number; pageId: string }>;
  /** In linked references: the lines nested under this one, in order. Left out when there are none. */
  children?: BacklinkLine[];
  /** Nested lines past MAX_NESTED_LINES, not sent. */
  more?: number;
}

/** One page linking here, as WorkspaceAgent.backlinks returns it. */
export interface BacklinkSource {
  sourceId: string;
  sourceTitle: string;
  sourceKind: "page" | "journal";
  lines: BacklinkLine[];
}

export interface BacklinkGroup {
  pageId: string;
  title: string;
  kind: "page" | "journal";
  slug: string | null;
  lines: BacklinkLine[];
}

/**
 * A stored line reduced to its text and link positions: what crosses an RPC
 * boundary (results must be serialisable, and other mark attributes are not
 * needed). Used for linked references and the Tasks view.
 */
export function toBacklinkLine(line: number, content: DocLine): BacklinkLine {
  return {
    line,
    text: content.text,
    links: content.marks.flatMap((m) => (m.type === WIKILINK_MARK && isWikilinkAttrs(m.attrs) ? [{ from: m.from, to: m.to, pageId: m.attrs.pageId }] : [])),
  };
}

export type Segment = { kind: "text"; text: string } | { kind: "bracket"; text: string } | { kind: "link"; text: string; pageId: string };

/**
 * A stored line as pieces to show: indentation and the bullet dropped, link
 * titles as links (shown with their current title by the caller), and the
 * `[[` `]]` around them as faint brackets.
 */
export function lineSegments(line: BacklinkLine): Segment[] {
  // Skip the indent and bullet; keep a task keyword, which is part of what the line says
  const shape = parseLine(line.text);
  const body = shape.indent + (shape.bullet ? Math.min(2, line.text.length - shape.indent) : 0);
  const links = [...line.links].filter((l) => l.from >= body && l.to <= line.text.length && l.from < l.to).sort((a, b) => a.from - b.from);
  const segments: Segment[] = [];
  let at = body;
  const pushText = (text: string) => {
    if (text) segments.push({ kind: "text", text });
  };
  for (const link of links) {
    if (link.from < at) continue;
    let before = line.text.slice(at, link.from);
    const opens = before.endsWith("[[");
    if (opens) before = before.slice(0, -2);
    pushText(before);
    if (opens) segments.push({ kind: "bracket", text: "[[" });
    segments.push({ kind: "link", text: line.text.slice(link.from, link.to), pageId: link.pageId });
    at = link.to;
    if (line.text.startsWith("]]", at)) {
      segments.push({ kind: "bracket", text: "]]" });
      at += 2;
    }
  }
  pushText(line.text.slice(at));
  return segments;
}

/** The most lines sent from under one linking line; the rest are counted. */
export const MAX_NESTED_LINES = 30;

/**
 * A page's lines from its stored runs (the index's page_text): each line's
 * text and link positions, numbered as in the page.
 */
export function linesFromRuns(runs: readonly TextRun[]): BacklinkLine[] {
  const lines: BacklinkLine[] = [{ line: 0, text: "", links: [] }];
  for (const run of runs) {
    const current = lines[lines.length - 1];
    if (typeof run !== "string") {
      current.links.push({ from: current.text.length, to: current.text.length + run.text.length, pageId: run.pageId });
      current.text += run.text;
      continue;
    }
    const parts = run.split("\n");
    lines[lines.length - 1].text += parts[0];
    for (const part of parts.slice(1)) lines.push({ line: lines.length, text: part, links: [] });
  }
  return lines;
}

/**
 * The lines nested under line `at` (more indented, up to the next line that
 * isn't), at most `max` of them, and how many more there are.
 */
export function nestedLines(lines: readonly BacklinkLine[], at: number, max = MAX_NESTED_LINES): { children: BacklinkLine[]; more: number } {
  const indent = parseLine(lines[at]?.text ?? "").indent;
  let end = at + 1;
  while (end < lines.length && parseLine(lines[end].text).indent > indent) end++;
  const children = lines.slice(at + 1, Math.min(end, at + 1 + max));
  return { children, more: end - (at + 1) - children.length };
}

/**
 * Linking lines with what is nested under each, from the page's stored runs.
 * A linking line nested under an earlier one is shown there, so it is not
 * listed again. Without runs (or if they don't match the stored lines, which
 * should not happen), the lines are listed alone.
 */
export function withNestedLines(linking: readonly BacklinkLine[], runs: readonly TextRun[] | null): BacklinkLine[] {
  const lines = runs ? linesFromRuns(runs) : [];
  const listed: BacklinkLine[] = [];
  let shownUpTo = -1;
  for (const link of linking) {
    if (link.line <= shownUpTo) continue;
    if (lines[link.line]?.text !== link.text) {
      listed.push(link);
      continue;
    }
    const { children, more } = nestedLines(lines, link.line);
    shownUpTo = link.line + children.length + more;
    listed.push({ ...link, ...(children.length ? { children } : {}), ...(more ? { more } : {}) });
  }
  return listed;
}
