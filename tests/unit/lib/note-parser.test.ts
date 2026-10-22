import { describe, it, expect } from "vitest";
import { parseLine, parseNote, PARSER_VERSION, type DocLine, type LineMark } from "~/lib/note-parser";
import { WIKILINK_MARK } from "~/lib/wikilink";

function line(text: string, marks: LineMark[] = []): DocLine {
  return { text, marks };
}

function link(from: number, to: number, pageId: string): LineMark {
  return { type: WIKILINK_MARK, from, to, attrs: { pageId } };
}

describe("PARSER_VERSION", () => {
  it("is a positive integer", () => {
    expect(Number.isInteger(PARSER_VERSION)).toBe(true);
    expect(PARSER_VERSION).toBeGreaterThan(0);
  });
});

describe("parseLine", () => {
  it("reads a plain line", () => {
    expect(parseLine("hello")).toEqual({ indent: 0, bullet: false, task: null, bodyStart: 0 });
  });

  it("counts leading tabs as indentation", () => {
    expect(parseLine("\t\t- nested")).toEqual({ indent: 2, bullet: true, task: null, bodyStart: 4 });
  });

  it("does not count spaces as indentation", () => {
    expect(parseLine("    - spaced")).toMatchObject({ indent: 0, bullet: false });
  });

  it("recognises a bare dash as an empty bullet", () => {
    expect(parseLine("\t-")).toEqual({ indent: 1, bullet: true, task: null, bodyStart: 2 });
  });

  it("does not treat a dash without a space as a bullet", () => {
    expect(parseLine("-not a bullet")).toMatchObject({ bullet: false, bodyStart: 0 });
  });

  it.each([
    ["TODO buy milk", "TODO", 5],
    ["DOING write tests", "DOING", 6],
    ["DONE ship it", "DONE", 5],
    ["- TODO with bullet", "TODO", 7],
    ["\t- DONE nested", "DONE", 8],
  ] as const)("finds the task in %j", (text, task, bodyStart) => {
    expect(parseLine(text)).toMatchObject({ task, bodyStart });
  });

  it("accepts a task keyword with nothing after it", () => {
    expect(parseLine("- TODO")).toMatchObject({ task: "TODO", bodyStart: 6 });
  });

  it.each(["TODOS are fun", "todo lowercase", "Later TODO", "TODO:colon"])(
    "does not treat %j as a task",
    (text) => {
      expect(parseLine(text).task).toBeNull();
    },
  );
});

