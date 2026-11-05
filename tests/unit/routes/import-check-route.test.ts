import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockImportCheck, mockGetAgentByName } = vi.hoisted(() => ({ mockImportCheck: vi.fn(), mockGetAgentByName: vi.fn() }));
vi.mock("agents", () => ({ getAgentByName: mockGetAgentByName }));
vi.mock("~/lib/cloudflare.server", () => ({ getCloudflare: vi.fn().mockReturnValue({ env: { WorkspaceAgent: "workspace" } }) }));

import { action, MAX_CHECK_ITEMS } from "~/routes/api.import.check";

function post(body: unknown, init: { method?: string; contentType?: string } = {}) {
  const request = new Request("https://mistlog.test/api/import/check", {
    method: init.method ?? "POST",
    headers: { "Content-Type": init.contentType ?? "application/json" },
    body: init.method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return action({ request, context: {} } as never) as Promise<Response>;
}

describe("POST /api/import/check", () => {
  beforeEach(() => {
    mockImportCheck.mockReset().mockResolvedValue({ pages: ["books"], days: [] });
    mockGetAgentByName.mockReset().mockResolvedValue({ importCheck: mockImportCheck });
  });

  it("asks the index about title keys (deduplicated) and valid dates only", async () => {
    const res = await post({ titles: ["Books", "books ", 42, "Garden"], dates: ["2026-11-04", "2026-02-30", "nope", "2026-11-04"] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pages: ["books"], days: [] });
    expect(mockImportCheck).toHaveBeenCalledWith(["books", "garden"], ["2026-11-04"]);
  });

  it("refuses anything but JSON POSTs, and requests that are too big", async () => {
    expect((await post({}, { method: "GET" })).status).toBe(405);
    expect((await post({}, { contentType: "text/plain" })).status).toBe(415);
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ titles: Array.from({ length: MAX_CHECK_ITEMS + 1 }, (_, i) => `t${i}`) })).status).toBe(413);
    expect(mockImportCheck).not.toHaveBeenCalled();
  });

  it("says when the index can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockImportCheck.mockRejectedValue(new Error("down"));
    expect((await post({ titles: ["x"] })).status).toBe(503);
    vi.restoreAllMocks();
  });
});
