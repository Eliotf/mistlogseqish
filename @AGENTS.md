# AGENTS.md

Instructions for AI coding agents (Claude Code, Codex, Cursor, Copilot and others) working in this repo. Humans can use it as a contributor guide too.

Keep this file short and accurate. If a rule here turns out to be wrong or out of date, fix it in the same PR. Prefer pointing to a file over copying its contents here.

## What this project is

Mistlog is a Logseq-style notes app: daily notes, `[[backlinks]]`, tasks, shareable pages, and markdown files stored on a server so syncing is simple. It is forked from [inanimate-tech/mist](https://github.com/inanimate-tech/mist) (MIT licence, keep the attribution in LICENSE).

- Product spec and roadmap: `docs/PRD.md` (read the relevant milestone before starting work)
- Interaction reference: `docs/prototype/mistlog-demo.html` (single-file prototype; match its behaviour, not its code)

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

**Definition of done:** `npm run typecheck && npm run lint && npm run test` all pass, new behaviour has tests, and `docs/PRD.md` is updated if scope or decisions changed.

## Stack

Cloudflare Workers and Durable Objects, React Router 7 (SSR), TipTap 3, Yjs, Tailwind CSS 4, TypeScript, Vitest. Planned additions: Cloudflare D1 (pages, links, shares, users) and R2 (attachments). Node 22+.

## Layout

```
agents/       Durable Object agents (server-side document state, live editing)
app/
  components/ UI components
  lib/        Editor logic, utilities, markdown parsing, sync client
  routes/     File-based routes (UI and API)
  shared/     Types and constants shared by client and server
workers/      Worker entry point
tests/        Test suite
docs/         PRD and prototype
```

## Product invariants (do not break these)

1. **Markdown is canonical.** Every page is one `.md` document. Keep the format Logseq-compatible:
   - Files: `pages/<slug>.md` and `journals/YYYY_MM_DD.md`.
   - Bullets are `- `. Nesting is a literal **tab character** before the `- `, never spaces.
   - Tasks are `TODO`, `DOING`, `DONE` at the start of a line (after the optional `- `).
   - Links are `[[Page Title]]`. Backlinks are derived, never stored by hand.
2. **Saves are compare-and-swap on `version`.** Never overwrite blindly. A stale write returns 412 and the client merges (base, theirs, mine) and retries. Never silently drop a user's text; if a merge cannot be clean, keep a conflicted copy.
3. **Renaming a page rewrites every `[[link]]` to it** in the same transaction.
4. **Permissions apply everywhere.** Backlinks, search, autocomplete and the future all-pages list must never reveal the title or content of a page the viewer cannot read.
5. **Everything is private by default.** Sharing is explicit (private, link view, link edit).
6. **The markdown parser is shared.** Link, tag and task extraction lives in one module in `app/lib/` and is used by both server indexing and client rendering. Do not duplicate regexes.

## Conventions

- TypeScript strict. No `any` without a comment explaining why. Prefer small pure functions in `app/lib/` for anything testable.
- Match the style of surrounding code. Run the formatter and linter rather than hand-formatting.
- Keep components small. Server-only code stays out of `app/components/`.
- No new dependency without asking (see Boundaries). Prefer the platform and what is already installed.
- Accessibility: keyboard-first. Every mouse action in the UI needs a keyboard path.

## Testing

- Unit-test the pure logic first: markdown parsing, link/backlink extraction, indent/outdent, task cycling, three-way merge, fuzzy date parsing.
- Add a regression test with every bug fix.
- Sync and permission changes need tests for the failure cases (stale version, unauthorised read), not just the happy path.
- Do not weaken or delete a test to make it pass. If a test is wrong, explain why in the PR.

## Working agreements

- Read the relevant PRD milestone first. For anything non-trivial, write a short plan (files to touch, risks) before editing and share it.
- One focused change per PR. Branch names: `feat/...`, `fix/...`, `chore/...`. Commit messages: conventional commits (`feat: add backlinks panel`).
- Verify by running the commands above. Say what you ran and what you did not.
- If the spec is ambiguous or a requirement conflicts with an invariant, stop and ask instead of guessing.
- When you learn something a future contributor would trip on, add one line to this file.

## Cloudflare notes

- Bindings (D1, R2, Durable Objects) are declared in `wrangler.jsonc`. After changing them, run `npx wrangler types` and commit the generated types.
- Local secrets and variables go in `.dev.vars` (git-ignored; copy from `.dev.vars.example`). Production secrets use `npx wrangler secret put NAME`.
- D1 schema changes are migrations: `npx wrangler d1 migrations create <name>`, then apply locally before remotely. Migrations are append-only; never edit one that has been applied.

## Boundaries

**Always**
- Run typecheck, lint and tests before saying a task is done.
- Keep changes scoped to the task. Mention unrelated problems instead of fixing them silently.

**Ask first**
- Adding or upgrading dependencies.
- Changing `wrangler.jsonc` bindings, database schema or migrations.
- Changing the markdown file format or the sync protocol.
- Deleting or renaming files outside the task's scope.
- Anything that touches authentication or sharing permissions.

**Never**
- Commit secrets, API tokens, `.dev.vars`, or account IDs.
- Run `npm run deploy`, `wrangler deploy`, or any command against the production Cloudflare account. Humans deploy (or CI does on merge).
- Run destructive commands against remote data (`wrangler d1 execute --remote` with writes, R2 deletes).
- Force-push, rewrite shared history, or edit generated files by hand.
- Disable linting, type checks or tests to get a green build.
