# QA prompt: F31b, Logseq import and undo

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change makes `/import` write a Logseq import and undo it. The browser (`app/lib/import-run.ts`) drives `POST /api/import/:step` (`app/routes/api.import.$step.ts`) in small batches:

- `start` refuses a second import.
- `pages` finds or creates each title's page.
- `write` calls `DocumentAgent.importLines`, which appends lines through Yjs and records their block IDs.
- `finish` marks the import done.
- `undo` removes exactly those lines and soft-deletes the pages the import created.

Read first:

- `AGENTS.md`, especially invariants 1, 2 and 3 and the gotchas about Yjs text, `getAgentByName`, deleted pages and block IDs
- `PRD.md` F31, and the decisions of 2026-11-05 and 2026-11-06
- `docs/technical-architecture.md`, "Logseq Import"
- `docs/reviews/f31b-import-and-undo-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code. Judge `npm run test` by its exit code.
2. **Add tests in new files ending `-qa.test.ts`.** Use made-up data only; never use real notes. Try to break these:
   - **Idempotency.** Write the same import to a document twice, including when the object restarts in between. Write two different imports to one document, then undo one of them.
   - **Undo exactness.** Undo after the imported lines were edited, moved, split (Enter in the middle of one), merged with a line above, or deleted. Then undo again.
   - **Marks.** Links at the start and end of a line. Two links in a row. A tag directly after a link. Non-ASCII titles. Check each through the real editor, as `tests/unit/lib/import-lines.test.ts` does.
   - **Block IDs.** An imported ID already used in the target document. The same ID on two imported lines. An ID used in a *different* document.
   - **Journals.** An unwritten day with only empty bullets. A day that has notes already. The date-title link forms the converter produces.
   - **Route.**
     - Wrong or stale `importId`.
     - Writes after `finish` or after `undo` has started.
     - Concurrent `start` calls.
     - A page deleted between `pages` and `write`.
     - A failing `deletePage` during undo.
     - Batches over `IMPORT_BATCH`.
     - Bad JSON.
   - **Index.**
     - Rebuilding the index during and after an import.
     - Re-indexing twice.
     - A deleted target page.
     - The 4 → 5 upgrade with existing data.
   - **Browser run.** Retries only on network errors and 5xx. A 409 stops at once. A page with more than 4,000 lines goes alone. Progress reaches the total.
3. **Look for invariant breaks.** Check whether:
   - any imported link is ever stored by title (invariant 1);
   - any server path replaces a document's content wholesale (invariant 2);
   - the import records could make the index disagree with documents after a rebuild (invariant 3);
   - anything the server creates lacks a block ID.
4. **Count Durable Object calls per request.** Check the worst case per request against Workers' free-plan limit of 50 subrequests. `getAgentByName` makes one call of its own.
5. **Do not change product code.** Report defects instead. Do not deploy or run anything against production.

## Report

For each defect, give:
- a severity (high, medium or low);
- a failing test or exact steps to reproduce;
- the file and line;
- a suggested fix.

Then list what you tried that held up, and anything you couldn't test.
