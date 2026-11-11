import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchSearch, searchRows, snippetParts, SNIPPET_END, SNIPPET_START, type SearchResults } from "~/lib/search";
import { isSearchShortcut } from "~/lib/search-box";

const S = SNIPPET_START;
const E = SNIPPET_END;
const page = (pageId: string, title: string) => ({ pageId, title, kind: "page" as const, slug: null });
const results = (over: Partial<SearchResults> = {}): SearchResults => ({ titles: [], text: [], pending: 0, ...over });

describe("snippetParts", () => {
  it("splits a snippet into plain and matched pieces", () => {
    expect(snippetParts(`…how to ${S}Smart${E} ${S}Notes${E} today`)).toEqual([
      { text: "…how to ", match: false },
      { text: "Smart", match: true },
      { text: " ", match: false },
      { text: "Notes", match: true },
      { text: " today", match: false },
    ]);
  });

  it("joins lines with spaces", () => {
    expect(snippetParts(`one\n\t- ${S}two${E}`)).toEqual([
      { text: "one - ", match: false },
      { text: "two", match: true },
    ]);
  });

  it("handles a snippet with no match, or nothing", () => {
    expect(snippetParts("plain")).toEqual([{ text: "plain", match: false }]);
    expect(snippetParts("")).toEqual([]);
  });
});

describe("searchRows", () => {
  it("lists titles, then text matches, then a row to create a page", () => {
    const rows = searchRows("boo", results({ titles: [page("a", "Books")], text: [{ ...page("b", "Reading"), snippet: "x" }] }));
    expect(rows.map((r) => r.kind)).toEqual(["title", "text", "create"]);
    expect(rows[2]).toEqual({ kind: "create", title: "boo", journal: false });
  });

  it("offers no create row when a page has the title, ignoring case", () => {
    expect(searchRows("books ", results({ titles: [page("a", "Books")] })).map((r) => r.kind)).toEqual(["title"]);
  });

  it("offers no create row for an empty query or a title that can't be one", () => {
    expect(searchRows("  ", results({ titles: [page("a", "Books")] })).map((r) => r.kind)).toEqual(["title"]);
    expect(searchRows("a [[b", results())).toEqual([]);
  });

  it("opens a journal day named by its date instead of creating a page", () => {
    expect(searchRows("Nov 11th, 2026", results())).toEqual([{ kind: "create", title: "Nov 11th, 2026", journal: true }]);
  });
});

describe("fetchSearch", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks GET /api/search with the query", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(results({ pending: 1 }))));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchSearch("a b&c")).toEqual(results({ pending: 1 }));
    expect(fetchMock).toHaveBeenCalledWith("/api/search?q=a%20b%26c", { signal: undefined });
  });

  it("throws when the server can't search", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 503 })));
    await expect(fetchSearch("x")).rejects.toThrow("search: 503");
  });
});

describe("isSearchShortcut", () => {
  const key = (over: Partial<KeyboardEvent>) => ({ key: "k", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over });
  afterEach(() => vi.unstubAllGlobals());

  it("is Cmd+K on a Mac", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(isSearchShortcut(key({ metaKey: true }))).toBe(true);
    expect(isSearchShortcut(key({ metaKey: true, key: "K" }))).toBe(true);
    expect(isSearchShortcut(key({ ctrlKey: true }))).toBe(false);
  });

  it("is Ctrl+K elsewhere", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(isSearchShortcut(key({ ctrlKey: true }))).toBe(true);
    expect(isSearchShortcut(key({ metaKey: true }))).toBe(false);
  });

  it("is not K with other keys, or another key", () => {
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(isSearchShortcut(key({}))).toBe(false);
    expect(isSearchShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isSearchShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isSearchShortcut(key({ ctrlKey: true, key: "j" }))).toBe(false);
  });
});
