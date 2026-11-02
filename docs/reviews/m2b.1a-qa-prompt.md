# QA prompt: M2b.1a, permanent block IDs

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change gives every line (top-level paragraph) a permanent `blockId` attribute, a UUID. It also bumps the document format to version 5. Browsers label only lines their own edit creates; the server labels every other line.

Read first:

- `AGENTS.md`
- `PRD.md` F41 and the 2026-11-01 decisions
- `docs/technical-architecture.md` "Block IDs"
- `docs/reviews/m2b.1a-block-ids-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code.
2. **Add editor tests in `tests/unit/lib/block-ids-qa.test.ts`.** Use the real TipTap editor with Yjs, as `tests/unit/lib/block-id-editing.test.ts` does. Try to end up with a duplicated ID, or to move an existing ID onto the wrong line:
   - selecting across three lines and typing a character
   - selecting across lines and pressing Enter
   - deleting a whole line and its newline
   - Tab and Shift+Tab on several lines
   - `editor.commands.setContent`
   - inserting a multi-paragraph slice from `editor.state.doc.slice(...)`, which keeps attributes, unlike pasting HTML
   - undo and redo after a split (y-tiptap undo)
   - two editors on two synced Y.Docs, each pressing Enter on the same line at the same moment
3. **Add server tests** (see the "block IDs" block in `tests/integration/agents/document-agent.test.ts`):
   - two clients adding unlabelled lines concurrently
   - a client that sends a duplicate ID
   - a client that sends an invalid ID
   - a client that removes an ID
   - reloading the agent repeatedly: IDs must stay stable, and no new state may be written
   - a renamed page
   - a journal before and after its first text
4. **Check what the browser rejects:** that a format-4 tab is refused, both in the Worker and in `onConnect`.
5. **If you can run headless Chrome against `npm run dev`:**
   - Type, split, join and paste lines, then reload. Check `data-block-id` on each `.tiptap > p`: every line labelled, all IDs unique, and the same IDs after the reload.
   - Open the same page in two tabs and edit both.

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
