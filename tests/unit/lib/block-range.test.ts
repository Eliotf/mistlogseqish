import { describe, it, expect } from "vitest";
import { blockAt, extendRange, moveRange } from "~/lib/block-range";

const page = [
  "- a", // 0
  "\t- a1", // 1
  "\t- a2", // 2
  "- b", // 3
  "\t- b1", // 4
  "- c", // 5
];
const none = Array<boolean>(page.length).fill(false);

describe("block ranges", () => {
  it("a block is its line and its children", () => {
    expect(blockAt(page, 0)).toEqual({ from: 0, to: 3 });
    expect(blockAt(page, 1)).toEqual({ from: 1, to: 2 });
  });

  it("Shift+↓ adds the next block, children and all", () => {
    expect(extendRange(page, none, { from: 0, to: 3 }, 1)).toEqual({ from: 0, to: 5 });
    expect(extendRange(page, none, { from: 0, to: 6 }, 1)).toEqual({ from: 0, to: 6 });
  });

  it("Shift+↑ adds the line above, and a parent brings all its children", () => {
    expect(extendRange(page, none, { from: 3, to: 5 }, -1)).toEqual({ from: 2, to: 5 });
    // From a2 up to a1, then to its parent a, whose block already ends at 3
    expect(extendRange(page, none, { from: 1, to: 2 }, -1)).toEqual({ from: 0, to: 3 });
    expect(extendRange(page, none, { from: 0, to: 3 }, -1)).toEqual({ from: 0, to: 3 });
  });

  it("a parent selected from below takes its children that came after the selection", () => {
    // b1 selected, Shift+↑ adds b: nothing of b's block may be left out
    expect(extendRange(["- b", "\t- b1", "\t- b2"], [false, false, false], { from: 1, to: 2 }, -1)).toEqual({ from: 0, to: 3 });
  });

  it("skips hidden lines: a folded block is taken whole", () => {
    const hidden = [false, true, true, false, false, false];
    expect(extendRange(page, hidden, { from: 3, to: 5 }, -1)).toEqual({ from: 0, to: 5 });
    expect(moveRange(page, hidden, { from: 3, to: 5 }, -1)).toEqual({ from: 0, to: 3 });
  });

  it("↑/↓ select the neighbouring block instead, stopping at the ends", () => {
    expect(moveRange(page, none, { from: 3, to: 5 }, 1)).toEqual({ from: 5, to: 6 });
    expect(moveRange(page, none, { from: 3, to: 5 }, -1)).toEqual({ from: 2, to: 3 });
    expect(moveRange(page, none, { from: 0, to: 3 }, -1)).toEqual({ from: 0, to: 3 });
    expect(moveRange(page, none, { from: 5, to: 6 }, 1)).toEqual({ from: 5, to: 6 });
  });
});
