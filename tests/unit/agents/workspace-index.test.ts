import { describe, it, expect, beforeEach } from "vitest";
import { WorkspaceIndex, SCHEMA_VERSION, SNIPPET_START, SNIPPET_END, ftsQuery, type PageUpdate } from "../../../agents/workspace-index";
import { PARSER_VERSION, type DocLine } from "~/lib/note-parser";
import { WIKILINK_MARK } from "~/lib/wikilink";
import { memoryDb } from "../../helpers/sqlite";

/** A line of text, with links given as [start, end, pageId]. */
function line(text: string, links: Array<[number, number, string]> = []): DocLine {
  return { text, marks: links.map(([from, to, pageId]) => ({ type: WIKILINK_MARK, from, to, attrs: { pageId } })) };
}

function page(pageId: string, title: string, lines: DocLine[], updatedAt = 1000): PageUpdate {
  return { pageId, title, updatedAt, lines };
}

const MIST = "mistlog1";
const ACCESS = "access01";
const READING = "reading1";
const TODAY = "journal-2026-10-22";
const YESTERDAY = "journal-2026-10-21";

describe("WorkspaceIndex", () => {
  let db: ReturnType<typeof memoryDb>;
  let index: WorkspaceIndex;

  beforeEach(() => {
    db = memoryDb();
    index = new WorkspaceIndex(db);
  });

  function count(table: string): number {
    return Number(db.exec(`SELECT COUNT(*) AS n FROM ${table}`)[0].n);
  }

  describe("schema", () => {
    it("creates its tables and records the schema version", () => {
      expect(index.schemaVersion()).toBe(SCHEMA_VERSION);
    });

    it("can be constructed again on the same storage without losing data", () => {
      index.updatePage(page(MIST, "Mistlog", [line("hello")]));
      const again = new WorkspaceIndex(db);
      expect(again.getPage(MIST)?.title).toBe("Mistlog");
    });
  });

  describe("updatePage", () => {
    it("stores the page and returns an acknowledgement", () => {
      const ack = index.updatePage(page(MIST, "  Mistlog  ", [line("hello")], 1234));
      expect(ack).toEqual({ pageId: MIST, parserVersion: PARSER_VERSION, updatedAt: 1234, applied: true });
      expect(index.getPage(MIST)).toEqual({
        pageId: MIST,
        kind: "page",
        title: "Mistlog",
        journalDate: null,
        hasContent: true,
        updatedAt: 1234,
        parserVersion: PARSER_VERSION,
      });
    });

    it("titles journals from their date, ignoring the given title", () => {
      index.updatePage(page(TODAY, "anything", [line("notes")]));
      expect(index.getPage(TODAY)).toMatchObject({ kind: "journal", title: "Oct 22nd, 2026", journalDate: "2026-10-22" });
    });

    it("marks a page with only whitespace as having no content", () => {
      index.updatePage(page(MIST, "Mistlog", [line("   "), line("")]));
      expect(index.getPage(MIST)?.hasContent).toBe(false);
    });

    it("rejects invalid page IDs", () => {
      expect(() => index.updatePage(page("Not an id", "x", []))).toThrow("Invalid page ID");
      expect(() => index.updatePage(page("journal-2026-02-30", "x", []))).toThrow("Invalid page ID");
    });

    it("replaces the page's previous links, tags, tasks and text", () => {
      index.updatePage(page(MIST, "Mistlog", [line("TODO old #a see Access", [[16, 22, ACCESS]])]));
      index.updatePage(page(MIST, "Mistlog", [line("DONE new #b see Reading", [[16, 23, READING]])]));
      expect(index.backlinks(ACCESS)).toEqual([]);
      expect(index.backlinks(READING).map((b) => b.sourceId)).toEqual([MIST]);
      expect(db.exec(`SELECT tag_key FROM tags`).map((r) => r.tag_key)).toEqual(["b"]);
      expect(index.tasks(["TODO"])).toEqual([]);
      expect(index.search("old")).toEqual([]);
      expect(index.search("new").map((h) => h.pageId)).toEqual([MIST]);
    });

    it("gives the same rows when the same content is indexed twice", () => {
      const update = page(MIST, "Mistlog", [line("TODO read Access #x", [[10, 16, ACCESS]]), line("more")]);
      index.updatePage(update);
      const snapshot = ["pages", "links", "tags", "tasks", "pages_fts", "registry"].map((t) => db.exec(`SELECT * FROM ${t}`));
      index.updatePage(update);
      const again = ["pages", "links", "tags", "tasks", "pages_fts", "registry"].map((t) => db.exec(`SELECT * FROM ${t}`));
      expect(again).toEqual(snapshot);
    });

    it("leaves other pages untouched", () => {
      index.updatePage(page(MIST, "Mistlog", [line("TODO a")]));
      index.updatePage(page(ACCESS, "Access", [line("TODO b")]));
      index.updatePage(page(MIST, "Mistlog", [line("nothing")]));
      expect(index.tasks().map((t) => t.pageId)).toEqual([ACCESS]);
    });

    it("rolls back completely if a write fails part-way", () => {
      index.updatePage(page(MIST, "Mistlog", [line("TODO keep me")]));
      db.raw.exec(`CREATE TRIGGER fail_tags BEFORE INSERT ON tags BEGIN SELECT RAISE(ABORT, 'boom'); END`);
      expect(() => index.updatePage(page(MIST, "Renamed", [line("TODO replaced #tag")]))).toThrow("boom");
      expect(index.getPage(MIST)?.title).toBe("Mistlog");
      expect(index.tasks().map((t) => t.text)).toEqual(["keep me"]);
    });

    it("ignores an update older than the one it holds", () => {
      index.updatePage(page(MIST, "Mistlog", [line("TODO newer")], 2000));
      const ack = index.updatePage(page(MIST, "Old title", [line("TODO older")], 1000));
      expect(ack).toEqual({ pageId: MIST, parserVersion: PARSER_VERSION, updatedAt: 2000, applied: false });
      expect(index.getPage(MIST)).toMatchObject({ title: "Mistlog", updatedAt: 2000 });
      expect(index.tasks().map((t) => t.text)).toEqual(["newer"]);
    });

    it("applies an update with the same time again, and a newer one", () => {
      index.updatePage(page(MIST, "Mistlog", [line("first")], 2000));
      expect(index.updatePage(page(MIST, "Mistlog", [line("same time")], 2000)).applied).toBe(true);
      expect(index.updatePage(page(MIST, "Mistlog", [line("later")], 2001)).applied).toBe(true);
      expect(index.search("later").map((h) => h.pageId)).toEqual([MIST]);
    });

    it("applies the first update for a page at any time", () => {
      expect(index.updatePage(page(MIST, "Mistlog", [line("x")], 0)).applied).toBe(true);
    });

    it("registers the page if it was not registered", () => {
      index.updatePage(page(MIST, "Mistlog", [], 500));
      expect(index.registeredPages()).toEqual([MIST]);
      expect(db.exec(`SELECT created_at FROM registry`)[0].created_at).toBe(500);
    });
  });

  describe("registry", () => {
    it("keeps the first creation time when registered twice", () => {
      index.registerPage(MIST, 100);
      index.registerPage(MIST, 200);
      index.updatePage(page(MIST, "Mistlog", [], 300));
      expect(db.exec(`SELECT created_at FROM registry`)).toEqual([{ created_at: 100 }]);
    });

    it("rejects invalid page IDs", () => {
      expect(() => index.registerPage("bad id", 1)).toThrow("Invalid page ID");
    });

    it("survives clearDerived, which empties everything else", () => {
      index.updatePage(page(MIST, "Mistlog", [line("TODO x #t see Access", [[14, 20, ACCESS]])]));
      index.registerPage(READING, 1);
      index.clearDerived();
      for (const table of ["pages", "links", "tags", "tasks", "pages_fts"]) expect(count(table)).toBe(0);
      expect(index.registeredPages()).toEqual([MIST, READING].sort());
    });

    it("pages through registered IDs in order", () => {
      for (const id of ["cccccccc", "aaaaaaaa", "bbbbbbbb", TODAY]) index.registerPage(id, 1);
      expect(index.registeredPages(2)).toEqual(["aaaaaaaa", "bbbbbbbb"]);
      expect(index.registeredPages(2, "bbbbbbbb")).toEqual(["cccccccc", TODAY]);
      expect(index.registeredPages(2, TODAY)).toEqual([]);
    });
  });

  describe("backlinks", () => {
    it("groups linking lines by source page, most recently updated first", () => {
      index.updatePage(page(MIST, "Mistlog", [line("about Access", [[6, 12, ACCESS]]), line("again Access", [[6, 12, ACCESS]])], 100));
      index.updatePage(page(TODAY, "", [line("set up Access", [[7, 13, ACCESS]])], 200));
      const links = index.backlinks(ACCESS);
      expect(links.map((b) => [b.sourceId, b.sourceKind, b.sourceTitle, b.lines.map((l) => l.line)])).toEqual([
        [TODAY, "journal", "Oct 22nd, 2026", [0]],
        [MIST, "page", "Mistlog", [0, 1]],
      ]);
      expect(links[1].lines[0].content).toEqual(line("about Access", [[6, 12, ACCESS]]));
    });

    it("does not list a page as linking to itself", () => {
      index.updatePage(page(MIST, "Mistlog", [line("self Mistlog", [[5, 12, MIST]])]));
      expect(index.backlinks(MIST)).toEqual([]);
    });

    it("works for pages that are linked but not yet indexed themselves", () => {
      index.updatePage(page(MIST, "Mistlog", [line("see New", [[4, 7, "newpage1"]])]));
      expect(index.backlinks("newpage1").map((b) => b.sourceId)).toEqual([MIST]);
    });
  });

  describe("findByTitle", () => {
    beforeEach(() => {
      index.updatePage(page(MIST, "Mistlog", [line("x")]));
      index.updatePage(page(TODAY, "", [line("x")]));
    });

    it("finds a page by title, ignoring case and surrounding spaces", () => {
      expect(index.findByTitle("  mistLOG ")?.pageId).toBe(MIST);
    });

    it("finds journals by their date title", () => {
      expect(index.findByTitle("oct 22nd, 2026")?.pageId).toBe(TODAY);
    });

    it("ignores the page being renamed", () => {
      expect(index.findByTitle("Mistlog", MIST)).toBeNull();
    });

    it("needs an exact match, not a prefix", () => {
      expect(index.findByTitle("Mist")).toBeNull();
    });
  });

  describe("searchTitles", () => {
    beforeEach(() => {
      index.updatePage(page(MIST, "Mistlog", [line("x")], 300));
      index.updatePage(page(ACCESS, "Cloudflare Access", [line("x")], 200));
      index.updatePage(page(READING, "Reading list", [line("x")], 100));
      index.updatePage(page(TODAY, "", [line("x")], 50));
    });

    it("puts titles starting with the query before titles containing it", () => {
      index.updatePage(page("accessx1", "Access logs", [line("x")]));
      expect(index.searchTitles("access").map((p) => p.title)).toEqual(["Access logs", "Cloudflare Access"]);
    });

    it("ignores case", () => {
      expect(index.searchTitles("MIST").map((p) => p.pageId)).toEqual([MIST]);
    });

    it("finds journals by their title", () => {
      expect(index.searchTitles("oct 22").map((p) => p.pageId)).toEqual([TODAY]);
    });

    it("treats % and _ literally", () => {
      index.updatePage(page("percent1", "100% done", [line("x")]));
      expect(index.searchTitles("%").map((p) => p.title)).toEqual(["100% done"]);
      expect(index.searchTitles("_")).toEqual([]);
    });

    it("returns recently updated pages for an empty query, up to the limit", () => {
      expect(index.searchTitles("", 2).map((p) => p.pageId)).toEqual([MIST, ACCESS]);
    });
  });

  describe("search", () => {
    beforeEach(() => {
      index.updatePage(page(MIST, "Mistlog", [line("Logseq-style notes on Cloudflare"), line("forked from Mist")]));
      index.updatePage(page(READING, "Reading list", [line("How to Take Smart Notes")]));
      index.updatePage(page(TODAY, "", [line("Café meeting about Yjs")]));
    });

    it("matches every word, the last as a prefix", () => {
      expect(index.search("smart not").map((h) => h.pageId)).toEqual([READING]);
      expect(index.search("notes").map((h) => h.pageId).sort()).toEqual([MIST, READING].sort());
    });

    it("searches titles too", () => {
      expect(index.search("reading").map((h) => h.pageId)).toEqual([READING]);
    });

    it("ignores accents and case", () => {
      expect(index.search("CAFE").map((h) => h.pageId)).toEqual([TODAY]);
    });

    it("marks matched words in the snippet", () => {
      const [hit] = index.search("smart");
      expect(hit.snippet).toContain(`${SNIPPET_START}Smart${SNIPPET_END}`);
      expect(hit.title).toBe("Reading list");
    });

    it.each(['"', "AND (", "title:", "NOT", "*", "a\"b", ")", "   ", "NEAR(x y)"])("does not fail on FTS syntax %j", (q) => {
      expect(() => index.search(q)).not.toThrow();
    });

    it("returns nothing for input with no words", () => {
      expect(index.search("  - * ")).toEqual([]);
    });
  });

  describe("ftsQuery", () => {
    it("quotes every word and makes the last a prefix", () => {
      expect(ftsQuery('smart "notes')).toBe('"smart" """notes"*');
      expect(ftsQuery("one")).toBe('"one"*');
      expect(ftsQuery(" ")).toBeNull();
    });
  });

  describe("tasks", () => {
    beforeEach(() => {
      index.updatePage(page(MIST, "Mistlog", [line("TODO agree interactions"), line("\t- DOING build index")]));
      index.updatePage(page(YESTERDAY, "", [line("TODO verify deploy gate"), line("DONE freeze coverage")]));
      index.updatePage(page(TODAY, "", [line("TODO write review")]));
    });

    it("lists open tasks, journals newest first, then pages", () => {
      expect(index.tasks().map((t) => [t.pageId, t.state, t.text])).toEqual([
        [TODAY, "TODO", "write review"],
        [YESTERDAY, "TODO", "verify deploy gate"],
        [MIST, "TODO", "agree interactions"],
        [MIST, "DOING", "build index"],
      ]);
    });

    it("includes indent, line and page title", () => {
      expect(index.tasks(["DOING"])).toEqual([
        { pageId: MIST, pageTitle: "Mistlog", line: 1, state: "DOING", indent: 1, text: "build index" },
      ]);
    });

    it("filters by state, and returns nothing for no states", () => {
      expect(index.tasks(["DONE"]).map((t) => t.text)).toEqual(["freeze coverage"]);
      expect(index.tasks([])).toEqual([]);
    });
  });

  describe("journals", () => {
    beforeEach(() => {
      index.updatePage(page("journal-2026-10-19", "", [line("old")]));
      index.updatePage(page("journal-2026-10-20", "", [line("")]));
      index.updatePage(page(YESTERDAY, "", [line("yesterday")]));
      index.updatePage(page(TODAY, "", [line("today")]));
      index.updatePage(page(MIST, "Mistlog", [line("not a journal")]));
    });

    it("lists journal days with content, newest first", () => {
      expect(index.journals().map((p) => p.journalDate)).toEqual(["2026-10-22", "2026-10-21", "2026-10-19"]);
    });

    it("pages backwards with a limit and a before date", () => {
      expect(index.journals(1).map((p) => p.journalDate)).toEqual(["2026-10-22"]);
      expect(index.journals(5, "2026-10-22").map((p) => p.journalDate)).toEqual(["2026-10-21", "2026-10-19"]);
    });
  });

  describe("staleCount", () => {
    it("counts pages built by an older parser", () => {
      index.updatePage(page(MIST, "Mistlog", [line("x")]));
      index.updatePage(page(ACCESS, "Access", [line("x")]));
      expect(index.staleCount()).toBe(0);
      db.exec(`UPDATE pages SET parser_version = ? WHERE page_id = ?`, PARSER_VERSION - 1, MIST);
      expect(index.staleCount()).toBe(1);
    });
  });
});
