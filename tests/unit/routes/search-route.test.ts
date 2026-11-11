import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_SEARCH_QUERY, SEARCH_RECENT_LIMIT, SEARCH_TEXT_LIMIT, SEARCH_TITLE_LIMIT } from "~/lib/search";

const { mockSearchPages } = vi.hoisted(() => ({ mockSearchPages: vi.fn() }));
vi.mock("~/lib/document-loader.server", () => ({ workspaceIndex: async () => ({ searchPages: mockSearchPages }) }));

import { loader } from "~/routes/api.search";

const get = (q: string | null) =>
  loader({ request: new Request(`https://mistlog.test/api/search${q === null ? "" : `?q=${encodeURIComponent(q)}`}`), context: {} } as never) as Promise<Response>;

describe("GET /api/search", () => {
  beforeEach(() => {
    mockSearchPages.mockReset();
    mockSearchPages.mockImplementation(async () => ({ titles: [], text: [], pending: 0 }));
  });

  it("returns the index's results, asking for the search box's limits", async () => {
    const results = { titles: [{ pageId: "abcd1234", title: "Books", kind: "page", slug: "books" }], text: [], pending: 2 };
    mockSearchPages.mockImplementation(async () => results);
    const res = await get("  boo ");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(results);
    expect(mockSearchPages).toHaveBeenCalledWith("boo", SEARCH_TITLE_LIMIT, SEARCH_TEXT_LIMIT);
  });

  it("asks for recent pages when there is no query", async () => {
    await get(null);
    expect(mockSearchPages).toHaveBeenCalledWith("", SEARCH_RECENT_LIMIT, SEARCH_TEXT_LIMIT);
  });

  it("searches only the start of a very long query", async () => {
    await get("y".repeat(MAX_SEARCH_QUERY * 5));
    expect(mockSearchPages).toHaveBeenCalledWith("y".repeat(MAX_SEARCH_QUERY), SEARCH_TITLE_LIMIT, SEARCH_TEXT_LIMIT);
  });

  it("returns 503 when the index cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockSearchPages.mockImplementation(async () => {
      throw new Error("down");
    });
    expect((await get("x")).status).toBe(503);
    vi.restoreAllMocks();
  });
});
