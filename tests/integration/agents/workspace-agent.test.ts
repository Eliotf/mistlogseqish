/**
 * WorkspaceAgent: the Durable Object wrapper around WorkspaceIndex.
 * The Agents SDK base class is mocked (it imports cloudflare: modules);
 * storage is real SQLite through the same exec/transactionSync shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WIKILINK_MARK } from "~/lib/wikilink";
import { memoryStorage } from "../../helpers/sqlite";

let storage: ReturnType<typeof memoryStorage>["storage"];
/** Calls to this.schedule(): [delay seconds, callback name]. */
let schedules: Array<[number, string]>;
/** What getAgentByName returns for a DocumentAgent. */
let docStub: (pageId: string) => { refreshIndex: () => Promise<void> };

vi.mock("agents", () => ({
  getAgentByName: async (_ns: unknown, name: string) => docStub(name),
  Agent: class MockAgent {
    env = { DocumentAgent: "documents" };
    get ctx() {
      return { storage };
    }
    schedule(when: number, callback: string) {
      schedules.push([when, callback]);
      return Promise.resolve({ id: String(schedules.length) });
    }
  },
}));

describe("WorkspaceAgent", () => {
  let WorkspaceAgent: typeof import("../../../agents/workspace").default;
  let isPrivateAgentPath: typeof import("../../../agents/workspace").isPrivateAgentPath;
  let REBUILD_PAUSE_SECONDS: number;
  let REBUILD_BATCH: number;
  let agent: InstanceType<typeof WorkspaceAgent>;

  beforeEach(async () => {
    storage = memoryStorage().storage;
    schedules = [];
    docStub = () => ({ refreshIndex: async () => {} });
    const mod = await import("../../../agents/workspace");
    WorkspaceAgent = mod.default;
    isPrivateAgentPath = mod.isPrivateAgentPath;
    REBUILD_PAUSE_SECONDS = mod.REBUILD_PAUSE_SECONDS;
    REBUILD_BATCH = mod.REBUILD_BATCH;
    agent = new WorkspaceAgent({} as never, {} as never);
  });

  describe("rebuild", () => {
    const PAGES = ["aaaa0001", "aaaa0002", "aaaa0003"];
    const update = (pageId: string, updatedAt = 1) => ({ pageId, title: pageId, updatedAt, lines: [{ text: "x", marks: [] }] });

    /** Registered pages that need re-indexing, in a fresh agent (as after a deploy wakes it). */
    async function staleAgent(ids = PAGES) {
      for (const id of ids) await agent.registerPage(id, 1);
      agent = new WorkspaceAgent({} as never, {} as never);
      // Each document re-indexes itself through the index when asked
      docStub = (pageId) => ({ refreshIndex: async () => void (await agent.updatePage(update(pageId, 2))) });
      return agent;
    }

    it("starts once when it wakes with pages to re-index, then works through them a batch at a time", async () => {
      const ids = Array.from({ length: REBUILD_BATCH + 2 }, (_, k) => `bbbb${String(k).padStart(4, "0")}`);
      const a = await staleAgent(ids);
      expect(await a.indexStatus()).toEqual({ pending: ids.length });
      expect(schedules).toEqual([[REBUILD_PAUSE_SECONDS, "rebuildStep"]]);
      await a.getPage(ids[0]); // later calls don't start another
      expect(schedules).toHaveLength(1);

      await a.rebuildStep(); // the first batch, then the next step is scheduled
      expect(await a.indexStatus()).toEqual({ pending: 2 });
      expect(schedules).toHaveLength(2);
      await a.rebuildStep(); // the rest
      expect(await a.indexStatus()).toEqual({ pending: 0 });
      expect(schedules).toHaveLength(3);
      await a.rebuildStep(); // nothing left: the pass ends without scheduling again
      expect(schedules).toHaveLength(3);
      await a.rebuildStep(); // and a stray step does nothing
      expect(schedules).toHaveLength(3);
    });

    it("does nothing when every page is current", async () => {
      await agent.updatePage(update("aaaa0001"));
      const fresh = new WorkspaceAgent({} as never, {} as never);
      await fresh.indexStatus();
      expect(schedules).toEqual([]);
      await fresh.rebuildStep(); // a leftover step with no rebuild running
      expect(schedules).toEqual([]);
    });

    it("keeps going past a page that fails, and leaves it for the next pass", async () => {
      const a = await staleAgent();
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      docStub = (pageId) => ({
        refreshIndex: async () => {
          if (pageId === "aaaa0002") throw new Error("down");
          await a.updatePage(update(pageId, 2));
        },
      });
      await a.indexStatus();
      await a.rebuildStep();
      await a.rebuildStep();
      expect(await a.indexStatus()).toEqual({ pending: 1 });
      expect(error).toHaveBeenCalledWith("Rebuild could not re-index aaaa0002", expect.any(Error));
      error.mockRestore();
      // The next wake starts a new pass for what is left
      const next = new WorkspaceAgent({} as never, {} as never);
      schedules = [];
      await next.indexStatus();
      expect(schedules).toEqual([[REBUILD_PAUSE_SECONDS, "rebuildStep"]]);
    });

    it("does not start a second pass while one is running (it continues through its own schedule)", async () => {
      await staleAgent();
      await agent.indexStatus();
      const again = new WorkspaceAgent({} as never, {} as never);
      await again.indexStatus();
      expect(schedules).toHaveLength(1);
    });
  });

  describe("access from outside", () => {
    it("refuses HTTP requests", async () => {
      const res = await agent.onRequest(new Request("https://do/"));
      expect(res.status).toBe(404);
    });

    it("closes WebSocket connections", async () => {
      const conn = { close: vi.fn() };
      await agent.onConnect(conn as never, {} as never);
      expect(conn.close).toHaveBeenCalledWith(1008, "Not available");
    });

    it.each([
      ["/agents/workspace-agent/default", true],
      ["/agents/workspace-agent", true],
      ["/agents/Workspace-Agent/default", true],
      ["/agents/workspace-agent/default/extra", true],
      ["/agents/document-agent/abcd1234", false],
      ["/agents/workspace-agents/x", false],
      ["/docs/abcd1234", false],
    ])("treats %s as private: %s", (path, expected) => {
      expect(isPrivateAgentPath(path)).toBe(expected);
    });
  });

  describe("RPC methods", () => {
    it("indexes a page and answers queries through Durable Object storage", async () => {
      await agent.registerPage("abcd1234", 1);
      const ack = await agent.updatePage({
        pageId: "journal-2026-10-22",
        title: "",
        updatedAt: 10,
        lines: [
          {
            text: "TODO read Mistlog #reading",
            marks: [
              { type: WIKILINK_MARK, from: 10, to: 17, attrs: { pageId: "abcd1234" } },
              { type: "criticComment", from: 0, to: 4, attrs: { note: "other formatting" } },
            ],
          },
        ],
      });
      expect(ack.pageId).toBe("journal-2026-10-22");
      expect((await agent.getPage("journal-2026-10-22"))?.title).toBe("Oct 22nd, 2026");
      expect((await agent.findByTitle("OCT 22ND, 2026"))?.pageId).toBe("journal-2026-10-22");
      expect(await agent.findByTitle("Oct 22nd, 2026", "journal-2026-10-22")).toBeNull();
      // Lines come back as text and link positions only (RPC results must be serialisable)
      expect(await agent.backlinks("abcd1234")).toEqual([
        {
          sourceId: "journal-2026-10-22",
          sourceTitle: "Oct 22nd, 2026",
          sourceKind: "journal",
          lines: [{ line: 0, text: "TODO read Mistlog #reading", links: [{ from: 10, to: 17, pageId: "abcd1234" }] }],
        },
      ]);
      expect((await agent.searchTitles("oct")).map((p) => p.pageId)).toEqual(["journal-2026-10-22"]);
      expect((await agent.search("read")).map((h) => h.pageId)).toEqual(["journal-2026-10-22"]);
      // Serialisable task items, the line reduced like a linked reference
      expect(await agent.tasks()).toEqual([
        {
          pageId: "journal-2026-10-22",
          pageTitle: "Oct 22nd, 2026",
          pageKind: "journal",
          updatedAt: expect.any(Number),
          state: "TODO",
          priority: null,
          blockId: null,
          line: { line: 0, text: "TODO read Mistlog #reading", links: [{ from: 10, to: 17, pageId: "abcd1234" }] },
        },
      ]);
      expect((await agent.journals()).map((p) => p.journalDate)).toEqual(["2026-10-22"]);
      expect(await agent.staleCount()).toBe(0);
      expect(await agent.registeredPages()).toEqual(["abcd1234", "journal-2026-10-22"]);
      await agent.clearDerived();
      expect(await agent.getPage("journal-2026-10-22")).toBeNull();
      expect(await agent.registeredPages()).toEqual(["abcd1234", "journal-2026-10-22"]);
    });

    it("shows a task row from before schema 3 (no stored line) as its keyword and text", async () => {
      await agent.updatePage({ pageId: "abcd1234", title: "Mistlog", updatedAt: 1, lines: [{ text: "TODO new", marks: [] }] });
      storage.sql.exec(`UPDATE tasks SET content = NULL, text = 'old text'`).toArray();
      expect((await agent.tasks()).map((t) => t.line)).toEqual([{ line: 0, text: "TODO old text", links: [] }]);
    });

    it("keeps one index across calls", async () => {
      await agent.updatePage({ pageId: "abcd1234", title: "Mistlog", updatedAt: 1, lines: [] });
      expect((await agent.getPage("abcd1234"))?.title).toBe("Mistlog");
    });
  });
});
