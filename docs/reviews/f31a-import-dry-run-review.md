# Review guide: F31a, Logseq import dry run

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/f31a-import-dry-run-review.md`.

## What this step does

`/import` (linked from All pages) is step 1 of the Logseq import (PRD F31):

1. Pick a Logseq graph folder.
2. The files are read and converted to Mistlog pages in the browser.
3. Only titles and dates are sent to the server, to see what already exists.
4. A report says what an import would do.

Nothing is written; the Import button is disabled until step 2.

## Decisions (owner-approved, 2026-11-05)

Existing pages and days get the imported lines added below their content. Multi-line blocks keep each continuation line as a plain line under its bullet. Undo will remove exactly what an import added. There's no second import while one exists. It's built as two pushes: this dry run, then import and undo.

## What changed

| File | What |
|---|---|
| `app/lib/logseq-import.ts` | **New.** `convertPage`, `convertGraph`, `titleFromFileName`, `summarise` |
| `app/lib/note-parser.ts` | `writtenLinks`: link and tag finding from text, moved out of the editor so the editor and the import share it (invariant 7) |
| `app/lib/wikilink-editing.ts` | `linkSpans` uses `writtenLinks` |
| `agents/workspace-index.ts`, `agents/workspace.ts` | `importCheck` (read-only, batched) |
| `app/routes/api.import.check.ts` | **New.** `POST { titles, dates }`; JSON only, valid dates only, at most 20,000 items |
| `app/routes/import.tsx`, `app/components/ImportView.tsx` | **New.** The page, the folder picker and the report |
| `app/components/AllPagesView.tsx` | Link to the import page |
| Tests | Converter (18), check route (3), view (3), index (1) |

## Found by running the owner's real graph (read-only, counts only)

- **The graph's own folder is called "Logseq".** The converter took it for Logseq's `logseq/` settings folder and skipped every file. It now uses the nearest matching folder above each file. There's a regression test.
- **4 journal files are sync backup copies** (`2024-05-03T10_20_30.123Z.Desktop.md`). They're skipped with that reason.
- **7 page titles contain `[[ ]]`.** They're kept, with the brackets removed and listed, rather than skipped. Skipping would have dropped their text.
- **File order** used `localeCompare`, which depends on the browser's language settings, so which spelling of a combined title won could differ between computers. It's now a fixed character order.

The converter now takes the whole graph: 186 pages, 725 new days plus 4 existing ones (in the local test data), 507 empty pages for links to pages with no file, 1,477 links, 187 tags, 39 block IDs, 4 folds, 349 continuation lines and 18,472 lines. No line nests more than one level deeper than the line above.

## Where to look hardest

1. **Indentation.** Depth is the number of tabs plus half the number of spaces, rounded down, and never more than one level deeper than the previous bullet. The real graph uses `\t - ` (a tab, then a space), which comes out as one level.
2. **Continuation lines** drop the block's own tabs, then up to the bullet's spaces plus two. Code inside fences keeps the rest of its indentation. A `- ` inside a code fence isn't treated as a bullet.
3. **What's sent to the server:** titles and dates only, never page text.
4. **507 empty pages.** Logseq keeps a page for every linked title in its own database without a file; the import would create them, as typing a link does. Worth flagging to the owner before step 2.

## How to verify

```sh
npm run typecheck && npm run lint && npm run test && npm run build
```

What I ran:

- **Checks:** typecheck, lint, test and build all exit 0. There are 1,144 tests. The coverage floor for branches went up to 79.
- **Deliberate breaks:** 7 converter rules were broken on purpose, and the tests caught every one.
- **Headless Chrome against `npm run dev` (local only):** the owner's real graph folder went through the real page, and the report matched the converter's counts. No errors.
