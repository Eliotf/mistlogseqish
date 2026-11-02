# QA prompt: M2b.1d, block selection

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change adds block selection. Esc selects the caret's block. Then:

- Shift+↑/↓ grows the selection, and ↑/↓ moves it.
- Tab and Shift+Tab indent.
- Backspace and Delete remove the blocks.
- Cmd/Ctrl+C and Cmd/Ctrl+X copy and cut whole lines.
- Enter and Esc leave the selection.

While blocks are selected, the editor's text selection spans them but isn't drawn, and typing and pasting are swallowed.

Read first:

- `AGENTS.md`
- `PRD.md` F39
- `docs/technical-architecture.md` "Block Selection"
- `docs/reviews/m2b.1d-block-selection-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code.
2. **Add tests in `tests/unit/lib/block-selection-qa.test.ts`.** Use the real editor with Yjs, as `tests/unit/lib/block-selection.test.ts` does. Try to change or lose text through the hidden text selection:
   - composition events
   - `beforeinput` with `insertReplacementText`
   - drag and drop of the selection
   - Cmd+A followed by typing
   - Alt+key combinations
   - Delete on a selection that includes folded blocks
   - Tab on a selection whose first line can't indent
   - another tab deleting the selected lines
   - another tab folding a selected block
   - undo and redo after Tab or Backspace on blocks
3. **Check priorities.** Esc must close the link suggestion list first. Check also the comment input and the page title, which have their own Esc handlers outside the editor. Check Tab with suggestions open.
4. **If you can run headless Chrome against `npm run dev`:**
   - Use real keys and the real clipboard. On a Mac, pass `commands: ["copy"]` and similar with `Input.dispatchKeyEvent`, and grant clipboard permissions.
   - Paste copied blocks into a plain-text field and back into the editor.
   - Check the feed and the side panel.

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
