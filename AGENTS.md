# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot and others) working in this repo. Humans can use it as a contributor guide too.

Keep this file short and accurate. If a rule here turns out to be wrong or out of date, fix it in the same PR. Prefer pointing to a file over copying its contents here.

## What this project is

Mistlog is a Logseq-style notes app: daily notes, `[[backlinks]]`, tasks and shareable pages, synced live across devices. It is forked from [inanimate-tech/mist](https://github.com/inanimate-tech/mist) (MIT licence, keep the attribution in LICENSE) and keeps Mist's storage: one live Yjs document per page.

- Product spec and roadmap: `PRD.md` (read the relevant milestone before starting work; section 6.1 for anything touching links)
- Interaction reference: `docs/prototype/mistlog-demo.html` (single-file clickable prototype; open it in a browser and match its behaviour, not its code). Its defaults follow the PRD decisions; the "Prototype controls" switches show alternatives that were considered and rejected. If the prototype and `PRD.md` disagree, the PRD wins.
- Mist's own docs in `docs/` describe the inherited editor and CriticMarkup. Where they disagree with `PRD.md`, the PRD wins.

## Commands

`package.json` is the source of truth. Common ones:

```
npm run dev          # local dev server
npm run build        # production build
npm run deploy       # build and deploy to Cloudflare Workers (humans only, see Boundaries)
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm run test         # Vitest with coverage
npm run test:watch   # Vitest watch mode
```

**Definition of done:** `npm run typecheck && npm run lint && npm run test` all pass, new behaviour has tests, and `PRD.md` is updated if scope or decisions changed.

## Stack

Cloudflare Workers and Durable Objects (via the Cloudflare Agents SDK), React Router 7 (SSR), TipTap 3, Yjs, Tailwind CSS 4, TypeScript, Vitest. Node 22+.

## Architecture in one paragraph

Each page and each journal day is one `DocumentAgent` Durable Object (`agents/document.ts`) holding a Yjs document in its built-in SQLite; clients connect over WebSocket and edits merge automatically. Journals use fixed IDs (`journal-YYYY-MM-DD`); pages use random permanent IDs. Cross-page features (backlinks, autocomplete, search, tasks, journal feed) query a `WorkspaceAgent` index (planned, M1), which each document updates after edits settle. See PRD section 7.

## Layout

```
agents/       Durable Object agents (document state, live editing, workspace index)
app/
  components/ UI components
  lib/        Editor logic, TipTap extensions, utilities, shared parser, Yjs provider
  routes/     File-based routes (UI and API)
  shared/     Types and constants shared by client and server
workers/      Worker entry point
tests/        Test suite
docs/         Mist's design and architecture docs, prototype
PRD.md        Product spec and roadmap
```

## Product invariants (do not break these)

1. **Links point to a page ID, never a title.** A link is a `wikilink` mark with a `pageId` attribute. Its displayed title is looked up from the index. Renaming a page changes the title in one place and never edits linking pages. Deleting a page leaves its links as unresolved, not removed. Pasted or imported `[[Title]]` text is converted to an ID link. See PRD 6.1.
2. **Never lose the user's text.** Edits go through Yjs so they merge; never replace a document's content wholesale on the server.
3. **The index is derived.** The workspace index is always rebuilt from documents, never the other way round. Re-indexing must be idempotent. Backlinks are never stored by hand.
4. **Page text follows Logseq conventions,** so export stays a straight conversion. Bullets are `- `. Nesting is a literal **tab character** before the `- `, never spaces. Tasks are `TODO`, `DOING`, `DONE` at the start of a line (after the optional `- `).
5. **Permissions apply everywhere.** Backlinks, search, autocomplete and the all-pages list must never reveal the title or content of a page the viewer cannot read. WebSocket connections to a document are checked too.
6. **Everything is private by default.** Sharing is explicit (private, link view, link edit).
7. **The parser is shared.** Link, tag and task extraction lives in one module in `app/lib/` and is used by both the index and the editor. Do not duplicate it.

## Conventions

- TypeScript strict. No `any` without a comment explaining why. Prefer small pure functions in `app/lib/` for anything testable.
- Client code must never import from `agents/`, not even types or constants. Shared code goes in `app/shared/`. This is the most common build break.
- Build each Logseq-style editor behaviour (indent, task cycling, `[[` autocomplete) as its own small TipTap extension with its own tests.
- Match the style of surrounding code. Run the formatter and linter rather than hand-formatting.
- Keep components small. Server-only code stays out of `app/components/`.
- No new dependency without asking (see Boundaries). Prefer the platform and what is already installed.
- Accessibility: keyboard-first. Every mouse action in the UI needs a keyboard path.

## Testing

- Unit-test the pure logic first: the shared parser, link mark round-trips through Yjs, indent/outdent, task cycling, fuzzy date parsing.
- Add a regression test with every bug fix.
- Sync, index and permission changes need tests for the failure cases (unauthorised read, deleted link target, re-indexing twice), not just the happy path.
- Do not weaken or delete a test to make it pass. If a test is wrong, explain why in the PR.

## Working agreements

- Read the relevant PRD milestone first. For anything non-trivial, write a short plan (files to touch, risks) before editing and share it.
- One focused change per PR. Branch names: `feat/...`, `fix/...`, `chore/...`. Commit messages: conventional commits (`feat: add backlinks panel`).
- Verify by running the commands above. Say what you ran and what you did not.
- If the spec is ambiguous or a requirement conflicts with an invariant, stop and ask instead of guessing.
- When you learn something a future contributor would trip on, add one line to this file.

## Gotchas

- `DocumentAgent` must not override `alarm()`: the Agents SDK uses it to run `this.schedule()` tasks. Documents created before the expiry was removed still have a deletion alarm scheduled, which only stays harmless while the SDK's handler is in place. Scheduled work must never delete document data.
- Coverage thresholds in `vitest.config.ts` are fixed floors. When your tests raise coverage, raise the floors in the same PR; never lower them. See PRD section 7, "Quality gates".
- Every push to `main` deploys to the live site through Cloudflare Workers Builds, which does not wait for GitHub CI.

## Cloudflare notes

- Bindings are declared in `wrangler.jsonc`. After changing them, run `npx wrangler types`. The generated `worker-configuration.d.ts` is git-ignored and regenerated on install.
- A new Durable Object class needs a new entry in `migrations` in `wrangler.jsonc` with a new tag. Migrations are append-only; never edit or remove one that has been deployed.
- Local secrets and variables go in `.dev.vars` (git-ignored; copy from `.dev.vars.example`). Production secrets use `npx wrangler secret put NAME`.

## Boundaries

**Always**
- Run typecheck, lint and tests before saying a task is done.
- Keep changes scoped to the task. Mention unrelated problems instead of fixing them silently.

**Ask first**
- Adding or upgrading dependencies.
- Changing `wrangler.jsonc` bindings or Durable Object migrations.
- Changing the Yjs document schema (shared type names, mark names or attributes). Bump `DOC_FORMAT_VERSION` in `app/shared/constants.ts` when you do.
- Changing the page text conventions or the sync protocol.
- Deleting or renaming files outside the task's scope.
- Anything that touches authentication or sharing permissions.

**Never**
- Commit secrets, API tokens, `.dev.vars`, or account IDs.
- Run `npm run deploy`, `wrangler deploy`, or any command against the production Cloudflare account. Humans deploy (or CI does on merge).
- Delete or overwrite remote data (Durable Object storage, R2).
- Force-push, rewrite shared history, or edit generated files by hand.
- Disable linting, type checks or tests to get a green build.
