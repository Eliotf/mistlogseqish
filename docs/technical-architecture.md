# Technical Architecture

Technology choices, rules, and architectural decisions for Mistlog. Product scope and the reasons behind decisions live in `PRD.md`; this file describes how the system is built.

## Platform

Everything runs on Cloudflare. No other hosting, no external databases, no separate asset storage.

- **Cloudflare Workers** — single worker serving the entire application.
- **Durable Objects** — each page and each journal day is a `DocumentAgent` Durable Object holding a Yjs document in its built-in SQLite. A single `WorkspaceAgent` Durable Object (instance `default`) holds the workspace index (see below).
- **Cloudflare Access** — gates the whole `workers.dev` address; visitors sign in with a Cloudflare account. The Worker does not verify the Access token itself yet (planned for M4).

## Framework Stack

- **React Router 7** — SSR enabled, serving from Cloudflare Workers. Uses `v8_viteEnvironmentApi` and `v8_middleware` future flags.
- **Cloudflare Agents SDK** — wrapper around the project providing agent routing. Agents are Durable Objects with a higher-level API for real-time WebSocket connections.
- **Vite** — build tooling with `@cloudflare/vite-plugin`, `@tailwindcss/vite`, `@react-router/dev/vite`, and `vite-tsconfig-paths`.
- **Tailwind CSS 4** — styling.
- **TypeScript** — strict type checking.
- **TipTap 3** — multiplayer markdown editor. Core technology for the document editing experience. Backed by Durable Object persistent state via Yjs.

## Directory Structure

```
agents/       Server-side Durable Object agents
app/          React Router application
  components/ Shared UI components
  lib/        Utilities, editor logic, shared parser, Yjs provider
  routes/     File-based routing
  shared/     Constants and types shared between client and server
docs/         Project documentation
workers/      Cloudflare Worker entry point (workers/app.ts)
tests/        Test suite
```

## Critical Rule: Server/Client Separation

Client-side React components must **never** import from the `agents/` directory — not even constants, types, or enums. If both client and server need shared types/constants, put them in `app/shared/`.

This is the most common source of build errors. The Cloudflare Workers environment (server) and the browser (client) are separate runtimes.

## Worker Entry Point Pattern

The worker entry at `workers/app.ts` handles requests in this order:

1. `routeAgentRequest(request, env)` — handles `/agents/:agent/:name` WebSocket and HTTP requests to agents.
2. React Router SSR — handles everything else.

Agents are exported from the worker entry file and configured as Durable Object bindings in `wrangler.jsonc`.

## Links

A link is a `wikilink` mark on text in the page's Yjs document, with a `pageId` attribute. The mark's name and attributes are defined once in the shared parser module (M1, chunk 1.3), so the server and the editor agree on them before any link UI exists. The displayed title always comes from the index, so renaming a page never edits linking pages. See `PRD.md` section 6.1.

## Shared Note Parser

One module, used by both the workspace index (server) and the editor (client), so links, tags and tasks are extracted one way (AGENTS.md invariant 7).

| File | Role |
|---|---|
| `app/lib/note-ids.ts` | Page IDs: Mist's random 8-character IDs for pages, `journal-YYYY-MM-DD` for journals (validated as real dates) |
| `app/lib/wikilink.ts` | The `wikilink` mark: name, `pageId` attribute, ProseMirror spec. The editor's TipTap extension (chunk 2.5) wraps this spec |
| `app/lib/note-parser.ts` | `parseLine` (indent, bullet, task) and `parseNote` (links, tags, tasks, search text), plus `PARSER_VERSION` |
| `app/lib/note-lines.ts` | Converts a Yjs fragment (server) or ProseMirror doc (client) into the parser's input: one line per paragraph, with mark ranges |

Tests in `tests/unit/lib/note-*.test.ts` include a round trip through Yjs using y-tiptap's converters (the same code the editor syncs with) and check that the server and client produce identical parser output.

