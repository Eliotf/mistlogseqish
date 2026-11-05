# QA prompt: F14a, pages kept in the browser

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change keeps every page you open in the browser's IndexedDB:

- **Library:** it uses `y-indexeddb`, with the database name `mistlog:v<DOC_FORMAT_VERSION>:<page ID>`.
- **Loading:** the saved copy loads while the page connects, and merges with the server through Yjs.
- **Deleted pages:** a deleted page's copy is cleared (close code 4002).

Read first:

- `AGENTS.md`, especially invariant 2 (never lose the user's text)
- `PRD.md` F14
- `docs/technical-architecture.md` "Browser Copy"
- `docs/reviews/f14a-browser-copy-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code.
2. **If you can add a test-only IndexedDB** (ask the owner before adding a dev dependency such as `fake-indexeddb`), test:
   - two tabs on one page, one of them offline
   - a page deleted while one tab was offline, which then reconnects
   - a format bump (an old copy must be ignored)
   - the journal feed's many lazily connected days
   - a zoomed page loaded from a saved copy
3. **Check that block IDs are never assigned by the browser** to lines loaded from IndexedDB.
4. **If you can run headless Chrome against `npm run dev`:** stop the server mid-edit, type, reload with and without the server, and check text from a second browser profile.

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
