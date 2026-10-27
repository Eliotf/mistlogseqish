import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockJournals, mockGetAgentByName } = vi.hoisted(() => ({
  mockJournals: vi.fn(),
  mockGetAgentByName: vi.fn(),
}));

vi.mock("agents", () => ({ getAgentByName: mockGetAgentByName }));
vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockReturnValue({ env: { WorkspaceAgent: "workspace", DocumentAgent: "documents" } }),
}));

import { loader as journalsLoader } from "~/routes/api.journals";
import { loader as homeLoader } from "~/routes/home";

const get = (query: string) =>
  journalsLoader({ request: new Request(`https://mistlog.test/api/journals${query}`), context: {} } as never) as Promise<Response>;
const page = (date: string) => ({ pageId: `journal-${date}`, journalDate: date });

describe("GET /api/journals", () => {
  beforeEach(() => {
    mockJournals.mockReset().mockResolvedValue([page("2026-10-20"), page("2026-10-19")]);
    mockGetAgentByName.mockReset().mockResolvedValue({ journals: mockJournals });
  });

  it("returns days before a date, newest first", async () => {
    const res = await get("?before=2026-10-21&limit=7");
    expect(await res.json()).toEqual({ days: ["2026-10-20", "2026-10-19"] });
    expect(mockJournals).toHaveBeenCalledWith(7, "2026-10-21");
  });

  it("defaults to 7 days with no lower bound", async () => {
    await get("");
    expect(mockJournals).toHaveBeenCalledWith(7, undefined);
  });

  it.each(["?before=2026-02-30", "?before=yesterday", "?limit=0", "?limit=32", "?limit=abc", "?limit=2.5"])(
    "returns 400 for %s",
    async (query) => {
      expect((await get(query)).status).toBe(400);
      expect(mockGetAgentByName).not.toHaveBeenCalled();
    },
  );

  it("returns 503 when the index is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockJournals.mockRejectedValue(new Error("down"));
    expect((await get("")).status).toBe(503);
    vi.restoreAllMocks();
  });
});

describe("home page loader", () => {
  beforeEach(() => {
    mockJournals.mockReset().mockResolvedValue([page("2026-10-27"), page("2026-10-25")]);
    mockGetAgentByName.mockReset().mockResolvedValue({ journals: mockJournals });
  });

  it("loads the first batch of days", async () => {
    expect(await homeLoader({ context: {} } as never)).toEqual({ days: ["2026-10-27", "2026-10-25"], loadFailed: false });
    expect(mockJournals).toHaveBeenCalledWith(7);
  });

  it("still loads, with no days, when the index is unreachable", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetAgentByName.mockRejectedValue(new Error("down"));
    expect(await homeLoader({ context: {} } as never)).toEqual({ days: [], loadFailed: true });
    vi.restoreAllMocks();
  });
});