## Page Titles

- A page's title is `meta.title` in its Yjs document (`DOC_FORMAT_VERSION` 3), so it syncs live between tabs. Journals are titled from their date and have no stored title.
- **Only the server writes titles.** Uniqueness is a cross-page rule enforced by the index, while the title itself lives in each document, so there must be exactly one writer, and it must go through the index first.
  - `PageTitle` (`app/components/PageTitle.tsx`) calls `POST /api/rename` with JSON `{ pageId, title }` (`app/routes/api.rename.ts`). Non-JSON bodies are refused, so another site's form cannot rename.
  - The route calls `DocumentAgent.rename(title)` on the page's own Durable Object. It refuses journals and documents that were never created, validates with `normalizeTitle`, then, holding the document's **index lock**, calls the index's `claimTitle`.
  - `claimTitle` runs in one transaction. It refuses a title another page or journal has (compared NFC-lowercase with `titleKey`) and any journal-date title (`isJournalTitle`), then records the title and assigns the slug.
  - Only after a successful claim does `DocumentAgent` write `meta.title` (origin `SERVER_ORIGIN`). It broadcasts the change to every connected browser, re-indexes at once, and the route returns the new address. The browser then moves to that address.
  - **Browsers cannot write `meta.title`.** Updates from browsers are applied with origin `CLIENT_ORIGIN`. If one changes `meta.title`, `DocumentAgent` puts the approved title back (origin `SERVER_ORIGIN`) and the revert reaches every tab.
- **The index lock** (`withIndexLock` in `agents/document.ts`) serialises `reindex` and `rename` for one document. A rename claims only after any reindex in flight has finished, so no reindex carrying the old title can reach the index after the claim. Without it, a page could briefly appear to have its old title, letting another page take its new one. The lock is per document; the index serialises claims across documents.
- Title rules live in `app/lib/page-title.ts` (`normalizeTitle`): NFC, invisible characters (zero-width, bidirectional controls, soft hyphen, BOM) removed, whitespace collapsed, 1 to 200 characters, no `[[` or `]]`.
- **Rebuild constraint (chunk 1.6).** While the index is rebuilding, `claimTitle` must refuse, because titles not yet re-indexed would look free.
- **Residual risk.** The server writes `meta.title` in the same synchronous step that `claimTitle` returns in. If the process died between the two, the index would hold a title the document lacks until the next reindex reverts it.
- Because links store page IDs, renaming changes nothing else. Links will show the new title once they read it from the index (chunk 2.5).

## Journal Pages

- A journal day is the `DocumentAgent` named `journal-YYYY-MM-DD`, opened at `/journal/YYYY-MM-DD` (`app/routes/journal.$date.tsx`). Any real date can be opened; invalid dates are 404, and `/docs/journal-…` redirects. `pagePath` returns the journal address for journal IDs.
- **Created by its first real text.** Journals have no `POST`. `DocumentAgent`'s update handler, for a journal without the `exists` marker, checks whether the document now has non-whitespace text (`createJournalIfWritten`). If so it records `exists` and `createdAt`, stamps `DOC_FORMAT_VERSION` and registers with the index. Until then it **does not persist** the Yjs state, so opening a day leaves nothing behind; the first text persists the whole document. Tabs still sync before creation. (The TipTap editor writes nothing into an empty document when it opens; the text check is a safety net.)
- Titles are the date (`journalTitle`), shown read-only by `JournalHeading`; `meta.title` writes are reverted and renames refused. The weekday is rendered on the server (it is the same in every time zone); "Today" and the "Not saved yet" note are decided in the browser with `useSyncExternalStore`.
- The header's "Today" button navigates to `/journal/<localDate(now)>`, computed in the browser's time zone when clicked.
- `onConnect` sends the document to the new tab first, then runs `indexOnOpen` (never throws), so indexing can never stop a tab receiving its document.

## Journal Feed

