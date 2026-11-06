import { describe, it, expect } from "vitest";
import { convertGraph, convertPage, titleFromFileName, type ImportFile } from "~/lib/logseq-import";

const ID_A = "6550c4d2-1111-4abc-8def-0123456789ab";
const ID_B = "6550c4d2-2222-4abc-8def-0123456789ab";
const texts = (lines: Array<{ text: string }>) => lines.map((l) => l.text);

describe("convertPage", () => {
  it("turns Logseq's indentation into tabs, whatever mix of tabs and spaces it used", () => {
    const { lines } = convertPage("- top\n\t - child\n\t\t - grandchild\n    - two-space child\n- next");
    expect(texts(lines)).toEqual(["- top", "\t- child", "\t\t- grandchild", "\t\t- two-space child", "- next"]);
  });

  it("never nests a line more than one level deeper than the line above", () => {
    expect(texts(convertPage("- a\n\t\t\t- far too deep\n- b").lines)).toEqual(["- a", "\t- far too deep", "- b"]);
  });

  it("makes id:: the block's ID and collapsed:: its fold, keeping other properties as text", () => {
    const { lines } = convertPage(`- parent\n  id:: ${ID_A}\n  collapsed:: true\n  status:: draft\n\t- child`);
    expect(lines).toEqual([
      { text: "- parent", blockId: ID_A, collapsed: true },
      { text: "\tstatus:: draft", blockId: null, collapsed: false },
      { text: "\t- child", blockId: null, collapsed: false },
    ]);
  });

  it("keeps a multi-line block's continuation lines under its bullet, code keeping its indentation", () => {
    const { lines, continuationLines } = convertPage("- first line\n  second line\n\t- ```js\n\t  if (x) {\n\t    y();\n\t  }\n\t  ```\n- after");
    expect(texts(lines)).toEqual(["- first line", "\tsecond line", "\t- ```js", "\t\tif (x) {", "\t\t  y();", "\t\t}", "\t\t```", "- after"]);
    expect(continuationLines).toBe(5);
  });

  it("does not treat a - inside a code block as a bullet", () => {
    expect(texts(convertPage("- ```\n  - not a bullet\n  ```").lines)).toEqual(["- ```", "\t- not a bullet", "\t```"]);
  });

  it("takes a page's title:: and keeps other text before the first bullet as plain lines", () => {
    const result = convertPage("title:: Real Title\nalias:: other\nsome intro\n\n- first");
    expect(result.title).toBe("Real Title");
    expect(texts(result.lines)).toEqual(["alias:: other", "some intro", "- first"]);
  });

  it("drops blank lines, a byte order mark and Windows line endings, and keeps empty bullets", () => {
    expect(texts(convertPage("﻿- a\r\n\r\n-\r\n- b").lines)).toEqual(["- a", "- ", "- b"]);
  });
});

describe("titleFromFileName", () => {
  it.each([
    ["Books.md", "Books"],
    ["projects___garden.md", "projects/garden"],
    ["projects%2Fgarden.md", "projects/garden"],
    ["What%3F.md", "What?"],
    ["100%.md", "100%"],
  ])("%s is %s", (file, title) => {
    expect(titleFromFileName(file)).toBe(title);
  });
});

