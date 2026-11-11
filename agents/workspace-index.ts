import { titleKey } from "../app/lib/page-title";
import type { AllPagesRow } from "../app/lib/all-pages";
import { parseNote, PARSER_VERSION, type DocLine, type TaskPriority, type TaskState } from "../app/lib/note-parser";
import { isJournalId, isJournalTitle, isPageId, journalTitle, parseJournalDate } from "../app/lib/note-ids";
import { slugify } from "../app/lib/slug";
import type { ImportRecord, StartImportResult, StartUndoResult } from "../app/lib/import-lines";

/**
 * The workspace index: everything cross-page features query (backlinks,
 * `[[` autocomplete, search, Tasks, the journal feed). It is derived from
 * documents and can be rebuilt from them, except the page registry, which
 * is the list of pages to rebuild from. See docs/technical-architecture.md,
 * "Workspace Index".
 *
 * Written against a small SQL interface so tests can run it on Node's
 * SQLite; WorkspaceAgent adapts Durable Object storage to it.
 *
 * Permissions: single user for now, so no query filters by viewer. Sharing
 * (M4) must add viewer filtering to every query here (AGENTS.md invariant 5).
 */

export type SqlValue = string | number | null;
// Durable Object storage can return BLOBs as ArrayBuffer; this index stores none.
export type SqlRow = Record<string, SqlValue | ArrayBuffer>;

export interface SqlDb {
  exec(query: string, ...bindings: SqlValue[]): SqlRow[];
  transaction<T>(fn: () => T): T;
}

export const SCHEMA_VERSION = 6;

/** Durable Object SQLite's limit on bound parameters in one query. */
const MAX_BOUND_PARAMS = 100;

