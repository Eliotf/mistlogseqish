import { describe, it, expect, vi, beforeEach } from "vitest";
import { MAX_KEPT_DAYS } from "~/lib/offline-days";

const { mockGetAgentByName } = vi.hoisted(() => ({ mockGetAgentByName: vi.fn() }));
vi.mock("agents", () => ({ getAgentByName: mockGetAgentByName }));
vi.mock("~/lib/cloudflare.server", () => ({ getCloudflare: vi.fn().mockReturnValue({ env: { WorkspaceAgent: "workspace", DocumentAgent: "document" } }) }));

import { action } from "~/routes/api.journals.state";

function post(body: unknown, init: { method?: string; contentType?: string } = {}) {
  const request = new Request("https://mist.example/api/journals/state", {
    method: init.method ?? "POST",
    headers: { "Content-Type": init.contentType ?? "application/json" },
    body: init.method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return action({ request, context: {}, params: {} } as never) as Promise<Response>;
}

describe("POST /api/journals/state (offline journal, F14)", () => {
  beforeEach(() => {
    mockGetAgentByName.mockReset().mockImplementation(async (_ns: string, name: string) => ({
      savedState: async () => (name === "journal-2026-11-12" ? "c3RhdGU=" : null),
    }));
  });

  it("answers each day's content, or null for a day nobody wrote in", async () => {
    const res = await post({ dates: ["2026-11-12", "2026-11-11", "2026-11-12"] });
    expect(await res.json()).toEqual({ states: { "2026-11-12": "c3RhdGU=", "2026-11-11": null } });
    // Asked once per day, by its journal ID
    expect(mockGetAgentByName.mock.calls.map((c) => c[1])).toEqual(["journal-2026-11-12", "journal-2026-11-11"]);
  });

  it("refuses anything but a JSON POST of up to MAX_KEPT_DAYS real dates", async () => {
    expect((await post({}, { method: "GET" })).status).toBe(405);
    expect((await post({}, { contentType: "text/plain" })).status).toBe(415);
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ dates: "2026-11-12" })).status).toBe(400);
    expect((await post({ dates: ["2026-02-30"] })).status).toBe(400);
    expect((await post({ dates: ["abcd1234"] })).status).toBe(400);
    expect((await post({ dates: Array.from({ length: MAX_KEPT_DAYS + 1 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`) })).status).toBe(400);
    expect(mockGetAgentByName).not.toHaveBeenCalled();
  });

  it("says so when a day can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetAgentByName.mockRejectedValue(new Error("down"));
    expect((await post({ dates: ["2026-11-12"] })).status).toBe(503);
    vi.restoreAllMocks();
  });
});
