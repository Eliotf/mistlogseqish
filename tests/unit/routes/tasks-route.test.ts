import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TaskItem } from "~/lib/tasks";

const { mockTasks, mockGetAgentByName } = vi.hoisted(() => ({
  mockTasks: vi.fn(),
  mockGetAgentByName: vi.fn(),
}));

vi.mock("agents", () => ({ getAgentByName: mockGetAgentByName }));
vi.mock("~/lib/cloudflare.server", () => ({
  getCloudflare: vi.fn().mockReturnValue({ env: { WorkspaceAgent: "workspace" } }),
}));

import { loader, DONE_LIMIT } from "~/routes/tasks";

const task = (over: Partial<TaskItem>): TaskItem => ({
  pageId: "abcd1234",
  pageTitle: "Mistlog",
  pageKind: "page",
  updatedAt: 1,
  state: "TODO",
  priority: null,
  blockId: null,
  line: { line: 0, text: "TODO a task", links: [] },
  ...over,
});

const load = () => loader({ context: {} } as never);

describe("/tasks loader", () => {
  beforeEach(() => {
    mockTasks.mockReset();
    mockGetAgentByName.mockReset().mockResolvedValue({ tasks: mockTasks });
  });

  it("asks the index for open tasks (NOW, DOING, TODO, LATER) and done ones, most recent first", async () => {
    const open = [task({ state: "NOW" })];
    mockTasks.mockImplementation(async (states: string[]) =>
      states.includes("DONE") ? [task({ state: "DONE", updatedAt: 1 }), task({ state: "DONE", updatedAt: 3, pageId: "efgh5678" })] : open,
    );
    const data = await load();
    expect(mockGetAgentByName).toHaveBeenCalledWith("workspace", "default");
    expect(mockTasks).toHaveBeenCalledWith(["NOW", "DOING", "TODO", "LATER"]);
    expect(data).toEqual({ open, done: [expect.objectContaining({ pageId: "efgh5678" }), expect.objectContaining({ pageId: "abcd1234" })], loadFailed: false });
  });

  it("shows at most the latest done tasks", async () => {
    mockTasks.mockImplementation(async (states: string[]) => (states.includes("DONE") ? Array.from({ length: DONE_LIMIT + 5 }, (_, i) => task({ state: "DONE", updatedAt: i })) : []));
    const data = await load();
    expect(data.done).toHaveLength(DONE_LIMIT);
    expect(data.done[0].updatedAt).toBe(DONE_LIMIT + 4);
  });

  it("says when the index can't be reached, instead of failing the page", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockTasks.mockRejectedValue(new Error("down"));
    expect(await load()).toEqual({ open: [], done: [], loadFailed: true });
    vi.restoreAllMocks();
  });
});
