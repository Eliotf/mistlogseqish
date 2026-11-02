import { describe, it, expect } from "vitest";
import { foldedAncestors, hasChildren, hiddenLines, nearestVisible } from "~/lib/folding";

const page = [
  "- a", // 0
  "\t- a1", // 1
  "\t\t- a1x", // 2
  "\t- a2", // 3
  "- b", // 4
  "", // 5
  "\tafter a blank line", // 6
];

describe("folding rules", () => {
  it("knows which lines have children; a blank line ends a block", () => {
    expect([0, 1, 2, 3, 4, 5].map((i) => hasChildren(page, i))).toEqual([true, true, false, false, false, true]);
  });

  it("hides everything nested under a folded line, and nothing else", () => {
    const folded = [true, false, false, false, false, false, false];
    expect(hiddenLines(page, folded)).toEqual([false, true, true, true, false, false, false]);
  });

  it("hides only the inner block when an inner line is folded", () => {
    const folded = [false, true, false, false, false, false, false];
    expect(hiddenLines(page, folded)).toEqual([false, false, true, false, false, false, false]);
  });

  it("a folded line with no children hides nothing", () => {
    expect(hiddenLines(page, [false, false, false, false, true, false, false])).toEqual(Array(7).fill(false));
  });

  it("lists the folded lines that hide a line, outermost first", () => {
    const folded = [true, true, false, false, false, false, false];
    expect(foldedAncestors(page, folded, 2)).toEqual([0, 1]);
    expect(foldedAncestors(page, folded, 3)).toEqual([0]);
    expect(foldedAncestors(page, folded, 4)).toEqual([]);
  });

  it("finds the nearest visible line in either direction", () => {
    const hidden = [false, true, true, false];
    expect(nearestVisible(hidden, 1, 1)).toBe(3);
    expect(nearestVisible(hidden, 2, -1)).toBe(0);
    expect(nearestVisible([true, true], 0, 1)).toBeNull();
  });
});