describe("parseNote: links", () => {
  it("reports each wikilink mark with its line", () => {
    const note = parseNote([
      line("See Mistlog", [link(4, 11, "abcd1234")]),
      line("and Oct 22nd", [link(4, 12, "journal-2026-10-22")]),
    ]);
    expect(note.links).toEqual([
      { pageId: "abcd1234", line: 0 },
      { pageId: "journal-2026-10-22", line: 1 },
    ]);
  });

  it("reports a link split into several runs once per line", () => {
    const note = parseNote([line("Mistlog", [link(0, 3, "abcd1234"), link(3, 7, "abcd1234")])]);
    expect(note.links).toEqual([{ pageId: "abcd1234", line: 0 }]);
  });

  it("reports the same page on different lines separately", () => {
    const note = parseNote([line("A", [link(0, 1, "abcd1234")]), line("A", [link(0, 1, "abcd1234")])]);
    expect(note.links).toHaveLength(2);
  });

  it("reports two different pages on one line", () => {
    const note = parseNote([line("A and B", [link(0, 1, "aaaaaaaa"), link(6, 7, "bbbbbbbb")])]);
    expect(note.links.map((l) => l.pageId)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
  });

  it.each([
    ["missing attrs", { type: WIKILINK_MARK, from: 0, to: 1 }],
    ["null pageId", { type: WIKILINK_MARK, from: 0, to: 1, attrs: { pageId: null } }],
    ["malformed pageId", { type: WIKILINK_MARK, from: 0, to: 1, attrs: { pageId: "Not An Id" } }],
    ["impossible journal date", { type: WIKILINK_MARK, from: 0, to: 1, attrs: { pageId: "journal-2026-02-30" } }],
  ])("skips a link with %s", (_name, mark) => {
    expect(parseNote([line("x", [mark as LineMark])]).links).toEqual([]);
  });

  it("ignores other marks", () => {
    const note = parseNote([line("x", [{ type: "criticHighlight", from: 0, to: 1, attrs: { threadId: "t1" } }])]);
    expect(note.links).toEqual([]);
  });

  it("still reports links inside a code fence", () => {
    const note = parseNote([line("```"), line("A", [link(0, 1, "abcd1234")]), line("```")]);
    expect(note.links).toEqual([{ pageId: "abcd1234", line: 1 }]);
  });
});

describe("parseNote: tasks", () => {
  it("extracts tasks with state, indent and text", () => {
    const note = parseNote([
      line("- TODO buy milk"),
      line("\t- DOING write tests"),
      line("plain line"),
      line("DONE ship it"),
    ]);
    expect(note.tasks).toEqual([
      { line: 0, state: "TODO", indent: 0, text: "buy milk" },
      { line: 1, state: "DOING", indent: 1, text: "write tests" },
      { line: 3, state: "DONE", indent: 0, text: "ship it" },
    ]);
  });

  it("ignores task keywords inside a code fence", () => {
    const note = parseNote([line("- ```"), line("TODO not a task"), line("- ```"), line("TODO real")]);
    expect(note.tasks).toEqual([{ line: 3, state: "TODO", indent: 0, text: "real" }]);
  });

  it("treats an unclosed fence as running to the end", () => {
    const note = parseNote([line("```js"), line("TODO hidden")]);
    expect(note.tasks).toEqual([]);
  });
});

describe("parseNote: tags", () => {
  function tags(text: string, marks: LineMark[] = []) {
    return parseNote([line(text, marks)]).tags.map((t) => t.name);
  }

  it("finds tags at the start and after whitespace", () => {
    expect(tags("#idea and #later\ttoo #x")).toEqual(["idea", "later", "x"]);
  });

  it("reports a lowercase key for matching", () => {
    expect(parseNote([line("#Project")]).tags).toEqual([{ name: "Project", key: "project", line: 0 }]);
  });

  it("allows namespaces, dashes, underscores, digits and other scripts", () => {
    expect(tags("#area/home #follow-up #q3_review #café #日本")).toEqual([
      "area/home",
      "follow-up",
      "q3_review",
      "café",
      "日本",
    ]);
  });

  it("stops at punctuation", () => {
    expect(tags("Done with #release.")).toEqual(["release"]);
  });

  it.each([
    ["a markdown heading", "# Heading"],
    ["a deeper heading", "## Heading"],
    ["a URL fragment", "see https://example.com/page#section"],
    ["a word with a hash inside", "C#sharp"],
    ["a number", "fixes issue #42"],
    ["a tag in parentheses", "(#aside)"],
    ["inline code", "run `git log #main` now"],
  ])("ignores %s", (_name, text) => {
    expect(tags(text)).toEqual([]);
  });

  it("ignores hashes inside link text", () => {
    expect(tags("C# notes", [link(0, 8, "abcd1234")])).toEqual([]);
  });

  it("still finds tags next to inline code and links", () => {
    expect(tags("`x` #a Mist #b", [link(7, 11, "abcd1234")])).toEqual(["a", "b"]);
  });

  it("ignores tags inside a code fence", () => {
    const note = parseNote([line("```"), line("#not-a-tag"), line("```"), line("#tag")]);
    expect(note.tags.map((t) => t.name)).toEqual(["tag"]);
  });
});

describe("parseNote: text", () => {
  it("joins lines with newlines for search", () => {
    expect(parseNote([line("one"), line("\t- two")]).text).toBe("one\n\t- two");
  });

  it("handles an empty document", () => {
    expect(parseNote([])).toEqual({ links: [], tags: [], tasks: [], text: "" });
  });
});
