/**
 * WorkspaceAgent: the Durable Object wrapper around WorkspaceIndex.
 * The Agents SDK base class is mocked (it imports cloudflare: modules);
 * storage is real SQLite through the same exec/transactionSync shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WIKILINK_MARK } from "~/lib/wikilink";
import { memoryStorage } from "../../helpers/sqlite";

let storage: ReturnType<typeof memoryStorage>["storage"];

vi.mock("agents", () => ({
  Agent: class MockAgent {
    get ctx() {
      return { storage };
    }
  },
}));

describe("WorkspaceAgent", () => {
  let WorkspaceAgent: typeof import("../../../agents/workspace").default;
  let isPrivateAgentPath: typeof import("../../../agents/workspace").isPrivateAgentPath;
  let agent: InstanceType<typeof WorkspaceAgent>;

  beforeEach(async () => {
    storage = memoryStorage().storage;
    const mod = await import("../../../agents/workspace");
    WorkspaceAgent = mod.default;
    isPrivateAgentPath = mod.isPrivateAgentPath;
    agent = new WorkspaceAgent({} as never, {} as never);
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
          { text: "TODO read Mistlog #reading", marks: [{ type: WIKILINK_MARK, from: 10, to: 17, attrs: { pageId: "abcd1234" } }] },
        ],
      });
      expect(ack.pageId).toBe("journal-2026-10-22");
      expect((await agent.getPage("journal-2026-10-22"))?.title).toBe("Oct 22nd, 2026");
      expect((await agent.findByTitle("OCT 22ND, 2026"))?.pageId).toBe("journal-2026-10-22");
      expect(await agent.findByTitle("Oct 22nd, 2026", "journal-2026-10-22")).toBeNull();
      expect((await agent.backlinks("abcd1234")).map((b) => b.sourceId)).toEqual(["journal-2026-10-22"]);
      expect((await agent.searchTitles("oct")).map((p) => p.pageId)).toEqual(["journal-2026-10-22"]);
      expect((await agent.search("read")).map((h) => h.pageId)).toEqual(["journal-2026-10-22"]);
      expect((await agent.tasks()).map((t) => t.text)).toEqual(["read Mistlog #reading"]);
      expect((await agent.journals()).map((p) => p.journalDate)).toEqual(["2026-10-22"]);
      expect(await agent.staleCount()).toBe(0);
      expect(await agent.registeredPages()).toEqual(["abcd1234", "journal-2026-10-22"]);
      await agent.clearDerived();
      expect(await agent.getPage("journal-2026-10-22")).toBeNull();
      expect(await agent.registeredPages()).toEqual(["abcd1234", "journal-2026-10-22"]);
    });

    it("keeps one index across calls", async () => {
      await agent.updatePage({ pageId: "abcd1234", title: "Mistlog", updatedAt: 1, lines: [] });
      expect((await agent.getPage("abcd1234"))?.title).toBe("Mistlog");
    });
  });
});
