import { Agent, getAgentByName } from "agents";
import type { Connection, ConnectionContext, WSMessage } from "agents";
import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import { MSG_SYNC, MSG_AWARENESS, DOC_FORMAT_VERSION, CLOSE_OUTDATED_CLIENT, clientUnderstandsFormat } from "../app/shared/constants";
import { linesFromYjs } from "../app/lib/note-lines";
import { PARSER_VERSION } from "../app/lib/note-parser";
import { isJournalId, isPageId } from "../app/lib/note-ids";
import { normalizeTitle, type DocumentRenameResult } from "../app/lib/page-title";
import { WORKSPACE_NAME } from "./workspace";

/**
 * Durable Objects SQLite accepts Uint8Array for BLOB columns via the
 * template literal API, but the type signature expects string. This
 * helper makes the cast explicit and grep-able.
 */
function sqlBlob(data: Uint8Array): string {
  return data as unknown as string;
}

/**
 * Awareness (who is here, where their cursor is) for relaying between
 * browsers. y-protocols' Awareness runs a 3-second setInterval to expire
 * stale states, and a Durable Object with a pending timer can never
 * hibernate, so every open page would be billed for its whole time open.
 * Stop that timer: browsers expire stale states themselves after 30 s, and
 * onClose removes a departing browser's state. Never add repeating timers
 * to a Durable Object (AGENTS.md).
 */
export function createRelayAwareness(doc: Y.Doc): awarenessProtocol.Awareness {
  const awareness = new awarenessProtocol.Awareness(doc);
  clearInterval((awareness as unknown as { _checkInterval: ReturnType<typeof setInterval> })._checkInterval);
  return awareness;
}

/** Yjs transaction origin for updates received from browsers. */
const CLIENT_ORIGIN = Symbol("client");
/** Yjs transaction origin for changes the server makes itself, which it broadcasts. */
const SERVER_ORIGIN = Symbol("server");

/**
 * Backup: seconds from the first unindexed edit to a persisted reindex. It
 * survives the object being evicted; normally the in-memory timer below has
 * already indexed by then and the backup finds nothing to do.
 */
export const INDEX_DELAY_SECONDS = 2;
/** Reindex this long after the last edit (a pause in typing)... */
export const INDEX_PAUSE_MS = 300;
/** ...or this long after the first unindexed edit, whichever comes first. */
export const INDEX_MAX_WAIT_MS = 2000;
/** Seconds to wait before each retry after a failed index update; the last repeats. */
export const INDEX_RETRY_SECONDS = [5, 30, 120, 600];

/** What this document knows about its entry in the workspace index. */
interface IndexState {
  /** Edits not yet sent to the index. */
  dirty: boolean;
  /** The last updatedAt sent. Each update is strictly later, so the index can ignore stale retries. */
  lastSent: number;
  /** The index's last acknowledgement. */
  ack: { updatedAt: number; parserVersion: number } | null;
  /** Failed attempts since the last success. */
  retries: number;
}

const NEW_INDEX_STATE: IndexState = { dirty: false, lastSent: 0, ack: null, retries: 0 };

const OUTDATED_REASON = "Mistlog was updated. Reload to keep editing.";
const DOCUMENT_SOCKET_PATH = /^\/agents\/document-agent\/[^/]+$/;

/** A WebSocket to a document from code older than DOC_FORMAT_VERSION. */
export function isOutdatedEditorRequest(request: Request): boolean {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return false;
  if (!DOCUMENT_SOCKET_PATH.test(new URL(request.url).pathname)) return false;
  return !clientUnderstandsFormat(request.url);
}

/** Accept the WebSocket and close it at once with CLOSE_OUTDATED_CLIENT, so the browser learns why. */
export function refuseOutdatedEditor(): Response {
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(CLOSE_OUTDATED_CLIENT, OUTDATED_REASON);
  return new Response(null, { status: 101, webSocket: client });
}

