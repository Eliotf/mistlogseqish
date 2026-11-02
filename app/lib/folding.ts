import { blockEnd } from "./bullets";

/**
 * Folding a block's children (PRD F37), as pure line logic. A line is folded
 * when its `collapsed` attribute is set (Logseq's `collapsed:: true`); the
 * attribute lives in the page, so folds sync to every device. A line is
 * hidden when any line it is nested under is folded. folding-editing.ts
 * applies this to the editor.
 */

export const COLLAPSED_ATTR = "collapsed";

export function hasChildren(texts: readonly string[], i: number): boolean {
  return blockEnd(texts, i) > i + 1;
}

/** Which lines are hidden inside a folded block. A folded line with no children hides nothing. */
export function hiddenLines(texts: readonly string[], collapsed: readonly boolean[]): boolean[] {
  const hidden = Array<boolean>(texts.length).fill(false);
  for (let i = 0; i < texts.length; i++) {
    if (!collapsed[i] || hidden[i]) continue;
    const end = blockEnd(texts, i);
    for (let j = i + 1; j < end; j++) hidden[j] = true;
  }
  return hidden;
}

/** The folded lines that hide line `i`, outermost first. */
export function foldedAncestors(texts: readonly string[], collapsed: readonly boolean[], i: number): number[] {
  const result: number[] = [];
  for (let j = 0; j < i; j++) {
    if (collapsed[j] && blockEnd(texts, j) > i) result.push(j);
  }
  return result;
}

/** The nearest visible line from `i` in direction `dir`, or null if there is none. */
export function nearestVisible(hidden: readonly boolean[], i: number, dir: 1 | -1): number | null {
  for (let j = i; j >= 0 && j < hidden.length; j += dir) {
    if (!hidden[j]) return j;
  }
  return null;
}
