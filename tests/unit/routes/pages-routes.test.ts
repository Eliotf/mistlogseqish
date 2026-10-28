import { describe, it, expect, vi, beforeEach } from "vitest";

const { index, agent, documentAgentFor } = vi.hoisted(() => {
  const index = { findByTitle: vi.fn(), currentSlug: vi.fn(), getPage: vi.fn(), searchTitles: vi.fn(), pagesByIds: vi.fn() };
  const agent = { createWithTitle: vi.fn() };
  return { index, agent, documentAgentFor: vi.fn() };
});
vi.mock("~/lib/document-loader.server", () => ({
  workspaceIndex: async () => index,
  documentAgent: async (_ctx: unknown, id: string) => {
    documentAgentFor(id);
    return agent;
  },
}));

import { action } from "~/routes/api.pages";
import { loader as search } from "~/routes/api.pages.search";

const post = (body: unknown, init: { method?: string; contentType?: string } = {}) =>
  action({
    request: new Request("https://mistlog.test/api/pages", {
      method: init.method ?? "POST",
      headers: { "Content-Type": init.contentType ?? "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    context: {},
  } as never) as Promise<Response>;

const page = (over: Record<string, unknown>) => ({ kind: "page", journalDate: null, hasContent: true, updatedAt: 1, parserVersion: 1, ...over });

function reset() {
  for (const fn of [...Object.values(index), agent.createWithTitle, documentAgentFor]) {
    fn.mockReset();
  }
  index.findByTitle.mockImplementation(async () => null);
  index.currentSlug.mockImplementation(async () => null);
  index.getPage.mockImplementation(async () => null);
  index.pagesByIds.mockImplementation(async () => []);
}

describe("POST /api/pages", () => {
  beforeEach(reset);

  it("returns the existing page with that title, creating nothing", async () => {
    index.findByTitle.mockImplementation(async () => page({ pageId: "abcd1234", title: "Books" }));
    index.currentSlug.mockImplementation(async () => "books");
    const res = await post({ title: " books " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, pageId: "abcd1234", title: "Books", slug: "books", kind: "page", empty: false });
    expect(index.findByTitle).toHaveBeenCalledWith("books");
    expect(agent.createWithTitle).not.toHaveBeenCalled();
  });

  it("creates an empty page under a fresh ID when no page has the title", async () => {
    agent.createWithTitle.mockImplementation(async () => ({ ok: true, pageId: "newpage1", title: "Holiday", slug: "holiday" }));
    const res = await post({ title: "Holiday" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true, pageId: "newpage1", title: "Holiday", slug: "holiday", kind: "page", empty: true });
    expect(documentAgentFor.mock.calls[0][0]).toMatch(/^[a-z0-9]{8}$/);
  });

  it("returns the other tab's page when it created the title a moment before", async () => {
    agent.createWithTitle.mockImplementation(async () => ({ ok: false, code: "taken", holder: { pageId: "other123", title: "Holiday" } }));
    const res = await post({ title: "holiday" });
    expect(await res.json()).toMatchObject({ ok: true, pageId: "other123", title: "Holiday" });
  });

  it("answers a journal date with that day's journal, without the index or a new page", async () => {
    index.getPage.mockImplementation(async () => page({ pageId: "journal-2026-10-28", kind: "journal", hasContent: true }));
    const res = await post({ title: "oct 28th, 2026" });
    expect(await res.json()).toEqual({ ok: true, pageId: "journal-2026-10-28", title: "Oct 28th, 2026", slug: null, kind: "journal", empty: false });
    expect(index.findByTitle).not.toHaveBeenCalled();
    expect(agent.createWithTitle).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty title", { title: "  " }],
    ["no title", {}],
    ["a title with [[ ]]", { title: "a [[b]]" }],
  ])("returns 400 for %s", async (_name, body) => {
    expect((await post(body)).status).toBe(400);
    expect(agent.createWithTitle).not.toHaveBeenCalled();
  });

  it("refuses non-JSON and non-POST requests", async () => {
    expect((await post("x", { contentType: "text/plain" })).status).toBe(415);
    expect((await post({ title: "x" }, { method: "PUT" })).status).toBe(405);
    expect((await post("{not json")).status).toBe(400);
  });

  it("returns 503 when pages can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    index.findByTitle.mockImplementation(async () => {
      throw new Error("down");
    });
    expect((await post({ title: "Holiday" })).status).toBe(503);
    vi.restoreAllMocks();
  });
});

describe("GET /api/pages/search", () => {
  beforeEach(reset);
  const get = (q: string) => search({ request: new Request(`https://mistlog.test/api/pages/search?q=${encodeURIComponent(q)}`), context: {} } as never) as Promise<Response>;

  it("suggests titled pages and journals, leaving out untitled pages", async () => {
    index.searchTitles.mockImplementation(async () => [
      page({ pageId: "abcd1234", title: "Novels" }),
      page({ pageId: "efgh5678", title: "", hasContent: false }),
      page({ pageId: "journal-2026-10-28", kind: "journal", title: "" }),
    ]);
    index.pagesByIds.mockImplementation(async () => [{ pageId: "abcd1234", slug: "novels" }]);
    const res = await get("nov");
    expect(index.searchTitles).toHaveBeenCalledWith("nov", expect.any(Number));
    expect((await res.json()).pages).toEqual([
      { pageId: "abcd1234", title: "Novels", kind: "page", slug: "novels", empty: false },
      { pageId: "journal-2026-10-28", title: "Oct 28th, 2026", kind: "journal", slug: null, empty: false },
    ]);
  });

  it("returns 503 when the index can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    index.searchTitles.mockImplementation(async () => {
      throw new Error("down");
    });
    expect((await get("x")).status).toBe(503);
    vi.restoreAllMocks();
  });
});
