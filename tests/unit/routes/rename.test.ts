import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockClaimTitle, mockGetAgentByName } = vi.hoisted(() => ({
  mockClaimTitle: vi.fn(),
  mockGetAgentByName: vi.fn(),
}));

vi.mock("agents", () => ({ getAgentByName: mockGetAgentByName }));

vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockReturnValue({ env: { WorkspaceAgent: "workspace", DocumentAgent: "documents" } }),
}));

import { action } from "~/routes/api.rename";

function post(body: unknown, init: { method?: string; contentType?: string } = {}) {
  const request = new Request("https://mistlog.test/api/rename", {
    method: init.method ?? "POST",
    headers: { "Content-Type": init.contentType ?? "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return action({ request, context: {} } as never) as Promise<Response>;
}

describe("POST /api/rename", () => {
  beforeEach(() => {
    mockClaimTitle.mockReset().mockResolvedValue({ ok: true, title: "Meeting notes", slug: "meeting-notes" });
    mockGetAgentByName.mockReset().mockResolvedValue({ claimTitle: mockClaimTitle });
  });

  it("claims a normalised title and returns the new address", async () => {
    const res = await post({ pageId: "abcd1234", title: "  Meeting   notes " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, title: "Meeting notes", path: "/page/meeting-notes" });
    expect(mockGetAgentByName).toHaveBeenCalledWith("workspace", "default");
    expect(mockClaimTitle).toHaveBeenCalledWith("abcd1234", "Meeting notes", expect.any(Number));
  });

  it("returns the permanent address when the title has no slug", async () => {
    mockClaimTitle.mockResolvedValue({ ok: true, title: "!!!", slug: null });
    expect(await (await post({ pageId: "abcd1234", title: "!!!" })).json()).toEqual({ ok: true, title: "!!!", path: "/docs/abcd1234" });
  });

  it("encodes accented slugs in the address", async () => {
    mockClaimTitle.mockResolvedValue({ ok: true, title: "Café", slug: "café" });
    expect((await (await post({ pageId: "abcd1234", title: "Café" })).json()).path).toBe("/page/caf%C3%A9");
  });

  it("refuses a title another page has", async () => {
    mockClaimTitle.mockResolvedValue({ ok: false, reason: "taken", holder: { pageId: "zzzz9999", title: "Meeting Notes" } });
    expect(await (await post({ pageId: "abcd1234", title: "meeting notes" })).json()).toEqual({
      ok: false,
      reason: "A page called “Meeting Notes” already exists.",
    });
  });

  it("refuses to rename a journal", async () => {
    mockClaimTitle.mockResolvedValue({ ok: false, reason: "journal" });
    expect(await (await post({ pageId: "journal-2026-10-25", title: "x" })).json()).toEqual({
      ok: false,
      reason: "Journal titles are dates and can't be renamed.",
    });
  });

  it("refuses an invalid title without asking the index", async () => {
    expect(await (await post({ pageId: "abcd1234", title: "a [[b]]" })).json()).toEqual({
      ok: false,
      reason: "Titles can't contain [[ or ]].",
    });
    expect(await (await post({ pageId: "abcd1234" })).json()).toEqual({ ok: false, reason: "A page needs a title." });
    expect(mockGetAgentByName).not.toHaveBeenCalled();
  });

  it.each([
    ["no page", { title: "Fine" }],
    ["an invalid page", { pageId: "Not An Id", title: "Fine" }],
    ["a non-string page", { pageId: 12345678, title: "Fine" }],
  ])("returns 400 for %s", async (_name, body) => {
    expect((await post(body)).status).toBe(400);
    expect(mockGetAgentByName).not.toHaveBeenCalled();
  });

  it("returns 400 for malformed JSON", async () => {
    expect((await post("{not json")).status).toBe(400);
  });

  it("returns 415 for a non-JSON body, so a plain form on another site cannot rename", async () => {
    expect((await post("pageId=abcd1234&title=x", { contentType: "application/x-www-form-urlencoded" })).status).toBe(415);
    expect(mockGetAgentByName).not.toHaveBeenCalled();
  });

  it("returns 405 for methods other than POST", async () => {
    expect((await post({ pageId: "abcd1234", title: "x" }, { method: "PUT" })).status).toBe(405);
  });
});
