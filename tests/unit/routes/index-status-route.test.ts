import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIndexStatus } = vi.hoisted(() => ({ mockIndexStatus: vi.fn() }));
vi.mock("~/lib/document-loader.server", () => ({ workspaceIndex: async () => ({ indexStatus: mockIndexStatus }) }));

import { loader } from "~/routes/api.index.status";

const get = () => loader({ request: new Request("https://mistlog.test/api/index/status"), context: {} } as never) as Promise<Response>;

describe("GET /api/index/status", () => {
  beforeEach(() => {
    mockIndexStatus.mockReset();
  });

  it("returns how many pages the index is catching up on, and nothing else", async () => {
    mockIndexStatus.mockImplementation(async () => ({ pending: 4, extra: "not for browsers" }));
    const res = await get();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pending: 4 });
  });

  it("returns 503 when the index cannot be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockIndexStatus.mockImplementation(async () => {
      throw new Error("down");
    });
    expect((await get()).status).toBe(503);
    vi.restoreAllMocks();
  });
});
