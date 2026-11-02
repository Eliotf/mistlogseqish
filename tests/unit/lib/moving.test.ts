import { describe, it, expect } from "vitest";
import { dropPlan, indexAfterMove, moveBlockPlan, type MovePlan } from "~/lib/moving";

const page = [
  "- a", // 0
  "\t- a1", // 1
  "\t- a2", // 2
  "\t\t- a2x", // 3
  "- b", // 4
  "\t- b1", // 5
  "- c", // 6
];

/** The lines in their new order. */
function apply(lines: string[], plan: MovePlan): string[] {
  const out = Array<string>(lines.length);
  lines.forEach((line, k) => {
    const moved = k >= plan.from && k < plan.to;
    const tabs = moved ? Math.max(0, (/^\t*/.exec(line)?.[0].length ?? 0) + plan.indentDelta) : -1;
    out[indexAfterMove(plan, k)] = moved ? "\t".repeat(tabs) + line.replace(/^\t*/, "") : line;
  });
  return out;
}

describe("moveBlockPlan", () => {
  it("moves a block with its children above the previous block at its level", () => {
    const plan = moveBlockPlan(page, 4, -1)!;
    expect(plan).toEqual({ from: 4, to: 6, before: 0, indentDelta: 0 });
    expect(apply(page, plan)).toEqual(["- b", "\t- b1", "- a", "\t- a1", "\t- a2", "\t\t- a2x", "- c"]);
  });

  it("moves a block below the next block at its level, past that block's children", () => {
    const plan = moveBlockPlan(page, 0, 1)!;
    expect(apply(page, plan)).toEqual(["- b", "\t- b1", "- a", "\t- a1", "\t- a2", "\t\t- a2x", "- c"]);
  });

  it("swaps children within their parent", () => {
    expect(apply(page, moveBlockPlan(page, 2, -1)!)).toEqual(["- a", "\t- a2", "\t\t- a2x", "\t- a1", "- b", "\t- b1", "- c"]);
  });

  it("never moves a block out of its parent, or past the first or last block", () => {
    expect(moveBlockPlan(page, 1, -1)).toBeNull(); // first child
    expect(moveBlockPlan(page, 2, 1)).toBeNull(); // last child
    expect(moveBlockPlan(page, 0, -1)).toBeNull();
    expect(moveBlockPlan(page, 6, 1)).toBeNull();
  });
});

describe("dropPlan", () => {
  it("drops a block above the target at the target's level, children and all", () => {
    const plan = dropPlan(page, 4, 1)!;
    expect(plan.indentDelta).toBe(1);
    expect(apply(page, plan)).toEqual(["- a", "\t- b", "\t\t- b1", "\t- a1", "\t- a2", "\t\t- a2x", "- c"]);
  });

  it("drops a nested block further down, at a shallower level", () => {
    expect(apply(page, dropPlan(page, 2, 6)!)).toEqual(["- a", "\t- a1", "- b", "\t- b1", "- a2", "\t- a2x", "- c"]);
  });

  it("does nothing when dropped on itself, its own children, or just below itself at its level", () => {
    expect(dropPlan(page, 0, 0)).toBeNull();
    expect(dropPlan(page, 0, 3)).toBeNull();
    expect(dropPlan(page, 0, 4)).toBeNull();
  });

  it("dropped just below itself at another level, it changes level in place", () => {
    expect(apply(page, dropPlan(page, 2, 4)!)).toEqual(["- a", "\t- a1", "- a2", "\t- a2x", "- b", "\t- b1", "- c"]);
  });
});
