import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIndex, mockDocFetch, mockGetAgentByName } = vi.hoisted(() => ({
  mockIndex: { currentSlug: vi.fn(), resolveSlug: vi.fn() },
  mockDocFetch: vi.fn(),
  mockGetAgentByName: vi.fn(),
}));

vi.mock("agents", () => ({ getAgentByName: mockGetAgentByName }));

vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockReturnValue({ env: { DocumentAgent: "documents", WorkspaceAgent: "workspace" } }),
}));

// The route modules import the editor screen; stub the heavy client modules
vi.mock("~/lib/useYjsEditor", () => ({ useYjsEditor: vi.fn() }));
vi.mock("~/components/Editor", () => ({ default: () => null }));

import { loader as docsLoader } from "~/routes/docs.$id";
import { loader as pageLoader } from "~/routes/page.$slug";
import { loader as journalLoader } from "~/routes/journal.$date";

function exists(createdAt = 123) {
  mockDocFetch.mockResolvedValue(Response.json({ exists: true, createdAt }));
}

async function thrown(promise: Promise<unknown>): Promise<Response> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof Response) return err;
    // react-router's data() throws a DataWithResponseInit
    const d = err as { init?: { status?: number } };
    return new Response(null, { status: d.init?.status ?? 500 });
  }
  throw new Error("expected the loader to throw");
}

const docs = (id: string) => docsLoader({ params: { id }, context: {} } as never);
const page = (slug: string) => pageLoader({ params: { slug }, context: {} } as never);
const journal = (date: string) => journalLoader({ params: { date }, context: {} } as never);

describe("page routes", () => {
  beforeEach(() => {
    mockIndex.currentSlug.mockReset().mockResolvedValue(null);
    mockIndex.resolveSlug.mockReset().mockResolvedValue(null);
    mockDocFetch.mockReset();
    mockGetAgentByName.mockReset().mockImplementation(async (ns: string) => (ns === "workspace" ? mockIndex : { fetch: mockDocFetch }));
  });

  describe("/docs/:id", () => {
    it("redirects to the readable address when the page has a slug", async () => {
      mockIndex.currentSlug.mockResolvedValue("meeting-notes");
      const res = await thrown(docs("abcd1234"));
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/page/meeting-notes");
      expect(mockDocFetch).not.toHaveBeenCalled();
    });

    it("encodes slugs with accents in the redirect", async () => {
      mockIndex.currentSlug.mockResolvedValue("café");
      expect((await thrown(docs("abcd1234"))).headers.get("Location")).toBe("/page/caf%C3%A9");
    });

    it("shows an untitled page at its permanent address", async () => {
      exists(456);
      expect(await docs("abcd1234")).toEqual({ id: "abcd1234", createdAt: 456, exists: true, path: "/docs/abcd1234" });
    });

    it("still loads the page if the index is unreachable", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockIndex.currentSlug.mockRejectedValue(new Error("index down"));
      exists();
      expect(await docs("abcd1234")).toMatchObject({ id: "abcd1234", path: "/docs/abcd1234" });
      vi.restoreAllMocks();
    });

    it("is 404 for a document that was never created", async () => {
      mockDocFetch.mockResolvedValue(Response.json({ exists: false, createdAt: null }));
      expect((await thrown(docs("abcd1234"))).status).toBe(404);
    });

    it("redirects a journal ID to its journal address", async () => {
      const res = await thrown(docs("journal-2026-10-26"));
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/journal/2026-10-26");
      expect(mockGetAgentByName).not.toHaveBeenCalled();
    });

    it("is 404 for an invalid ID without asking anything", async () => {
      expect((await thrown(docs("NOT-AN-ID"))).status).toBe(404);
      expect(mockGetAgentByName).not.toHaveBeenCalled();
    });
  });

  describe("/page/:slug", () => {
    it("shows the page for its current slug", async () => {
      mockIndex.resolveSlug.mockResolvedValue({ pageId: "abcd1234", current: true, currentSlug: "meeting-notes" });
      exists(789);
      expect(await page("meeting-notes")).toEqual({ id: "abcd1234", createdAt: 789, exists: true, path: "/page/meeting-notes" });
      expect(mockIndex.resolveSlug).toHaveBeenCalledWith("meeting-notes");
    });

    it("redirects an old slug to the current one", async () => {
      mockIndex.resolveSlug.mockResolvedValue({ pageId: "abcd1234", current: false, currentSlug: "new-name" });
      const res = await thrown(page("old-name"));
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/page/new-name");
    });

    it("redirects a different-case address to the canonical one", async () => {
      mockIndex.resolveSlug.mockResolvedValue({ pageId: "abcd1234", current: true, currentSlug: "meeting-notes" });
      const res = await thrown(page("Meeting-Notes"));
      expect(res.status).toBe(302);
      expect(res.headers.get("Location")).toBe("/page/meeting-notes");
    });

    it("accepts a decomposed accent as the canonical slug without redirecting", async () => {
      mockIndex.resolveSlug.mockResolvedValue({ pageId: "abcd1234", current: true, currentSlug: "café" });
      exists();
      expect(await page("café")).toMatchObject({ path: "/page/caf%C3%A9" });
    });

    it("redirects an old slug to the permanent address when the page has no slug now", async () => {
      mockIndex.resolveSlug.mockResolvedValue({ pageId: "abcd1234", current: false, currentSlug: null });
      expect((await thrown(page("old-name"))).headers.get("Location")).toBe("/docs/abcd1234");
    });

    it("is 404 for an unknown slug", async () => {
      expect((await thrown(page("nothing-here"))).status).toBe(404);
      expect(mockDocFetch).not.toHaveBeenCalled();
    });
  });

  describe("/journal/:date", () => {
    it("opens a day nobody has written in yet", async () => {
      mockDocFetch.mockResolvedValue(Response.json({ exists: false, createdAt: null }));
      expect(await journal("2026-10-26")).toEqual({
        id: "journal-2026-10-26",
        createdAt: null,
        exists: false,
        path: "/journal/2026-10-26",
      });
      expect(mockGetAgentByName).toHaveBeenCalledWith("documents", "journal-2026-10-26");
    });

    it("opens a day that has been written in", async () => {
      exists(321);
      expect(await journal("2026-10-25")).toMatchObject({ exists: true, createdAt: 321 });
    });

    it.each(["2026-02-30", "2026-13-01", "26-10-26", "today", "2026-10-26x"])("is 404 for %j", async (date) => {
      expect((await thrown(journal(date))).status).toBe(404);
      expect(mockGetAgentByName).not.toHaveBeenCalled();
    });
  });
});
