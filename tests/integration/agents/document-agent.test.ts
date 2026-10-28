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
import { DOC_FORMAT_VERSION, CLOSE_OUTDATED_CLIENT } from "~/shared/constants";
import { YjsProvider } from "~/lib/yjs-provider";
import { PARSER_VERSION } from "~/lib/note-parser";
import { WorkspaceIndex, type PageUpdate, type PageUpdateAck, type ClaimResult } from "../../../agents/workspace-index";
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
  claimTitle: (pageId: string, title: string, at: number) => Promise<ClaimResult>;
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

    /** Like real Durable Object SQLite, doc_state does not exist until created. */
    tablesCreated = false;

    sql(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = strings.join("$").toLowerCase().trim();

      if (query.includes("create table")) {
        this.tablesCreated = true;
        return [];
      }
      if (query.includes("doc_state") && !this.tablesCreated) throw new Error("no such table: doc_state");

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

/** What onConnect receives from a browser running the current code. */
const CURRENT_CLIENT = { request: new Request(`https://mistlog.test/agents/document-agent/test-doc?format=${DOC_FORMAT_VERSION}`) } as never;

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
    // The in-memory index timer fires only when a test advances time, so no
    // timer from one test can reach the next test's index
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
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
      claimTitle: async () => {
        throw new Error("index not set up in this test");
      },
    };
    nextConnId = 1;

    const mod = await import("../../../agents/document");
    DocumentAgent = mod.default;
    agent = new DocumentAgent({} as never, {} as never);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
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
    targetAgent.onConnect(connection as never, CURRENT_CLIENT);

    return { doc, awareness, socket, connection, provider, connId };
  }

  function cleanup(...clients: Array<{ provider: YjsProvider; doc: Y.Doc }>) {
    for (const c of clients) {
      c.provider.destroy();
      c.doc.destroy();
    }
  }

  /* ================================================================ */
  /*  Durable Object usage: nothing may keep the object awake          */
  /* ================================================================ */

  describe("hibernation", () => {
    // A Durable Object with a pending timer cannot hibernate, and is billed
    // for every second it is open. Mist's server awareness ran one every 3 s.
    it("leaves no timer running after starting up and serving a request", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "setTimeout", "clearTimeout"] });
      const fresh = new DocumentAgent({} as never, {} as never);
      await fresh.onRequest(new Request("https://do/"));
      expect(vi.getTimerCount()).toBe(0);
    });

    it("createRelayAwareness stops y-protocols' 3-second interval", async () => {
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      const { createRelayAwareness } = await import("../../../agents/document");
      const awareness = createRelayAwareness(new Y.Doc());
      expect(vi.getTimerCount()).toBe(0);
      // It still relays: applying and encoding states works
      expect(awareness.getStates()).toBeInstanceOf(Map);
    });
  });

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

  describe("tabs running older code", () => {
    const socketRequest = (query: string, headers: Record<string, string> = { Upgrade: "websocket" }) =>
      new Request(`https://mistlog.test/agents/document-agent/abcd1234${query}`, { headers });

    it.each([
      ["no format", ""],
      ["an older format", `?format=${DOC_FORMAT_VERSION - 1}`],
      ["a malformed format", "?format=4x"],
    ])("refuses a connection with %s, sending nothing", async (_name, query) => {
      const conn = createConnection();
      const sent: Uint8Array[] = [];
      conn.onSend = (d) => sent.push(d);
      await agent.onConnect(conn as never, { request: socketRequest(query) } as never);
      expect(conn.closeCode).toBe(CLOSE_OUTDATED_CLIENT);
      expect(conn.closeReason).toContain("Reload");
      expect(sent).toHaveLength(0);
    });

    it("accepts the current format and newer ones", async () => {
      for (const v of [DOC_FORMAT_VERSION, DOC_FORMAT_VERSION + 1]) {
        const conn = createConnection();
        const sent: Uint8Array[] = [];
        conn.onSend = (d) => sent.push(d);
        await agent.onConnect(conn as never, { request: socketRequest(`?format=${v}`) } as never);
        expect(conn.closed).toBe(false);
        expect(sent.length).toBeGreaterThan(0);
      }
    });

    it("the Worker spots outdated document sockets, and only those", async () => {
      const { isOutdatedEditorRequest } = await import("../../../agents/document");
      expect(isOutdatedEditorRequest(socketRequest(""))).toBe(true);
      expect(isOutdatedEditorRequest(socketRequest("?format=3"))).toBe(true);
      expect(isOutdatedEditorRequest(socketRequest(`?format=${DOC_FORMAT_VERSION}`))).toBe(false);
      // Not a WebSocket, or not a document: left alone
      expect(isOutdatedEditorRequest(socketRequest("", {}))).toBe(false);
      expect(isOutdatedEditorRequest(new Request("https://mistlog.test/agents/workspace-agent/default", { headers: { Upgrade: "websocket" } }))).toBe(false);
      expect(isOutdatedEditorRequest(new Request("https://mistlog.test/docs/abcd1234", { headers: { Upgrade: "websocket" } }))).toBe(false);
    });

    it("the Worker accepts the socket and closes it with the reload code", async () => {
      const server = { accept: vi.fn(), close: vi.fn() };
      vi.stubGlobal("WebSocketPair", function () { return { 0: { client: true }, 1: server }; });
      // Node's Response refuses status 101, which Workers allow for WebSockets
      const RealResponse = Response;
      vi.stubGlobal("Response", function (body: unknown, init: { status: number; webSocket: unknown }) { return { body, ...init }; });
      try {
        const { refuseOutdatedEditor } = await import("../../../agents/document");
        const res = refuseOutdatedEditor() as unknown as { status: number; webSocket: unknown };
        expect(res.status).toBe(101);
        expect(res.webSocket).toEqual({ client: true });
        expect(server.accept).toHaveBeenCalled();
        expect(server.close).toHaveBeenCalledWith(CLOSE_OUTDATED_CLIENT, expect.stringContaining("Reload"));
      } finally {
        vi.unstubAllGlobals();
        expect(Response).toBe(RealResponse);
      }
    });
  });

  describe("onMessage", () => {
    it("ignores string messages gracefully", async () => {
      const conn = createConnection();
      await agent.onConnect(conn as never, CURRENT_CLIENT);
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
      await agent.onConnect(conn as never, CURRENT_CLIENT);
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
    /** Order of calls reaching the index, for the race tests. */
    let calls: string[];

    beforeEach(() => {
      index = new WorkspaceIndex(memoryDb());
      updates = [];
      calls = [];
      mockIndexStub = {
        updatePage: async (update) => {
          updates.push(update);
          calls.push(`update ${update.title}`);
          return index.updatePage(update);
        },
        registerPage: async (pageId, createdAt) => index.registerPage(pageId, createdAt),
        claimTitle: async (pageId, title, at) => {
          calls.push(`claim ${title}`);
          return index.claimTitle(pageId, title, at);
        },
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
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const inCall = new Promise<void>((resolve) => (entered = resolve));
      mockIndexStub.updatePage = async (update) => {
        entered();
        await gate;
        updates.push(update);
        return index.updatePage(update);
      };
      const client = connectYjsClient();
      const inFlight = agent.reindex();
      await inCall; // the index call is now really in flight
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
      await later.onConnect(createConnection() as never, CURRENT_CLIENT);
      expect(reindexes()).toHaveLength(1);
      await later.reindex();
      expect(index.search("old").map((h) => h.pageId)).toEqual([PAGE_ID]);
    });

    it("schedules only once when opened while a reindex is already pending", async () => {
      await create("pending");
      mockSchedules = [];
      await agent.onConnect(createConnection() as never, CURRENT_CLIENT);
      expect(reindexes()).toEqual([]);
    });

    it("does not reindex on open when the index is up to date", async () => {
      await create("indexed");
      await agent.reindex();
      const fresh = new DocumentAgent({} as never, {} as never);
      (fresh as unknown as { name: string }).name = PAGE_ID;
      mockSchedules = [];
      await fresh.onConnect(createConnection() as never, CURRENT_CLIENT);
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
      await fresh.onConnect(createConnection() as never, CURRENT_CLIENT);
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
      await later.onConnect(createConnection() as never, CURRENT_CLIENT);
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
          if ((strings as string[]).join("").includes("key = 'index'")) throw new Error("disk full");
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

    /* ---- Pages created for links (createWithTitle) ---- */

    it("creates a page for a link: claims the title first, then saves it with that title", async () => {
      const result = await agent.createWithTitle("  Holiday   plans ");
      expect(result).toEqual({ ok: true, pageId: PAGE_ID, title: "Holiday plans", slug: "holiday-plans" });
      expect(calls[0]).toBe("claim Holiday plans");
      expect((agent as unknown as { doc: Y.Doc }).doc.getMap("meta").get("title")).toBe("Holiday plans");
      expect(mockSqlStore.has("exists")).toBe(true);
      expect(mockSqlStore.has("state")).toBe(true);
      expect(index.registeredPages()).toEqual([PAGE_ID]);
      expect(index.findByTitle("holiday plans")?.pageId).toBe(PAGE_ID);
    });

    it("creates nothing and returns the other page when the title was taken a moment ago", async () => {
      index.claimTitle("other123", "Holiday", 1);
      const result = await agent.createWithTitle("holiday");
      expect(result).toEqual({ ok: false, code: "taken", holder: { pageId: "other123", title: "Holiday" } });
      expect(mockSqlStore.has("exists")).toBe(false);
      expect(mockSqlStore.has("state")).toBe(false);
      expect(index.registeredPages()).toEqual(["other123"]);
    });

    it("lets only one of two tabs creating the same title at once succeed", async () => {
      const other = new DocumentAgent({} as never, {} as never);
      (other as unknown as { name: string }).name = "other123";
      const [a, b] = await Promise.all([agent.createWithTitle("Holiday"), other.createWithTitle("Holiday")]);
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
      const loser = a.ok ? b : a;
      expect(loser).toMatchObject({ ok: false, code: "taken" });
    });

    it("refuses an invalid title, a journal, or a page that already exists, creating nothing", async () => {
      expect(await agent.createWithTitle("   ")).toMatchObject({ ok: false, code: "invalid" });
      expect(await agent.createWithTitle("Oct 28th, 2026")).toMatchObject({ ok: false, code: "invalid" });
      expect(mockSqlStore.has("exists")).toBe(false);
      await create("already here");
      expect(await agent.createWithTitle("Late")).toEqual({ ok: false, code: "exists" });
      (agent as unknown as { name: string }).name = "journal-2026-10-28";
      expect(await agent.createWithTitle("Late")).toEqual({ ok: false, code: "journal" });
    });

    /* ---- Renames: only the server writes meta.title ---- */

    it("renames: claims the title, writes meta.title on the server, and syncs it to every tab", async () => {
      await create("body text");
      await agent.reindex();
      const a = connectYjsClient();
      const b = connectYjsClient();
      updates = [];

      const result = await agent.rename("  Renamed   Page ");

      expect(result).toEqual({ ok: true, title: "Renamed Page", slug: "renamed-page" });
      expect(a.doc.getMap("meta").get("title")).toBe("Renamed Page");
      expect(b.doc.getMap("meta").get("title")).toBe("Renamed Page");
      await vi.waitFor(() => expect(updates.at(-1)?.title).toBe("Renamed Page"));
      expect(index.currentSlug(PAGE_ID)).toBe("renamed-page");
      cleanup(a, b);
    });

    it("reverts a title written directly by a browser, for every tab", async () => {
      await create("body");
      await agent.rename("Approved");
      const a = connectYjsClient();
      const b = connectYjsClient();
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      updates = [];

      a.doc.getMap("meta").set("title", "Sneaky Duplicate");

      expect(warn).toHaveBeenCalledWith("Reverted a title change made outside rename");
      expect(a.doc.getMap("meta").get("title")).toBe("Approved");
      expect(b.doc.getMap("meta").get("title")).toBe("Approved");
      await agent.reindex();
      expect(updates.every((u) => u.title === "Approved")).toBe(true);
      expect(index.getPage(PAGE_ID)?.title).toBe("Approved");
      cleanup(a, b);
      warn.mockRestore();
    });

    it("reverts a browser's title on a page that never had one by removing it", async () => {
      await create("body");
      const a = connectYjsClient();
      vi.spyOn(console, "warn").mockImplementation(() => {});
      a.doc.getMap("meta").set("title", "Unapproved");
      expect(a.doc.getMap("meta").has("title")).toBe(false);
      cleanup(a);
      vi.restoreAllMocks();
    });

    it("waits for a reindex in flight before claiming, so the old title cannot land after the claim", async () => {
      await create("body");
      await agent.rename("Plans");
      await agent.reindex();
      // Hold a reindex that carries the old title in flight
      let release!: () => void;
      let entered!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      const inCall = new Promise<void>((resolve) => (entered = resolve));
      const realUpdate = mockIndexStub.updatePage;
      mockIndexStub.updatePage = async (update) => {
        if (update.title === "Plans") {
          entered();
          await gate;
        }
        return realUpdate(update);
      };
      const client = connectYjsClient();
      addLine(client, "edit that triggers a reindex");
      calls = [];
      const staleReindex = agent.reindex();
      await inCall;

      const renaming = agent.rename("Notes");
      await Promise.resolve();
      expect(calls).toEqual([]); // the claim has not been sent while the old title is in flight
      release();
      await staleReindex;
      await renaming;
      await vi.waitFor(() => expect(calls.at(-1)).toBe("update Notes"));

      expect(calls.slice(0, 2)).toEqual(["update Plans", "claim Notes"]);
      expect(index.getPage(PAGE_ID)?.title).toBe("Notes");
      // Another page cannot now take "Notes", and "Plans" is free
      expect(index.claimTitle("bbbb2222", "notes", 1)).toMatchObject({ ok: false, reason: "taken" });
      expect(index.claimTitle("bbbb2222", "Plans", 1)).toMatchObject({ ok: true });
      cleanup(client);
    });

    it("serialises two renames of the same page; the last one wins everywhere", async () => {
      await create("body");
      const client = connectYjsClient();
      const [first, second] = await Promise.all([agent.rename("First"), agent.rename("Second")]);
      expect(first.ok && second.ok).toBe(true);
      expect(client.doc.getMap("meta").get("title")).toBe("Second");
      await vi.waitFor(() => expect(index.getPage(PAGE_ID)?.title).toBe("Second"));
      expect(index.currentSlug(PAGE_ID)).toBe("second");
      cleanup(client);
    });

    it("refuses a title another page has, leaving meta.title unchanged", async () => {
      index.updatePage({ pageId: "bbbb2222", title: "Taken", updatedAt: 1, lines: [] });
      await create("body");
      await agent.rename("Mine");
      expect(await agent.rename("taken")).toEqual({ ok: false, code: "taken", holderTitle: "Taken" });
      expect(connectYjsClient().doc.getMap("meta").get("title")).toBe("Mine");
    });

    it("refuses journal-date titles and invalid titles", async () => {
      await create("body");
      expect(await agent.rename("Oct 30th, 2026")).toEqual({ ok: false, code: "journal-title" });
      expect(await agent.rename("a [[b]]")).toEqual({ ok: false, code: "invalid", reason: "Titles can't contain [[ or ]]." });
      expect(await agent.rename("   ")).toEqual({ ok: false, code: "invalid", reason: "A page needs a title." });
    });

    it("refuses to rename a document that was never created, without touching the index", async () => {
      expect(await agent.rename("Phantom")).toEqual({ ok: false, code: "missing" });
      expect(index.registeredPages()).toEqual([]);
      expect(calls).toEqual([]);
    });

    it("refuses to rename a journal", async () => {
      (agent as unknown as { name: string }).name = "journal-2026-10-26";
      expect(await agent.rename("Anything")).toEqual({ ok: false, code: "journal" });
    });

    it("leaves the title unchanged if the index cannot be reached", async () => {
      await create("body");
      await agent.rename("Before");
      mockIndexStub.claimTitle = async () => {
        throw new Error("index down");
      };
      await expect(agent.rename("After")).rejects.toThrow("index down");
      expect(connectYjsClient().doc.getMap("meta").get("title")).toBe("Before");
      // The lock is released: later reindexes still run
      const client = connectYjsClient();
      addLine(client, "still indexing");
      await agent.reindex();
      expect(index.search("still").map((h) => h.pageId)).toEqual([PAGE_ID]);
      cleanup(client);
    });

    it("does not write meta.title again when renaming to the current title", async () => {
      await create("body");
      await agent.rename("Same");
      const client = connectYjsClient();
      const seen: unknown[] = [];
      client.doc.getMap("meta").observe(() => seen.push(client.doc.getMap("meta").get("title")));
      expect(await agent.rename("Same")).toMatchObject({ ok: true, title: "Same" });
      expect(seen).toEqual([]);
      cleanup(client);
    });

    it("reindexes at once after a rename, without waiting for the throttle", async () => {
      await create("body");
      await agent.reindex();
      updates = [];
      mockSchedules = [];
      await agent.rename("Instant");
      await vi.waitFor(() => expect(updates.map((u) => u.title)).toEqual(["Instant"]));
    });

    it("keeps body edits on the throttle", async () => {
      await create("body text");
      await agent.reindex();
      const client = connectYjsClient();
      updates = [];
      mockSchedules = [];
      addLine(client, "just typing");
      await Promise.resolve();
      expect(updates).toEqual([]);
      expect(reindexes()).toEqual([[2, "reindex"]]);
      cleanup(client);
    });

    it("keeps editing working if the immediate reindex bookkeeping fails", async () => {
      await create("body");
      await agent.reindex();
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const realSql = (agent as unknown as { sql: (...a: unknown[]) => unknown }).sql.bind(agent);
      const a = connectYjsClient();
      vi.spyOn(agent as unknown as { sql: (...a: unknown[]) => unknown }, "sql").mockImplementation(
        (strings: unknown, ...values: unknown[]) => {
          if ((strings as string[]).join("").includes("key = 'index'")) throw new Error("disk full");
          return realSql(strings, ...values);
        },
      );
      expect(await agent.rename("Still syncs")).toMatchObject({ ok: true });
      expect(errors).toHaveBeenCalledWith("reindexNow failed", expect.any(Error));
      expect(a.doc.getMap("meta").get("title")).toBe("Still syncs");
      cleanup(a);
      vi.restoreAllMocks();
    });

    it("does not reindex a never-created document when a browser sets its title", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const client = connectYjsClient();
      client.doc.getMap("meta").set("title", "Sneaky");
      await Promise.resolve();
      expect(updates).toEqual([]);
      cleanup(client);
      vi.restoreAllMocks();
    });

    it("still sends the document to a new tab if the index check on open fails", async () => {
      await create("must arrive");
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      const realSql = (agent as unknown as { sql: (...a: unknown[]) => unknown }).sql.bind(agent);
      vi.spyOn(agent as unknown as { sql: (...a: unknown[]) => unknown }, "sql").mockImplementation(
        (strings: unknown, ...values: unknown[]) => {
          if ((strings as string[]).join("").includes("key = 'index'")) throw new Error("disk full");
          return realSql(strings, ...values);
        },
      );
      const client = connectYjsClient();
      await Promise.resolve();
      expect(client.doc.getXmlFragment("default").toString()).toContain("must arrive");
      expect(errors).toHaveBeenCalledWith("indexOnOpen failed", expect.any(Error));
      cleanup(client);
      vi.restoreAllMocks();
    });

    /* ---- Index soon after a pause in typing ---- */

    describe("indexing after a pause", () => {
      beforeEach(() => {
        // The 2-second limit is measured with Date.now(), so fake the clock too
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      });

      it("indexes 0.3 seconds after the last edit", async () => {
        await create("start");
        await agent.reindex();
        const client = connectYjsClient();
        updates = [];
        addLine(client, "one");
        await vi.advanceTimersByTimeAsync(299);
        expect(updates).toEqual([]);
        await vi.advanceTimersByTimeAsync(1);
        expect(updates.map((u) => u.lines.map((l) => l.text))).toEqual([["start", "one"]]);
        cleanup(client);
      });

      it("waits for the pause: each edit restarts the 0.3 seconds", async () => {
        await create("start");
        await agent.reindex();
        const client = connectYjsClient();
        updates = [];
        addLine(client, "a");
        await vi.advanceTimersByTimeAsync(200);
        addLine(client, "b");
        await vi.advanceTimersByTimeAsync(200);
        expect(updates).toEqual([]);
        await vi.advanceTimersByTimeAsync(100);
        expect(updates).toHaveLength(1);
        expect(updates[0].lines.map((l) => l.text)).toEqual(["start", "a", "b"]);
        cleanup(client);
      });

      it("still indexes every 2 seconds during continuous typing", async () => {
        await create("start");
        await agent.reindex();
        const client = connectYjsClient();
        updates = [];
        for (let i = 0; i < 15; i++) {
          addLine(client, `line ${i}`); // one edit every 0.2 seconds, never pausing
          await vi.advanceTimersByTimeAsync(200);
        }
        // 3 seconds of typing: indexed once at the 2-second limit
        expect(updates).toHaveLength(1);
        expect(updates[0].lines.length).toBeGreaterThanOrEqual(10);
        await vi.advanceTimersByTimeAsync(300);
        expect(updates).toHaveLength(2);
        expect(updates[1].lines.at(-1)?.text).toBe("line 14");
        cleanup(client);
      });

      it("leaves retries to the backoff schedule while the index is failing", async () => {
        await create("start");
        mockIndexStub.updatePage = async () => {
          throw new Error("index down");
        };
        vi.spyOn(console, "error").mockImplementation(() => {});
        await agent.reindex(); // fails: now in backoff
        const attempts = vi.fn();
        mockIndexStub.updatePage = async () => {
          attempts();
          throw new Error("index down");
        };
        const client = connectYjsClient();
        addLine(client, "typing during an outage");
        await vi.advanceTimersByTimeAsync(5000);
        expect(attempts).not.toHaveBeenCalled();
        cleanup(client);
        vi.restoreAllMocks();
      });

      it("makes the backup schedule a no-op once the pause timer has indexed", async () => {
        await create("start");
        await agent.reindex();
        const client = connectYjsClient();
        updates = [];
        addLine(client, "edit");
        await vi.advanceTimersByTimeAsync(300);
        expect(updates).toHaveLength(1);
        await agent.reindex(); // the persisted 2-second backup firing
        expect(updates).toHaveLength(1);
        cleanup(client);
      });

      it("does not run for documents that are not indexable", async () => {
        const client = connectYjsClient(); // never created
        addLine(client, "nothing to index");
        await vi.advanceTimersByTimeAsync(3000);
        expect(updates).toEqual([]);
        cleanup(client);
      });
    });

    /* ---- Journals: created by their first real text ---- */

    describe("journals", () => {
      const DAY = "journal-2026-10-26";
      beforeEach(() => {
        (agent as unknown as { name: string }).name = DAY;
      });

      async function status() {
        const res = await agent.onRequest(new Request("https://do/"));
        return (await res.json()) as { exists: boolean; createdAt: number | null };
      }

      it("is not created, saved or indexed just by opening it", async () => {
        const client = connectYjsClient();
        expect(await status()).toEqual({ exists: false, createdAt: null });
        expect(mockSqlStore.has("state")).toBe(false);
        expect(index.registeredPages()).toEqual([]);
        cleanup(client);
      });

      it("is not created by an empty paragraph or whitespace", async () => {
        const client = connectYjsClient();
        addLine(client, "");
        addLine(client, "   \t ");
        await agent.reindex();
        expect(await status()).toEqual({ exists: false, createdAt: null });
        expect(mockSqlStore.has("state")).toBe(false);
        expect(updates).toEqual([]);
        cleanup(client);
      });

      it("is created, saved, registered and indexed by its first real text", async () => {
        const client = connectYjsClient();
        addLine(client, "First thought of the day");
        await Promise.resolve();

        const now = await status();
        expect(now.exists).toBe(true);
        expect(now.createdAt).toEqual(expect.any(Number));
        expect(mockSqlStore.has("state")).toBe(true);
        expect(client.doc.getMap("meta").get("version")).toBe(DOC_FORMAT_VERSION);
        await vi.waitFor(() => expect(index.registeredPages()).toEqual([DAY]));
        expect(reindexes().length).toBeGreaterThan(0);
        await agent.reindex();
        expect(index.getPage(DAY)).toMatchObject({ kind: "journal", title: "Oct 26th, 2026", hasContent: true });
        cleanup(client);
      });

      it("saves the whole document, including what was there before the first text", async () => {
        const client = connectYjsClient();
        addLine(client, "");
        addLine(client, "Now with text");
        const fresh = new DocumentAgent({} as never, {} as never);
        (fresh as unknown as { name: string }).name = DAY;
        const reopened = connectYjsClient(fresh);
        expect(reopened.doc.getXmlFragment("default").toString()).toContain("Now with text");
        cleanup(client, reopened);
      });

      it("is created once when two tabs type the first letter at the same time", async () => {
        const a = connectYjsClient();
        const b = connectYjsClient();
        addLine(a, "A");
        addLine(b, "B");
        const first = (await status()).createdAt;
        addLine(a, "more");
        expect((await status()).createdAt).toBe(first);
        expect(a.doc.getXmlFragment("default").toString()).toContain("B");
        expect(b.doc.getXmlFragment("default").toString()).toContain("A");
        await vi.waitFor(() => expect(index.registeredPages()).toEqual([DAY]));
        cleanup(a, b);
      });

      it("still syncs between tabs before it is created", async () => {
        const a = connectYjsClient();
        const b = connectYjsClient();
        addLine(a, "");
        expect(b.doc.getXmlFragment("default").length).toBe(1);
        cleanup(a, b);
      });

      it("removes a title a browser tries to give it", async () => {
        const client = connectYjsClient();
        addLine(client, "written");
        vi.spyOn(console, "warn").mockImplementation(() => {});
        client.doc.getMap("meta").set("title", "Not a date");
        expect(client.doc.getMap("meta").has("title")).toBe(false);
        expect(await agent.rename("Not a date")).toEqual({ ok: false, code: "journal" });
        cleanup(client);
        vi.restoreAllMocks();
      });
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