class DocumentAgent extends Agent {
  private doc: Y.Doc | null = null;
  private awareness: awarenessProtocol.Awareness | null = null;
  /** A reindex is scheduled. Lost on restart, so markForIndex also runs on connect. */
  private reindexPending = false;
  /** In-memory timer for indexing soon after a pause; lost on eviction (the backup schedule covers that). */
  private pauseTimer: ReturnType<typeof setTimeout> | null = null;
  /** When the current burst of unindexed edits started, for the maximum wait. */
  private burstStartedAt = 0;
  /**
   * Serialises reindex and rename. A rename claims its title only after any
   * reindex in flight has finished, so no reindex with the old title can
   * reach the index after the claim (docs/technical-architecture.md).
   */
  private indexLock: Promise<void> = Promise.resolve();
  /** The title the server last approved; browsers cannot change meta.title. */
  private approvedTitle: unknown = undefined;

  private ensureInitialised(): { doc: Y.Doc; awareness: awarenessProtocol.Awareness } {
    if (this.doc && this.awareness) {
      return { doc: this.doc, awareness: this.awareness };
    }

    this.doc = new Y.Doc();
    this.awareness = createRelayAwareness(this.doc);

    // Create table if needed
    this.sql`
      CREATE TABLE IF NOT EXISTS doc_state (
        key TEXT PRIMARY KEY,
        value BLOB
      )
    `;

    // Load persisted state
    const rows = this.sql<{ value: ArrayBuffer }>`
      SELECT value FROM doc_state WHERE key = 'state'
    `;

    if (rows.length > 0 && rows[0].value) {
      const state = new Uint8Array(rows[0].value);
      Y.applyUpdate(this.doc, state);
    }

    const meta = this.doc.getMap<unknown>("meta");
    this.approvedTitle = meta.get("title");

    // Persist on every update, then queue it for the workspace index.
    // Browsers' updates are relayed by onMessage; the server's own changes
    // (such as a rename, or reverting a browser's title change) are sent here.
    this.doc.on("update", (update: Uint8Array, origin: unknown) => {
      if (origin !== CLIENT_ORIGIN) this.broadcastUpdate(update);
      // A journal is created by its first real text; until then nothing is saved
      if (this.isUncreatedJournal() && !this.createJournalIfWritten()) return;
      const state = Y.encodeStateAsUpdate(this.doc!);
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('state', ${sqlBlob(state)})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
      this.markForIndex();
    });

    // Only the server sets the title (rename, after the index claims it), so
    // titles stay unique. A browser's change to it is reverted for everyone.
    // A server change reindexes at once instead of on the 2-second throttle.
    meta.observe((event) => {
      if (!event.keysChanged.has("title")) return;
      if (event.transaction.origin === CLIENT_ORIGIN) {
        console.warn("Reverted a title change made outside rename");
        const approved = this.approvedTitle;
        this.doc!.transact(() => {
          if (approved === undefined) meta.delete("title");
          else meta.set("title", approved);
        }, SERVER_ORIGIN);
        return;
      }
      this.approvedTitle = meta.get("title");
      this.reindexNow();
    });

    return { doc: this.doc, awareness: this.awareness };
  }

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    // Second line of defence (the Worker refuses these first): an editor from
    // before the current document format would delete text it does not
    // understand, so it gets nothing.
    if (!clientUnderstandsFormat(ctx.request.url)) {
      connection.close(CLOSE_OUTDATED_CLIENT, OUTDATED_REASON);
      return;
    }
    const { doc, awareness } = this.ensureInitialised();

