# Review guide: F31b, Logseq import and undo

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/f31b-import-and-undo-review.md`.

## What this step does

`/import` now writes the import after the dry run report, and can undo it (PRD F31 step 2):

1. **Import:** every title gets its page: an existing page, a journal day, or a new page. Linked titles with no page are created empty, as typing a link does (owner's decision, 2026-11-06). Then each page and day gets its lines added below what is there, with `[[links]]` and `#tags` linked by page ID.
2. **One at a time:** a second import is refused while one exists that hasn't been undone.
3. **Cut short:** choosing the folder again continues the same import. Nothing is written twice.
4. **Undo this import:** removes exactly the lines the import added, by block ID, even if they were edited or moved since. It soft-deletes the pages the import created. Lines written since stay.

## Design

The browser drives `POST /api/import/:step` in small batches (`IMPORT_BATCH` = 6 titles or documents per request). Every step is safe to repeat.

| Step | What it does |
|---|---|
| `start` | Records an import in the index (`imports` table). Answers 409 with the current one if one exists |
| `pages` | Finds or creates each title's page. A new page is recorded in `import_pages` as created *before* `createWithTitle`, so undo always finds it. A lost race (`taken`) links to the winner and forgets the record |
| `write` | Records each document, then `DocumentAgent.importLines` |
| `finish` | Marks it done and returns the record |
| `undo` | A few documents per call: `undoImport`, then `deletePage` if the import created it, then forget it. When none are left the import becomes `undone` |

`DocumentAgent.importLines` works like this:
- It appends paragraphs through Yjs (`app/lib/import-lines.ts`), so open tabs merge them.
- In the same synchronous step it stores the added block IDs in `doc_state` under `imports`.
- If that import is already recorded, it does nothing. This is what makes a retried or continued import safe.
- A block ID the document already uses gets a new one.
- A journal day with only empty bullets stays unwritten.

## What changed

| File | What |
|---|---|
| `app/lib/import-lines.ts` | **New**, shared. The wire format (`ImportedLine`), validation, `appendImportedLines`, `removeImportedLines`, `ImportRecord`, `IMPORT_BATCH` |
| `app/lib/import-run.ts` | **New**, browser. `runImport`, `runUndo`, `withRetry` (only for network errors and 5xx), `writeBatches` |
| `app/lib/logseq-import.ts` | `titlesToResolve`, `pageIdFor`, `targetOf`, `linkedLines` |
| `app/routes/api.import.$step.ts` | **New.** The five steps |
| `agents/document.ts` | `importLines`, `undoImport` (under the index lock) |
| `agents/workspace-index.ts`, `agents/workspace.ts` | Schema 5: `imports` and `import_pages`. `startImport`, `recordImportPage` (once created, always created), `startUndo`, `finishUndo`, … `allPages` now leaves out journal days with no text |
| `app/components/ImportView.tsx`, `app/routes/import.tsx` | Import button, progress, Continue, Undo with confirmation, the loader for the current import |
| `vitest.config.ts` | Statements floor 83 → 84 |
| Tests | Writing and removing lines, including a round trip through the real editor (13). Linking (2). Run and retry (8). Route (9). Index (5, including the 4 → 5 upgrade). `DocumentAgent` (5). View (5 new). All pages (1) |

## Found while building

- **A real bug, caught by the editor round trip.** `Y.XmlText.insert` with no attributes takes the formatting of the text before it, so the text after a link became part of the link. Plain runs now pass `{ wikilink: null }`. Added to AGENTS.md.
- **`getAgentByName` makes a fetch of its own.** That is why the batch is 6 and not larger. Added to AGENTS.md.
- **The undo confirmation said "0 pages it created"** after a fresh import. `finish` now returns the import's record.
- **A dead guard was removed.** `linkedLines` had a guard against overlapping links, but `writtenLinks` never returns overlapping links: a tag inside a link title isn't a tag.
- **A test was corrected, not weakened.** The version 3 upgrade test checked for the number 4 literally. It now checks `SCHEMA_VERSION`.

## Checked against the owner's graph (local dev server only, counts only)

- **First run:** the page reloaded partway (cause not found; nothing in the server log). Choosing the folder again continued the same import: 914 pages and days written, nothing written twice.
- **Second, fresh run:** 28 seconds. Pages went from 32 to 723, as expected: 693 titles less the few that existed.
- **Days:** 674 journal days written. 55 of the graph's days hold only empty bullets (Logseq makes a file per day opened); they stay unwritten.
- **Sample days:** every line had a block ID, every link was linked, none were missing.
- **Undo:** 15 seconds. Counts returned exactly to before (32 pages; 110 with journal days). A day's own earlier line stayed.

## Deliberate breaks (each caught by a test)

- Plain runs written without `wikilink: null`.
- A block ID collision not given a new ID.
- No "already imported here" check.
- The block IDs not recorded.
- `recordImportPage` overwriting "created".
- A second import not refused.
- A new page created before it is recorded.
- A failed delete during undo ignored.
- Writing allowed to an import that isn't running.
- Every error retried.

## Worth a careful look

- **Rename versus import.** `pageForTitle` uses `findByTitle` and then `createWithTitle`. A page renamed onto that title between the two calls gives `taken`, which links to the holder. Check that's acceptable.
- **Pages deleted on undo.** Undo soft-deletes created pages even if the owner wrote on them since. That was agreed, and the confirmation says so; the storage is kept for a later Trash.
- **Journal days aren't deleted.** Undo empties them, and empty days are now hidden from All pages. The feed already hid them.
- **Coverage counts the route's error branches.** A failing request is retried with backoff three times, then the screen says to continue or undo.
- **Undone imports keep their rows** in `imports` (state `undone`), as a record. Nothing reads them yet.
