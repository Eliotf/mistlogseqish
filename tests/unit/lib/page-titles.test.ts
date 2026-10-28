import { describe, it, expect, vi, afterEach } from "vitest";
import { PageTitleStore, linkHref, searchPages, linkPageForTitle, targetOf, MAX_TITLE_IDS, type LinkTarget } from "~/lib/page-titles";

const target = (title: string, over: Partial<LinkTarget> = {}): LinkTarget => ({ title, kind: "page", slug: null, empty: false, missing: false, ...over });
const settle = () => new Promise((r) => setTimeout(r, 0));

function fakeFetcher(titles: Record<string, string>) {
  return vi.fn(async (ids: string[]) => Object.fromEntries(ids.filter((id) => id in titles).map((id) => [id, target(titles[id])])));
}

describe("PageTitleStore", () => {
  afterEach(() => vi.restoreAllMocks());

  it("batches requests made together into one fetch, without duplicates", async () => {
    const fetcher = fakeFetcher({ a: "A", b: "B" });
    const store = new PageTitleStore(fetcher);
    store.request(["a", "b"]);
    store.request(["b", "a"]);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(["a", "b"]);
    expect(store.get("a")?.title).toBe("A");
  });

  it("does not fetch a page it already asked for", async () => {
    const fetcher = fakeFetcher({ a: "A" });
    const store = new PageTitleStore(fetcher);
    store.request(["a"]);
    await settle();
    store.request(["a"]);
    await settle();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("splits large batches to the route's limit", async () => {
    const fetcher = fakeFetcher({});
    const store = new PageTitleStore(fetcher);
    store.request(Array.from({ length: MAX_TITLE_IDS + 1 }, (_, i) => `p${i}`));
    await settle();
    expect(fetcher.mock.calls.map(([ids]) => ids.length)).toEqual([MAX_TITLE_IDS, 1]);
  });

  it("tells listeners only when something changed", async () => {
    const titles = { a: "A" };
    const store = new PageTitleStore(fakeFetcher(titles));
    const listener = vi.fn();
    store.subscribe(listener);
    store.request(["a"]);
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    store.refresh();
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    titles.a = "A renamed";
    store.refresh();
    await settle();
    expect(listener).toHaveBeenCalledTimes(2);
    expect(store.get("a")?.title).toBe("A renamed");
  });

  it("keeps the titles it had when a fetch fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetcher = fakeFetcher({ a: "A" });
    const store = new PageTitleStore(fetcher);
    store.request(["a"]);
    await settle();
    fetcher.mockRejectedValueOnce(new Error("offline"));
    store.refresh();
    await settle();
    expect(store.get("a")?.title).toBe("A");
  });

  it("stops telling a listener after it unsubscribes", async () => {
    const store = new PageTitleStore(fakeFetcher({ a: "A" }));
    const listener = vi.fn();
    store.subscribe(listener)();
    store.request(["a"]);
    await settle();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("linkHref", () => {
  it("uses the page's slug, a journal's date, or the page ID", () => {
    expect(linkHref("abcd1234", target("Books", { slug: "books" }))).toBe("/page/books");
    expect(linkHref("journal-2026-10-28", undefined)).toBe("/journal/2026-10-28");
    expect(linkHref("abcd1234", undefined)).toBe("/docs/abcd1234");
  });
});

describe("PageTitleStore.prime", () => {
  it("records a title learned elsewhere, without fetching it", async () => {
    const fetcher = fakeFetcher({});
    const store = new PageTitleStore(fetcher);
    const listener = vi.fn();
    store.subscribe(listener);
    store.prime("a", target("A"));
    store.prime("a", target("A"));
    store.request(["a"]);
    await settle();
    expect(store.get("a")?.title).toBe("A");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("talking to the server", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("searches titles", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ pages: [{ pageId: "a", title: "A", kind: "page", slug: null, empty: false }] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await searchPages("a b")).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/pages/search?q=a%20b");
  });

  it("finds or creates the page for a title, or says it can't", async () => {
    const page = { pageId: "a", title: "A", kind: "page", slug: "a", empty: true };
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ ok: true, ...page })).mockResolvedValueOnce(Response.json({ ok: false, reason: "no" }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await linkPageForTitle("A")).toEqual(page);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", body: JSON.stringify({ title: "A" }) });
    expect(await linkPageForTitle("bad")).toBeNull();
  });

  it("turns a found page into what links show", () => {
    expect(targetOf({ pageId: "a", title: "A", kind: "journal", slug: null, empty: true })).toEqual({ title: "A", kind: "journal", slug: null, empty: true, missing: false });
  });
});
