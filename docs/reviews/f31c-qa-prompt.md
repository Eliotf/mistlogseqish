# QA prompt: F31c, several Logseq imports

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change lets `/import` run more than one Logseq import:

- Imports are listed (by folder name) and each can be undone.
- Only one runs or is being undone at a time.
- Undoing an import keeps a page it created if another import still uses it, and that import takes the page over (`handOverImportPage`).

Read first:

- `AGENTS.md`, especially invariants 1–3 and the gotchas about index migrations and `getAgentByName`
- `PRD.md` F31 and the decision of 2026-11-09
- `docs/technical-architecture.md`, "Logseq Import"
- `docs/reviews/f31c-several-imports-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code; judge `npm run test` by its exit code.
2. **Add tests in new files ending `-qa.test.ts`,** using made-up data only. Try to break:
   - **Ordering.** Three imports sharing pages, undone in every order. Is every page deleted exactly when the last import using it is undone, and never before?
   - **Cut short.** An undo stopped after the hand-over but before the record is forgotten, then repeated. And one stopped after `deletePage`.
   - **Concurrency.** Two `start` calls at once. An undo of A while B is running (must be refused). Starting while an undo is unfinished.
   - **Pages used two ways.** A page one import created that another import both writes to and links to. A page deleted by hand between the two imports.
   - **Labels.** Empty, very long, and non-string labels. Two different folders with the same name.
   - **Upgrade.** Schema 5 → 6 with a running import and with a done import.
   - **The view.** Keyboard access to every Undo button. Disabled buttons while an import is unfinished. The list after a failed reload.
3. **Count Durable Object calls** per `pages` and `undo` request in the worst case, against the 50-subrequest limit.
4. **Do not change product code.** Report defects instead. Do not deploy or run anything against production.

## Report

For each defect, give:

- a severity (high, medium or low);
- a failing test or exact steps;
- the file and line;
- a suggested fix.

Then list what held up, and what you couldn't test.