// Version 1, as shipped in chunk 1.4. Never edit: later versions migrate
// from it (MIGRATIONS). One statement per entry, because Node's SQLite
// prepares a single statement at a time.
export const SCHEMA_V1: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  // Never cleared by a rebuild: it is how a rebuild finds every page.
  `CREATE TABLE IF NOT EXISTS registry (page_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS pages (
    page_id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    title TEXT NOT NULL,
    title_key TEXT NOT NULL,
    journal_date TEXT,
    has_content INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    parser_version INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS pages_title_key ON pages (title_key)`,
  `CREATE INDEX IF NOT EXISTS pages_journal_date ON pages (journal_date)`,
  `CREATE TABLE IF NOT EXISTS links (
    source_id TEXT NOT NULL,
    target_id TEXT NOT NULL,
    line INTEGER NOT NULL,
    content TEXT NOT NULL,
    PRIMARY KEY (source_id, target_id, line)
  )`,
  `CREATE INDEX IF NOT EXISTS links_target ON links (target_id)`,
  `CREATE TABLE IF NOT EXISTS tags (page_id TEXT NOT NULL, tag_key TEXT NOT NULL, name TEXT NOT NULL, line INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS tags_page ON tags (page_id)`,
  `CREATE INDEX IF NOT EXISTS tags_key ON tags (tag_key)`,
  `CREATE TABLE IF NOT EXISTS tasks (
    page_id TEXT NOT NULL,
    line INTEGER NOT NULL,
    state TEXT NOT NULL,
    indent INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (page_id, line)
  )`,
  `CREATE INDEX IF NOT EXISTS tasks_state ON tasks (state)`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(page_id UNINDEXED, title, body, tokenize = 'unicode61 remove_diacritics 2')`,
];

/**
 * Each entry upgrades the index by one version: MIGRATIONS[0] takes it from
 * 1 to 2, and so on. Append only; never edit an entry that has shipped.
 */
const MIGRATIONS: Array<(db: SqlDb) => void> = [
  // 1 -> 2: readable URLs (chunk 2.1b). Give every titled page its slug.
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS slugs (slug TEXT PRIMARY KEY, page_id TEXT NOT NULL, current INTEGER NOT NULL)`);
    db.exec(`CREATE INDEX IF NOT EXISTS slugs_page ON slugs (page_id)`);
    const titled = db.exec(`SELECT page_id, title FROM pages WHERE kind = 'page' AND title != '' ORDER BY page_id`);
    for (const row of titled) assignSlug(db, row.page_id as string, row.title as string);
  },
  // 2 -> 3: the Tasks view (M2b.1f) opens a task zoomed into its line and shows it like a
  // linked reference. Older rows get these when their page is next indexed.
  (db) => {
    db.exec(`ALTER TABLE tasks ADD COLUMN block_id TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN priority TEXT`);
    db.exec(`ALTER TABLE tasks ADD COLUMN content TEXT`);
  },
  // 3 -> 4: deleting pages (F21). A deleted page leaves the registry, so a
  // rebuild never brings it back; this records it (its storage is kept, so a
  // later Trash can restore it).
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS deleted_pages (page_id TEXT PRIMARY KEY, title TEXT NOT NULL, deleted_at INTEGER NOT NULL)`);
  },
  // 4 -> 5: Logseq import (F31). Which documents an import wrote to and which
  // pages it created, so it can be undone. Not derived from documents: like
  // the registry, a rebuild never clears it.
  (db) => {
    db.exec(`CREATE TABLE IF NOT EXISTS imports (import_id TEXT PRIMARY KEY, state TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER)`);
    db.exec(`CREATE TABLE IF NOT EXISTS import_pages (import_id TEXT NOT NULL, page_id TEXT NOT NULL, created INTEGER NOT NULL, PRIMARY KEY (import_id, page_id))`);
  },
  // 5 -> 6: more than one import (F31). Each keeps the name of its folder, so
  // the list of imports can tell them apart. Older imports have none.
  (db) => {
    db.exec(`ALTER TABLE imports ADD COLUMN label TEXT`);
  },
];

// Rebuilt from documents. Not listed, so never cleared: registry (how a
// rebuild finds pages) and slugs (old slugs are not recorded in documents,
// and old links must keep redirecting).
const DERIVED_TABLES = ["pages", "links", "tags", "tasks", "pages_fts"];

/**
 * Give a page the slug for its title and return it, keeping its old slugs as
 * redirects. A slug another page currently holds gets a short ID suffix; a
 * slug that is only another page's old redirect is taken over, since a real
 * title beats a leftover redirect. Returns null for titles with no letters
 * or digits, which keep the /docs/<id> address.
 */
function assignSlug(db: SqlDb, pageId: string, title: string): string | null {
  const base = slugify(title);
  if (!base) {
    db.exec(`UPDATE slugs SET current = 0 WHERE page_id = ?`, pageId);
    return null;
  }
  const candidates = [base, `${base}-${pageId.slice(0, 4)}`, `${base}-${pageId}`];
  const held = db.exec(`SELECT slug FROM slugs WHERE page_id = ? AND current = 1`, pageId)[0]?.slug as string | undefined;
  // Re-indexing an unchanged title keeps the same slug, even a suffixed one
  if (held && candidates.includes(held)) return held;
  for (const slug of candidates) {
    const owner = db.exec(`SELECT page_id, current FROM slugs WHERE slug = ?`, slug)[0];
    if (owner && owner.page_id !== pageId && owner.current === 1) continue;
    db.exec(`UPDATE slugs SET current = 0 WHERE page_id = ?`, pageId);
    db.exec(
      `INSERT INTO slugs (slug, page_id, current) VALUES (?, ?, 1)
       ON CONFLICT (slug) DO UPDATE SET page_id = excluded.page_id, current = 1`,
      slug, pageId,
    );
    return slug;
  }
  // Unreachable: the last candidate contains the page's own unique ID
  throw new Error(`No free slug for ${pageId}`);
}

export type ClaimResult =
  | { ok: true; title: string; slug: string | null }
  | { ok: false; reason: "taken"; holder: { pageId: string; title: string } }
  | { ok: false; reason: "journal" | "journal-title" };

export interface ResolvedSlug {
  pageId: string;
  /** Whether the requested slug is the page's current one (false means redirect). */
  current: boolean;
  /** The page's current slug, or null if it has none (use /docs/<id>). */
  currentSlug: string | null;
}

/** Markers around matched words in search snippets; the UI turns them into highlights. */
export const SNIPPET_START = "\u0002";
export const SNIPPET_END = "\u0003";

export interface PageUpdate {
  pageId: string;
  /** Ignored for journals, whose title comes from the date. */
  title: string;
  updatedAt: number;
  lines: DocLine[];
}

export interface PageUpdateAck {
  pageId: string;
  parserVersion: number;
  /** The update time the index now holds for this page. */
  updatedAt: number;
  /** False when the update was older than what the index holds, and was ignored. */
  applied: boolean;
}

export interface IndexedPage {
  pageId: string;
  kind: "page" | "journal";
  title: string;
  journalDate: string | null;
  hasContent: boolean;
  updatedAt: number;
  parserVersion: number;
}

export interface Backlink {
  sourceId: string;
  sourceTitle: string;
  sourceKind: "page" | "journal";
  lines: Array<{ line: number; content: DocLine }>;
}

export interface SearchHit {
  pageId: string;
  title: string;
  /** Matching text with SNIPPET_START / SNIPPET_END around matched words. */
  snippet: string;
}

export interface IndexedTask {
  pageId: string;
  pageTitle: string;
  pageKind: "page" | "journal";
  /** When the page was last indexed: how recent a done task is. */
  updatedAt: number;
  line: number;
  state: TaskState;
  indent: number;
  text: string;
  priority: TaskPriority | null;
  blockId: string | null;
  /** The whole line as stored, null for rows from before schema 3. */
  content: DocLine | null;
}

function toPage(row: SqlRow): IndexedPage {
  return {
    pageId: row.page_id as string,
    kind: row.kind as "page" | "journal",
    title: row.title as string,
    journalDate: (row.journal_date as string | null) ?? null,
    hasContent: row.has_content === 1,
    updatedAt: row.updated_at as number,
    parserVersion: row.parser_version as number,
  };
}

// How titles are compared for uniqueness; shared with the editor's links
export { titleKey };

/** Escape LIKE wildcards; queries use ESCAPE '\'. */
function likeEscape(s: string): string {
  return s.replace(/[\\%_]/g, (c) => "\\" + c);
}

/**
 * Turn free text into a safe FTS5 query: every word must match, the last as
 * a prefix (so results update while typing). Each word is quoted, so input
 * like `"`, `AND (` or `title:` is searched for literally instead of being
 * parsed as FTS5 syntax.
 */