describe("convertGraph", () => {
  const file = (path: string, text = "- x"): ImportFile => ({ path, text });

  it("reads pages and journal days, even when the graph's folder is itself called Logseq", () => {
    const plan = convertGraph([
      file("Logseq/pages/Books.md", "- read [[Novels]] #reading"),
      file("Logseq/journals/2026_11_04.md", "- went to [[Books]] on [[Nov 3rd, 2026]]"),
      file("Logseq/logseq/config.edn", "{}"),
      file("Logseq/assets/photo.jpg", ""),
      file("Logseq/.DS_Store", ""),
    ]);
    expect(plan.pages.map((p) => [p.kind, p.title, p.date])).toEqual([
      ["journal", "Nov 4th, 2026", "2026-11-04"],
      ["page", "Books", null],
    ]);
    // Linked with no page in the graph (journal dates aside): created empty
    expect(plan.missingTitles).toEqual(["Novels", "reading"]);
    expect(plan.stats).toMatchObject({ pages: 1, journals: 1, links: 3, tags: 1, assets: 1 });
  });

  it("skips copies of journal days and files it can't read, saying why", () => {
    const plan = convertGraph([
      file("g/journals/2026_11_04.md"),
      file("g/journals/2026_11_04 2.md"),
      file("g/journals/2026-11-04T10_20_30.123Z.Desktop.md"),
      file("g/journals/notes.md"),
      file("g/pages/Org page.org"),
      file("g/pages/image.png"),
    ]);
    // In the plan's fixed order (by character code: "-" before "_")
    expect(plan.skipped.map((s) => s.reason)).toEqual([
      "A sync backup copy (keeping the original day)",
      "A conflict copy (keeping the original day)",
      "Not a journal file name (YYYY_MM_DD.md)",
      "Org-mode files aren't supported",
      "Not a Markdown file",
    ]);
    expect(plan.pages).toHaveLength(1);
  });

  it("combines two files with one title, and a date page with its journal day", () => {
    const plan = convertGraph([
      file("g/pages/Books.md", "- one"),
      file("g/pages/books.md", "- two"),
      file("g/pages/Nov 4th, 2026.md", "- from a page"),
      file("g/journals/2026_11_04.md", "- from the day"),
    ]);
    expect(plan.pages.map((p) => [p.title, texts(p.lines)])).toEqual([
      ["Nov 4th, 2026", ["- from the day", "- from a page"]],
      ["Books", ["- one", "- two"]],
    ]);
    expect(plan.combined.sort()).toEqual(["Books", "Nov 4th, 2026"]);
  });

  it("keeps pages whose names have [[ or ]], without the brackets, and says so", () => {
    const plan = convertGraph([file("g/pages/[[Ideas]] for later.md", "- keep me")]);
    expect(plan.pages.map((p) => [p.title, texts(p.lines)])).toEqual([["Ideas for later", ["- keep me"]]]);
    expect(plan.renamed).toEqual([{ from: "[[Ideas]] for later", to: "Ideas for later" }]);
  });

  it("keeps a block ID on the first block that has it", () => {
    const plan = convertGraph([file("g/pages/A.md", `- a\n  id:: ${ID_A}`), file("g/pages/B.md", `- b\n  id:: ${ID_A}\n- c\n  id:: ${ID_B}`)]);
    expect(plan.pages.flatMap((p) => p.lines.map((l) => l.blockId))).toEqual([ID_A, null, ID_B]);
    expect(plan.stats).toMatchObject({ blockIds: 2, duplicateIds: 1 });
  });
});

describe("summarise", () => {
  it("counts what is new and what gets lines added, given what Mistlog has", async () => {
    const { summarise } = await import("~/lib/logseq-import");
    const plan = convertGraph([
      { path: "g/pages/Books.md", text: "- [[Novels]] and [[Garden]]" },
      { path: "g/pages/Ideas.md", text: "- x" },
      { path: "g/journals/2026_11_04.md", text: "- x" },
      { path: "g/journals/2026_11_05.md", text: "- x" },
    ]);
    expect(summarise(plan, { pages: ["books", "garden"], days: ["2026-11-05"] })).toEqual({
      newPages: 1,
      addedToPages: 1,
      newDays: 1,
      addedToDays: 1,
      emptyPages: 1, // Novels; Garden exists already
    });
  });
});

describe("linking an imported page's lines", () => {
  it("links each [[title]] and tag by page ID, the mark on the title or tag name", async () => {
    const { linkedLines, targetOf, titlesToResolve } = await import("~/lib/logseq-import");
    const plan = convertGraph([
      { path: "g/pages/Books.md", text: `- read [[Novels]] and #reading on [[Nov 3rd, 2026]]\n  id:: ${ID_A}\n  collapsed:: true\n- #[[big ideas]] [[Lost]]` },
      { path: "g/journals/2026_11_04.md", text: "- went to [[books]]" },
    ]);
    // The graph's pages first, then linked titles with no page (in display order)
    const titles = titlesToResolve(plan);
    expect(titles[0]).toBe("Books");
    expect(titles.slice(1).sort()).toEqual(["Lost", "Novels", "big ideas", "reading"]);
    const resolved = { books: "pagebook", novels: "pagenovl", reading: "pageread", "big ideas": "pagebigi", lost: null };
    const [day, books] = plan.pages;
    expect(targetOf(day, resolved)).toBe("journal-2026-11-04");
    expect(targetOf(books, resolved)).toBe("pagebook");

    const lines = linkedLines(books, resolved);
    const text = lines[0].text;
    expect(lines[0]).toMatchObject({ blockId: ID_A, collapsed: true });
    expect(lines[0].links.map((l) => [text.slice(l.from, l.to), l.pageId])).toEqual([
      ["Novels", "pagenovl"],
      ["reading", "pageread"],
      ["Nov 3rd, 2026", "journal-2026-11-03"],
    ]);
    // A title that couldn't be had stays as text
    expect(lines[1].links.map((l) => [lines[1].text.slice(l.from, l.to), l.pageId])).toEqual([["big ideas", "pagebigi"]]);
    expect(linkedLines(day, resolved)[0].links).toEqual([{ from: 12, to: 17, pageId: "pagebook" }]);
  });

  it("leaves empty links alone", async () => {
    const { linkedLines } = await import("~/lib/logseq-import");
    const plan = convertGraph([{ path: "g/pages/A.md", text: "- [[]] and [[ ]]" }]);
    expect(linkedLines(plan.pages[0], {})[0].links).toEqual([]);
  });
});
