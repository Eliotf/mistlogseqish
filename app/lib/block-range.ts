import { blockEnd } from "./bullets";
import { nearestVisible } from "./folding";

/**
 * Which whole blocks are selected (PRD F39), as pure line logic: lines
 * from..to (exclusive). A selection never splits a line from its children,
 * so deleting or indenting it keeps the outline whole. Hidden (folded)
 * lines are never selected on their own, only with the block that hides
 * them. block-selection.ts applies this to the editor.
 */

export interface LineRange {
  from: number;
  to: number;
}

/** The block at line `i`: the line and its children. */
export function blockAt(lines: readonly string[], i: number): LineRange {
  return { from: i, to: blockEnd(lines, i) };
}

/**
 * Shift+↑ adds the visible line above (with all its children, so a parent
 * brings its whole block); Shift+↓ adds the next block. Returns the range
 * unchanged at the top or bottom.
 */
export function extendRange(lines: readonly string[], hidden: readonly boolean[], range: LineRange, dir: 1 | -1): LineRange {
  if (dir === -1) {
    const above = range.from > 0 ? nearestVisible(hidden, range.from - 1, -1) : null;
    if (above === null) return range;
    return { from: above, to: Math.max(range.to, blockEnd(lines, above)) };
  }
  if (range.to >= lines.length || hidden[range.to]) return range;
  return { from: range.from, to: Math.max(range.to, blockEnd(lines, range.to)) };
}

/** ↑/↓: select the block above or below instead. Returns the range unchanged at the top or bottom. */
export function moveRange(lines: readonly string[], hidden: readonly boolean[], range: LineRange, dir: 1 | -1): LineRange {
  const next = dir === -1 ? (range.from > 0 ? nearestVisible(hidden, range.from - 1, -1) : null) : range.to < lines.length ? nearestVisible(hidden, range.to, 1) : null;
  return next === null ? range : blockAt(lines, next);
}
