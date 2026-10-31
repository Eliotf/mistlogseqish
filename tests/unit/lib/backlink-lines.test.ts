import { describe, it, expect } from "vitest";
import { lineSegments } from "~/lib/backlink-lines";

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
