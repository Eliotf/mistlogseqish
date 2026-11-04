# QA prompt: M2b.2a, phones (first part)

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change makes Mistlog usable on phones:

- **Keyboard toolbar:** on touch screens, while an editor has focus, a toolbar sits above the on-screen keyboard: outdent, indent, task, link, up, down, fold, done.
- **Layout:** the header is compact, the feed's per-day Mist bar is hidden, and Mist's mobile panel starts collapsed.
- **Touch:** fold arrows always show.

Read first:

- `AGENTS.md`
- `PRD.md` F17
- `docs/technical-architecture.md` "Phones"
- `docs/reviews/m2b.2a-phones-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code.
2. **Add tests in `tests/unit/lib/phones-qa.test.ts(x)`.** Cover:
   - toolbar actions inside a zoom
   - toolbar actions with blocks selected
   - toolbar actions with a link suggestion list open
   - toolbar actions on a folded line
   - two editors (a feed) where focus moves from one to the other: the toolbar must act on the new one
   - the active editor after the Editor unmounts mid-action
   - `visualViewport` missing (older browsers)
3. **Check SSR.** The toolbar and the header must render on the server (Workers runtime: no `window`, and `navigator` has no `platform`) and hydrate without mismatches.
4. **If you can run headless Chrome with touch emulation against `npm run dev`:**
   - Use 390px and 320px widths, and landscape.
   - Check header overflow on every screen.
   - Tap each button, and check that focus stays in the editor.
   - Open the side panel on a phone.

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
