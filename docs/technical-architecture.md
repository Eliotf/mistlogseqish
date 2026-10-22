# Technical Architecture

Technology choices, rules, and architectural decisions for Mistlog. Product scope and the reasons behind decisions live in `PRD.md`; this file describes how the system is built.

## Platform

Everything runs on Cloudflare. No other hosting, no external databases, no separate asset storage.

- **Cloudflare Workers** — single worker serving the entire application.
- **Durable Objects** — each page and each journal day is a `DocumentAgent` Durable Object holding a Yjs document in its built-in SQLite. A single `WorkspaceAgent` Durable Object holds the workspace index (see below; planned for M1).
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

## Workspace Index

Each page is an isolated Durable Object, so cross-page features (backlinks, `[[` autocomplete, search, the Tasks view, the journal feed) query one `WorkspaceAgent` instead. The index is always derived from documents, never the other way round.

### What it holds

- **Page registry** — every page ID and its creation date, recorded when the page is created. This is the only part of the index that cannot be rebuilt (Durable Objects cannot be listed), so rebuilds never clear it. Journals have date-based IDs (`journal-YYYY-MM-DD`) and can always be found by date.
- **Derived tables** — `pages` (title, kind, journal date, updated), `links`, `tasks`, and a full-text search table. These can be cleared and rebuilt at any time.
- **Parser version** — the version of the shared parser that built each page's entry.

### How it stays correct

1. **On every edit.** After edits pause (about 2 seconds), the `DocumentAgent` runs the shared parser and sends that page's entry to the index. Only that page's rows are replaced. Re-indexing the same content twice gives the same result.
2. **Retry until confirmed.** Each document remembers whether the index has confirmed its latest entry. Until it has, the document retries using the Agents SDK's `this.schedule()`. Lost updates (index briefly unreachable, a restart) fix themselves within seconds or minutes.
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
