import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDeletePage, mockAllPages, mockGetAgentByName } = vi.hoisted(() => ({
  mockDeletePage: vi.fn(),
  mockAllPages: vi.fn(),
  mockGetAgentByName: vi.fn(),
}));

vi.mock("agents", () => ({ getAgentByName: mockGetAgentByName }));
vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockReturnValue({ env: { WorkspaceAgent: "workspace", DocumentAgent: "documents" } }),
}));

import { action } from "~/routes/api.pages.delete";
import { loader } from "~/routes/pages";

function post(body: unknown, init: { method?: string; contentType?: string } = {}) {
  const request = new Request("https://mistlog.test/api/pages/delete", {
    method: init.method ?? "POST",
    headers: { "Content-Type": init.contentType ?? "application/json" },
    body: init.method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return action({ request, context: {} } as never) as Promise<Response>;
}

beforeEach(() => {
  mockDeletePage.mockReset();
  mockAllPages.mockReset();
  mockGetAgentByName.mockReset().mockImplementation(async (ns: string) => (ns === "documents" ? { deletePage: mockDeletePage } : { allPages: mockAllPages }));
});

describe("POST /api/pages/delete", () => {
  it("asks the page's DocumentAgent to delete it", async () => {
    mockDeletePage.mockResolvedValue({ ok: true, title: "Old notes" });
    const res = await post({ pageId: "abcd1234" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, title: "Old notes" });
    expect(mockGetAgentByName).toHaveBeenCalledWith("documents", "abcd1234");
  });

  it.each([
    [{ ok: false, code: "missing" }, 404],
    [{ ok: false, code: "journal" }, 400],
    [{ ok: false, code: "failed" }, 503],
  ])("passes on %j with status %i", async (outcome, status) => {
    mockDeletePage.mockResolvedValue(outcome);
    const res = await post({ pageId: "abcd1234" });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(outcome);
  });

  it("says it failed when the agent can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockDeletePage.mockRejectedValue(new Error("down"));
    const res = await post({ pageId: "abcd1234" });
    expect(res.status).toBe(503);
    vi.restoreAllMocks();
  });

  it("refuses anything but a JSON POST with a valid page ID, without asking anyone", async () => {
    expect((await post({}, { method: "GET" })).status).toBe(405);
    expect((await post({ pageId: "abcd1234" }, { contentType: "application/x-www-form-urlencoded" })).status).toBe(415);
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ pageId: "../etc" })).status).toBe(400);
    expect(mockDeletePage).not.toHaveBeenCalled();
  });
});

describe("/pages loader", () => {
  it("lists every page from the index", async () => {
    mockAllPages.mockResolvedValue([{ pageId: "abcd1234" }]);
    expect(await loader({ context: {} } as never)).toEqual({ pages: [{ pageId: "abcd1234" }], loadFailed: false });
  });

  it("says when the index can't be reached, instead of failing the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockAllPages.mockRejectedValue(new Error("down"));
    expect(await loader({ context: {} } as never)).toEqual({ pages: [], loadFailed: true });
    vi.restoreAllMocks();
  });
});
