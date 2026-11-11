import { describe, it, expect, beforeEach } from "vitest";
import { WorkspaceIndex, SCHEMA_V1, SCHEMA_VERSION, SNIPPET_START, SNIPPET_END, ftsQuery, type PageUpdate } from "../../../agents/workspace-index";
import { PARSER_VERSION, type DocLine } from "~/lib/note-parser";
import { WIKILINK_MARK } from "~/lib/wikilink";
import { memoryDb } from "../../helpers/sqlite";
import { MAX_SEARCH_RESULTS } from "~/lib/search";

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
      const snapshot = ["pages", "links", "tags", "tasks", "pages_fts", "page_text", "registry"].map((t) => db.exec(`SELECT * FROM ${t}`));
      index.updatePage(update);
      const again = ["pages", "links", "tags", "tasks", "pages_fts", "page_text", "registry"].map((t) => db.exec(`SELECT * FROM ${t}`));
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
      for (const table of ["pages", "links", "tags", "tasks", "pages_fts", "page_text"]) expect(count(table)).toBe(0);
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

  describe("pagesByIds", () => {
    it("returns each known page with its current slug, and leaves out unknown IDs", () => {
      index.updatePage(page(MIST, "Mistlog", [line("hello")]));
      index.claimTitle(MIST, "Mistlog renamed", 2000);
      index.updatePage(page(READING, "", []));
      index.updatePage(page(TODAY, "", [line("today")]));
      const found = new Map(index.pagesByIds([MIST, READING, TODAY, "nopage01"]).map((p) => [p.pageId, p]));
      expect([...found.keys()].sort()).toEqual([MIST, READING, TODAY].sort());
      expect(found.get(MIST)).toMatchObject({ title: "Mistlog renamed", slug: "mistlog-renamed", hasContent: true });
      expect(found.get(READING)).toMatchObject({ slug: null, hasContent: false });
      expect(found.get(TODAY)).toMatchObject({ kind: "journal", slug: null });
    });

    it("returns nothing for no IDs", () => {
      expect(index.pagesByIds([])).toEqual([]);
    });

    it("never binds more than 100 parameters in one query (the Durable Object limit)", () => {
      const ids = Array.from({ length: 250 }, (_, i) => `p${String(i).padStart(7, "0")}`);
      for (const id of ids.slice(0, 120)) index.updatePage(page(id, "", [line("x")]));
      let most = 0;
      const exec = db.exec.bind(db);
      db.exec = (query: string, ...bindings: Parameters<typeof db.exec>[1][]) => {
        most = Math.max(most, bindings.length);
        return exec(query, ...bindings);
      };
      expect(index.pagesByIds(ids)).toHaveLength(120);
      expect(most).toBeLessThanOrEqual(100);
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
      expect(index.claimTitle(MIST, "OCT 22ND, 2026", 1)).toEqual({ ok: false, reason: "journal-title" });
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

    it("reserves journal titles even for journals that are not indexed yet", () => {
      expect(index.claimTitle(MIST, "Oct 30th, 2026", 1)).toEqual({ ok: false, reason: "journal-title" });
      expect(index.claimTitle(MIST, "dec 1ST, 2030", 1)).toEqual({ ok: false, reason: "journal-title" });
      expect(index.claimTitle(MIST, "Oct 30, 2026", 1).ok).toBe(true);
    });

    it("compares titles in one Unicode form", () => {
      index.claimTitle(MIST, "Café", 1);
      expect(index.claimTitle(ACCESS, "cafe\u0301", 2)).toMatchObject({ ok: false, reason: "taken" });
      expect(index.findByTitle("CAFE\u0301")?.pageId).toBe(MIST);
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

    /** Import records came with version 5: an older index has none of their tables. */
    function dropImportTables(db: ReturnType<typeof memoryDb>) {
      db.exec(`DROP TABLE import_pages`);
      db.exec(`DROP TABLE imports`);
    }

    /** Page text runs came with version 7. */
    function dropPageText(db: ReturnType<typeof memoryDb>) {
      db.exec(`DROP TABLE page_text`);
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

    it("upgrades a version 2 index: old task rows keep working, and gain the new fields when re-indexed", () => {
      const old = versionOneDb();
      new WorkspaceIndex(old); // to version 2 (and on to the current one)
      // Rebuild the version 2 tasks table, as it was before schema 3
      old.exec(`DROP TABLE tasks`);
      old.exec(`CREATE TABLE tasks (page_id TEXT NOT NULL, line INTEGER NOT NULL, state TEXT NOT NULL, indent INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (page_id, line))`);
      old.exec(`INSERT INTO tasks (page_id, line, state, indent, text) VALUES ('aaaa1111', 0, 'TODO', 0, 'old task')`);
      dropImportTables(old); // added in version 5
      dropPageText(old); // added in version 7
      old.exec(`UPDATE meta SET value = '2' WHERE key = 'schema_version'`);
      const upgraded = new WorkspaceIndex(old);
      expect(upgraded.schemaVersion()).toBe(SCHEMA_VERSION);
      expect(upgraded.tasks()).toEqual([expect.objectContaining({ text: "old task", priority: null, blockId: null, content: null })]);
      upgraded.updatePage(page("aaaa1111", "Meeting notes!", [line("TODO [#A] new task")], 2000));
      expect(upgraded.tasks()).toEqual([expect.objectContaining({ text: "[#A] new task", priority: "A", content: { text: "TODO [#A] new task", marks: [] } })]);
    });

    it("upgrades a version 3 index with a table of deleted pages", () => {
      const old = versionOneDb();
      new WorkspaceIndex(old);
      old.exec(`DROP TABLE deleted_pages`);
      dropImportTables(old); // added in version 5
      dropPageText(old); // added in version 7
      old.exec(`UPDATE meta SET value = '3' WHERE key = 'schema_version'`);
      const upgraded = new WorkspaceIndex(old);
      expect(upgraded.schemaVersion()).toBe(SCHEMA_VERSION);
      expect(upgraded.isDeleted("aaaa1111")).toBe(false);
      upgraded.deletePage("aaaa1111", 1);
      expect(upgraded.isDeleted("aaaa1111")).toBe(true);
    });

    it("upgrades a version 4 index with import records, keeping its pages", () => {
      const old = versionOneDb();
      new WorkspaceIndex(old);
      dropImportTables(old);
      dropPageText(old); // added in version 7
      old.exec(`UPDATE meta SET value = '4' WHERE key = 'schema_version'`);
      const upgraded = new WorkspaceIndex(old);
      expect(upgraded.schemaVersion()).toBe(SCHEMA_VERSION);
      expect(upgraded.listImports()).toEqual([]);
      expect(upgraded.startImport("imp1", "Logseq", 1)).toEqual({ ok: true });
      expect(upgraded.getPage("aaaa1111")?.title).toBe("Meeting notes!");
    });

    it("upgrades a version 5 index, keeping its import (with no folder name)", () => {
      const old = versionOneDb();
      new WorkspaceIndex(old);
      old.exec(`DROP TABLE imports`);
      old.exec(`CREATE TABLE imports (import_id TEXT PRIMARY KEY, state TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER)`);
      old.exec(`INSERT INTO imports (import_id, state, started_at, finished_at) VALUES ('imp1', 'done', 1, 2)`);
      old.exec(`INSERT INTO import_pages (import_id, page_id, created) VALUES ('imp1', 'aaaa1111', 1)`);
      dropPageText(old); // added in version 7
      old.exec(`UPDATE meta SET value = '5' WHERE key = 'schema_version'`);
      const upgraded = new WorkspaceIndex(old);
      expect(upgraded.schemaVersion()).toBe(SCHEMA_VERSION);
      expect(upgraded.listImports()).toEqual([{ importId: "imp1", label: null, state: "done", startedAt: 1, finishedAt: 2, pages: 1, created: 1 }]);
      // A finished import no longer stops another
      expect(upgraded.startImport("imp2", "Work", 3)).toEqual({ ok: true });
    });

    it("upgrades a version 6 index: old search rows keep working until their page re-indexes", () => {
      const old = memoryDb();
      const v7 = new WorkspaceIndex(old);
      v7.updatePage(page(ACCESS, "Access", [line("x")]));
      v7.updatePage(page(MIST, "Mistlog", [line("see Access", [[4, 10, ACCESS]])]));
      // As a version 6 index held it: no runs, the stored link text in the search row
      dropPageText(old);
      old.exec(`UPDATE meta SET value = '6' WHERE key = 'schema_version'`);
      const upgraded = new WorkspaceIndex(old);
      expect(upgraded.schemaVersion()).toBe(SCHEMA_VERSION);
      expect(Number(old.exec(`SELECT COUNT(*) AS n FROM page_text`)[0].n)).toBe(0);
      expect(upgraded.search("see").map((h) => h.pageId)).toEqual([MIST]);
      // A rename before the linking page re-indexes leaves its row as it was
      upgraded.claimTitle(ACCESS, "Gateway", 2000);
      expect(upgraded.search("see access").map((h) => h.pageId)).toEqual([MIST]);
      // Re-indexing (the parser version makes every page do so) fills in its runs
      upgraded.updatePage(page(MIST, "Mistlog", [line("see Access", [[4, 10, ACCESS]])], 3000));
      expect(upgraded.search("see gateway").map((h) => h.pageId)).toEqual([MIST]);
      expect(upgraded.search("see access")).toEqual([]);
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

  describe("Logseq import records (F31)", () => {
    it("lists every import not undone, newest first, with its folder name", () => {
      expect(index.listImports()).toEqual([]);
      index.startImport("imp1", "Logseq", 100);
      index.finishImport("imp1", 150);
      index.startImport("imp2", null, 200);
      expect(index.listImports()).toEqual([
        { importId: "imp2", label: null, state: "running", startedAt: 200, finishedAt: null, pages: 0, created: 0 },
        { importId: "imp1", label: "Logseq", state: "done", startedAt: 100, finishedAt: 150, pages: 0, created: 0 },
      ]);
      expect(index.getImport("imp1")).toMatchObject({ label: "Logseq", state: "done" });
      expect(index.getImport("nope")).toBeNull();
    });

    it("lists imports started in the same millisecond in the order they were started", () => {
      // Import IDs are random, so they must not decide the order
      for (const id of ["imp-c", "imp-a", "imp-b"]) {
        index.startImport(id, id, 100);
        index.finishImport(id, 100);
      }
      expect(index.listImports().map((i) => i.importId)).toEqual(["imp-b", "imp-a", "imp-c"]);
      // The hand-over, too, goes to the latest
      index.recordImportPage("imp-c", MIST, true);
      index.recordImportPage("imp-a", MIST, false);
      index.recordImportPage("imp-b", MIST, false);
      index.startUndo("imp-c");
      expect(index.handOverImportPage("imp-c", MIST)).toBe(true);
      expect(index.getImport("imp-b")).toMatchObject({ created: 1 });
      expect(index.getImport("imp-a")).toMatchObject({ created: 0 });
    });

    it("runs one import at a time; a finished one doesn't stop another", () => {
      expect(index.startImport("imp1", "A", 100)).toEqual({ ok: true });
      expect(index.isRunningImport("imp1")).toBe(true);
      const refused = index.startImport("imp2", "B", 200);
      expect(refused).toEqual({ ok: false, current: expect.objectContaining({ importId: "imp1", label: "A", state: "running" }) });
      expect(index.isRunningImport("imp2")).toBe(false);

      expect(index.finishImport("imp1", 150)).toBe(true);
      expect(index.isRunningImport("imp1")).toBe(false);
      expect(index.startImport("imp2", "B", 200)).toEqual({ ok: true });
      expect(index.finishImport("imp2", 250)).toBe(true);
      expect(index.listImports().map((i) => i.importId)).toEqual(["imp2", "imp1"]);
    });

    it("refuses to start an import while another is being undone, or to undo one while another is unfinished", () => {
      index.startImport("imp1", "A", 100);
      index.finishImport("imp1", 150);
      index.startImport("imp2", "B", 200);
      // imp2 is running: imp1 can't be undone yet (its pages may be what imp2 links to)
      expect(index.startUndo("imp1")).toBe("busy");
      expect(index.getImport("imp1")?.state).toBe("done");
      expect(index.startUndo("nope")).toBe("missing");
      index.finishImport("imp2", 250);
      expect(index.startUndo("imp1")).toBe("ok");
      expect(index.startUndo("imp2")).toBe("busy");
      expect(index.startImport("imp3", "C", 300)).toEqual({ ok: false, current: expect.objectContaining({ importId: "imp1", state: "undoing" }) });
      // Continuing the undo of the unfinished one is allowed
      expect(index.startUndo("imp1")).toBe("ok");
      expect(index.finishUndo("imp1")).toBe(true);
      expect(index.startUndo("imp2")).toBe("ok");
    });

    it("counts the documents written and pages created; a page once created stays so", () => {
      index.startImport("imp1", "A", 100);
      index.recordImportPage("imp1", MIST, true);
      index.recordImportPage("imp1", MIST, false); // found again when the import is continued
      index.recordImportPage("imp1", TODAY, false);
      index.recordImportPage("imp1", ACCESS, true);
      index.forgetImportPage("imp1", ACCESS); // it was created by someone else first
      expect(index.getImport("imp1")).toMatchObject({ pages: 2, created: 1 });
      expect(() => index.recordImportPage("imp1", "../nope", false)).toThrow("Invalid page ID");
    });

    it("undoes a few documents at a time and is not finished until all are", () => {
      index.startImport("imp1", "A", 100);
      index.recordImportPage("imp1", MIST, true);
      index.recordImportPage("imp1", TODAY, false);
      index.recordImportPage("imp1", READING, false);
      // Undo is refused for an import that doesn't exist, and once started, writes stop
      expect(index.startUndo("nope")).toBe("missing");
      expect(index.startUndo("imp1")).toBe("ok");
      expect(index.isRunningImport("imp1")).toBe(false);
      expect(index.finishImport("imp1", 1)).toBe(false);
      expect(index.importPagesToUndo("imp1", 2)).toEqual([
        { pageId: TODAY, created: false },
        { pageId: MIST, created: true },
      ]);
      index.forgetImportPage("imp1", TODAY);
      index.forgetImportPage("imp1", MIST);
      expect(index.finishUndo("imp1")).toBe(false);
      expect(index.getImport("imp1")).toMatchObject({ state: "undoing", pages: 1 });
      // Undoing again after a cut-off undo continues it
      expect(index.startUndo("imp1")).toBe("ok");
      index.forgetImportPage("imp1", READING);
      expect(index.finishUndo("imp1")).toBe(true);
      expect(index.getImport("imp1")).toBeNull();
      expect(index.listImports()).toEqual([]);
      expect(index.startUndo("imp1")).toBe("missing");
      expect(index.finishUndo("nope")).toBe(false);
    });

    it("hands a created page over to the newest other import still using it", () => {
      index.startImport("imp1", "A", 100);
      index.recordImportPage("imp1", MIST, true);
      index.recordImportPage("imp1", ACCESS, true);
      index.finishImport("imp1", 150);
      index.startImport("imp2", "B", 200);
      index.recordImportPage("imp2", MIST, false);
      index.finishImport("imp2", 250);
      index.startImport("imp3", "C", 300);
      index.recordImportPage("imp3", MIST, false);
      index.finishImport("imp3", 350);
      // imp3, being undone, doesn't take anything over
      index.startUndo("imp3");
      expect(index.handOverImportPage("imp1", MIST)).toBe(true);
      expect(index.getImport("imp2")).toMatchObject({ created: 1 });
      expect(index.getImport("imp3")).toMatchObject({ created: 0 });
      // Nobody else uses ACCESS: it is deleted with imp1
      expect(index.handOverImportPage("imp1", ACCESS)).toBe(false);
      // A repeat (an undo cut short) hands it over again, harmlessly
      expect(index.handOverImportPage("imp1", MIST)).toBe(true);
      expect(index.getImport("imp2")).toMatchObject({ pages: 1, created: 1 });
    });

    it("survives a rebuild: import records are not derived", () => {
      index.startImport("imp1", "A", 100);
      index.recordImportPage("imp1", MIST, true);
      index.clearDerived();
      expect(index.getImport("imp1")).toMatchObject({ importId: "imp1", label: "A", pages: 1 });
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

  describe("search across pages (F13)", () => {
    const NOTES = "notes001";
    const fts = () => db.exec(`SELECT page_id, title, body FROM pages_fts ORDER BY page_id`);
    const derived = () => [fts(), db.exec(`SELECT * FROM page_text ORDER BY page_id`)];

    beforeEach(() => {
      index.updatePage(page(ACCESS, "Cloudflare Access", [line("Zero trust gateway")], 100));
      index.updatePage(page(MIST, "Mistlog", [line("- notes on [[Cloudflare Access]] setup", [[13, 30, ACCESS]])], 200));
      index.updatePage(page(READING, "Reading list", [line("How to Take Smart Notes")], 300));
      index.updatePage(page(TODAY, "", [line("met about [[Mistlog]]", [[12, 19, MIST]])], 400));
    });

    it("lists titles first (starting with the query, then containing it), then text matches with a snippet", () => {
      index.updatePage(page(NOTES, "Notes inbox", [line("empty")], 500));
      const results = index.searchPages("notes", 6, 8);
      expect(results.titles.map((p) => p.title)).toEqual(["Notes inbox"]);
      expect(results.titles[0]).toEqual({ pageId: NOTES, title: "Notes inbox", kind: "page", slug: "notes-inbox" });
      expect(results.text.map((h) => h.pageId).sort()).toEqual([MIST, READING].sort());
      const reading = results.text.find((h) => h.pageId === READING)!;
      expect(reading).toMatchObject({ title: "Reading list", kind: "page", slug: "reading-list" });
      expect(reading.snippet).toContain(`${SNIPPET_START}Notes${SNIPPET_END}`);
      expect(results.pending).toBe(0);
    });

    it("lists a page found only by its title with the titles, not the text matches", () => {
      const results = index.searchPages("reading", 6, 8);
      expect(results.titles.map((p) => p.pageId)).toEqual([READING]);
      expect(results.text).toEqual([]);
    });

    it("finds a title the LIKE match misses (no accent) through full text, once", () => {
      index.updatePage(page(NOTES, "Café plans", [line("nothing here")], 500));
      const results = index.searchPages("cafe", 6, 8);
      expect(results.titles.map((p) => p.pageId)).toEqual([NOTES]);
      expect(results.text).toEqual([]);
    });

    it("titles journal days by their date and finds them by it", () => {
      const results = index.searchPages("oct 22", 6, 8);
      expect(results.titles).toEqual([{ pageId: TODAY, title: "Oct 22nd, 2026", kind: "journal", slug: null }]);
      expect(index.searchPages("met", 6, 8).text).toEqual([expect.objectContaining({ pageId: TODAY, title: "Oct 22nd, 2026", kind: "journal" })]);
    });

    it("leaves out journal days with no text", () => {
      index.updatePage(page(YESTERDAY, "", [line("  ")], 500));
      expect(index.searchPages("oct 21", 6, 8).titles).toEqual([]);
      expect(index.search("oct 21")).toEqual([]);
      expect(index.searchPages("", 10, 8).titles.map((p) => p.pageId)).not.toContain(YESTERDAY);
    });

    it("finds untitled pages by their text only", () => {
      index.updatePage(page(NOTES, "", [line("loose thought")], 500));
      expect(index.searchPages("loose", 6, 8).text.map((h) => h.pageId)).toEqual([NOTES]);
      expect(index.searchPages("", 10, 8).titles.map((p) => p.pageId)).not.toContain(NOTES);
    });

    it("lists recently edited pages for an empty query, and no text matches", () => {
      expect(index.searchPages("  ", 2, 8)).toEqual({
        titles: [
          { pageId: TODAY, title: "Oct 22nd, 2026", kind: "journal", slug: null },
          { pageId: READING, title: "Reading list", kind: "page", slug: "reading-list" },
        ],
        text: [],
        pending: 0,
      });
    });

    it("never shows a deleted page", () => {
      index.deletePage(READING, 1000);
      expect(index.searchPages("reading", 6, 8).titles).toEqual([]);
      expect(index.searchPages("smart", 6, 8).text).toEqual([]);
      expect(index.searchPages("", 10, 8).titles.map((p) => p.pageId)).not.toContain(READING);
      // A late update from an open tab doesn't bring it back
      index.updatePage(page(READING, "Reading list", [line("Smart again")], 2000));
      expect(index.searchPages("smart", 6, 8).text).toEqual([]);
    });

    it("says how many pages the index is still catching up on", () => {
      index.registerPage(NOTES, 1);
      expect(index.searchPages("x", 6, 8).pending).toBe(1);
    });

    describe("links are found by their page's current title, not the stored copy", () => {
      it("after a rename", () => {
        expect(index.searchPages("cloudflare setup", 6, 8).text.map((h) => h.pageId)).toEqual([MIST]);
        expect(index.claimTitle(ACCESS, "Zero Trust", 1000)).toMatchObject({ ok: true });
        const found = index.searchPages("zero trust setup", 6, 8).text;
        expect(found.map((h) => h.pageId)).toEqual([MIST]);
        expect(found[0].snippet).toContain(`[[${SNIPPET_START}Zero${SNIPPET_END} ${SNIPPET_START}Trust${SNIPPET_END}]]`);
        // The old title no longer finds the linking page (nor the renamed one)
        expect(index.searchPages("cloudflare", 6, 8)).toMatchObject({ titles: [], text: [] });
        // Its own title is searched by the new one at once, before it re-indexes
        expect(index.search("zero").map((h) => h.pageId).sort()).toEqual([ACCESS, MIST].sort());
      });

      it("after a rename that arrives as an update", () => {
        index.updatePage(page(ACCESS, "Gateway", [line("Zero trust gateway")], 1000));
        expect(index.search("notes gateway").map((h) => h.pageId)).toEqual([MIST]);
        expect(index.search("notes cloudflare")).toEqual([]);
      });

      it("whichever page a rebuild reaches first", () => {
        const linkerFirst = memoryDb();
        const fresh = new WorkspaceIndex(linkerFirst);
        fresh.updatePage(page(MIST, "Mistlog", [line("- notes on [[Cloudflare Access]] setup", [[13, 30, ACCESS]])], 200));
        fresh.updatePage(page(ACCESS, "Gateway", [line("Zero trust gateway")], 100));
        expect(fresh.search("notes gateway").map((h) => h.pageId)).toEqual([MIST]);
      });

      it("a link to a journal day shows its date", () => {
        index.updatePage(page(NOTES, "Plans", [line("see [[old copy]]", [[6, 14, YESTERDAY]])], 500));
        expect(index.search("see oct 21st").map((h) => h.pageId)).toEqual([NOTES]);
      });

      it("a deleted page's links go back to their stored text", () => {
        index.claimTitle(ACCESS, "Zero Trust", 1000);
        index.deletePage(ACCESS, 2000);
        expect(index.search("notes zero")).toEqual([]);
        expect(index.search("notes cloudflare").map((h) => h.pageId)).toEqual([MIST]);
      });

      it("many linked pages in one page (more than one query's bound parameters)", () => {
        // Durable Object SQLite refuses more than 100 bound parameters; Node's doesn't, so check here
        const limited = memoryDb();
        const exec = limited.exec.bind(limited);
        limited.exec = (query, ...bindings) => {
          if (bindings.length > 100) throw new Error(`too many SQL variables: ${bindings.length}`);
          return exec(query, ...bindings);
        };
        index = new WorkspaceIndex(limited);
        const ids = Array.from({ length: 150 }, (_, i) => `t${String(i).padStart(7, "0")}`);
        for (const [i, id] of ids.entries()) index.updatePage(page(id, `Target ${i}`, [line("x")], 500));
        index.claimTitle(ids[149], "Renamed last", 600);
        const text = ids.map((_, i) => `[[old${i}]]`).join(" ");
        const marks: Array<[number, number, string]> = [];
        let at = 0;
        for (const [i, id] of ids.entries()) {
          marks.push([at + 2, at + 2 + `old${i}`.length, id]);
          at += `[[old${i}]] `.length;
        }
        index.updatePage(page(NOTES, "Hub", [line(text, marks)], 700));
        expect(index.search("renamed last").map((h) => h.pageId).sort()).toEqual([NOTES, ids[149]].sort());
        expect(index.search("old0")).toEqual([]);
      });

      it("re-indexing twice gives the same rows", () => {
        index.claimTitle(ACCESS, "Zero Trust", 1000);
        const update = page(MIST, "Mistlog", [line("- notes on [[Cloudflare Access]] setup", [[13, 30, ACCESS]])], 2000);
        index.updatePage(update);
        const once = derived();
        index.updatePage(update);
        expect(derived()).toEqual(once);
      });

      it("a rebuild from the documents gives the same rows as renaming did", () => {
        index.claimTitle(ACCESS, "Zero Trust", 1000);
        index.updatePage(page(ACCESS, "Zero Trust", [line("Zero trust gateway")], 1001));
        const incremental = derived();
        index.clearDerived();
        // The documents as they now are, in another order
        index.updatePage(page(TODAY, "", [line("met about [[Mistlog]]", [[12, 19, MIST]])], 400));
        index.updatePage(page(MIST, "Mistlog", [line("- notes on [[Cloudflare Access]] setup", [[13, 30, ACCESS]])], 200));
        index.updatePage(page(READING, "Reading list", [line("How to Take Smart Notes")], 300));
        index.updatePage(page(ACCESS, "Zero Trust", [line("Zero trust gateway")], 1001));
        expect(derived()).toEqual(incremental);
      });
    });

    describe("odd queries", () => {
      it.each([
        ["empty", ""],
        ["only punctuation", "-- ** !?"],
        ["FTS operators", "NOT AND OR NEAR(x y)"],
        ["quotes", '"smart'],
        ["column filters", "title: body:"],
        ["LIKE wildcards", "%_%"],
        ["brackets", "[[ ]] ((x))"],
      ])("%s does not fail", (_name, q) => {
        expect(() => index.searchPages(q, 6, 8)).not.toThrow();
      });

      it("searches FTS operators and quotes as words", () => {
        index.updatePage(page(NOTES, "Logic", [line("this AND that, \"quoted\" NOT here")], 500));
        expect(index.searchPages("and that", 6, 8).text.map((h) => h.pageId)).toEqual([NOTES]);
        expect(index.searchPages('"quoted', 6, 8).text.map((h) => h.pageId)).toEqual([NOTES]);
        expect(index.searchPages("not here", 6, 8).text.map((h) => h.pageId)).toEqual([NOTES]);
      });

      it("treats LIKE wildcards in titles literally", () => {
        index.updatePage(page(NOTES, "100% done", [line("x")], 500));
        expect(index.searchPages("%", 6, 8).titles.map((p) => p.pageId)).toEqual([NOTES]);
        expect(index.searchPages("_", 6, 8).titles).toEqual([]);
      });

      it("handles a very long query", () => {
        const long = "smart ".repeat(400);
        expect(index.searchPages(long, 6, 8).text.map((h) => h.pageId)).toEqual([READING]);
        expect(() => index.searchPages("x".repeat(5000), 6, 8)).not.toThrow();
      });
    });

    describe("result caps", () => {
      beforeEach(() => {
        for (let i = 0; i < 70; i++) index.updatePage(page(`many${String(i).padStart(4, "0")}`, `Common ${i}`, [line(`common words ${i}`)], 1000 + i));
      });

      it("returns at most the limits asked for", () => {
        const results = index.searchPages("common", 6, 8);
        expect(results.titles).toHaveLength(6);
        expect(results.text).toHaveLength(8);
      });

      it("never more than MAX_SEARCH_RESULTS, whatever is asked", () => {
        expect(index.search("common", 1000)).toHaveLength(MAX_SEARCH_RESULTS);
        expect(index.searchPages("common", 1000, 1000).titles).toHaveLength(MAX_SEARCH_RESULTS);
        expect(index.searchPages("", 1000, 8).titles).toHaveLength(MAX_SEARCH_RESULTS);
        expect(index.search("common", 0)).toHaveLength(1);
        expect(index.search("common", Number.NaN)).toHaveLength(1);
      });
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

    it("includes the page, line, priority, block ID and the stored line", () => {
      expect(index.tasks(["DOING"])).toEqual([
        {
          pageId: MIST,
          pageTitle: "Mistlog",
          pageKind: "page",
          updatedAt: 1000,
          line: 1,
          state: "DOING",
          indent: 1,
          text: "build index",
          priority: null,
          blockId: null,
          content: { text: "\t- DOING build index", marks: [] },
        },
      ]);
    });

    it("knows LATER and NOW, and lists higher priorities first", () => {
      index.updatePage(page(ACCESS, "Access", [line("LATER [#C] someday"), { text: "NOW [#A] urgent", marks: [], id: "00000000-0000-4000-8000-000000000001" }, line("TODO [#B] soon")]));
      expect(index.tasks(["TODO", "LATER", "NOW"]).map((t) => [t.state, t.priority, t.text])).toEqual([
        ["NOW", "A", "[#A] urgent"],
        ["TODO", "B", "[#B] soon"],
        ["LATER", "C", "[#C] someday"],
        ["TODO", null, "write review"],
        ["TODO", null, "verify deploy gate"],
        ["TODO", null, "agree interactions"],
      ]);
      expect(index.tasks(["NOW"])[0].blockId).toBe("00000000-0000-4000-8000-000000000001");
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

  describe("All pages and deleting (F21)", () => {
    beforeEach(() => {
      index.updatePage(page(MIST, "Mistlog", [line("see access", [[4, 10, ACCESS]])], 3000));
      index.updatePage(page(READING, "Reading", [line("access again", [[0, 6, ACCESS]]), line("and again", [[4, 9, ACCESS]])], 2000));
      index.updatePage(page(ACCESS, "Access", [line("TODO self link", [[5, 9, ACCESS]]), line("#tag")], 1000));
      index.updatePage(page(TODAY, "", [line("today")], 4000));
    });

    it("lists every page and journal, newest first, with how many other pages link to each", () => {
      expect(index.allPages()).toEqual([
        { pageId: TODAY, kind: "journal", title: "Oct 22nd, 2026", slug: null, hasContent: true, updatedAt: 4000, backlinks: 0 },
        { pageId: MIST, kind: "page", title: "Mistlog", slug: "mistlog", hasContent: true, updatedAt: 3000, backlinks: 0 },
        { pageId: READING, kind: "page", title: "Reading", slug: "reading", hasContent: true, updatedAt: 2000, backlinks: 0 },
        // Linked twice from Reading and once from Mistlog; its own self-link doesn't count
        { pageId: ACCESS, kind: "page", title: "Access", slug: "access", hasContent: true, updatedAt: 1000, backlinks: 2 },
      ]);
    });

    it("leaves out journal days with no text, but keeps empty pages", () => {
      index.updatePage(page(YESTERDAY, "", [line("  ")], 5000));
      index.updatePage(page(READING, "Reading", [line("")], 6000));
      expect(index.allPages().map((p) => p.pageId)).toEqual([READING, TODAY, MIST, ACCESS]);
    });

    it("deleting a page removes it and what it says, frees its title and addresses, and keeps links to it", () => {
      expect(index.deletePage(ACCESS, 5000)).toBe("Access");
      expect(index.getPage(ACCESS)).toBeNull();
      expect(index.tasks(["TODO"])).toEqual([]);
      expect(index.search("self")).toEqual([]);
      expect(index.resolveSlug("access")).toBeNull();
      expect(index.registeredPages()).not.toContain(ACCESS);
      expect(index.pagesToRefresh()).not.toContain(ACCESS);
      // Links from other pages to it stay: they show as unresolved
      expect(index.backlinks(ACCESS).map((b) => b.sourceId).sort()).toEqual([MIST, READING]);
      // Its title is free for another page
      expect(index.claimTitle(READING, "Access", 6000)).toMatchObject({ ok: true });
    });

    it("a deleted page's links no longer count, and late updates or registrations never bring it back", () => {
      index.deletePage(READING, 5000);
      expect(index.allPages().find((p) => p.pageId === ACCESS)?.backlinks).toBe(1);
      expect(index.updatePage(page(READING, "Reading", [line("late edit")], 9000)).applied).toBe(true);
      index.registerPage(READING, 9000);
      expect(index.getPage(READING)).toBeNull();
      expect(index.registeredPages()).not.toContain(READING);
      expect(index.isDeleted(READING)).toBe(true);
      expect(index.isDeleted(MIST)).toBe(false);
    });

    it("deleting twice is harmless", () => {
      index.deletePage(MIST, 5000);
      expect(index.deletePage(MIST, 6000)).toBe("");
      expect(Number(db.exec(`SELECT COUNT(*) AS n FROM deleted_pages`)[0].n)).toBe(1);
    });
  });

  describe("importCheck (Logseq import dry run)", () => {
    it("says which title keys are pages and which days already have notes, in batches", () => {
      index.updatePage(page(MIST, "Mistlog", [line("x")]));
      index.updatePage(page(TODAY, "", [line("today")]));
      index.updatePage(page("journal-2026-10-21", "", [line("")]));
      const many = Array.from({ length: 150 }, (_, i) => `title ${i}`);
      expect(index.importCheck([...many, "mistlog", "unknown"], ["2026-10-22", "2026-10-21", "2026-10-20"])).toEqual({ pages: ["mistlog"], days: ["2026-10-22"] });
    });
  });

  describe("rebuild bookkeeping", () => {
    it("lists registered pages never indexed or indexed by an older parser, in ID order after a cursor", () => {
      index.updatePage(page(MIST, "Mistlog", [line("x")]));
      index.updatePage(page(ACCESS, "Access", [line("x")]));
      index.registerPage(TODAY, 1); // registered, never indexed
      expect(index.pagesToRefresh()).toEqual([TODAY]);
      db.exec(`UPDATE pages SET parser_version = ? WHERE page_id = ?`, PARSER_VERSION - 1, MIST);
      expect(index.pagesToRefresh()).toEqual([TODAY, MIST]);
      expect(index.refreshCount()).toBe(2);
      expect(index.pagesToRefresh(1)).toEqual([TODAY]);
      expect(index.pagesToRefresh(10, TODAY)).toEqual([MIST]);
      index.updatePage(page(MIST, "Mistlog", [line("x")], 2000));
      expect(index.pagesToRefresh()).toEqual([TODAY]);
    });

    it("remembers where a rebuild has got to, and forgets it when done", () => {
      expect(index.rebuildCursor()).toBeNull();
      index.setRebuildCursor("");
      expect(index.rebuildCursor()).toBe("");
      index.setRebuildCursor(MIST);
      expect(index.rebuildCursor()).toBe(MIST);
      index.setRebuildCursor(null);
      expect(index.rebuildCursor()).toBeNull();
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
