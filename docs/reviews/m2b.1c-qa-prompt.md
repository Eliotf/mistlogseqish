# QA prompt: M2b.1c, moving blocks

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change adds moving blocks:

- **Keys:** Alt+Shift+↑/↓ swaps the caret's block with its neighbour at the same level.
- **Dragging:** dragging a bullet drops its block above the target line, at the target's level.
- **What moves:** a block moves with its children, block IDs and folds, as one transaction.

Read first:

- `AGENTS.md`
- `PRD.md` F38
- `docs/technical-architecture.md` "Moving Blocks"
- `docs/reviews/m2b.1c-moving-blocks-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code.
2. **Add tests in `tests/unit/lib/moving-qa.test.ts`.** Use the real editor with Yjs, as `tests/unit/lib/block-moving.test.ts` does. Try to break the outline structure or lose text:
   - blocks next to empty lines and code fences
   - moving the last block of a page down
   - dropping onto the first line
   - a block whose lines carry links (`wikilink` marks) and CriticMarkup marks
   - moving a block while a text selection spans several lines
   - redo after undo
   - two synced editors, where one moves a block while the other types into it
   - a drag that starts and then has its source block deleted by another tab
   - the invariant that a line is at most one level deeper than the line above it, after every move
3. **Check `applyMove`** for position mistakes when `before` equals `from`, equals `to`, or equals `lines.length`.
4. **If you can run headless Chrome against `npm run dev`:**
   - Move with keys, and drag with Chrome's drag interception (`Input.setInterceptDrags`, then `Input.dispatchDragEvent`).
   - Drag between two days in the journal feed. It must be refused, with no text inserted.
   - Click a bullet, and check what the caret does.

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
