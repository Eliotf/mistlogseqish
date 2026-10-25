import { describe, it, expect, beforeEach } from "vitest";
import { WorkspaceIndex, SCHEMA_V1, SCHEMA_VERSION, SNIPPET_START, SNIPPET_END, ftsQuery, type PageUpdate } from "../../../agents/workspace-index";
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

  describe("slugs", () => {
    const rename = (pageId: string, title: string, at = Date.now()) => index.updatePage(page(pageId, title, [line("x")], at));

    it("gives a titled page a slug from its title", () => {
      rename(MIST, "Meeting Notes");
      expect(index.currentSlug(MIST)).toBe("meeting-notes");
      expect(index.resolveSlug("meeting-notes")).toEqual({ pageId: MIST, current: true, currentSlug: "meeting-notes" });
    });

    it("gives untitled pages, symbol-only titles and journals no slug", () => {
      rename(MIST, "");
      rename(ACCESS, "!!!");
      rename(TODAY, "");
      expect([index.currentSlug(MIST), index.currentSlug(ACCESS), index.currentSlug(TODAY)]).toEqual([null, null, null]);
      expect(count("slugs")).toBe(0);
    });

    it("keeps the same slug when the page is re-indexed", () => {
      rename(MIST, "Notes", 1);
      rename(MIST, "Notes", 2);
      rename(MIST, "Notes", 3);
      expect(db.exec(`SELECT slug, current FROM slugs`)).toEqual([{ slug: "notes", current: 1 }]);
    });

    it("keeps old slugs as redirects after a rename", () => {
      rename(MIST, "First name", 1);
      rename(MIST, "Second name", 2);
      expect(index.currentSlug(MIST)).toBe("second-name");
      expect(index.resolveSlug("first-name")).toEqual({ pageId: MIST, current: false, currentSlug: "second-name" });
    });

    it("makes an old slug current again when the title is changed back", () => {
      rename(MIST, "Alpha", 1);
      rename(MIST, "Beta", 2);
      rename(MIST, "Alpha", 3);
      expect(index.resolveSlug("alpha")?.current).toBe(true);
      expect(index.resolveSlug("beta")).toEqual({ pageId: MIST, current: false, currentSlug: "alpha" });
    });

    it("adds a short ID suffix when another page holds the slug", () => {
      rename("cccc1111", "C");
      rename("dddd2222", "C++");
      expect(index.currentSlug("cccc1111")).toBe("c");
      expect(index.currentSlug("dddd2222")).toBe("c-dddd");
    });

    it("falls back to the full ID when the suffixed slug is also taken", () => {
      rename("cccc1111", "C");
      rename("dddd0001", "C++");
      rename("dddd0002", "C#");
      expect(index.currentSlug("dddd0001")).toBe("c-dddd");
      expect(index.currentSlug("dddd0002")).toBe("c-dddd0002");
    });

    it("keeps a suffixed slug stable even after the plain one frees up", () => {
      rename("cccc1111", "C", 1);
      rename("dddd2222", "C++", 2);
      rename("cccc1111", "Something else", 3);
      rename("dddd2222", "C++", 4);
      expect(index.currentSlug("dddd2222")).toBe("c-dddd");
    });

    it("lets a page take over a slug that is only another page's old redirect", () => {
      rename(MIST, "Notes", 1);
      rename(MIST, "Ideas", 2);
      rename(ACCESS, "Notes", 3);
      expect(index.resolveSlug("notes")).toEqual({ pageId: ACCESS, current: true, currentSlug: "notes" });
      expect(index.resolveSlug("ideas")?.pageId).toBe(MIST);
    });

    it("drops the current slug when the title loses its letters, keeping redirects", () => {
      rename(MIST, "Named", 1);
      rename(MIST, "???", 2);
      expect(index.currentSlug(MIST)).toBeNull();
      expect(index.resolveSlug("named")).toEqual({ pageId: MIST, current: false, currentSlug: null });
    });

    it("resolves slugs regardless of case and accent composition", () => {
      rename(MIST, "Café");
      expect(index.resolveSlug("CAFÉ")?.pageId).toBe(MIST);
      expect(index.resolveSlug("café")?.pageId).toBe(MIST);
      expect(index.resolveSlug("unknown")).toBeNull();
    });

    it("keeps slugs, including redirects, through clearDerived", () => {
      rename(MIST, "Old", 1);
      rename(MIST, "New", 2);
      index.clearDerived();
      expect(index.resolveSlug("old")).toEqual({ pageId: MIST, current: false, currentSlug: "new" });
      expect(index.resolveSlug("new")?.current).toBe(true);
    });
  });

  describe("claimTitle", () => {
    it("records the title and returns the new slug", () => {
      index.updatePage(page(MIST, "Old", [line("x")], 10));
      expect(index.claimTitle(MIST, "Fresh Start", 20)).toEqual({ ok: true, title: "Fresh Start", slug: "fresh-start" });
      expect(index.getPage(MIST)).toMatchObject({ title: "Fresh Start", updatedAt: 10 });
      expect(index.resolveSlug("old")).toEqual({ pageId: MIST, current: false, currentSlug: "fresh-start" });
    });

    it("refuses a title another page or journal has, ignoring case", () => {
      index.updatePage(page(ACCESS, "Cloudflare Access", [line("x")]));
      index.updatePage(page(TODAY, "", [line("x")]));
      expect(index.claimTitle(MIST, "cloudflare access", 1)).toEqual({
        ok: false,
        reason: "taken",
        holder: { pageId: ACCESS, title: "Cloudflare Access" },
      });
      expect(index.claimTitle(MIST, "OCT 22ND, 2026", 1)).toMatchObject({ ok: false, reason: "taken" });
      expect(index.getPage(MIST)).toBeNull();
    });

    it("lets only the first of two pages claim the same title", () => {
      expect(index.claimTitle("aaaa1111", "Shared", 1).ok).toBe(true);
      expect(index.claimTitle("bbbb2222", "shared", 2)).toMatchObject({ ok: false, reason: "taken" });
    });

    it("lets a page claim its own title again", () => {
      index.claimTitle(MIST, "Mine", 1);
      expect(index.claimTitle(MIST, "MINE", 2)).toMatchObject({ ok: true, title: "MINE", slug: "mine" });
    });

    it("refuses to rename a journal", () => {
      expect(index.claimTitle(TODAY, "Something", 1)).toEqual({ ok: false, reason: "journal" });
    });

    it("works for a page that has not been indexed yet, and its first reindex still applies", () => {
      expect(index.claimTitle(MIST, "Brand New", 50)).toEqual({ ok: true, title: "Brand New", slug: "brand-new" });
      expect(index.registeredPages()).toEqual([MIST]);
      expect(index.getPage(MIST)).toMatchObject({ title: "Brand New", hasContent: false, updatedAt: 0 });
      expect(index.updatePage(page(MIST, "Brand New", [line("content")], 1)).applied).toBe(true);
      expect(index.currentSlug(MIST)).toBe("brand-new");
    });

    it("ends with the claimed title even if a stale reindex with the old title arrives in between", () => {
      index.updatePage(page(MIST, "Before", [line("x")], 10));
      index.claimTitle(MIST, "After", 11);
      index.updatePage(page(MIST, "Before", [line("x")], 12));
      expect(index.currentSlug(MIST)).toBe("before");
      index.updatePage(page(MIST, "After", [line("x")], 13));
      expect(index.currentSlug(MIST)).toBe("after");
      expect(index.resolveSlug("before")).toEqual({ pageId: MIST, current: false, currentSlug: "after" });
    });

    it("rejects invalid page IDs", () => {
      expect(() => index.claimTitle("bad id", "x", 1)).toThrow("Invalid page ID");
    });
  });

  describe("migrations", () => {
    function versionOneDb() {
      const old = memoryDb();
      for (const stmt of SCHEMA_V1) old.exec(stmt);
      old.exec(`INSERT INTO meta (key, value) VALUES ('schema_version', '1')`);
      const insert = `INSERT INTO pages (page_id, kind, title, title_key, journal_date, has_content, updated_at, parser_version)
                      VALUES (?, ?, ?, ?, ?, 1, 1, 1)`;
      old.exec(insert, "bbbb2222", "page", "Meeting Notes", "meeting notes", null);
      old.exec(insert, "aaaa1111", "page", "Meeting notes!", "meeting notes!", null);
      old.exec(insert, "cccc3333", "page", "", "", null);
      old.exec(insert, TODAY, "journal", "Oct 22nd, 2026", "oct 22nd, 2026", "2026-10-22");
      return old;
    }

    it("upgrades a version 1 index and gives every titled page a slug", () => {
      const old = versionOneDb();
      const upgraded = new WorkspaceIndex(old);
      expect(upgraded.schemaVersion()).toBe(SCHEMA_VERSION);
      // Pages are slugged in ID order, so the earlier ID keeps the plain slug
      expect(upgraded.currentSlug("aaaa1111")).toBe("meeting-notes");
      expect(upgraded.currentSlug("bbbb2222")).toBe("meeting-notes-bbbb");
      expect(upgraded.currentSlug("cccc3333")).toBeNull();
      expect(upgraded.currentSlug(TODAY)).toBeNull();
      expect(upgraded.getPage("bbbb2222")?.title).toBe("Meeting Notes");
    });

    it("migrates only once", () => {
      const old = versionOneDb();
      new WorkspaceIndex(old);
      old.exec(`DELETE FROM slugs`);
      new WorkspaceIndex(old);
      expect(Number(old.exec(`SELECT COUNT(*) AS n FROM slugs`)[0].n)).toBe(0);
    });

    it("leaves a version 1 index untouched if the migration fails", () => {
      const old = versionOneDb();
      old.raw.exec(`CREATE TABLE slugs (slug TEXT PRIMARY KEY, page_id TEXT NOT NULL, current INTEGER NOT NULL)`);
      old.raw.exec(`CREATE TRIGGER fail_slugs BEFORE INSERT ON slugs BEGIN SELECT RAISE(ABORT, 'boom'); END`);
      expect(() => new WorkspaceIndex(old)).toThrow("boom");
      expect(old.exec(`SELECT value FROM meta WHERE key = 'schema_version'`)[0].value).toBe("1");
    });

    it("refuses to open an index newer than the code", () => {
      const future = memoryDb();
      for (const stmt of SCHEMA_V1) future.exec(stmt);
      future.exec(`INSERT INTO meta (key, value) VALUES ('schema_version', '99')`);
      expect(() => new WorkspaceIndex(future)).toThrow("newer than this code");
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
