import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { askForDailyPrompt, isTooOldForPrompt, wantsDailyPrompt } from "~/lib/daily-prompt";

const { mockGetAgentByName } = vi.hoisted(() => ({ mockGetAgentByName: vi.fn() }));
vi.mock("agents", () => ({ getAgentByName: mockGetAgentByName }));
vi.mock("~/lib/cloudflare.server", () => ({ getCloudflare: vi.fn().mockReturnValue({ env: { WorkspaceAgent: "workspace", DocumentAgent: "document" } }) }));

import { action } from "~/routes/api.journals.prompt";

function post(body: unknown, init: { method?: string; contentType?: string } = {}) {
  const request = new Request("https://mist.example/api/journals/prompt", {
    method: init.method ?? "POST",
    headers: { "Content-Type": init.contentType ?? "application/json" },
    body: init.method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return action({ request, context: {}, params: {} } as never) as Promise<Response>;
}

describe("which days get the daily line", () => {
  it("today and later, in the browser's time zone", () => {
    expect(wantsDailyPrompt("2026-11-23", "2026-11-23")).toBe(true);
    expect(wantsDailyPrompt("2026-12-01", "2026-11-23")).toBe(true);
    expect(wantsDailyPrompt("2026-11-22", "2026-11-23")).toBe(false);
    expect(wantsDailyPrompt("2026-02-30", "2026-01-01")).toBe(false);
  });

  it("the server refuses only days before yesterday in UTC, as it can't know the browser's today", () => {
    const now = new Date("2026-11-23T01:00:00Z");
    expect(isTooOldForPrompt("2026-11-22", now)).toBe(false); // still the 22nd west of UTC
    expect(isTooOldForPrompt("2026-11-21", now)).toBe(true);
  });
});

describe("askForDailyPrompt", () => {
  const memory = () => {
    const items = new Map<string, string>();
    return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v) };
  };

  it("asks once per day from this browser", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ added: true }));
    const storage = memory();
    expect(await askForDailyPrompt("2026-11-23", { fetch: fetchMock, storage })).toBe(true);
    expect(await askForDailyPrompt("2026-11-23", { fetch: fetchMock, storage })).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/journals/prompt");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ date: "2026-11-23" });
  });

  it("asks again next time after a failure or offline, and never throws", async () => {
    const storage = memory();
    expect(await askForDailyPrompt("2026-11-23", { fetch: vi.fn().mockRejectedValue(new TypeError("offline")), storage })).toBe(false);
    expect(await askForDailyPrompt("2026-11-23", { fetch: vi.fn().mockResolvedValue(new Response("", { status: 503 })), storage })).toBe(false);
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ added: false }));
    expect(await askForDailyPrompt("2026-11-23", { fetch: fetchMock, storage })).toBe(true);
  });
});

describe("POST /api/journals/prompt", () => {
  const addDailyPrompt = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T12:00:00Z"));
    addDailyPrompt.mockReset().mockResolvedValue({ ok: true, added: true });
    mockGetAgentByName.mockReset().mockResolvedValue({ addDailyPrompt });
  });
  afterEach(() => vi.useRealTimers());

  it("asks that day's journal to add its line", async () => {
    const res = await post({ date: "2026-11-23" });
    expect(await res.json()).toEqual({ added: true });
    expect(mockGetAgentByName.mock.calls[0][1]).toBe("journal-2026-11-23");
  });

  it("refuses anything but a JSON POST of a real date that isn't in the past", async () => {
    expect((await post({}, { method: "GET" })).status).toBe(405);
    expect((await post({}, { contentType: "text/plain" })).status).toBe(415);
    expect((await post("{nope")).status).toBe(400);
    expect((await post({ date: 20261123 })).status).toBe(400);
    expect((await post({ date: "2026-02-30" })).status).toBe(400);
    expect((await post({ date: "2026-11-01" })).status).toBe(400);
    expect(mockGetAgentByName).not.toHaveBeenCalled();
  });

  it("passes on the day's refusal", async () => {
    addDailyPrompt.mockResolvedValue({ ok: false, code: "deleted" });
    expect((await post({ date: "2026-11-23" })).status).toBe(410);
    addDailyPrompt.mockResolvedValue({ ok: false, code: "invalid" });
    expect((await post({ date: "2026-11-23" })).status).toBe(400);
  });

  it("says so when the day can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetAgentByName.mockRejectedValue(new Error("down"));
    expect((await post({ date: "2026-11-23" })).status).toBe(503);
    vi.restoreAllMocks();
  });
});
