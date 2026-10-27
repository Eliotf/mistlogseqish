import { describe, it, expect } from "vitest";
import {
  indentOf,
  bulletContentStart,
  blockEnd,
  indentPlan,
  enterPlan,
  backspacePlan,
  type PrefixEdit,
} from "~/lib/bullets";

/** Apply prefix edits to lines, to check results as text. */
function apply(lines: string[], edits: PrefixEdit[]): string[] {
  const out = [...lines];
  for (const e of edits) out[e.line] = out[e.line].slice(0, e.from) + e.text + out[e.line].slice(e.to);
  return out;
}

describe("indentOf and bulletContentStart", () => {
  it.each([
    ["plain", 0, null],
    ["- item", 0, 2],
    ["\t\t- deep", 2, 4],
    ["\t-", 1, 2],
    ["-not a bullet", 0, null],
    ["  - spaces", 0, null],
    ["\tplain indented", 1, null],
  ] as const)("%j: indent %i, content at %j", (text, indent, start) => {
    expect(indentOf(text)).toBe(indent);
    expect(bulletContentStart(text)).toBe(start);
  });
});

describe("blockEnd", () => {
  const lines = ["- a", "\t- a1", "\t\t- a1x", "\t- a2", "- b", "\t- b1"];
  it("includes all deeper lines that follow", () => {
    expect(blockEnd(lines, 0)).toBe(4);
    expect(blockEnd(lines, 1)).toBe(3);
    expect(blockEnd(lines, 3)).toBe(4);
    expect(blockEnd(lines, 5)).toBe(6);
  });

  it("stops at an empty line", () => {
    expect(blockEnd(["- a", "", "\t- not a child"], 0)).toBe(1);
  });
});

describe("indentPlan", () => {
  it("indents a line and its children together", () => {
    const lines = ["- a", "- b", "\t- b1", "\t\t- b1x", "- c"];
    expect(apply(lines, indentPlan(lines, 1, 1, 1)!)).toEqual(["- a", "\t- b", "\t\t- b1", "\t\t\t- b1x", "- c"]);
  });

  it("outdents a line and its children together", () => {
    const lines = ["- a", "\t- b", "\t\t- b1", "- c"];
    expect(apply(lines, indentPlan(lines, 1, 1, -1)!)).toEqual(["- a", "- b", "\t- b1", "- c"]);
  });

  it("will not indent more than one level below the line above", () => {
    expect(indentPlan(["- a", "\t- b"], 1, 1, 1)).toBeNull();
  });

  it("will not indent the first line or outdent a top-level line", () => {
    expect(indentPlan(["- a", "- b"], 0, 0, 1)).toBeNull();
    expect(indentPlan(["- a", "- b"], 1, 1, -1)).toBeNull();
  });

  it("makes a plain line a bullet when indenting it", () => {
    const lines = ["- a", "plain"];
    expect(apply(lines, indentPlan(lines, 1, 1, 1)!)).toEqual(["- a", "\t- plain"]);
  });

  it("indents several selected lines and their children", () => {
    const lines = ["- a", "- b", "- c", "\t- c1", "- d"];
    expect(apply(lines, indentPlan(lines, 1, 2, 1)!)).toEqual(["- a", "\t- b", "\t- c", "\t\t- c1", "- d"]);
  });

  it("outdents a mixed selection, leaving top-level lines alone", () => {
    const lines = ["- a", "\t- b", "- c"];
    expect(apply(lines, indentPlan(lines, 1, 2, -1)!)).toEqual(["- a", "- b", "- c"]);
  });

  it("keeps everything after the prefix, including tasks", () => {
    const lines = ["- a", "- TODO keep **this** exactly"];
    expect(apply(lines, indentPlan(lines, 1, 1, 1)!)[1]).toBe("\t- TODO keep **this** exactly");
  });
});

describe("enterPlan", () => {
  it("leaves plain lines to the editor", () => {
    expect(enterPlan(["plain"], 0, 5)).toBeNull();
  });

  it("splits a bullet into a new bullet at the same level", () => {
    expect(enterPlan(["\t- hello world"], 0, 8)).toEqual({ kind: "split", prefix: "\t- " });
  });

  it("starts the first child at the end of a line that has children", () => {
    expect(enterPlan(["- parent", "\t- child"], 0, 8)).toEqual({ kind: "split", prefix: "\t- " });
  });

  it("starts a sibling in the middle of a line that has children", () => {
    expect(enterPlan(["- parent", "\t- child"], 0, 4)).toEqual({ kind: "split", prefix: "- " });
  });

  it("adds an empty bullet above when the caret is before the content", () => {
    expect(enterPlan(["\t- item"], 0, 3)).toEqual({ kind: "above", text: "\t- " });
    expect(enterPlan(["\t- item"], 0, 0)).toEqual({ kind: "above", text: "\t- " });
  });

  it("outdents an empty nested bullet", () => {
    const lines = ["- a", "\t- "];
    const plan = enterPlan(lines, 1, 3)!;
    expect(plan.kind).toBe("edits");
    if (plan.kind !== "edits") return;
    expect(apply(lines, plan.edits)).toEqual(["- a", "- "]);
    expect(plan.caretOffset).toBe(2);
  });

  it("turns an empty top-level bullet into a plain empty line", () => {
    for (const text of ["- ", "-", "-   "]) {
      const plan = enterPlan([text], 0, text.length)!;
      expect(plan.kind === "edits" && apply([text], plan.edits)).toEqual([""]);
    }
  });
});

describe("backspacePlan", () => {
  it("only acts with the caret right after the bullet", () => {
    expect(backspacePlan(["- item"], 0, 3)).toBeNull();
    expect(backspacePlan(["- item"], 0, 1)).toBeNull();
    expect(backspacePlan(["plain"], 0, 0)).toBeNull();
  });

  it("outdents a nested bullet with its children", () => {
    const lines = ["- a", "\t- b", "\t\t- b1"];
    const plan = backspacePlan(lines, 1, 3)!;
    expect(apply(lines, plan.edits)).toEqual(["- a", "- b", "\t- b1"]);
    expect(plan.caretOffset).toBe(2);
  });

  it("removes the bullet from a top-level line, keeping its text", () => {
    const plan = backspacePlan(["- item"], 0, 2)!;
    expect(apply(["- item"], plan.edits)).toEqual(["item"]);
    expect(plan.caretOffset).toBe(0);
  });

  it("handles a bare dash", () => {
    const plan = backspacePlan(["-"], 0, 1)!;
    expect(apply(["-"], plan.edits)).toEqual([""]);
  });
});
