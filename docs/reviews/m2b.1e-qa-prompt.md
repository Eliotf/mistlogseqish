# QA prompt: M2b.1e, zoom

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change adds zoom:

- **Zooming in:** a bullet click or Cmd/Ctrl+. shows one block and its children, at `?block=<id>`.
- **Zooming out:** a breadcrumb or Cmd/Ctrl+, zooms out.
- **Editing:** while zoomed, this tab's edits are refused if they would reach outside the block (`staysInZoom`). Enter at the end of the zoomed line adds a first child.
- **From elsewhere:** the feed and the side panel open the page zoomed.

Read first:

- `AGENTS.md`
- `PRD.md` F40
- `docs/technical-architecture.md` "Zoom"
- `docs/reviews/m2b.1e-zoom-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code.
2. **Add tests in `tests/unit/lib/zoom-qa.test.ts`.** Use the real editor with Yjs, as `tests/unit/lib/zoom-editing.test.ts` does. Look for both false refusals and leaks:
   - pasting indented multi-line text inside the block
   - undo and redo after edits inside
   - block selection of every child, then Delete
   - Tab on the first child
   - dragging a child above the zoomed line
   - a remote edit that moves the zoomed block elsewhere
   - another tab outdenting a child out of the block
   - zooming into a folded block that sits inside another folded block
   - zooming into a line with no ID
   - a link click inside a zoom
3. **Check `ZoomCrumbs`:** long lines, a line that is only a link, a renamed page title, and a journal day.
4. **Check the routes.** Redirects must keep `?block=`. A missing or garbage `?block=` must show the whole page without errors.
5. **If you can run headless Chrome against `npm run dev`:**
   - Click bullets and use the keys and the breadcrumb.
   - Use Back and Forward, and reload.
   - Click a bullet in the feed and in the side panel.
   - Delete the zoomed block from a second tab.
   - At narrow widths, check the caret at the start of a flush-left line.

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