    // Send SyncStep1 to the new client
    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, doc);
    connection.send(encoding.toUint8Array(syncEncoder));

    // Send SyncStep2 (full state) to the new client
    const stateEncoder = encoding.createEncoder();
    encoding.writeVarUint(stateEncoder, MSG_SYNC);
    syncProtocol.writeSyncStep2(stateEncoder, doc);
    connection.send(encoding.toUint8Array(stateEncoder));

    // Send current awareness states to the new client
    const awarenessStates = awareness.getStates();
    if (awarenessStates.size > 0) {
      const clients = Array.from(awarenessStates.keys());
      const update = awarenessProtocol.encodeAwarenessUpdate(awareness, clients);
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(awarenessEncoder, update);
      connection.send(encoding.toUint8Array(awarenessEncoder));
    }

    // Only after the client has the document, so indexing can never block it
    this.indexOnOpen();
  }

  /**
   * Index on open if never indexed (Mist-era documents), indexed by an older
   * parser, or left with unsent edits by a restart. Never throws.
   */
  private indexOnOpen(): void {
    try {
      if (!this.isIndexable()) return;
      const indexState = this.readIndexState();
      if (!indexState.ack || indexState.ack.parserVersion < PARSER_VERSION || indexState.dirty) {
        this.markForIndex();
      }
    } catch (err) {
      console.error("indexOnOpen failed", err);
    }
  }

  async onMessage(connection: Connection, message: WSMessage) {
    if (typeof message === "string") {
      // JSON control messages — reserved for future use
      return;
    }

    const { doc, awareness } = this.ensureInitialised();

    const data =
      message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : new Uint8Array(
            (message as Uint8Array).buffer,
            (message as Uint8Array).byteOffset,
            (message as Uint8Array).byteLength,
          );
    const decoder = decoding.createDecoder(data);
    const msgType = decoding.readVarUint(decoder);

    switch (msgType) {
      case MSG_SYNC: {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, doc, CLIENT_ORIGIN);

        // If there's a response (e.g. SyncStep2 reply), send it back
        if (encoding.length(encoder) > 1) {
          connection.send(encoding.toUint8Array(encoder));
        }

        // Broadcast the raw message to all other clients
        this.broadcastBinary(message, connection.id);
        break;
      }
      case MSG_AWARENESS: {
        const update = decoding.readVarUint8Array(decoder);
        awarenessProtocol.applyAwarenessUpdate(awareness, update, connection);

        // Broadcast awareness to all other clients
        this.broadcastBinary(message, connection.id);
        break;
      }
    }
  }

  async onClose(
    connection: Connection,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ) {
    if (this.awareness) {
      // Remove this client's awareness state
      awarenessProtocol.removeAwarenessStates(
        this.awareness,
        // Agents SDK uses string IDs; awareness protocol expects numbers.
      // The protocol converts via toString() internally, so this is safe.
      [connection.id as unknown as number],
        null,
      );
    }
  }

  // No alarm() override: documents never expire. Documents created before
  // the 99-hour expiry was removed still have a deletion alarm scheduled;
  // the Agents SDK's own alarm() handles it and finds nothing to run.
  // Use this.schedule() for timed work, and never delete data from an alarm.

  async onRequest(request: Request) {
    if (request.method === "POST") {
      // Create / initialise the document
      const { doc } = this.ensureInitialised();
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('exists', ${sqlBlob(new Uint8Array([1]))})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
      this.existsCache = true;

      // Stamp doc format version in Yjs metadata
      const meta = doc.getMap<number>("meta");
      if (!meta.has("version")) {
        meta.set("version", DOC_FORMAT_VERSION);
      }

      // Store creation timestamp
      const now = Date.now();
      this.sql`
        INSERT INTO doc_state (key, value) VALUES ('createdAt', ${sqlBlob(new Uint8Array(new Float64Array([now]).buffer))})
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `;
      await this.registerWithIndex(now);

      // If the request has a JSON body with content, populate the Yjs doc
      const contentType = request.headers.get("Content-Type") || "";
      if (contentType.includes("application/json")) {
        try {
          const body = await request.json() as { content?: string; threads?: unknown[]; onboarding?: boolean };
          if (body.content) {
            // Parse CriticMarkup and apply as marks on XmlText
            const { parseCriticMarkupToContent } = await import("../app/lib/critic-parser");
            const frag = doc.getXmlFragment("default");
            if (frag.length === 0) {
              const lines = body.content.split("\n");
              for (const line of lines) {
                const { cleanText, marks } = parseCriticMarkupToContent(line);
                const para = new Y.XmlElement("paragraph");
                const ytext = new Y.XmlText(cleanText);
                // Apply marks via Yjs formatting attributes
                for (const mark of marks) {
                  const attrs: Record<string, Record<string, unknown>> = {};
                  attrs[mark.type] = mark.attrs ?? {};
                  ytext.format(mark.from, mark.to - mark.from, attrs);
                }
                para.insert(0, [ytext]);
                frag.insert(frag.length, [para]);
              }
            }
          }
          if (body.threads && Array.isArray(body.threads)) {
            const threadsMap = doc.getMap<string>("threads");
            for (const thread of body.threads) {
              const t = thread as { id?: string };
              if (t.id) {
                threadsMap.set(t.id, JSON.stringify(thread));
              }
            }
          }
          if (body.onboarding) {
            const docState = doc.getMap<string>("docState");
            docState.set("onboarding", "true");
          }
        } catch (err) {
          // If it's an unsupported CriticMarkup error, return it
          if (err instanceof Error && err.message.includes("Unsupported CriticMarkup")) {
            return new Response(JSON.stringify({ ok: false, error: err.message }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          // Ignore other malformed JSON — document is still created
        }
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (request.method === "GET") {
      // Check whether this document exists
      this.ensureInitialised();
      const rows = this.sql<{ value: ArrayBuffer }>`
        SELECT value FROM doc_state WHERE key = 'exists'
      `;
      const exists = rows.length > 0;

      const createdAtRows = this.sql<{ value: ArrayBuffer }>`
        SELECT value FROM doc_state WHERE key = 'createdAt'
      `;
      const createdAt =
        createdAtRows.length > 0
          ? new Float64Array(createdAtRows[0].value)[0]
          : null;

      return new Response(JSON.stringify({ exists, createdAt }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  /* ---------- Journals (docs/technical-architecture.md, "Journal Pages") ---------- */

  /** Cached 'exists' marker; null until read. */
  private existsCache: boolean | null = null;

  private exists(): boolean {
    this.existsCache ??= this.sql<{ value: ArrayBuffer }>`SELECT value FROM doc_state WHERE key = 'exists'`.length > 0;
    return this.existsCache;
  }

  /** A journal day nobody has written in yet. It has no POST: it is created by its first text. */
  private isUncreatedJournal(): boolean {
    return isJournalId(this.name) && !this.exists();
  }

  /**
   * Create this journal if its document now has real text: mark it as
   * existing, record when, stamp the format version and register it with the
   * index. Opening a day, or the editor adding an empty paragraph, does not
   * count. Returns whether the journal exists now.
   */
  private createJournalIfWritten(): boolean {
    const hasText = linesFromYjs(this.doc!.getXmlFragment("default")).some((line) => line.text.trim() !== "");
    if (!hasText) return false;
    const now = Date.now();
    this.sql`
      INSERT INTO doc_state (key, value) VALUES ('exists', ${sqlBlob(new Uint8Array([1]))})
      ON CONFLICT(key) DO NOTHING
    `;
    this.sql`
      INSERT INTO doc_state (key, value) VALUES ('createdAt', ${sqlBlob(new Uint8Array(new Float64Array([now]).buffer))})
      ON CONFLICT(key) DO NOTHING
    `;
    this.existsCache = true;
    const meta = this.doc!.getMap<unknown>("meta");
    if (!meta.has("version")) this.doc!.transact(() => meta.set("version", DOC_FORMAT_VERSION), SERVER_ORIGIN);
    void this.registerWithIndex(now);
    return true;
  }

  /* ---------- Workspace index (docs/technical-architecture.md) ---------- */

  /** Only documents created through POST, with a valid page ID, are indexed. */
  private isIndexable(): boolean {
    return isPageId(this.name) && this.exists();
  }

  private readIndexState(): IndexState {
    const rows = this.sql<{ value: ArrayBuffer }>`SELECT value FROM doc_state WHERE key = 'index'`;
    if (!rows.length) return { ...NEW_INDEX_STATE };
    try {
      return { ...NEW_INDEX_STATE, ...(JSON.parse(new TextDecoder().decode(rows[0].value)) as Partial<IndexState>) };
    } catch {
      return { ...NEW_INDEX_STATE };
    }
  }

  private writeIndexState(state: IndexState): void {
    const value = new TextEncoder().encode(JSON.stringify(state));
    this.sql`
      INSERT INTO doc_state (key, value) VALUES ('index', ${sqlBlob(value)})
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `;
  }

  /** Note unsent edits and make sure a reindex is scheduled. Never throws. */
  private markForIndex(): void {
    try {
      if (!this.isIndexable()) return;
      const state = this.readIndexState();
      if (!state.dirty) this.writeIndexState({ ...state, dirty: true });
      this.scheduleReindex(INDEX_DELAY_SECONDS);
      // While retrying after a failure, leave it to the backoff schedule
      if (state.retries === 0) this.armPauseTimer();
    } catch (err) {
      console.error("markForIndex failed", err);
    }
  }

  /**
   * Index INDEX_PAUSE_MS after the last edit, but no later than
   * INDEX_MAX_WAIT_MS after the first unindexed edit, so continuous typing
   * still reaches the index every couple of seconds.
   */
  private armPauseTimer(): void {
    const now = Date.now();
    if (this.pauseTimer === null) this.burstStartedAt = now;
    else clearTimeout(this.pauseTimer);
    const delay = Math.max(0, Math.min(INDEX_PAUSE_MS, this.burstStartedAt + INDEX_MAX_WAIT_MS - now));
    this.pauseTimer = setTimeout(() => {
      this.pauseTimer = null;
      this.reindex().catch((err: unknown) => console.error("Reindex after pause failed", err));
    }, delay);
  }

  /** Reindex immediately instead of waiting for the throttle. Never throws. */
  private reindexNow(): void {
    try {
      if (!this.isIndexable()) return;
      // Yjs runs map observers before the doc's update event, so mark the edit here
      const state = this.readIndexState();
      if (!state.dirty) this.writeIndexState({ ...state, dirty: true });
    } catch (err) {
      console.error("reindexNow failed", err);
      return;
    }
    this.reindex().catch((err: unknown) => console.error("Immediate reindex failed", err));
  }

  private scheduleReindex(seconds: number): void {
    if (this.reindexPending) return;
    this.reindexPending = true;
    this.schedule(seconds, "reindex").catch((err: unknown) => {
      this.reindexPending = false;
      console.error("Could not schedule reindex", err);
    });
  }

  private withIndexLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.indexLock.then(fn);
    this.indexLock = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /**
   * Rename this page. Called by the /api/rename route. Holding the index
   * lock, ask the index to claim the title (unique across pages and
   * journals), and only then write meta.title, which syncs to every tab.
   * Throws if the index cannot be reached; the title is then unchanged.
   */
  async rename(rawTitle: string): Promise<DocumentRenameResult> {
    const { doc } = this.ensureInitialised();
    if (isJournalId(this.name)) return { ok: false, code: "journal" };
    if (!this.isIndexable()) return { ok: false, code: "missing" };
    const result = normalizeTitle(rawTitle);
    if (!result.ok) return { ok: false, code: "invalid", reason: result.reason };

    return this.withIndexLock(async (): Promise<DocumentRenameResult> => {
      const index = await getAgentByName(this.env.WorkspaceAgent, WORKSPACE_NAME);
      const claim = await index.claimTitle(this.name, result.title, Date.now());
      if (!claim.ok) {
        return claim.reason === "taken"
          ? { ok: false, code: "taken", holderTitle: claim.holder.title }
          : { ok: false, code: claim.reason };
      }
      const meta = doc.getMap<unknown>("meta");
      if (meta.get("title") !== result.title) {
        doc.transact(() => meta.set("title", result.title), SERVER_ORIGIN);
      }
      return { ok: true, title: result.title, slug: claim.slug };
    });
  }

  /**
   * Send this document to the workspace index. Called by the Agents SDK
   * scheduler. Edits made while the call is in flight set dirty again and
   * schedule the next round. A failure retries with backoff and never
   * affects editing or sync. Runs under the index lock.
   */
  async reindex(): Promise<void> {
    return this.withIndexLock(() => this.reindexLocked());
  }

  private async reindexLocked(): Promise<void> {
    this.reindexPending = false;
    const { doc } = this.ensureInitialised();
    if (!this.isIndexable()) return;
    const before = this.readIndexState();
    if (!before.dirty) return;

    const updatedAt = Math.max(Date.now(), before.lastSent + 1);
    this.writeIndexState({ ...before, dirty: false, lastSent: updatedAt });
    const title = doc.getMap<unknown>("meta").get("title");

    try {
      const index = await getAgentByName(this.env.WorkspaceAgent, WORKSPACE_NAME);
      const ack = await index.updatePage({
        pageId: this.name,
        title: typeof title === "string" ? title : "",
        updatedAt,
        lines: linesFromYjs(doc.getXmlFragment("default")),
      });
      const now = this.readIndexState();
      // If the index held something newer (lost local state), send again after it
      const stale = !ack.applied;
      this.writeIndexState({
        ...now,
        dirty: now.dirty || stale,
        lastSent: Math.max(now.lastSent, ack.updatedAt),
        ack: { updatedAt: ack.updatedAt, parserVersion: ack.parserVersion },
        retries: 0,
      });
      if (now.dirty || stale) this.scheduleReindex(INDEX_DELAY_SECONDS);
    } catch (err) {
      // Back off: no fast reindex until a scheduled retry succeeds
      if (this.pauseTimer !== null) {
        clearTimeout(this.pauseTimer);
        this.pauseTimer = null;
      }
      const now = this.readIndexState();
      const retries = now.retries + 1;
      this.writeIndexState({ ...now, dirty: true, retries });
      console.error(`Index update failed (attempt ${retries})`, err);
      this.scheduleReindex(INDEX_RETRY_SECONDS[Math.min(retries, INDEX_RETRY_SECONDS.length) - 1]);
    }
  }

  /** Record this new document in the index's registry. A failure is logged; the first reindex registers it too. */
  private async registerWithIndex(createdAt: number): Promise<void> {
    if (!isPageId(this.name)) return;
    try {
      const index = await getAgentByName(this.env.WorkspaceAgent, WORKSPACE_NAME);
      await index.registerPage(this.name, createdAt);
    } catch (err) {
      console.error("Could not register with the workspace index", err);
    }
  }

  /** Send a change the server made to every connected browser. */
  private broadcastUpdate(update: Uint8Array) {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);
    for (const conn of this.getConnections()) conn.send(message);
  }

  private broadcastBinary(message: WSMessage, excludeId: string) {
    // Make a clean copy to avoid ArrayBufferView offset issues
    const bytes =
      message instanceof ArrayBuffer
        ? new Uint8Array(message)
        : new Uint8Array(
            (message as Uint8Array).buffer,
            (message as Uint8Array).byteOffset,
            (message as Uint8Array).byteLength,
          );
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    for (const conn of this.getConnections()) {
      if (conn.id !== excludeId) {
        conn.send(buf);
      }
    }
  }
}

export default DocumentAgent;