export function ftsQuery(input: string): string | null {
  const words = input.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (!words.length) return null;
  return words
    .map((w, i) => `"${w.replace(/"/g, '""')}"${i === words.length - 1 ? "*" : ""}`)
    .join(" ");
}

export class WorkspaceIndex {
  constructor(private readonly db: SqlDb) {
    db.transaction(() => {
      for (const stmt of SCHEMA_V1) db.exec(stmt);
      db.exec(`INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', '1')`);
      let version = Number(db.exec(`SELECT value FROM meta WHERE key = 'schema_version'`)[0].value);
      if (version > SCHEMA_VERSION) {
        throw new Error(`Index schema ${version} is newer than this code (${SCHEMA_VERSION})`);
      }
      for (; version < SCHEMA_VERSION; version++) {
        MIGRATIONS[version - 1](db);
        db.exec(`UPDATE meta SET value = ? WHERE key = 'schema_version'`, String(version + 1));
      }
    });
  }

  schemaVersion(): number {
    return Number(this.db.exec(`SELECT value FROM meta WHERE key = 'schema_version'`)[0]?.value);
  }

  /** Record a page in the registry. Safe to call more than once; keeps the first creation time. */
  registerPage(pageId: string, createdAt: number): void {
    if (!isPageId(pageId)) throw new Error(`Invalid page ID: ${pageId}`);
    if (this.isDeleted(pageId)) return;
    this.db.exec(`INSERT OR IGNORE INTO registry (page_id, created_at) VALUES (?, ?)`, pageId, createdAt);
  }

