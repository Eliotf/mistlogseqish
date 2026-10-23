import { DatabaseSync } from "node:sqlite";
import type { SqlDb, SqlValue, SqlRow } from "../../agents/workspace-index";

/**
 * An in-memory SQLite database behind the same interface WorkspaceIndex uses
 * on Durable Object storage, so index tests run real SQL (including FTS5).
 */
export function memoryDb(): SqlDb & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  let depth = 0;
  return {
    raw,
    exec(query: string, ...bindings: SqlValue[]): SqlRow[] {
      return raw.prepare(query).all(...bindings) as SqlRow[];
    },
    transaction<T>(fn: () => T): T {
      // Durable Object transactionSync nests; emulate with savepoints
      const name = `sp${depth++}`;
      raw.exec(`SAVEPOINT ${name}`);
      try {
        const result = fn();
        raw.exec(`RELEASE ${name}`);
        return result;
      } catch (err) {
        raw.exec(`ROLLBACK TO ${name}`);
        raw.exec(`RELEASE ${name}`);
        throw err;
      } finally {
        depth--;
      }
    },
  };
}

/** A durable-storage-shaped wrapper, for testing WorkspaceAgent itself. */
export function memoryStorage() {
  const db = memoryDb();
  return {
    db,
    storage: {
      sql: { exec: (query: string, ...bindings: SqlValue[]) => ({ toArray: () => db.exec(query, ...bindings) }) },
      transactionSync: <T>(fn: () => T): T => db.transaction(fn),
    },
  };
}
