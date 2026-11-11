# QA prompt: F21b, deleting several pages at once

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change lets `/pages` (All pages) delete several pages at once:

- Each page row has a tick box, and the header has "Select all shown", covering every row the current filter shows. Journal days have no tick box.
- "Delete N pages" opens one confirmation naming the pages (first 8, then "and N more"). Escape cancels it.
- The browser calls the existing `POST /api/pages/delete` once per page, at most `BULK_DELETE_BATCH` (5) at a time. Failed pages stay listed and ticked, and an alert names them.

Read first:

- `AGENTS.md`, especially invariants 1, 3 and 5, and the gotchas about `getAgentByName` and subrequests
- `PRD.md` F21 and section 6.3
- `docs/reviews/f21b-bulk-delete-review.md`
- `app/lib/bulk-delete.ts`, `app/components/AllPagesView.tsx`, `app/routes/api.pages.delete.ts`, and `DocumentAgent.deletePage` in `agents/document.ts`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code; judge `npm run test` by its exit code.
2. **Add tests in new files ending `-qa.test.ts` or `-qa.test.tsx`,** using made-up data only. Try to break:
   - **What gets deleted.** Tick, filter, untick, sort, "Show all", toggle journal days, in different orders. Does the button's count always equal what the confirmation names and what is sent? Is a page hidden by the filter ever deleted?
   - **Failures.** Every delete failing; the first batch failing and later ones succeeding; a thrown `deletePage`; a non-JSON 500 answer from the server; `missing` and `journal` codes.
   - **Concurrency.** A single-row delete while the confirmation is open or a bulk delete is running. Pressing the confirm button twice quickly. Never more than 5 requests in flight.
   - **Keyboard.** Every action reachable with Tab, Space and Enter; Escape closes the confirmation but not while deleting; where focus goes after cancelling, after full success and after partial failure.
   - **Journal days.** No tick box, never sent, select all disabled when only journal days are shown.
   - **Titles.** Untitled pages, very long titles, 9 and 200 selected pages.
3. **Count requests and subrequests** for deleting 50 pages, against the 50-subrequest limit per request.
4. **Do not change product code.** Report defects instead. Do not deploy or run anything against production.

## Report

For each defect, give:

- a severity (high, medium or low);
- a failing test or exact steps;
- the file and line;
- a suggested fix.

Then list what held up, and what you couldn't test.
