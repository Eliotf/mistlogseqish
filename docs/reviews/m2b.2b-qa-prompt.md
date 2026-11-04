# QA prompt: M2b.2b, All pages with delete

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change adds `/pages`, which lists every page with backlink counts and last-edited dates. It can be filtered and sorted, and journal days can be included on request.

It also adds soft delete:

- **In the document:** a `deleted` marker means it is no longer indexed or served, and its tabs are closed with code 4002.
- **In the index:** the page's entry, derived rows, slugs and registry entry are removed, and the page is recorded in `deleted_pages`.
- **Storage:** the page's Yjs state is kept.

Read first:

- `AGENTS.md`
- `PRD.md` F21 and section 6.3
- `docs/technical-architecture.md` "All Pages and Deleting"
- `docs/reviews/m2b.2b-all-pages-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code.
2. **Add tests in `tests/integration/agents/delete-qa.test.ts` and `tests/unit/components/all-pages-qa.test.tsx`.** Try to bring a deleted page back or lose text:
   - rename and `createWithTitle` on a deleted document
   - a reindex in flight during a delete
   - two tabs deleting at once
   - deleting a page that is open in the side panel
   - the rebuild after a delete
   - creating a new page with the deleted page's old title, then checking which page old links point to (they should still be missing)
   - a page whose title another page links to by its old slug
3. **Check the view:**
   - 1,000 pages: render time, and sort and filter time
   - keyboard-only use: filter, sort and delete
   - screen-reader names
4. **Check the route:** method, content type, invalid IDs. Note what M4 permissions will need here.

## Rules

- Only add test files. Revert any temporary changes and leave no diff.
- If a test you write fails because of a real bug, keep it, mark it with `it.fails(...)`, and add a comment explaining the bug.
- Do not lower coverage floors or weaken tests.
- Do not deploy or touch any Cloudflare account. Do not commit or push.

## Report format

Start with one line: the check results, with exit codes.

Then list findings, most severe first. For each:

- **Severity**: high, medium, or low.
- **Where**: `file:line`.
- **What**: one sentence.
- **Evidence**.
- **Suggested fix**.

Then "Not checked". If you find no real defects, say so plainly.
