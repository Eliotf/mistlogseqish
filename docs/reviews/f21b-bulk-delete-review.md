# Review guide: F21b, deleting several pages at once

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/f21b-bulk-delete-review.md`.

## What this step does

Until now `/pages` deleted one page at a time. Before importing the owner's graph, they want to clear out several at once:

1. **Tick boxes.** Each page row has one. Journal days have none, since days can't be deleted yet.
2. **Select all shown.** A tick box in the header ticks every page row the filter shows, including rows past the first 200 ("Show all"). It shows a partial state when some are ticked, and unticks them all when every shown row is ticked.
3. **One confirmation.** "Delete N pages" opens a confirmation naming the pages: the first 8 titles, then "and N more". Focus moves to Cancel, and Escape closes it and returns focus to "Delete N pages".
4. **Same soft delete.** Each page goes through `POST /api/pages/delete`, unchanged. Links to deleted pages show as missing straight away.
5. **Partial failure.** Deleted rows go. Failed rows stay listed and ticked, and an alert names them, so trying again is one click. A page already deleted elsewhere (`missing`) counts as gone, as in the single delete.

## Design

| Piece | What |
|---|---|
| Browser loop, no new endpoint | Each request deletes one page: one `getAgentByName` fetch plus one RPC, so 2 subrequests, far below the 50 allowed. A list endpoint would have needed its own cap, validation and tests, for no gain at this scale |
| `BULK_DELETE_BATCH` = 5 | At most five deletes in flight at once, so a big selection doesn't flood the Worker or the workspace index (every delete takes the index's lock in turn) |
| Ticked and shown | The pages that count are those ticked **and** shown by the current filter. A page ticked and then filtered out is not deleted, and isn't in the count. Its tick stays, so clearing the filter brings it back |
| Frozen confirmation | The confirmation keeps the rows it was opened with, and the tick boxes are disabled while it is open, so it deletes exactly what it names |
| No Escape while deleting | Cancel is disabled and Escape is ignored once deleting has started. The progress reads "Deleting 3 of 10…" |

## What changed

| File | What |
|---|---|
| `app/lib/bulk-delete.ts` | New. `selectableRows`, `deletePagesInBatches`, `deleteSucceeded`, `describeTitles`, `pagesCount`, and the constants |
| `app/components/AllPagesView.tsx` | Tick boxes, select all, "Delete N pages" and "Clear selection", the confirmation (`role="alertdialog"`), focus handling, and the failure message. A single delete now also unticks its row |
| `vitest.config.ts` | Lines floor 85 → 86 |
| Tests | `tests/unit/lib/bulk-delete.test.ts` (4 new) and 10 new in `tests/unit/components/all-pages-view.test.tsx` |
| `PRD.md` | F21 row and changelog |

No server, index, schema, Yjs or `wrangler.jsonc` change.

## Deliberate breaks (each caught by a test)

- Batch size ignored (all deletes at once).
- Every result counted as deleted.
- Failed rows unticked after deleting.
- No failure message.
- Journal days selectable (in `selectableRows`), and a tick box shown on journal rows.
- Select all covering every row instead of the filtered ones.
- Ticked rows hidden by the filter deleted too.
- `missing` counted as a failure.
- Escape not closing the confirmation, and Escape allowed while deleting.
- Focus not moved to Cancel.
- Tick boxes not frozen while confirming.
- Every title listed, with no "and N more".

## Walked through (local dev server, made-up pages only)

Seven pages named "Bulkwalk Alpha" to "Bulkwalk Golf", driven over CDP in headless Chrome:

- **Space** on a focused row tick box ticks it; two ticked shows "Delete 2 pages".
- **Space** on select all, with the filter on, makes it "Delete 7 pages".
- **Enter** on "Delete 7 pages" opens the confirmation with all seven titles, and focus is on Cancel. **Escape** closes it, and focus goes back to "Delete 7 pages".
- Unticked Golf, then deleted six: only Golf is left, after a reload too, and `/page/bulkwalk-alpha-…` answers 404.
- **Partial failure:** with the delete request forced to 503 in the browser, deleting Golf shows "Couldn't delete 1 page: “Bulkwalk Golf …”", and Golf stays listed and ticked. Deleting it again with the network back worked.
- **Browser console:** no errors.
- Not walked through: journal rows, since the local workspace had no journal days with text. The unit tests cover them.

## Worth a careful look

- **The filter limits what is deleted.** Hidden ticked pages are kept ticked but never deleted. The other option was to clear ticks on every filter change, which loses work when narrowing a search. Check that the count on the button always matches what the confirmation names.
- **Many requests for a big selection.** Deleting 500 pages makes 500 Worker requests, 5 at a time. That is within the free plan's daily request allowance, but a list endpoint (capped at about 20 pages a request) would make it 25 requests. Easy to add later without changing the view, since the view only calls `deletePage(pageId)`.
- **No progress across reloads.** Leaving the page partway through stops the remaining deletes. Pages already deleted stay deleted; nothing is half-done for any one page, since each delete is atomic in its `DocumentAgent`.
- **Focus after deleting** goes to "Delete N pages" if some failed, or to the select-all box if all went.
