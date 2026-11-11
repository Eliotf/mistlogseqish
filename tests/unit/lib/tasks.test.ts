import { describe, it, expect } from "vitest";
import { nextTaskState, setTaskEdit, cyclePlan, taskStateOf } from "~/lib/tasks";
import type { PrefixEdit } from "~/lib/bullets";

function apply(lines: string[], edits: PrefixEdit[]): string[] {
  const out = [...lines];
  for (const e of edits) out[e.line] = out[e.line].slice(0, e.from) + e.text + out[e.line].slice(e.to);
  return out;
}
const cycle = (text: string) => apply([text], cyclePlan([text], [0]))[0];

describe("nextTaskState", () => {
  it("cycles through every state: none -> TODO -> DOING -> LATER -> NOW -> DONE -> none", () => {
    expect([null, "TODO", "DOING", "LATER", "NOW", "DONE"].map((s) => nextTaskState(s as never))).toEqual(["TODO", "DOING", "LATER", "NOW", "DONE", null]);
  });
});

describe("cycling a line", () => {
  it.each([
    ["- buy milk", "- TODO buy milk"],
    ["- TODO buy milk", "- DOING buy milk"],
    ["- DOING buy milk", "- LATER buy milk"],
    ["- DONE buy milk", "- buy milk"],
    ["- LATER read", "- NOW read"],
    ["- NOW read", "- DONE read"],
    ["- TODO [#A] urgent", "- DOING [#A] urgent"],
    ["\t\t- nested", "\t\t- TODO nested"],
    ["plain line", "TODO plain line"],
    ["- ", "- TODO "],
    ["", "TODO "],
    ["- TODO", "- DOING "],
    ["-", "- TODO "],
    ["\t-", "\t- TODO "],
    ["- TODO **bold** [[x]]", "- DOING **bold** [[x]]"],
  ])("%j becomes %j", (before, after) => {
    expect(cycle(before)).toBe(after);
  });

  it("goes all the way round back to the original", () => {
    let text = "\t- write the review";
    for (let i = 0; i < 6; i++) text = cycle(text);
    expect(text).toBe("\t- write the review");
  });

  it("does not treat lowercase or mid-line keywords as tasks", () => {
    expect(cycle("- todo later")).toBe("- TODO todo later");
    expect(cycle("- ask about NOW")).toBe("- TODO ask about NOW");
  });

  it("cycles each given line from its own state", () => {
    const lines = ["- a", "- TODO b", "- DONE c", "- LATER d"];
    expect(apply(lines, cyclePlan(lines, [0, 1, 2, 3]))).toEqual(["- TODO a", "- DOING b", "- c", "- NOW d"]);
    expect(apply(lines, cyclePlan(lines, [1, 3]))).toEqual(["- a", "- DOING b", "- DONE c", "- NOW d"]);
  });
});

describe("setTaskEdit and taskStateOf", () => {
  it("sets any state directly, keeping the rest of the line", () => {
    expect(apply(["- TODO x"], [setTaskEdit(0, "- TODO x", "LATER")])).toEqual(["- LATER x"]);
    expect(apply(["- DOING x"], [setTaskEdit(0, "- DOING x", null)])).toEqual(["- x"]);
  });

  it("reads a line's state", () => {
    expect(taskStateOf("\t- NOW ship it")).toBe("NOW");
    expect(taskStateOf("- just text")).toBeNull();
  });
});