  /**
   * Replace everything the index holds for one page, atomically. Re-indexing
   * the same content gives the same rows. An update older than the one the
   * index holds is ignored, so a slow retry can never overwrite newer content;
   * documents send strictly increasing updatedAt values. Returns an
   * acknowledgement the document keeps (retry until confirmed).
   */
  updatePage(update: PageUpdate): PageUpdateAck {
    const { pageId, updatedAt, lines } = update;
    if (!isPageId(pageId)) throw new Error(`Invalid page ID: ${pageId}`);
    // A late update from a deleted page (a tab still open) must not bring it back
    if (this.isDeleted(pageId)) return { pageId, parserVersion: PARSER_VERSION, updatedAt, applied: true };
    const journalDate = parseJournalDate(pageId);
    const kind = isJournalId(pageId) ? "journal" : "page";
    const title = journalDate ? journalTitle(journalDate) : update.title.trim();
    const parsed = parseNote(lines);
    const hasContent = parsed.text.trim() !== "" ? 1 : 0;

    return this.db.transaction((): PageUpdateAck => {
      const held = this.db.exec(`SELECT updated_at FROM pages WHERE page_id = ?`, pageId)[0]?.updated_at as number | undefined;
      if (held !== undefined && updatedAt < held) {
        return { pageId, parserVersion: PARSER_VERSION, updatedAt: held, applied: false };
      }
      this.db.exec(`INSERT OR IGNORE INTO registry (page_id, created_at) VALUES (?, ?)`, pageId, updatedAt);
      for (const table of ["links", "tags", "tasks", "pages_fts"]) {
        const col = table === "links" ? "source_id" : "page_id";
        this.db.exec(`DELETE FROM ${table} WHERE ${col} = ?`, pageId);
      }
      this.db.exec(
        `INSERT INTO pages (page_id, kind, title, title_key, journal_date, has_content, updated_at, parser_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (page_id) DO UPDATE SET
           kind = excluded.kind, title = excluded.title, title_key = excluded.title_key,
           journal_date = excluded.journal_date, has_content = excluded.has_content,
           updated_at = excluded.updated_at, parser_version = excluded.parser_version`,
        pageId, kind, title, titleKey(title), journalDate, hasContent, updatedAt, PARSER_VERSION,
      );
      for (const link of parsed.links) {
        this.db.exec(
          `INSERT OR IGNORE INTO links (source_id, target_id, line, content) VALUES (?, ?, ?, ?)`,
          pageId, link.pageId, link.line, JSON.stringify(lines[link.line]),
        );
      }
      for (const tag of parsed.tags) {
        this.db.exec(`INSERT INTO tags (page_id, tag_key, name, line) VALUES (?, ?, ?, ?)`, pageId, tag.key, tag.name, tag.line);
      }
      for (const task of parsed.tasks) {
        this.db.exec(
          `INSERT INTO tasks (page_id, line, state, indent, text, block_id, priority, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          pageId, task.line, task.state, task.indent, task.text, task.blockId, task.priority, JSON.stringify(lines[task.line]),
        );
      }
      this.db.exec(`INSERT INTO pages_fts (page_id, title, body) VALUES (?, ?, ?)`, pageId, title, parsed.text);
      if (kind === "page") assignSlug(this.db, pageId, title);
      return { pageId, parserVersion: PARSER_VERSION, updatedAt, applied: true };
    });
  }

  /** A page's current slug, or null if it has none. */
  currentSlug(pageId: string): string | null {
    return (this.db.exec(`SELECT slug FROM slugs WHERE page_id = ? AND current = 1`, pageId)[0]?.slug as string) ?? null;
  }

  /** Pages by ID, each with its current slug, for showing links (PRD 6.1). Unknown IDs are left out. */
  pagesByIds(pageIds: string[]): Array<IndexedPage & { slug: string | null }> {
    const found: Array<IndexedPage & { slug: string | null }> = [];
    // Durable Object SQLite allows at most 100 bound parameters per query
    for (let i = 0; i < pageIds.length; i += MAX_BOUND_PARAMS) {
      const ids = pageIds.slice(i, i + MAX_BOUND_PARAMS);
      const rows = this.db.exec(
        `SELECT p.*, s.slug FROM pages p LEFT JOIN slugs s ON s.page_id = p.page_id AND s.current = 1
         WHERE p.page_id IN (${ids.map(() => "?").join(", ")})`,
        ...ids,
      );
      for (const row of rows) found.push({ ...toPage(row), slug: (row.slug as string | null) ?? null });
    }
    return found;
  }

  /** Which page a slug belongs to, and whether it is that page's current slug. */
  resolveSlug(slug: string): ResolvedSlug | null {
    const row = this.db.exec(`SELECT page_id, current FROM slugs WHERE slug = ?`, slug.normalize("NFC").toLowerCase())[0];
    if (!row) return null;
    const pageId = row.page_id as string;
    return { pageId, current: row.current === 1, currentSlug: this.currentSlug(pageId) };
  }

  getPage(pageId: string): IndexedPage | null {
    const row = this.db.exec(`SELECT * FROM pages WHERE page_id = ?`, pageId)[0];
    return row ? toPage(row) : null;
  }

  /**
   * Rename a page in the index, atomically: refuse if another page or journal
   * has the title, otherwise record it and assign its slug. The index handles
   * one call at a time, so two renames to the same title cannot both succeed.
   *
   * Only DocumentAgent.rename calls this, holding the document's index lock,
   * and writes meta.title only after a successful claim. So no reindex with
   * an older title can arrive after the claim. The caller must pass a title
   * that has already passed normalizeTitle.
   */
  claimTitle(pageId: string, title: string, at: number): ClaimResult {
    if (!isPageId(pageId)) throw new Error(`Invalid page ID: ${pageId}`);
    if (isJournalId(pageId)) return { ok: false, reason: "journal" };
    // Journals are titled by date and may not be in the index yet, so reserve every date
    if (isJournalTitle(title)) return { ok: false, reason: "journal-title" };
    return this.db.transaction((): ClaimResult => {
      const holder = this.findByTitle(title, pageId);
      if (holder) return { ok: false, reason: "taken", holder: { pageId: holder.pageId, title: holder.title } };
      this.db.exec(`INSERT OR IGNORE INTO registry (page_id, created_at) VALUES (?, ?)`, pageId, at);
      // A page created moments ago may not be indexed yet; updated_at 0 lets its first reindex apply
      this.db.exec(
        `INSERT INTO pages (page_id, kind, title, title_key, journal_date, has_content, updated_at, parser_version)
         VALUES (?, 'page', ?, ?, NULL, 0, 0, ?)
         ON CONFLICT (page_id) DO UPDATE SET title = excluded.title, title_key = excluded.title_key`,
        pageId, title, titleKey(title), PARSER_VERSION,
      );
      return { ok: true, title, slug: assignSlug(this.db, pageId, title) };
    });
  }

  /**
   * The page or journal with this title, ignoring case and surrounding
   * whitespace, other than exceptId. Used to keep titles unique (PRD F2).
   */
  findByTitle(title: string, exceptId = ""): IndexedPage | null {
    const row = this.db.exec(
      `SELECT * FROM pages WHERE title_key = ? AND page_id != ? ORDER BY page_id LIMIT 1`,
      titleKey(title), exceptId,
    )[0];
    return row ? toPage(row) : null;
  }

  /** Pages linking to a page, most recently updated first, with each linking line. */
  backlinks(targetId: string): Backlink[] {
    const rows = this.db.exec(
      `SELECT l.source_id, l.line, l.content, p.title, p.kind
       FROM links l JOIN pages p ON p.page_id = l.source_id
       WHERE l.target_id = ? AND l.source_id != ?
       ORDER BY p.updated_at DESC, l.source_id, l.line`,
      targetId, targetId,
    );
    const groups = new Map<string, Backlink>();
    for (const row of rows) {
      const id = row.source_id as string;
      let group = groups.get(id);
      if (!group) {
        group = { sourceId: id, sourceTitle: row.title as string, sourceKind: row.kind as "page" | "journal", lines: [] };
        groups.set(id, group);
      }
      group.lines.push({ line: row.line as number, content: JSON.parse(row.content as string) as DocLine });
    }
    return [...groups.values()];
  }

  /**
   * Titles for `[[` autocomplete: titles starting with the query first, then
   * titles containing it. An empty query returns recently updated pages.
   */
  searchTitles(query: string, limit = 10): IndexedPage[] {
    const q = titleKey(query);
    if (!q) {
      return this.db.exec(`SELECT * FROM pages ORDER BY updated_at DESC LIMIT ?`, limit).map(toPage);
    }
    const like = likeEscape(q);
    return this.db
      .exec(
        `SELECT *, CASE WHEN title_key LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END AS rank_group
         FROM pages WHERE title_key LIKE ? ESCAPE '\\'
         ORDER BY rank_group, length(title), title_key LIMIT ?`,
        like + "%", "%" + like + "%", limit,
      )
      .map(toPage);
  }

  /** Full-text search over titles and text, best matches first. */
  search(query: string, limit = 20): SearchHit[] {
    const match = ftsQuery(query);
    if (!match) return [];
    return this.db
      .exec(
        `SELECT page_id, title, snippet(pages_fts, 2, ?, ?, '…', 12) AS snippet
         FROM pages_fts WHERE pages_fts MATCH ? ORDER BY rank LIMIT ?`,
        SNIPPET_START, SNIPPET_END, match, limit,
      )
      .map((row) => ({ pageId: row.page_id as string, title: row.title as string, snippet: row.snippet as string }));
  }

  /** Tasks in the given states: by priority (A first, none last), then journals newest first, then pages by title. */
  tasks(states: TaskState[] = ["TODO", "DOING"]): IndexedTask[] {
    if (!states.length) return [];
    const placeholders = states.map(() => "?").join(", ");
    return this.db
      .exec(
        `SELECT t.*, p.title, p.kind, p.updated_at FROM tasks t JOIN pages p ON p.page_id = t.page_id
         WHERE t.state IN (${placeholders})
         ORDER BY t.priority IS NULL, t.priority, p.kind = 'page', p.journal_date DESC, p.title_key, t.line`,
        ...states,
      )
      .map((row) => ({
        pageId: row.page_id as string,
        pageTitle: row.title as string,
        pageKind: row.kind as "page" | "journal",
        updatedAt: row.updated_at as number,
        line: row.line as number,
        state: row.state as TaskState,
        indent: row.indent as number,
        text: row.text as string,
        priority: (row.priority as TaskPriority | null) ?? null,
        blockId: (row.block_id as string | null) ?? null,
        content: row.content ? (JSON.parse(row.content as string) as DocLine) : null,
      }));
  }

  /** Journal days with content, newest first, before an optional YYYY-MM-DD date (exclusive). */
  journals(limit = 14, before?: string): IndexedPage[] {
    return this.db
      .exec(
        `SELECT * FROM pages WHERE kind = 'journal' AND has_content = 1 AND (? IS NULL OR journal_date < ?)
         ORDER BY journal_date DESC LIMIT ?`,
        before ?? null, before ?? null, limit,
      )
      .map(toPage);
  }

  /** Number of indexed pages built by an older parser. Non-zero means a rebuild is due. */
  staleCount(): number {
    return Number(this.db.exec(`SELECT COUNT(*) AS n FROM pages WHERE parser_version < ?`, PARSER_VERSION)[0].n);
  }

  /** Clear everything derived, ready for a rebuild. The registry and slugs are kept. */
  clearDerived(): void {
    this.db.transaction(() => {
      for (const table of DERIVED_TABLES) this.db.exec(`DELETE FROM ${table}`);
    });
  }

  /**
   * Registered pages the index has not built with the current parser (never
   * indexed, or by an older one), in ID order after `after`: what a rebuild
   * asks to re-index (docs/technical-architecture.md, "How it stays correct").
   */
  pagesToRefresh(limit = 10, after = ""): string[] {
    return this.db
      .exec(
        `SELECT r.page_id FROM registry r LEFT JOIN pages p ON p.page_id = r.page_id
         WHERE r.page_id > ? AND (p.page_id IS NULL OR p.parser_version < ?)
         ORDER BY r.page_id LIMIT ?`,
        after, PARSER_VERSION, limit,
      )
      .map((row) => row.page_id as string);
  }

  /** How many registered pages a rebuild still has to re-index. */
  refreshCount(): number {
    return Number(
      this.db.exec(
        `SELECT COUNT(*) AS n FROM registry r LEFT JOIN pages p ON p.page_id = r.page_id
         WHERE p.page_id IS NULL OR p.parser_version < ?`,
        PARSER_VERSION,
      )[0].n,
    );
  }

  /** Where a running rebuild has got to (the last page ID it asked), or null when none is running. */
  rebuildCursor(): string | null {
    const value = this.db.exec(`SELECT value FROM meta WHERE key = 'rebuild_cursor'`)[0]?.value;
    return typeof value === "string" ? value : null;
  }

  setRebuildCursor(cursor: string | null): void {
    if (cursor === null) this.db.exec(`DELETE FROM meta WHERE key = 'rebuild_cursor'`);
    else this.db.exec(`INSERT INTO meta (key, value) VALUES ('rebuild_cursor', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, cursor);
  }

  isDeleted(pageId: string): boolean {
    return this.db.exec(`SELECT 1 FROM deleted_pages WHERE page_id = ?`, pageId).length > 0;
  }

  /**
   * Delete a page from the index (F21): its entry, everything derived from it,
   * its slugs (its addresses stop working) and its registry entry, so its
   * title is free and a rebuild never brings it back. Links to it from other
   * pages stay, and show as unresolved. Returns the title it had.
   */
  deletePage(pageId: string, at: number): string {
    if (!isPageId(pageId)) throw new Error(`Invalid page ID: ${pageId}`);
    return this.db.transaction((): string => {
      const title = (this.db.exec(`SELECT title FROM pages WHERE page_id = ?`, pageId)[0]?.title as string | undefined) ?? "";
      this.db.exec(`DELETE FROM links WHERE source_id = ?`, pageId);
      for (const table of ["pages", "tags", "tasks", "pages_fts", "slugs", "registry"]) {
        this.db.exec(`DELETE FROM ${table} WHERE page_id = ?`, pageId);
      }
      this.db.exec(`INSERT INTO deleted_pages (page_id, title, deleted_at) VALUES (?, ?, ?) ON CONFLICT (page_id) DO NOTHING`, pageId, title, at);
      return title;
    });
  }

  /**
   * Every page and journal in the index for the All pages list (F21), most
   * recently edited first, each with how many other pages link to it. A
   * journal day with no text is left out, as an unwritten day is (an undone
   * import leaves its days empty, and days can't be deleted).
   */
  allPages(): AllPagesRow[] {
    return this.db
      .exec(
        `SELECT p.page_id, p.kind, p.title, p.journal_date, p.has_content, p.updated_at, s.slug,
           (SELECT COUNT(DISTINCT l.source_id) FROM links l WHERE l.target_id = p.page_id AND l.source_id != p.page_id) AS backlinks
         FROM pages p LEFT JOIN slugs s ON s.page_id = p.page_id AND s.current = 1
         WHERE p.kind = 'page' OR p.has_content = 1
         ORDER BY p.updated_at DESC, p.page_id`,
      )
      .map((row) => ({
        pageId: row.page_id as string,
        kind: row.kind as "page" | "journal",
        title: row.title as string,
        slug: (row.slug as string | null) ?? null,
        hasContent: row.has_content === 1,
        updatedAt: row.updated_at as number,
        backlinks: Number(row.backlinks),
      }));
  }

  /**
   * For a Logseq import's dry run: which of these title keys are pages
   * already, and which of these days (YYYY-MM-DD) already have notes.
   */
  importCheck(keys: string[], dates: string[]): { pages: string[]; days: string[] } {
    const pages: string[] = [];
    const days: string[] = [];
    for (let i = 0; i < keys.length; i += MAX_BOUND_PARAMS) {
      const chunk = keys.slice(i, i + MAX_BOUND_PARAMS);
      const rows = this.db.exec(`SELECT title_key FROM pages WHERE kind = 'page' AND title_key IN (${chunk.map(() => "?").join(", ")})`, ...chunk);
      for (const row of rows) pages.push(row.title_key as string);
    }
    for (let i = 0; i < dates.length; i += MAX_BOUND_PARAMS) {
      const chunk = dates.slice(i, i + MAX_BOUND_PARAMS);
      const rows = this.db.exec(`SELECT journal_date FROM pages WHERE kind = 'journal' AND has_content = 1 AND journal_date IN (${chunk.map(() => "?").join(", ")})`, ...chunk);
      for (const row of rows) days.push(row.journal_date as string);
    }
    return { pages, days };
  }

  /* ---------- Logseq import (F31): several, each undoable, one in progress at a time ---------- */

  private importRecord(row: SqlRow): ImportRecord {
    const importId = row.import_id as string;
    const counts = this.db.exec(`SELECT COUNT(*) AS n, COALESCE(SUM(created), 0) AS created FROM import_pages WHERE import_id = ?`, importId)[0];
    return {
      importId,
      label: (row.label as string | null) ?? null,
      state: row.state as ImportRecord["state"],
      startedAt: row.started_at as number,
      finishedAt: (row.finished_at as number | null) ?? null,
      pages: Number(counts.n),
      created: Number(counts.created),
    };
  }

  /** Every import not undone, newest first (started in the same millisecond: the later recorded first). */
  listImports(): ImportRecord[] {
    return this.db.exec(`SELECT * FROM imports WHERE state != 'undone' ORDER BY started_at DESC, rowid DESC`).map((row) => this.importRecord(row));
  }

  /** One import, unless it is undone (or never was). */
  getImport(importId: string): ImportRecord | null {
    const row = this.db.exec(`SELECT * FROM imports WHERE import_id = ? AND state != 'undone'`, importId)[0];
    return row ? this.importRecord(row) : null;
  }

  /** The import running or being undone, if any; while there is one, no other may start or be undone. */
  private unfinishedImport(): ImportRecord | null {
    const row = this.db.exec(`SELECT * FROM imports WHERE state IN ('running', 'undoing') ORDER BY started_at DESC LIMIT 1`)[0];
    return row ? this.importRecord(row) : null;
  }

  /**
   * Start an import, unless another is running or being undone (finish or
   * undo that first). Finished imports don't stop another.
   */
  startImport(importId: string, label: string | null, at: number): StartImportResult {
    return this.db.transaction((): StartImportResult => {
      const current = this.unfinishedImport();
      if (current) return { ok: false, current };
      this.db.exec(`INSERT INTO imports (import_id, label, state, started_at) VALUES (?, ?, 'running', ?)`, importId, label, at);
      return { ok: true };
    });
  }

  /** Whether this import is the running one, so its pages may be created and written. */
  isRunningImport(importId: string): boolean {
    return this.db.exec(`SELECT 1 FROM imports WHERE import_id = ? AND state = 'running'`, importId).length > 0;
  }

  /**
   * Record a document the import writes to or creates, before it does so.
   * Once recorded as created, it stays so (a resumed import finds the page it
   * made last time and must still delete it on undo).
   */
  recordImportPage(importId: string, pageId: string, created: boolean): void {
    if (!isPageId(pageId)) throw new Error(`Invalid page ID: ${pageId}`);
    this.db.exec(
      `INSERT INTO import_pages (import_id, page_id, created) VALUES (?, ?, ?)
       ON CONFLICT (import_id, page_id) DO UPDATE SET created = max(created, excluded.created)`,
      importId, pageId, created ? 1 : 0,
    );
  }

  /** Forget a document: a page the import meant to create but didn't, or one already undone. */
  forgetImportPage(importId: string, pageId: string): void {
    this.db.exec(`DELETE FROM import_pages WHERE import_id = ? AND page_id = ?`, importId, pageId);
  }

  finishImport(importId: string, at: number): boolean {
    this.db.exec(`UPDATE imports SET state = 'done', finished_at = ? WHERE import_id = ? AND state = 'running'`, at, importId);
    return this.db.exec(`SELECT 1 FROM imports WHERE import_id = ? AND state = 'done'`, importId).length > 0;
  }

  /**
   * Start (or continue) undoing an import: from now on it writes nothing.
   * "missing" if there is no such import left to undo; "busy" while another
   * is running or being undone (an undo could delete a page that one is
   * linking to).
   */
  startUndo(importId: string): StartUndoResult {
    return this.db.transaction((): StartUndoResult => {
      const other = this.unfinishedImport();
      if (other && other.importId !== importId) return this.getImport(importId) ? "busy" : "missing";
      this.db.exec(`UPDATE imports SET state = 'undoing' WHERE import_id = ? AND state IN ('running', 'done')`, importId);
      return this.db.exec(`SELECT 1 FROM imports WHERE import_id = ? AND state = 'undoing'`, importId).length > 0 ? "ok" : "missing";
    });
  }

  /**
   * A page this import created, being undone: if another import not undone
   * uses it too (wrote to it or links to it), that one takes it over, so the
   * page stays until the last of them is undone. Returns whether it did.
   */
  handOverImportPage(importId: string, pageId: string): boolean {
    return this.db.transaction((): boolean => {
      const other = this.db.exec(
        `SELECT ip.import_id FROM import_pages ip JOIN imports i ON i.import_id = ip.import_id
         WHERE ip.page_id = ? AND ip.import_id != ? AND i.state IN ('running', 'done')
         ORDER BY i.started_at DESC, i.rowid DESC LIMIT 1`,
        pageId, importId,
      )[0];
      if (!other) return false;
      this.db.exec(`UPDATE import_pages SET created = 1 WHERE import_id = ? AND page_id = ?`, other.import_id as string, pageId);
      return true;
    });
  }

  /** The next documents to undo, each with whether the import created it. */
  importPagesToUndo(importId: string, limit = 10): Array<{ pageId: string; created: boolean }> {
    return this.db
      .exec(`SELECT page_id, created FROM import_pages WHERE import_id = ? ORDER BY page_id LIMIT ?`, importId, limit)
      .map((row) => ({ pageId: row.page_id as string, created: row.created === 1 }));
  }

  /** Mark an import undone once every document is; it leaves the list. Returns whether it is undone. */
  finishUndo(importId: string): boolean {
    return this.db.transaction((): boolean => {
      const left = Number(this.db.exec(`SELECT COUNT(*) AS n FROM import_pages WHERE import_id = ?`, importId)[0].n);
      if (left > 0) return false;
      this.db.exec(`UPDATE imports SET state = 'undone' WHERE import_id = ? AND state = 'undoing'`, importId);
      return this.db.exec(`SELECT 1 FROM imports WHERE import_id = ? AND state = 'undone'`, importId).length > 0;
    });
  }

  /** Registered page IDs in ID order, for walking the registry in batches. */
  registeredPages(limit = 100, after = ""): string[] {
    return this.db
      .exec(`SELECT page_id FROM registry WHERE page_id > ? ORDER BY page_id LIMIT ?`, after, limit)
      .map((row) => row.page_id as string);
  }
}
