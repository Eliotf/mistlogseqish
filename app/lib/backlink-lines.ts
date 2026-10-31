import { parseLine } from "./note-parser";

/**
 * Linked references (PRD F4): what the backlinks route returns, and how one
 * stored line is shown. Shared by the route (server) and the section (browser).
 */

export interface BacklinkLine {
  line: number;
  text: string;
  /** Link marks in the line: [from, to) offsets of a title, and its page. */
  links: Array<{ from: number; to: number; pageId: string }>;
}

export interface BacklinkGroup {
  pageId: string;
  title: string;
  kind: "page" | "journal";
  slug: string | null;
  lines: BacklinkLine[];
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
