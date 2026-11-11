# QA prompt: F13, search across pages

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change adds search across pages:

- A search box opened with Cmd/Ctrl+K or the header's Search button, listing title matches, text matches with highlighted snippets, and a row to create a page (`GET /api/search`, `WorkspaceIndex.searchPages`).
- A fix so a link is searched by its page's current title, not the stored copy: index schema 7 (`page_text`), parser version 4, and linking pages' search rows rewritten when a title changes or a page is deleted.

Read first:

- `AGENTS.md`, especially invariants 1, 3, 5 and 7, and the gotchas about index migrations, bound parameters and `navigator`
- `PRD.md` F13 and the decision of 2026-11-11
- `docs/technical-architecture.md`, "Workspace Index"
- `docs/reviews/f13-search-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code; judge `npm run test` by its exit code.
2. **Add tests in new files ending `-qa.test.ts`** (or `-qa.test.tsx`), using made-up data only. Try to break:
   - **Derived and idempotent.** Any sequence of updates, renames and deletes, then `clearDerived` and re-indexing the final documents in a random order: are `pages_fts` and `page_text` identical? Try renames that arrive only as `updatePage`, two pages swapping titles, a page linking to itself, and links to journal days that have no entry.
   - **Rename races.** A rename (`claimTitle`) followed by an older `updatePage` that is ignored; a rename back to the old title; a title changed by case only.
   - **Deleted pages.** A deleted page must never appear (title, text, recent list), including after late updates and registrations. Do the pages linking to it reveal its *current* title anywhere after deletion?
   - **Odd input.** FTS syntax, quotes, `*`, `^`, `NEAR`, column filters, LIKE wildcards, emoji, combining accents, right-to-left text, control characters (including the snippet markers `\u0002` and `\u0003` inside page text), very long queries and very long pages.
   - **Limits.** Results capped; no query binds more than 100 parameters (wrap the test db to refuse more).
   - **Upgrade.** Schema 6 → 7 with existing pages and links: old rows still found, a rename before re-indexing, then re-indexing.
   - **The box.** Keyboard only: open, type, ↑/↓, Enter, Cmd/Ctrl+Enter, Esc, Tab. Focus returns. A slow response arriving after a newer one. Creating a page whose title exists in another case, or is a journal date. Server rendering (no `navigator.platform` at module load).
3. **Count work per rename** for a page linked from 1,000 pages: statements run, and whether any query exceeds 100 bound parameters.
4. **Do not change product code.** Report defects instead. Do not deploy or run anything against production.

## Report

For each defect, give:

- a severity (high, medium or low);
- a failing test or exact steps;
- the file and line;
- a suggested fix.

Then list what held up, and what you couldn't test.
