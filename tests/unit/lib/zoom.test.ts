import { describe, it, expect } from "vitest";
import { ancestorsOf, crumbText, zoomCrumbs, zoomHref, zoomRange } from "~/lib/zoom";

const page = [
  "- a", // 0
  "\t- a1", // 1
  "\t\t- a1x", // 2
  "\t- a2", // 3
  "- b", // 4
];
const ids = ["A", "A1", "A1X", "A2", "B"];

describe("zoom", () => {
  it("shows the zoomed block and its children", () => {
    expect(zoomRange(page, ids, "A1")).toEqual({ from: 1, to: 3 });
    expect(zoomRange(page, ids, "A")).toEqual({ from: 0, to: 4 });
    expect(zoomRange(page, ids, "gone")).toBeNull();
  });

  it("finds the lines a line is nested under, outermost first", () => {
    expect(ancestorsOf(page, 2)).toEqual([0, 1]);
    expect(ancestorsOf(page, 3)).toEqual([0]);
    expect(ancestorsOf(page, 4)).toEqual([]);
    // A blank line ends a block, as for folding and zoom, so nothing above it is a parent
    expect(ancestorsOf(["- a", "", "\t- after a blank"], 2)).toEqual([]);
  });

  it("shows a line as a short breadcrumb", () => {
    expect(crumbText("\t\t- TODO Buy milk ")).toBe("TODO Buy milk");
    expect(crumbText("\tplain")).toBe("plain");
    expect(crumbText(`- ${"x".repeat(50)}`)).toBe(`${"x".repeat(39)}…`);
  });

  it("builds the breadcrumb: page, the blocks above, then the zoomed block", () => {
    const lines = page.map((text, i) => ({ text, marks: [], id: ids[i] }));
    expect(zoomCrumbs(lines, "A1X", "Project")).toEqual([
      { blockId: null, text: "Project" },
      { blockId: "A", text: "a" },
      { blockId: "A1", text: "a1" },
      { blockId: "A1X", text: "a1x" },
    ]);
    expect(zoomCrumbs(lines, "gone", "Project")).toBeNull();
  });

  it("puts the zoomed block in the address, or takes it out", () => {
    expect(zoomHref("/page/project", "abc")).toBe("/page/project?block=abc");
    expect(zoomHref("/page/project", null)).toBe("/page/project");
  });
});