- `/` (`app/routes/home.tsx`) is the journal feed. The loader asks the index for the newest days with notes (`journals(7)`) and fails open: if the index is unreachable, the feed still shows today, with a retry for earlier days.
- `JournalFeed` (`app/components/JournalFeed.tsx`) puts today first. Today is decided in the browser with `useSyncExternalStore`; the server renders a placeholder of the same height. Earlier days (before today, so future days are hidden) follow, newest first. Older batches load from `GET /api/journals?before=&limit=` (`app/routes/api.journals.ts`) when a sentinel near the bottom comes within 800px of the screen, or from a "Show older days" button.
- Each day is a `JournalDay`: a live editor with its own Yjs connection and Mist document context (`DocumentProvider`, `ConnectedEditor`, `DayBar`). Days show a light placeholder until they come within 1200px of the screen (`CONNECT_MARGIN`), the first three at once, then stay connected so scrolling back is instant.
- `AppHeader` and `ConnectedEditor` are shared with the single-page screen (`docs.$id.tsx`), so both render the same header and editor wiring.
- Day headings are `h2` under one visually hidden `h1` ("Journals"), and do not set the browser tab title.

## Bullets and Indentation

- The text stays Logseq-compatible: a bullet is `- ` after leading tab characters (PRD F7). Only keys and display change.
- `app/lib/bullets.ts` is pure line logic. `indentPlan` moves a line or a selection with its children, at most one level below the line above, and makes indented plain lines bullets. `enterPlan` continues a bullet, starts the first child at the end of a line with children, adds an empty bullet above when the caret is before the content, and outdents or ends an empty bullet. `backspacePlan` outdents, or removes a top-level bullet, when the caret is right after `- `. Every change rewrites only the start of a line.
- `app/lib/bullet-editing.ts` (`BulletEditing`, registered in `Editor.tsx`) applies the plans as ProseMirror transactions, so they sync over Yjs and undo normally. Inserted indentation is plain text and never takes a mark; Enter splits with `tr.split` so moved text keeps its marks. Keys are ignored during IME composition. In suggest mode, Tab and Shift+Tab are swallowed (focus stays in the editor) and Enter and Backspace are left to Mist (F34 will design indentation suggestions).
- `bulletDecorations` draws each leading tab as a fixed-width indent with a guide (`.md-indent`) and a bullet's `-` as a dot (`.md-bullet`), skipping code fences. The caret still moves one character at a time across `- `.

## Durable Object Usage

Durable Objects are billed for every second they are awake; they hibernate after about 10 idle seconds (WebSocket hibernation, on by default in the Agents SDK). The free plan allows about 28 hours of awake time a day.

- **No repeating timers on a Durable Object.** A pending `setInterval` or `setTimeout` stops hibernation. y-protocols' `Awareness` runs a 3-second interval, so `DocumentAgent` uses `createRelayAwareness`, which stops it; browsers expire stale presence after 30 seconds, and `onClose` removes a departing browser's state. Short one-off timers (the 0.3-second index timer) are fine. A test fails if starting a `DocumentAgent` leaves any timer pending.
- **Presence only from the editor in use.** y-protocols re-sends a browser's presence every 15 seconds while it is set, waking that page's object. `usePresenceWhileFocused` (`app/lib/connection-budget.ts`) clears presence unless the editor is focused in a visible tab. Collaborators' cursors disappear when they click away, and reappear when they return.
- **Hidden tabs disconnect.** `useDisconnectWhenHidden` closes a tab's connections after 5 minutes hidden and reconnects when it is shown; the server's sync messages bring it up to date.
- **Result:** an idle open page or feed costs almost nothing; awake time is spent while someone types (about 10 seconds after each burst, for the page and the index). Measured locally with headless Chrome: a 17-day feed sent 0 messages to documents in 40 idle seconds.

## Readable URLs

