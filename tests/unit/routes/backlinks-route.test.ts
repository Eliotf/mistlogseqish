import { describe, it, expect, vi, beforeEach } from "vitest";

const { index } = vi.hoisted(() => ({ index: { backlinks: vi.fn(), pagesByIds: vi.fn() } }));
vi.mock("~/lib/document-loader.server", () => ({ workspaceIndex: async () => index }));

import { loader } from "~/routes/api.pages.backlinks";

const get = (q: string) => loader({ request: new Request(`https://mistlog.test/api/pages/backlinks${q}`), context: {} } as never) as Promise<Response>;

describe("GET /api/pages/backlinks", () => {
  beforeEach(() => {
    index.backlinks.mockReset();
    index.pagesByIds.mockReset();
    index.pagesByIds.mockImplementation(async () => [{ pageId: "aaaa1111", slug: "plans" }]);
  });

  it("returns linking pages with their titles, addresses and link positions", async () => {
    index.backlinks.mockImplementation(async () => [
      { sourceId: "aaaa1111", sourceTitle: "Plans", sourceKind: "page", lines: [{ line: 2, content: { text: "see [[Books]]", marks: [{ type: "wikilink", from: 6, to: 11, attrs: { pageId: "abcd1234" } }, { type: "criticComment", from: 0, to: 3 }] } }] },
      { sourceId: "journal-2026-10-30", sourceTitle: "", sourceKind: "journal", lines: [{ line: 0, content: { text: "[[Books]]", marks: [{ type: "wikilink", from: 2, to: 7, attrs: { pageId: "abcd1234" } }] } }] },
      { sourceId: "bbbb2222", sourceTitle: "", sourceKind: "page", lines: [] },
    ]);
    const res = await get("?id=abcd1234");
    expect(index.backlinks).toHaveBeenCalledWith("abcd1234");
    expect((await res.json()).groups).toEqual([
      { pageId: "aaaa1111", title: "Plans", kind: "page", slug: "plans", lines: [{ line: 2, text: "see [[Books]]", links: [{ from: 6, to: 11, pageId: "abcd1234" }] }] },
      { pageId: "journal-2026-10-30", title: "Oct 30th, 2026", kind: "journal", slug: null, lines: [{ line: 0, text: "[[Books]]", links: [{ from: 2, to: 7, pageId: "abcd1234" }] }] },
      { pageId: "bbbb2222", title: "Untitled", kind: "page", slug: null, lines: [] },
    ]);
  });

  it("returns 400 for a bad page ID", async () => {
    expect((await get("?id=../x")).status).toBe(400);
    expect((await get("")).status).toBe(400);
    expect(index.backlinks).not.toHaveBeenCalled();
  });

  it("returns 503 when the index can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    index.backlinks.mockImplementation(async () => {
      throw new Error("down");
    });
    expect((await get("?id=abcd1234")).status).toBe(503);
    vi.restoreAllMocks();
  });
});
