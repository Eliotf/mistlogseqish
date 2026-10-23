/**
 * DocumentAgent integration tests.
 *
 * Tests the actual DocumentAgent code with a mocked Agent base class.
 * The agents SDK uses cloudflare: protocol imports, so we mock the base
 * class and test lifecycle methods (onConnect, onMessage, onClose,
 * onRequest, alarm) directly.
 *
 * For Yjs sync tests, real Y.Doc clients exchange messages through the
 * actual agent code — testing the sync relay, SQL persistence, and
 * awareness propagation end-to-end.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import * as awarenessProtocol from "y-protocols/awareness";
import { DOC_FORMAT_VERSION } from "~/shared/constants";
import { YjsProvider } from "~/lib/yjs-provider";
import { PARSER_VERSION } from "~/lib/note-parser";
import { WorkspaceIndex, type PageUpdate, type PageUpdateAck } from "../../../agents/workspace-index";
import { memoryDb } from "../../helpers/sqlite";

/* ------------------------------------------------------------------ */
/*  Mock Agent base class                                              */
/* ------------------------------------------------------------------ */

let mockSqlStore: Map<string, ArrayBuffer>;
let mockConnectionMap: Map<string, MockConnection>;
let mockSetAlarm: ReturnType<typeof vi.fn>;
/** Calls to this.schedule(): [delay seconds, callback name]. */
let mockSchedules: Array<[number, string]>;
/** What getAgentByName returns for the workspace index. */
let mockIndexStub: {
  updatePage: (update: PageUpdate) => Promise<PageUpdateAck>;
  registerPage: (pageId: string, createdAt: number) => Promise<void>;
};

vi.mock("agents", () => ({
  getAgentByName: async () => mockIndexStub,
  Agent: class MockAgent {
    name = "test-doc";
    env = { WorkspaceAgent: {} };

    schedule(when: number, callback: string) {
      mockSchedules.push([when, callback]);
      return Promise.resolve({ id: String(mockSchedules.length) });
    }
    ctx = {
      storage: {
        get setAlarm() {
          return mockSetAlarm;
        },
      },
    };

    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.join("$").toLowerCase().trim();

      if (query.includes("create table")) return [];

      if (query.includes("delete from doc_state")) {
        mockSqlStore.clear();
        return [];
      }

      if (query.includes("select") && query.includes("from doc_state")) {
        const match = query.match(/key\s*=\s*'(\w+)'/);
        if (match) {
          const buf = mockSqlStore.get(match[1]);
          if (buf) return [{ value: buf }];
        }
        return [];
      }

      if (query.includes("insert into doc_state")) {
        const match = query.match(/values\s*\(\s*'(\w+)'/i);
        if (match) {
          const val = values[0];
          if (val instanceof Uint8Array) {
            mockSqlStore.set(
              match[1],
              val.buffer.slice(val.byteOffset, val.byteOffset + val.byteLength),
            );
          }
        }
        return [];
      }

      return [];
    }

    getConnections() {
      return mockConnectionMap.values();
    }

    // Stands in for the Agents SDK's alarm(), which only runs tasks
    // registered with this.schedule(). DocumentAgent registers none.
    alarm = async (): Promise<void> => {};
  },
}));

/* ------------------------------------------------------------------ */
/*  Mock Connection (server-side WebSocket handle)                     */
/* ------------------------------------------------------------------ */

class MockConnection {
  id: string;
  closed = false;
  closeCode?: number;
  closeReason?: string;
  onSend?: (data: Uint8Array) => void;

  constructor(id: string) {
    this.id = id;
  }

  send(data: ArrayBuffer | Uint8Array) {
    const bytes =
      data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data);
    this.onSend?.(bytes);
  }

  close(code?: number, reason?: string) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
  }
}

/* ------------------------------------------------------------------ */
/*  Mock Socket (client-side WebSocket)                                */
/* ------------------------------------------------------------------ */

class MockSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockSocket.OPEN;
  binaryType = "blob";
  sent: Uint8Array[] = [];
  onSend?: (data: Uint8Array) => void;

  send(data: Uint8Array | ArrayBuffer) {
    const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    this.sent.push(bytes);
    this.onSend?.(bytes);
  }

  close() {
    this.readyState = MockSocket.CLOSED;
    this.dispatchEvent(new Event("close"));
  }

  receiveMessage(data: Uint8Array) {
    const copy = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    this.dispatchEvent(new MessageEvent("message", { data: copy }));
  }
}

Object.defineProperty(MockSocket.prototype, "OPEN", { value: 1 });
Object.defineProperty(MockSocket.prototype, "CONNECTING", { value: 0 });

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("DocumentAgent", () => {
  let DocumentAgent: typeof import("../../../agents/document").default;
  let agent: InstanceType<typeof DocumentAgent>;
  let nextConnId: number;

  beforeEach(async () => {
    vi.stubGlobal("WebSocket", MockSocket);
    mockSqlStore = new Map();
    mockConnectionMap = new Map();
    mockSetAlarm = vi.fn();
    mockSchedules = [];
    mockIndexStub = {
      updatePage: async () => {
        throw new Error("index not set up in this test");
      },
      registerPage: async () => {},
    };
    nextConnId = 1;

    const mod = await import("../../../agents/document");
    DocumentAgent = mod.default;
    agent = new DocumentAgent({} as never, {} as never);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /* ---- Helpers ---- */

  /** Create a bare MockConnection registered in the connection map. */
  function createConnection(): MockConnection {
    const conn = new MockConnection(`conn-${nextConnId++}`);
    mockConnectionMap.set(conn.id, conn);
    return conn;
  }

  /**
   * Connect a full Yjs client through the agent.
   *
   * Wiring:
   *   agent sends → connection.send → socket.receiveMessage → YjsProvider
   *   YjsProvider sends → socket.send → agent.onMessage
   */
  function connectYjsClient(targetAgent = agent) {
    const connId = `conn-${nextConnId++}`;
    const socket = new MockSocket();
    const connection = new MockConnection(connId);

    // Wire agent → client
    connection.onSend = (data) => socket.receiveMessage(data);

    // Create provider (attaches message listener to socket)
    const doc = new Y.Doc();
    const awareness = new awarenessProtocol.Awareness(doc);
    const provider = new YjsProvider(
      socket as unknown as WebSocket,
      doc,
      awareness,
    );

    // Wire client → agent
    socket.onSend = (data) => {
      const buf = data.buffer.slice(
        data.byteOffset,
        data.byteOffset + data.byteLength,
      );
      targetAgent.onMessage(connection as never, buf);
    };

    // Register connection so getConnections() includes it
    mockConnectionMap.set(connId, connection);

    // Trigger sync handshake
    targetAgent.onConnect(connection as never, {} as never);

    return { doc, awareness, socket, connection, provider, connId };
  }

  function cleanup(...clients: Array<{ provider: YjsProvider; doc: Y.Doc }>) {
    for (const c of clients) {
      c.provider.destroy();
      c.doc.destroy();
    }
  }

  /* ================================================================ */
  /*  HTTP GET                                                         */
  /* ================================================================ */

  describe("GET /", () => {
    it("returns exists: false for a fresh agent", async () => {
      const res = await agent.onRequest(new Request("https://do/"));
      const body = await res.json();
      expect(body).toEqual({ exists: false, createdAt: null });
    });

    it("returns exists: true with createdAt after POST", async () => {
      const before = Date.now();
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const after = Date.now();

      const res = await agent.onRequest(new Request("https://do/"));
      const body = (await res.json()) as { exists: boolean; createdAt: number };
      expect(body.exists).toBe(true);
      expect(body.createdAt).toBeGreaterThanOrEqual(before);
      expect(body.createdAt).toBeLessThanOrEqual(after);
    });
  });

  /* ================================================================ */
  /*  HTTP POST                                                        */
  /* ================================================================ */

  describe("POST /", () => {
    it("returns { ok: true }", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", { method: "POST" }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    });

    it("stamps DOC_FORMAT_VERSION in Yjs meta map", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      const client = connectYjsClient();
      expect(client.doc.getMap<number>("meta").get("version")).toBe(
        DOC_FORMAT_VERSION,
      );
      cleanup(client);
    });

    it("does not schedule an alarm (documents never expire)", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));

      expect(mockSetAlarm).not.toHaveBeenCalled();
    });

    it("imports plain text content", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "hello world" }),
        }),
      );

      const client = connectYjsClient();
      const frag = client.doc.getXmlFragment("default");
      expect(frag.length).toBe(1);
      const para = frag.get(0) as Y.XmlElement;
      expect((para.get(0) as Y.XmlText).toString()).toBe("hello world");
      cleanup(client);
    });

    it("imports content with CriticMarkup marks", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "hello {++world++}" }),
        }),
      );

      const client = connectYjsClient();
      const para = client.doc.getXmlFragment("default").get(0) as Y.XmlElement;
      const ytext = para.get(0) as Y.XmlText;
      // XmlText.toString() includes formatting as XML tags, so check delta
      expect(ytext.toDelta()).toEqual([
        { insert: "hello " },
        { insert: "world", attributes: { criticAddition: {} } },
      ]);
      cleanup(client);
    });

    it("imports multiline content as separate paragraphs", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "line one\nline two\nline three" }),
        }),
      );

      const client = connectYjsClient();
      expect(client.doc.getXmlFragment("default").length).toBe(3);
      cleanup(client);
    });

    it("imports threads into Y.Map", async () => {
      const thread = { id: "t-1", commentText: "good point", replies: [] };
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "text", threads: [thread] }),
        }),
      );

      const client = connectYjsClient();
      const stored = JSON.parse(
        client.doc.getMap<string>("threads").get("t-1")!,
      );
      expect(stored.commentText).toBe("good point");
      cleanup(client);
    });

    it("returns 400 for unsupported CriticMarkup (substitution)", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "hello {~~old~>new~~}" }),
        }),
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { ok: boolean; error: string };
      expect(body.ok).toBe(false);
      expect(body.error).toContain("Unsupported CriticMarkup");
    });

    it("still creates doc even with malformed JSON body", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "not json",
        }),
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });

      // Document should still exist
      const getRes = await agent.onRequest(new Request("https://do/"));
      const body = (await getRes.json()) as { exists: boolean };
      expect(body.exists).toBe(true);
    });
  });

  /* ================================================================ */
  /*  Unsupported HTTP methods                                         */
  /* ================================================================ */

  describe("unsupported methods", () => {
    it("returns 404 for PUT", async () => {
      const res = await agent.onRequest(
        new Request("https://do/", { method: "PUT" }),
      );
      expect(res.status).toBe(404);
    });
  });

  /* ================================================================ */
  /*  Alarm (regression: documents used to auto-delete after 99 hours) */
  /* ================================================================ */

  describe("alarm", () => {
    // Documents created before the expiry was removed still have a
    // deletion alarm scheduled. When it fires, nothing may be lost.
    it("keeps the document when a leftover deletion alarm fires", async () => {
      await agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: "Keep me" }),
        }),
      );
      const stored = new Map(mockSqlStore);

      await agent.alarm();

      expect(mockSqlStore).toEqual(stored);
      const res = await agent.onRequest(new Request("https://do/"));
      const body = (await res.json()) as { exists: boolean };
      expect(body.exists).toBe(true);
      const client = connectYjsClient();
      expect(client.doc.getXmlFragment("default").toString()).toContain("Keep me");
      cleanup(client);
    });

    it("keeps connections open when an alarm fires", async () => {
      await agent.onRequest(new Request("https://do/", { method: "POST" }));
      const conn = createConnection();

      await agent.alarm();

      expect(conn.closed).toBe(false);
    });

    it("does not override the Agents SDK alarm handler", () => {
      const BaseAgent = Object.getPrototypeOf(DocumentAgent) as new () => { alarm: () => Promise<void> };
      expect(Object.prototype.hasOwnProperty.call(DocumentAgent.prototype, "alarm")).toBe(false);
      expect(agent.alarm.toString()).toBe(new BaseAgent().alarm.toString());
    });
  });

  /* ================================================================ */
  /*  Yjs sync through the agent                                       */
  /* ================================================================ */

  describe("Yjs sync", () => {
    it("syncs content from client A to client B", () => {
      const a = connectYjsClient();
      a.doc.getText("default").insert(0, "hello from A");

      const b = connectYjsClient();
      expect(b.doc.getText("default").toString()).toBe("hello from A");
      cleanup(a, b);
    });

    it("syncs live edits bidirectionally", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      a.doc.getText("default").insert(0, "AAA");
      expect(b.doc.getText("default").toString()).toBe("AAA");

      b.doc.getText("default").insert(3, " BBB");
      expect(a.doc.getText("default").toString()).toBe("AAA BBB");
      cleanup(a, b);
    });

    it("persists state in SQL and restores on new agent instance", () => {
      const a = connectYjsClient();
      a.doc.getText("default").insert(0, "persisted data");
      cleanup(a);
      mockConnectionMap.clear();

      // Simulate DO restart: new agent instance, same SQL store
      const agent2 = new DocumentAgent({} as never, {} as never);
      const b = connectYjsClient(agent2);
      expect(b.doc.getText("default").toString()).toBe("persisted data");
      cleanup(b);
    });

    it("propagates awareness state between clients", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      a.awareness.setLocalStateField("user", {
        name: "Alice",
        color: "#E57373",
      });

      const stateA = b.awareness.getStates().get(a.doc.clientID);
      expect(stateA?.user).toEqual({ name: "Alice", color: "#E57373" });
      cleanup(a, b);
    });

    it("new client receives content after first client disconnects", () => {
      const a = connectYjsClient();
      a.doc.getText("default").insert(0, "before disconnect");
      a.provider.destroy();
      a.socket.close();
      mockConnectionMap.delete(a.connId);
      a.doc.destroy();

      const b = connectYjsClient();
      expect(b.doc.getText("default").toString()).toBe("before disconnect");
      cleanup(b);
    });

    it("handles rapid sequential edits", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      const text = a.doc.getText("default");
      for (let i = 0; i < 50; i++) {
        text.insert(text.length, `${i} `);
      }

      const expected = Array.from({ length: 50 }, (_, i) => `${i} `).join("");
      expect(b.doc.getText("default").toString()).toBe(expected);
      cleanup(a, b);
    });

    it("handles deletions synced between clients", () => {
      const a = connectYjsClient();
      const b = connectYjsClient();

      a.doc.getText("default").insert(0, "hello world");
      expect(b.doc.getText("default").toString()).toBe("hello world");

      a.doc.getText("default").delete(6, 5);
      expect(b.doc.getText("default").toString()).toBe("hello ");
      cleanup(a, b);
    });
  });

  /* ================================================================ */
  /*  onMessage edge cases                                             */
  /* ================================================================ */

  describe("onMessage", () => {
    it("ignores string messages gracefully", async () => {
      const conn = createConnection();
      await agent.onConnect(conn as never, {} as never);
      // Should not throw
      await agent.onMessage(conn as never, "some string message");
    });
  });

  /* ================================================================ */
  /*  onClose                                                          */
  /* ================================================================ */

  describe("onClose", () => {
    it("does not throw when awareness is not initialised", async () => {
      const conn = createConnection();
      // Agent has never been initialised — awareness is null
      await agent.onClose(conn as never, 1000, "normal", true);
    });

    it("does not throw after agent is initialised", async () => {
      const conn = createConnection();
      await agent.onConnect(conn as never, {} as never);
      await agent.onClose(conn as never, 1000, "normal", true);
    });
  });

  /* ================================================================ */
  /*  Workspace index reporting                                        */
  /* ================================================================ */

  describe("workspace index", () => {
    const PAGE_ID = "abcd1234";
    let index: WorkspaceIndex;
    let updates: PageUpdate[];

    beforeEach(() => {
      index = new WorkspaceIndex(memoryDb());
      updates = [];
      mockIndexStub = {
        updatePage: async (update) => {
          updates.push(update);
          return index.updatePage(update);
        },
        registerPage: async (pageId, createdAt) => index.registerPage(pageId, createdAt),
      };
      (agent as unknown as { name: string }).name = PAGE_ID;
    });

    function create(content?: string) {
      return agent.onRequest(
        new Request("https://do/", {
          method: "POST",
          headers: content ? { "Content-Type": "application/json" } : {},
          body: content ? JSON.stringify({ content }) : undefined,
        }),
      );
    }

    /** Append a line from a client, as the editor would. */
    function addLine(client: { doc: Y.Doc }, text: string) {
      const para = new Y.XmlElement("paragraph");
      para.insert(0, [new Y.XmlText(text)]);
      const frag = client.doc.getXmlFragment("default");
      frag.insert(frag.length, [para]);
    }

    const reindexes = () => mockSchedules.filter(([, cb]) => cb === "reindex");

    it("registers a new document in the index", async () => {
      await create();
      expect(index.registeredPages()).toEqual([PAGE_ID]);
    });

    it("indexes created content after a short delay, scheduling once", async () => {
      await create("TODO read Yjs docs #reading\nsecond line");
      expect(reindexes()).toEqual([[2, "reindex"]]);
      expect(updates).toHaveLength(0);

      await agent.reindex();

      expect(updates).toHaveLength(1);
      expect(updates[0].lines.map((l) => l.text)).toEqual(["TODO read Yjs docs #reading", "second line"]);
      expect(index.tasks().map((t) => t.text)).toEqual(["read Yjs docs #reading"]);
      expect(index.search("second").map((h) => h.pageId)).toEqual([PAGE_ID]);
    });

    it("does nothing on a reindex with no new edits", async () => {
      await create("hello");
      await agent.reindex();
      await agent.reindex();
      expect(updates).toHaveLength(1);
    });

    it("indexes edits made through the editor", async () => {
      await create();
      await agent.reindex();
      const client = connectYjsClient();
      mockSchedules = [];
      addLine(client, "DOING index edits");
      addLine(client, "and more");
      expect(reindexes()).toHaveLength(1);

      await agent.reindex();

      expect(index.tasks().map((t) => [t.state, t.text])).toEqual([["DOING", "index edits"]]);
      cleanup(client);
    });

    it("sends strictly increasing update times, even if the clock stands still", async () => {
      vi.spyOn(Date, "now").mockReturnValue(5000);
      try {
        await create("one");
        await agent.reindex();
        const client = connectYjsClient();
        addLine(client, "two");
        await agent.reindex();
        expect(updates.map((u) => u.updatedAt)).toEqual([5000, 5001]);
        cleanup(client);
      } finally {
        vi.restoreAllMocks();
      }
    });

    it("schedules another round for edits made while an update is in flight", async () => {
      await create("first");
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      mockIndexStub.updatePage = async (update) => {
        await gate;
        updates.push(update);
        return index.updatePage(update);
      };
      const client = connectYjsClient();
      const inFlight = agent.reindex();
      mockSchedules = [];
      addLine(client, "typed during the call");
      release();
      await inFlight;

      expect(reindexes()).toHaveLength(1);
      await agent.reindex();
      expect(updates.at(-1)!.lines.map((l) => l.text)).toContain("typed during the call");
      cleanup(client);
    });

    it("retries with backoff until the index confirms, then resets", async () => {
      await create("retry me");
      let failures = 3;
      mockIndexStub.updatePage = async (update) => {
        if (failures-- > 0) throw new Error("index unavailable");
        updates.push(update);
        return index.updatePage(update);
      };
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      mockSchedules = [];

      for (let i = 0; i < 4; i++) await agent.reindex();

      expect(reindexes().map(([delay]) => delay)).toEqual([5, 30, 120]);
      expect(errors).toHaveBeenCalledTimes(3);
      expect(index.search("retry").map((h) => h.pageId)).toEqual([PAGE_ID]);

      // After a success the backoff starts again from the beginning
      failures = 1;
      const client = connectYjsClient();
      addLine(client, "again");
      mockSchedules = [];
      await agent.reindex();
      expect(reindexes().map(([delay]) => delay)).toEqual([5]);
      cleanup(client);
      errors.mockRestore();
    });

    it("keeps retrying every 10 minutes after repeated failures", async () => {
      await create("down");
      mockIndexStub.updatePage = async () => {
        throw new Error("index unavailable");
      };
      vi.spyOn(console, "error").mockImplementation(() => {});
      mockSchedules = [];
      for (let i = 0; i < 6; i++) await agent.reindex();
      expect(reindexes().map(([delay]) => delay)).toEqual([5, 30, 120, 600, 600, 600]);
      vi.restoreAllMocks();
    });

    it("never lets an index failure break editing or sync", async () => {
      await create("start");
      mockIndexStub.updatePage = async () => {
        throw new Error("index unavailable");
      };
      vi.spyOn(console, "error").mockImplementation(() => {});
      const a = connectYjsClient();
      const b = connectYjsClient();
      addLine(a, "still syncs");
      await expect(agent.reindex()).resolves.toBeUndefined();
      expect(b.doc.getXmlFragment("default").toString()).toContain("still syncs");
      cleanup(a, b);
      vi.restoreAllMocks();
    });

    it("sends again when the index already holds a newer update", async () => {
      index.updatePage({ pageId: PAGE_ID, title: "", updatedAt: 9_000_000_000_000, lines: [] });
      await create("my real content");
      mockSchedules = [];
      await agent.reindex();
      expect(index.search("real")).toEqual([]);
      expect(reindexes()).toHaveLength(1);

      await agent.reindex();

      expect(updates.at(-1)!.updatedAt).toBe(9_000_000_000_001);
      expect(index.search("real").map((h) => h.pageId)).toEqual([PAGE_ID]);
    });

    it("indexes a never-indexed document when it is opened", async () => {
      // A Mist-era document: created before indexing existed, opened later
      await create("old notes");
      mockSqlStore.delete("index");
      const later = new DocumentAgent({} as never, {} as never);
      (later as unknown as { name: string }).name = PAGE_ID;
      mockSchedules = [];
      await later.onConnect(createConnection() as never, {} as never);
      expect(reindexes()).toHaveLength(1);
      await later.reindex();
      expect(index.search("old").map((h) => h.pageId)).toEqual([PAGE_ID]);
    });

    it("schedules only once when opened while a reindex is already pending", async () => {
      await create("pending");
      mockSchedules = [];
      await agent.onConnect(createConnection() as never, {} as never);
      expect(reindexes()).toEqual([]);
    });

    it("does not reindex on open when the index is up to date", async () => {
      await create("indexed");
      await agent.reindex();
      const fresh = new DocumentAgent({} as never, {} as never);
      (fresh as unknown as { name: string }).name = PAGE_ID;
      mockSchedules = [];
      await fresh.onConnect(createConnection() as never, {} as never);
      expect(reindexes()).toEqual([]);
    });

    it("reindexes on open when an older parser built the entry", async () => {
      await create("indexed");
      await agent.reindex();
      const raw = JSON.parse(new TextDecoder().decode(mockSqlStore.get("index")!));
      raw.ack.parserVersion = PARSER_VERSION - 1;
      mockSqlStore.set("index", new TextEncoder().encode(JSON.stringify(raw)).buffer);
      const fresh = new DocumentAgent({} as never, {} as never);
      (fresh as unknown as { name: string }).name = PAGE_ID;
      mockSchedules = [];
      await fresh.onConnect(createConnection() as never, {} as never);
      expect(reindexes()).toHaveLength(1);
    });

    it("does not index a document that was never created", async () => {
      const client = connectYjsClient();
      addLine(client, "written to a random ID");
      expect(reindexes()).toEqual([]);
      await agent.reindex();
      expect(updates).toEqual([]);
      cleanup(client);
    });

    it("does not index or register a document whose name is not a page ID", async () => {
      (agent as unknown as { name: string }).name = "test-doc";
      await create("content");
      await agent.reindex();
      expect(reindexes()).toEqual([]);
      expect(index.registeredPages()).toEqual([]);
      expect(updates).toEqual([]);
    });

    it("treats a corrupted index state as never indexed", async () => {
      await create("notes");
      mockSqlStore.set("index", new TextEncoder().encode("{not json").buffer);
      const later = new DocumentAgent({} as never, {} as never);
      (later as unknown as { name: string }).name = PAGE_ID;
      mockSchedules = [];
      await later.onConnect(createConnection() as never, {} as never);
      expect(reindexes()).toHaveLength(1);
    });

    it("can schedule again after the scheduler refuses a task", async () => {
      await create("first");
      await agent.reindex();
      const client = connectYjsClient();
      await agent.reindex();
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const refuse = vi
        .spyOn(agent as unknown as { schedule: () => Promise<unknown> }, "schedule")
        .mockRejectedValueOnce(new Error("storage busy"));
      mockSchedules = [];

      addLine(client, "refused");
      await Promise.resolve();
      expect(errors).toHaveBeenCalledWith("Could not schedule reindex", expect.any(Error));
      expect(reindexes()).toEqual([]);

      addLine(client, "accepted");
      expect(reindexes()).toHaveLength(1);
      await agent.reindex();
      expect(index.search("refused").map((h) => h.pageId)).toEqual([PAGE_ID]);
      refuse.mockRestore();
      errors.mockRestore();
      cleanup(client);
    });

    it("keeps saving and syncing edits if index bookkeeping fails", async () => {
      await create("start");
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const realSql = (agent as unknown as { sql: (...a: unknown[]) => unknown }).sql.bind(agent);
      vi.spyOn(agent as unknown as { sql: (...a: unknown[]) => unknown }, "sql").mockImplementation(
        (strings: unknown, ...values: unknown[]) => {
          if ((strings as string[]).join("").includes("key = 'exists'")) throw new Error("disk full");
          return realSql(strings, ...values);
        },
      );
      const a = connectYjsClient();
      const b = connectYjsClient();
      addLine(a, "saved anyway");
      expect(errors).toHaveBeenCalledWith("markForIndex failed", expect.any(Error));
      expect(b.doc.getXmlFragment("default").toString()).toContain("saved anyway");
      expect(mockSqlStore.has("state")).toBe(true);
      cleanup(a, b);
      vi.restoreAllMocks();
    });

    it("still creates the document if registration fails", async () => {
      mockIndexStub.registerPage = async () => {
        throw new Error("index unavailable");
      };
      vi.spyOn(console, "error").mockImplementation(() => {});
      const res = await create("hello");
      expect(res.status).toBe(200);
      await agent.reindex();
      expect(index.registeredPages()).toEqual([PAGE_ID]);
      vi.restoreAllMocks();
    });
  });
});