- `/page/<slug>` is a page's readable address; `/docs/<id>` is its permanent one and redirects (302) to the slug when the page has one. Untitled pages, and titles with no letters or digits, stay at `/docs/<id>`.
- `slugify` (`app/lib/slug.ts`) lowercases, keeps letters, digits and marks from any script, turns everything else into `-`, and caps at 80 code points.
- The index assigns slugs in `updatePage` (`assignSlug` in `agents/workspace-index.ts`). A slug another page currently holds gets a suffix: the first 4 characters of the page ID, then the full ID. A slug that is only another page's old redirect is taken over. Re-indexing keeps a page's slug stable.
- `/page/:slug` (`app/routes/page.$slug.tsx`) resolves through the index. Old slugs, and other case or accent forms, redirect to the canonical address; unknown slugs are 404. Both routes share `app/lib/document-loader.server.ts`. The `/docs/<id>` slug lookup fails open if the index is unreachable.
- After a rename the browser moves to the new address at once: `claimTitle` has already assigned the slug (chunk 2.1d).

## Workspace Index

Each page is an isolated Durable Object, so cross-page features (backlinks, `[[` autocomplete, search, the Tasks view, the journal feed) query one `WorkspaceAgent` instead. The index is always derived from documents, never the other way round.

### Implementation

- **Schema versions.** `SCHEMA_V1` is frozen as shipped. `MIGRATIONS` is an append-only list; entry *n* upgrades version *n* to *n+1*. Opening the index runs any pending migrations in one transaction, and refuses an index newer than the code. Version 2 (chunk 2.1b) adds `slugs` and slugs every titled page.

- `agents/workspace-index.ts`: `WorkspaceIndex`, all schema, updates and queries, written against a two-method SQL interface (`exec`, `transaction`).
- `agents/workspace.ts`: `WorkspaceAgent`, which adapts Durable Object storage (`storage.sql.exec`, `storage.transactionSync`) to that interface and exposes the index's methods over Durable Object RPC.
- **Private.** Only other Durable Objects call it. The Worker refuses `/agents/workspace-agent/*` before the agent router (`isPrivateAgentPath`), and the agent refuses HTTP requests and WebSocket connections. UI queries will go through server routes that can check permissions (M4).
- **Updates.** A document sends `{ pageId, title, updatedAt, lines }`. The index runs the shared parser and replaces that page's rows in one transaction, then returns an acknowledgement. Journals are titled from their date (`journalTitle`).
- **Search.** FTS5 with `unicode61 remove_diacritics 2`. Input is quoted word by word (`ftsQuery`), so FTS syntax in user input is searched literally.
- **Tests** run the real SQL on Node's built-in SQLite (`tests/helpers/sqlite.ts`). The same code was also run once inside local `workerd` (Miniflare) to confirm FTS5, transactions and the schema work on Cloudflare's SQLite.

### What it holds

- **Page registry** — every page ID and its creation date, recorded when the page is created. This is the only part of the index that cannot be rebuilt (Durable Objects cannot be listed), so rebuilds never clear it. Journals have date-based IDs (`journal-YYYY-MM-DD`) and can always be found by date.
- **Slugs** — every slug each page has had (`slugs`: `slug`, `page_id`, `current`). Like the registry, never cleared by a rebuild, because old slugs are not recorded in documents and old links must keep redirecting.
- **Derived tables** — `pages` (title, kind, journal date, updated), `links`, `tasks`, and a full-text search table. These can be cleared and rebuilt at any time.
- **Parser version** — the version of the shared parser that built each page's entry.

### How it stays correct

