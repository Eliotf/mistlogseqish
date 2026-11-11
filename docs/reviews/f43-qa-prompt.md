# QA prompt: F43, the keyboard shortcut sheet and go-to shortcuts

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change adds:

- A keyboard shortcut sheet, opened with `?` outside text fields or with the `?` button in the header. It lists every shortcut from one list, `app/lib/shortcuts.ts`.
- Go-to shortcuts: `g j` (journals, `/`) and `g a` (All pages, `/pages`).

Read first:

- `AGENTS.md`, especially the gotchas about `navigator.platform` and `app/lib/mod-key.ts`, and the conventions on accessibility
- `PRD.md` F43 and the decision of 2026-11-11 about the sheet
- `docs/prototype/mistlog-demo.html`: search for "Link to a date" (the key list) and `onGlobalKey`
- `docs/reviews/f43-shortcuts-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code; judge `npm run test` by its exit code.
2. **Audit the list.** For every entry in `SHORTCUT_GROUPS`, find the code that handles it and confirm the keys and the description match what it really does, including in suggest mode and on a read-only page. Then search `app/` for key handling the list leaves out (`addKeyboardShortcuts`, `handleKeyDown`, `keydown`, `event.key`, `e.key`) and say whether each should be listed.
3. **Add tests in new files ending `-qa.test.ts` or `-qa.test.tsx`,** using made-up data only. Try to break:
   - **Typing.** `?` and `g j` with the focus in: the page editor (also with blocks selected and with a suggestion list open), the page title, the search box, the comment box, a select, and an element inside editable content.
   - **Keyboard layouts.** `?` produced without Shift. Shift+/ producing another character. AltGr (Ctrl+Alt) layouts. IME composition.
   - **Sequences.** `g g j`, `g Shift j`, `G j`, `g` then a pause of exactly `GO_CHORD_MS`, `g` in a field then `j` outside, and `t r` interleaved with `g a`.
   - **Focus.** Focus return when the element that had focus is gone by the time the sheet closes (for example after navigation). The trap when the list area has the focus. Opening from the header button with the mouse.
   - **Modals together.** The sheet and the search box open at once, in both orders. Which one Esc closes, and where the focus ends up.
   - **Server rendering.** Rendering the header and root with `navigator` lacking `platform`.
4. **Check in a real browser if you can** (local dev server only; `GET /new` redirects to the journal feed). Do not use real notes, and delete anything you create.
5. **Do not change product code.** Report defects instead. Do not deploy or run anything against production.

## Report

For each defect, give:

- a severity (high, medium or low);
- a failing test or exact steps;
- the file and line;
- a suggested fix.

Then list what held up, and what you couldn't test.
