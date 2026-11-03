import { blockEnd, bulletContentStart, indentOf } from "./bullets";
import { blockAt, type LineRange } from "./block-range";
import type { DocLine } from "./note-parser";

/**
 * Zooming into a block (PRD F40), as pure line logic. The zoomed block is
 * named by its permanent block ID (F41), so the zoom survives edits, moves
 * and other tabs. zoom-editing.ts applies this to the editor and
 * ZoomCrumbs shows the breadcrumb.
 */

/** Query parameter for the zoomed block: /page/<slug>?block=<id>. */
export const ZOOM_PARAM = "block";

/** The lines shown when zoomed into block `rootId`: it and its children. Null if no line has that ID. */
export function zoomRange(lines: readonly string[], ids: readonly unknown[], rootId: string): LineRange | null {
  const i = ids.indexOf(rootId);
  return i < 0 ? null : blockAt(lines, i);
}

/**
 * The lines line `i` is nested under, outermost first: those whose block
 * (blockEnd) contains it, as for folding and zoom. A blank line is never one.
 */
export function ancestorsOf(lines: readonly string[], i: number): number[] {
  const result: number[] = [];
  for (let j = 0; j < i; j++) {
    if (lines[j] !== "" && blockEnd(lines, j) > i) result.push(j);
  }
  return result;
}

/** A line as a breadcrumb: no indentation or bullet, shortened. */
export function crumbText(line: string, max = 40): string {
  const start = bulletContentStart(line) ?? indentOf(line);
  const text = line.slice(start).trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export interface Crumb {
  /** Null for the whole page. */
  blockId: string | null;
  text: string;
}

/**
 * The breadcrumb for a zoom: the whole page, then each block the zoomed
 * block is nested under, then the zoomed block itself. Null if the block is
 * not on the page.
 */
export function zoomCrumbs(lines: readonly DocLine[], rootId: string, pageTitle: string): Crumb[] | null {
  const texts = lines.map((l) => l.text);
  const i = lines.findIndex((l) => l.id === rootId);
  if (i < 0) return null;
  const chain = [...ancestorsOf(texts, i), i];
  return [{ blockId: null, text: pageTitle }, ...chain.map((j) => ({ blockId: lines[j].id ?? null, text: crumbText(texts[j]) || "…" }))];
}

/** The page address with `?block=` set to `blockId`, or removed for null. */
export function zoomHref(path: string, blockId: string | null): string {
  return blockId ? `${path}?${ZOOM_PARAM}=${encodeURIComponent(blockId)}` : path;
}
