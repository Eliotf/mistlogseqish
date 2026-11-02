# QA prompt: M2b.1b, folding

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change adds folding. A line with children can be folded with the arrow by its bullet or with Cmd/Ctrl+↑/↓. The fold is a `collapsed` attribute on the line, synced through Yjs and kept out of undo. Hidden lines are never edited:

- the caret skips them;
- a local edit that lands in a folded block unfolds it;
- a fold that hides the caret moves the caret;
- Enter at the end of a folded line adds a sibling after its children.

Read first:

- `AGENTS.md`
- `PRD.md` F37 and the 2026-11-01 and 2026-11-02 decisions
- `docs/technical-architecture.md` "Folding"
- `docs/reviews/m2b.1b-folding-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code.
2. **Add tests in `tests/unit/lib/folding-qa.test.ts`.** Use the real editor with Yjs, as `tests/unit/lib/folding-editing.test.ts` does. Try to get text into a hidden line, or to make two tabs fight over a fold:
   - Backspace at the start of the line after a folded block
   - Delete at the end of a folded line
   - Shift+Tab on a hidden child, reached by a range selection
   - typing over a range selection that spans a folded block
   - pasting several lines at the end of a folded line
   - undo after unfolding by an edit
   - two synced editors where one folds while the other types in the child
   - folding inside folding
   - a code fence inside a folded block
   - suggest mode
3. **Check the decorations**: `.fold-hidden`, `.is-folded` and `.fold-toggle`. Check they update when a remote change adds or removes children.
4. **If you can run headless Chrome against `npm run dev`:**
   - Fold with the mouse and the keyboard.
   - Move with ↑/↓, Shift+↑/↓, Home/End and Cmd+A across a fold.
   - Reload, and open the page in a second tab.
   - Check the journal feed and the side panel.

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