1. **On every edit.** Each Yjs update marks the document as needing indexing. An in-memory timer reindexes **0.3 seconds after the last edit** (`INDEX_PAUSE_MS`), or **2 seconds after the first unindexed edit** (`INDEX_MAX_WAIT_MS`), whichever comes first, so the index is fresh almost as soon as typing pauses and continuous typing still reaches it every 2 seconds. In-memory timers are lost if the object is evicted, so a persisted `schedule("reindex")` in 2 seconds (`INDEX_DELAY_SECONDS`) stays as a backup; whichever runs second finds nothing to do. While the document is retrying after a failure, the fast timer is off and only the backoff schedule runs. `reindex` sends `{ pageId, title, updatedAt, lines }` (lines from `linesFromYjs`); the index parses them and replaces only that page's rows. Re-indexing the same content twice gives the same result.
2. **Retry until confirmed.** Each document keeps an index state record in its own storage (`doc_state` key `index`): unsent edits, the last `updatedAt` sent, the last acknowledgement, and a retry count. A failed call retries after 5 s, 30 s, 2 min, then every 10 min (`INDEX_RETRY_SECONDS`), resetting after a success. Schedules are stored by the Agents SDK, so they survive restarts. Index failures are logged and never affect editing or sync.
   - **Ordering.** Each document sends strictly increasing `updatedAt` values (`max(now, lastSent + 1)`), and the index ignores any update older than the one it holds, so a slow retry can never overwrite newer content. If the index reports it holds something newer (for example after lost local state), the document sends again with a later time.
   - **Which documents.** Only documents created through `POST` (the `exists` marker) with a valid page ID are indexed or registered, so a WebSocket to an arbitrary ID cannot add entries.
   - **On open.** A document re-indexes when a client connects if it was never indexed, was indexed by an older parser, or has unsent edits. New documents register in the registry when created.
3. **Rebuild when the parser changes.** Bumping the parser version triggers one rebuild: clear the derived tables, then ask every page in the registry and every journal to re-index. Expect a handful a year, never on a schedule.
4. **Weekly check.** Once a week the index asks each registered page whether its entry is current, by comparing a short content summary, and re-indexes only those that differ (M1, chunk 1.6; can land after M2).

**Limit:** none of these catch a bug in the parser itself, because a wrong result is consistently wrong. Parser tests and the version bump in step 3 are the only defence.

### Existing documents

Mist-era documents are not backfilled, because they cannot be listed. A document indexes itself whenever it is opened.

### Alarms

`DocumentAgent` does not override `alarm()`. The Agents SDK uses `alarm()` to run tasks registered with `this.schedule()`, which is what debounced indexing and retries use. Documents created before the 99-hour expiry was removed still have a deletion alarm scheduled; when it fires, the SDK finds no scheduled task and does nothing. Scheduled work must never delete document data.

### What the user sees

Nothing in normal operation. Signals appear only where results may be incomplete, and only while they are:

| Situation | Where | Message |
|---|---|---|
| This page's latest edit is not confirmed by the index | Small dot by the backlinks heading | "Recent edits to this page aren't in search yet" |
| A rebuild is running | One line at the foot of the left sidebar, and a note above search, backlinks and Tasks results | "Updating index · 140 of 412 pages" |
| The weekly check fixed pages | Not shown; logged | — |
| User suspects drift | Settings | "Rebuild index" button, same progress line |

## Key Configuration

- `wrangler.jsonc` — Cloudflare Workers config. Must include `"nodejs_compat"` in compatibility flags (required by Agents SDK for `async_hooks`). A new Durable Object class needs a new, append-only `migrations` entry. Set `CLOUDFLARE_ACCOUNT_ID` env var for deployment.
- `react-router.config.ts` — SSR enabled with `v8_viteEnvironmentApi` and `v8_middleware` future flags.
- `vite.config.ts` — plugins: cloudflare, tailwindcss, reactRouter, tsconfigPaths.
- `vitest.config.ts` — test config with fixed coverage floors (see `PRD.md` section 7, Quality gates).

## Documentation

- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare Agents SDK: https://developers.cloudflare.com/agents/
- Durable Objects: https://developers.cloudflare.com/durable-objects/
- Cloudflare Access: https://developers.cloudflare.com/cloudflare-one/policies/access/
- React Router 7: https://reactrouter.com/
- TipTap: https://tiptap.dev/
- Yjs: https://yjs.dev/
