import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFindByTitle, mockGetAgentByName } = vi.hoisted(() => ({
  mockFindByTitle: vi.fn(),
  mockGetAgentByName: vi.fn(),
}));

vi.mock("agents", () => ({ getAgentByName: mockGetAgentByName }));

vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockReturnValue({ env: { WorkspaceAgent: { binding: "workspace" } } }),
}));

import { loader } from "~/routes/api.title-check";

function check(params: Record<string, string>) {
  const url = new URL("https://mistlog.test/api/title-check");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return loader({ request: new Request(url), context: {} } as never) as Promise<Response>;
}

describe("GET /api/title-check", () => {
  beforeEach(() => {
    mockFindByTitle.mockReset().mockResolvedValue(null);
    mockGetAgentByName.mockReset().mockResolvedValue({ findByTitle: mockFindByTitle });
  });

  it("says a free title is available, normalised", async () => {
    const res = await check({ title: "  Meeting   notes ", pageId: "abcd1234" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ available: true, title: "Meeting notes" });
    expect(mockGetAgentByName).toHaveBeenCalledWith({ binding: "workspace" }, "default");
    expect(mockFindByTitle).toHaveBeenCalledWith("Meeting notes", "abcd1234");
  });

  it("refuses a title another page has", async () => {
    mockFindByTitle.mockResolvedValue({ pageId: "zzzz9999", title: "Meeting Notes" });
    const res = await check({ title: "meeting notes", pageId: "abcd1234" });
    expect(await res.json()).toEqual({ available: false, reason: "A page called “Meeting Notes” already exists." });
  });

  it("refuses an invalid title without asking the index", async () => {
    const res = await check({ title: "a [[b]]", pageId: "abcd1234" });
    expect(await res.json()).toEqual({ available: false, reason: "Titles can't contain [[ or ]]." });
    expect(mockGetAgentByName).not.toHaveBeenCalled();
  });

  it("refuses a missing title", async () => {
    const res = await check({ pageId: "abcd1234" });
    expect(await res.json()).toEqual({ available: false, reason: "A page needs a title." });
  });

  it.each([{}, { pageId: "not an id" }, { pageId: "journal-2026-02-30" }])("returns 400 for page %j", async (params) => {
    const res = await check({ title: "Fine", ...params });
    expect(res.status).toBe(400);
    expect(mockGetAgentByName).not.toHaveBeenCalled();
  });

  it("accepts journal page IDs", async () => {
    const res = await check({ title: "Fine", pageId: "journal-2026-10-24" });
    expect(res.status).toBe(200);
  });
});
