import { describe, it, expect } from "vitest";
import { lineSegments, linesFromRuns, nestedLines, withNestedLines } from "~/lib/backlink-lines";

const link = (text: string, title: string, pageId = "abcd1234") => {
  const from = text.indexOf(title);
  return { from, to: from + title.length, pageId };
};

describe("lineSegments", () => {
  it("drops the indent and bullet, keeps a task keyword, and splits out links with faint brackets", () => {
    const text = "\t\t- TODO read [[Books]] soon";
    expect(lineSegments({ line: 0, text, links: [link(text, "Books")] })).toEqual([
      { kind: "text", text: "TODO read " },
      { kind: "bracket", text: "[[" },
      { kind: "link", text: "Books", pageId: "abcd1234" },
      { kind: "bracket", text: "]]" },
      { kind: "text", text: " soon" },
    ]);
  });

  it("handles several links, a link at either end, and a bare bullet", () => {
    const text = "[[A]] and [[B]]";
    const segments = lineSegments({ line: 0, text, links: [link(text, "B", "bbbb1111"), link(text, "A", "aaaa1111")] });
    expect(segments.map((s) => s.text).join("")).toBe(text);
    expect(segments.filter((s) => s.kind === "link").map((s) => s.kind === "link" && s.pageId)).toEqual(["aaaa1111", "bbbb1111"]);
    expect(lineSegments({ line: 0, text: "-", links: [] })).toEqual([]);
  });

  it("shows a link without brackets as a plain link, and ignores marks that don't fit the text", () => {
    const text = "see Books";
    expect(lineSegments({ line: 0, text, links: [link(text, "Books"), { from: 3, to: 99, pageId: "x" }, { from: 5, to: 5, pageId: "y" }] })).toEqual([
      { kind: "text", text: "see " },
      { kind: "link", text: "Books", pageId: "abcd1234" },
    ]);
  });
});

// A page as stored runs: "- see [[Books]]" with two lines under it, then a line beside it
const runs = ["- see [[", { pageId: "abcd1234", text: "Books" }, "]]\n\t- first\n\t\t- deeper [[", { pageId: "eeee5555", text: "Other" }, "]]\n- next"];

describe("linesFromRuns", () => {
  it("splits a page's runs into numbered lines with their links", () => {
    expect(linesFromRuns(runs)).toEqual([
      { line: 0, text: "- see [[Books]]", links: [{ from: 8, to: 13, pageId: "abcd1234" }] },
      { line: 1, text: "\t- first", links: [] },
      { line: 2, text: "\t\t- deeper [[Other]]", links: [{ from: 13, to: 18, pageId: "eeee5555" }] },
      { line: 3, text: "- next", links: [] },
    ]);
  });

  it("gives one empty line for a page with no text", () => {
    expect(linesFromRuns([])).toEqual([{ line: 0, text: "", links: [] }]);
  });
});

describe("nestedLines", () => {
  const lines = linesFromRuns(runs);

  it("takes the more indented lines after a line, up to one that isn't", () => {
    expect(nestedLines(lines, 0).children.map((l) => l.line)).toEqual([1, 2]);
    expect(nestedLines(lines, 1).children.map((l) => l.line)).toEqual([2]);
    expect(nestedLines(lines, 2)).toEqual({ children: [], more: 0 });
    expect(nestedLines(lines, 3)).toEqual({ children: [], more: 0 });
  });

  it("sends at most the limit and counts the rest", () => {
    expect(nestedLines(lines, 0, 1)).toEqual({ children: [lines[1]], more: 1 });
  });
});

describe("withNestedLines", () => {
  const lines = linesFromRuns(runs);

  it("adds what is nested under each linking line, and leaves it out when there is nothing", () => {
    expect(withNestedLines([lines[0], lines[3]], runs)).toEqual([{ ...lines[0], children: [lines[1], lines[2]] }, lines[3]]);
  });

  it("does not list a linking line again when it is shown under an earlier one", () => {
    expect(withNestedLines([lines[0], lines[2]], runs).map((l) => l.line)).toEqual([0]);
  });

  it("counts nested lines past the limit, and skips linking lines among them", () => {
    const many = ["- see\n" + Array.from({ length: 40 }, (_, i) => `\t- line ${i}`).join("\n")];
    const all = linesFromRuns(many);
    const [shown] = withNestedLines([all[0], all[35]], many);
    expect(shown.children).toHaveLength(30);
    expect(shown.more).toBe(10);
    expect(withNestedLines([all[0], all[35]], many)).toHaveLength(1);
  });

  it("lists lines alone without stored runs, or when the runs don't match them", () => {
    expect(withNestedLines([lines[0]], null)).toEqual([lines[0]]);
    expect(withNestedLines([{ ...lines[0], text: "- changed" }], runs)).toEqual([{ ...lines[0], text: "- changed" }]);
  });
});
