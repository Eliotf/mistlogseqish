import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPagesByIds } = vi.hoisted(() => ({ mockPagesByIds: vi.fn() }));
vi.mock("~/lib/document-loader.server", () => ({ workspaceIndex: async () => ({ pagesByIds: mockPagesByIds }) }));

import { loader } from "~/routes/api.pages.titles";

const get = (query: string) => loader({ request: new Request(`https://mistlog.test/api/pages/titles${query}`), context: {} } as never) as Promise<Response>;
const indexed = (over: Record<string, unknown>) => ({ kind: "page", title: "", journalDate: null, hasContent: true, updatedAt: 1, parserVersion: 1, slug: null, ...over });

describe("GET /api/pages/titles", () => {
  beforeEach(() => {
    mockPagesByIds.mockReset();
    mockPagesByIds.mockImplementation(async () => []);
  });

  it("returns what links to each page should show", async () => {
    mockPagesByIds.mockImplementation(async () => [
      indexed({ pageId: "abcd1234", title: "Books", slug: "books" }),
      indexed({ pageId: "efgh5678", title: "", hasContent: false }),
      indexed({ pageId: "journal-2026-10-28", kind: "journal", journalDate: "2026-10-28" }),
    ]);
    const res = await get("?ids=abcd1234,efgh5678,journal-2026-10-28,journal-2026-10-01,zzzz9999");
    expect(res.status).toBe(200);
    expect((await res.json()).pages).toEqual({
      abcd1234: { title: "Books", kind: "page", slug: "books", empty: false, missing: false },
      efgh5678: { title: "Untitled", kind: "page", slug: null, empty: true, missing: false },
      "journal-2026-10-28": { title: "Oct 28th, 2026", kind: "journal", slug: null, empty: false, missing: false },
      // A journal day with no notes yet is a real, empty page: its ID is fixed
      "journal-2026-10-01": { title: "Oct 1st, 2026", kind: "journal", slug: null, empty: true, missing: false },
      zzzz9999: { title: "", kind: "page", slug: null, empty: false, missing: true },
    });
  });

  it("asks the index once, without duplicates", async () => {
    await get("?ids=abcd1234,abcd1234");
    expect(mockPagesByIds).toHaveBeenCalledTimes(1);
    expect(mockPagesByIds).toHaveBeenCalledWith(["abcd1234"]);
  });

  it.each([
    ["no ids", ""],
    ["an empty list", "?ids="],
    ["a bad ID", "?ids=abcd1234,../etc"],
    ["an impossible journal date", "?ids=journal-2026-02-30"],
    ["too many IDs", `?ids=${Array.from({ length: 201 }, (_, i) => `p${String(i).padStart(7, "0")}`).join(",")}`],
  ])("returns 400 for %s", async (_name, query) => {
    expect((await get(query)).status).toBe(400);
    expect(mockPagesByIds).not.toHaveBeenCalled();
  });

  it("returns 503 when the index cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockPagesByIds.mockImplementation(async () => {
      throw new Error("down");
    });
    expect((await get("?ids=abcd1234")).status).toBe(503);
    vi.restoreAllMocks();
  });
});
