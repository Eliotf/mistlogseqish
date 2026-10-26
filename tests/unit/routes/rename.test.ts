import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRename, mockGetAgentByName } = vi.hoisted(() => ({
  mockRename: vi.fn(),
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
    mockRename.mockReset().mockResolvedValue({ ok: true, title: "Meeting notes", slug: "meeting-notes" });
    mockGetAgentByName.mockReset().mockResolvedValue({ rename: mockRename });
  });

  it("asks the page's DocumentAgent to rename and returns the new address", async () => {
    const res = await post({ pageId: "abcd1234", title: "  Meeting   notes " });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, title: "Meeting notes", path: "/page/meeting-notes" });
    expect(mockGetAgentByName).toHaveBeenCalledWith("documents", "abcd1234");
    expect(mockRename).toHaveBeenCalledWith("  Meeting   notes ");
  });

  it("returns the permanent address when the title has no slug", async () => {
    mockRename.mockResolvedValue({ ok: true, title: "!!!", slug: null });
    expect(await (await post({ pageId: "abcd1234", title: "!!!" })).json()).toEqual({ ok: true, title: "!!!", path: "/docs/abcd1234" });
  });

  it("encodes accented slugs in the address", async () => {
    mockRename.mockResolvedValue({ ok: true, title: "Café", slug: "café" });
    expect((await (await post({ pageId: "abcd1234", title: "Café" })).json()).path).toBe("/page/caf%C3%A9");
  });

  it.each([
    [{ ok: false, code: "taken", holderTitle: "Meeting Notes" }, "A page called “Meeting Notes” already exists.", 200],
    [{ ok: false, code: "invalid", reason: "Titles can't contain [[ or ]]." }, "Titles can't contain [[ or ]].", 200],
    [{ ok: false, code: "journal-title" }, "Dates like this are journal titles. Choose another title.", 200],
    [{ ok: false, code: "journal" }, "Journal titles are dates and can't be renamed.", 200],
    [{ ok: false, code: "missing" }, "This page doesn't exist.", 404],
  ])("explains a refusal %j", async (outcome, reason, status) => {
    mockRename.mockResolvedValue(outcome);
    const res = await post({ pageId: "abcd1234", title: "x" });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ ok: false, reason });
  });

  it("returns 503 when the rename cannot reach the index", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockRename.mockRejectedValue(new Error("index down"));
    const res = await post({ pageId: "abcd1234", title: "x" });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, reason: "Couldn't save the title right now. Try again in a moment." });
    vi.restoreAllMocks();
  });

  it("passes a missing title through as empty, for the agent to refuse", async () => {
    await post({ pageId: "abcd1234" });
    expect(mockRename).toHaveBeenCalledWith("");
  });

  it.each([
    ["no page", { title: "Fine" }],
    ["an invalid page", { pageId: "Not An Id", title: "Fine" }],
    ["a non-string page", { pageId: 12345678, title: "Fine" }],
    ["a non-object body", null],
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
