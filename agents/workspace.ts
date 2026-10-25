import { Agent } from "agents";
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

class WorkspaceAgent extends Agent {
  private _index: WorkspaceIndex | null = null;

  private get index(): WorkspaceIndex {
    this._index ??= new WorkspaceIndex(durableSql(this.ctx.storage));
    return this._index;
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

  async currentSlug(pageId: string) {
    return this.index.currentSlug(pageId);
  }

  async resolveSlug(slug: string) {
    return this.index.resolveSlug(slug);
  }

  async findByTitle(title: string, exceptId?: string) {
    return this.index.findByTitle(title, exceptId);
  }

  async backlinks(targetId: string) {
    return this.index.backlinks(targetId);
  }

  async searchTitles(query: string, limit?: number) {
    return this.index.searchTitles(query, limit);
  }

  async search(query: string, limit?: number) {
    return this.index.search(query, limit);
  }

  async tasks(states?: TaskState[]) {
    return this.index.tasks(states);
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

  async registeredPages(limit?: number, after?: string) {
    return this.index.registeredPages(limit, after);
  }
}

export default WorkspaceAgent;
