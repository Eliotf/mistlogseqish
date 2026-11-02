import { blockEnd, indentOf } from "./bullets";

/**
 * Moving blocks (PRD F38), as pure line logic. A block is a line and its
 * children (the following lines indented deeper), and always moves whole.
 * block-moving.ts applies these plans to the editor.
 */

export interface MovePlan {
  /** The lines that move: from..to (exclusive). */
  from: number;
  to: number;
  /** The line they move in front of, as an index in the lines before the move (lines.length for the end). Never inside from..to. */
  before: number;
  /** Tabs to add to (or, if negative, remove from) every moved line. */
  indentDelta: number;
}

/**
 * Alt+Shift+↑/↓: swap the block at line `i` with the previous or next block
 * at the same level, under the same parent. Null at the first or last block
 * of its level.
 */
export function moveBlockPlan(lines: readonly string[], i: number, dir: 1 | -1): MovePlan | null {
  const level = indentOf(lines[i]);
  const end = blockEnd(lines, i);
  if (dir === -1) {
    let j = i - 1;
    while (j >= 0 && indentOf(lines[j]) > level) j--;
    if (j < 0 || indentOf(lines[j]) < level) return null;
    return { from: i, to: end, before: j, indentDelta: 0 };
  }
  if (end >= lines.length || indentOf(lines[end]) !== level) return null;
  return { from: i, to: end, before: blockEnd(lines, end), indentDelta: 0 };
}

/**
 * Dropping the block at line `i` on line `target`: it goes above the target,
 * at the target's level. Null if that would not move it (dropped on itself,
 * one of its children, or the line just below it at the same level).
 */
export function dropPlan(lines: readonly string[], i: number, target: number): MovePlan | null {
  const end = blockEnd(lines, i);
  if (target >= i && target < end) return null;
  const indentDelta = indentOf(lines[target]) - indentOf(lines[i]);
  if (target === end && indentDelta === 0) return null;
  return { from: i, to: end, before: target, indentDelta };
}

/** Line `line`'s indentation after the move. Never below zero. */
export function movedIndent(line: string, delta: number): number {
  return Math.max(0, indentOf(line) + delta);
}

/** Where line `k` of the old order ends up. */
export function indexAfterMove(plan: MovePlan, k: number): number {
  const size = plan.to - plan.from;
  if (k >= plan.from && k < plan.to) {
    const start = plan.before < plan.from ? plan.before : plan.before - size;
    return start + (k - plan.from);
  }
  if (plan.before < plan.from) return k >= plan.before && k < plan.from ? k + size : k;
  return k >= plan.to && k < plan.before ? k - size : k;
}
