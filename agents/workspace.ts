import { toBacklinkLine, type BacklinkSource } from "../app/lib/backlink-lines";
import type { TaskItem } from "../app/lib/tasks";
import { Agent, getAgentByName } from "agents";
import type { Connection, ConnectionContext } from "agents";
import type { TaskState } from "../app/lib/note-parser";
import { WorkspaceIndex, type SqlDb, type SqlValue, type PageUpdate } from "./workspace-index";
import { WORKSPACE_NAME } from "../app/shared/constants";

/**
 * One workspace's index (one instance, named "default", while single-user).
 * Other Durable Objects call its methods over RPC; browsers never reach it.
 * The router refuses /agents/workspace-agent/* (see isPrivateAgentPath), and
 * onRequest and onConnect refuse as a second line of defence.
 */

export { WORKSPACE_NAME };

/** Pages a rebuild re-indexes per step, and the pause between steps. */
export const REBUILD_BATCH = 10;
export const REBUILD_PAUSE_SECONDS = 1;

const PRIVATE_AGENT_PATH = /^\/agents\/workspace-agent(\/|$)/i;

/** True for request paths that must never be routed to an agent from outside. */
export function isPrivateAgentPath(pathname: string): boolean {
  return PRIVATE_AGENT_PATH.test(pathname);
}

function durableSql(storage: DurableObjectStorage): SqlDb {
  return {
    exec: (query: string, ...bindings: SqlValue[]) => storage.sql.exec(query, ...bindings).toArray(),
    transaction: <T>(fn: () => T): T => storage.transactionSync(fn),
  };
}

class WorkspaceAgent extends Agent<Env> {
  private _index: WorkspaceIndex | null = null;
  /** Whether this instance has looked for pages to rebuild since it woke. */
  private rebuildChecked = false;

  private get index(): WorkspaceIndex {
    this._index ??= new WorkspaceIndex(durableSql(this.ctx.storage));
    if (!this.rebuildChecked) {
      this.rebuildChecked = true;
      this.startRebuildIfNeeded(this._index);
    }
    return this._index;
  }

  /**
   * Rebuild (M1 chunk 1.6): after a parser change, or for registered pages
   * never indexed, ask each such page's DocumentAgent to send its lines again,
   * a batch at a time through this.schedule() (never a repeating timer, so
   * the object still sleeps). Nothing is cleared first, so search, backlinks
   * and titles keep working; each page's rows are replaced as it reports.
   * Checked once each time the object wakes; a page that fails is retried by
   * the next pass, and a pass whose next step was lost (a step that failed
   * before scheduling it) is resumed. Never throws.
   */
  private startRebuildIfNeeded(index: WorkspaceIndex): void {
    try {
      const cursor = index.rebuildCursor();
      if (cursor !== null) {
        // A pass is running: it continues through its own schedule, unless that was lost
        if (this.getSchedules().some((task) => task.callback === "rebuildStep")) return;
      } else {
        if (index.refreshCount() === 0) return;
        index.setRebuildCursor("");
      }
      this.schedule(REBUILD_PAUSE_SECONDS, "rebuildStep").catch((err: unknown) => {
        console.error("Could not schedule the index rebuild", err);
      });
    } catch (err) {
      console.error("Could not check for an index rebuild", err);
    }
  }

  /** One rebuild step: re-index the next batch of pages, then schedule the next step. */
  async rebuildStep(): Promise<void> {
    // A running step is the pass itself: it must not check for (and start) another
    this.rebuildChecked = true;
    const index = this.index;
    const cursor = index.rebuildCursor();
    if (cursor === null) return;
    const batch = index.pagesToRefresh(REBUILD_BATCH, cursor);
    if (batch.length === 0) {
      index.setRebuildCursor(null);
      return;
    }
    for (const pageId of batch) {
      try {
        const doc = await getAgentByName(this.env.DocumentAgent, pageId);
        await doc.refreshIndex();
      } catch (err) {
        console.error(`Rebuild could not re-index ${pageId}`, err);
      }
    }
    index.setRebuildCursor(batch[batch.length - 1]);
    await this.schedule(REBUILD_PAUSE_SECONDS, "rebuildStep");
  }

  /** How many pages the index is still catching up on (shown where results may be incomplete). */
  async indexStatus(): Promise<{ pending: number }> {
    return { pending: this.index.refreshCount() };
  }

  async onRequest(_request: Request): Promise<Response> {
    return new Response("Not found", { status: 404 });
  }

  async onConnect(connection: Connection, _ctx: ConnectionContext) {
    connection.close(1008, "Not available");
  }

  async registerPage(pageId: string, createdAt: number) {
    this.index.registerPage(pageId, createdAt);
  }

  async updatePage(update: PageUpdate) {
    return this.index.updatePage(update);
  }

  async getPage(pageId: string) {
    return this.index.getPage(pageId);
  }

  async pagesByIds(pageIds: string[]) {
    return this.index.pagesByIds(pageIds);
  }

  async currentSlug(pageId: string) {
    return this.index.currentSlug(pageId);
  }

  async resolveSlug(slug: string) {
    return this.index.resolveSlug(slug);
  }

  async claimTitle(pageId: string, title: string, at: number) {
    return this.index.claimTitle(pageId, title, at);
  }

  async findByTitle(title: string, exceptId?: string) {
    return this.index.findByTitle(title, exceptId);
  }

  /**
   * Linked references, with each line reduced to its text and link
   * positions: RPC results must be serialisable, and the stored marks'
   * other attributes are not needed.
   */
  async backlinks(targetId: string): Promise<BacklinkSource[]> {
    return this.index.backlinks(targetId).map((b) => ({
      sourceId: b.sourceId,
      sourceTitle: b.sourceTitle,
      sourceKind: b.sourceKind,
      lines: b.lines.map(({ line, content }) => toBacklinkLine(line, content)),
    }));
  }

  async searchTitles(query: string, limit?: number) {
    return this.index.searchTitles(query, limit);
  }

  async search(query: string, limit?: number) {
    return this.index.search(query, limit);
  }

  /** Tasks as the Tasks view shows them; lines reduced like linked references, so the result is serialisable. */
  async tasks(states?: TaskState[]): Promise<TaskItem[]> {
    return this.index.tasks(states).map((t) => ({
      pageId: t.pageId,
      pageTitle: t.pageTitle,
      pageKind: t.pageKind,
      updatedAt: t.updatedAt,
      state: t.state,
      priority: t.priority,
      blockId: t.blockId,
      // Rows from before schema 3 have no stored line: rebuild a plain one from the keyword and text
      line: t.content ? toBacklinkLine(t.line, t.content) : { line: t.line, text: `${t.state} ${t.text}`, links: [] },
    }));
  }

  async journals(limit?: number, before?: string) {
    return this.index.journals(limit, before);
  }

  async staleCount() {
    return this.index.staleCount();
  }

  async clearDerived() {
    this.index.clearDerived();
  }

  /** Only DocumentAgent.deletePage calls this, holding the page's index lock. Returns the title it had. */
  async deletePage(pageId: string, at: number) {
    return this.index.deletePage(pageId, at);
  }

  async importCheck(keys: string[], dates: string[]) {
    return this.index.importCheck(keys, dates);
  }

  async allPages() {
    return this.index.allPages();
  }

  async registeredPages(limit?: number, after?: string) {
    return this.index.registeredPages(limit, after);
  }
}

export default WorkspaceAgent;
