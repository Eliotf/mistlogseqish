# QA prompt: F8 and F17, the left sidebar and phone menu

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change adds the prototype's left sidebar and its phone menu:

- **The sidebar.** Journals, Today, All pages, Tasks, Search, New page, Recent (pages opened in this browser) and an index status line. It is shown or hidden with `t l` or a header button, and remembered per browser.
- **The phone menu.** On phones the same contents open from ☰ as a modal panel, with a focus trap and focus return.
- **The header.** Today, Tasks, Pages and New page moved out of it.

Read first:

- `AGENTS.md`, especially invariants 1 and 5, and the gotchas about timers, `navigator`, and the Workers runtime
- `PRD.md` F8, F17, F13, and the decisions of 2026-10-24 and 2026-11-11
- `docs/technical-architecture.md`, "Left sidebar and phone menu"
- `docs/reviews/f8-left-sidebar-review.md`
- `docs/prototype/mistlog-demo.html` (open it; compare the left nav and the phone frame's menu)

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code; judge `npm run test` by its exit code.
2. **Add tests in new files ending `-qa.test.tsx`,** using made-up data only. Try to break:
   - **Shortcuts.**
     - `t l` and `t r` in every kind of field: input, textarea, select, contenteditable, the search box, the page title.
     - With modifiers held.
     - With the phone menu open.
     - Holding `t` (key repeat).
     - `t`, then a click, then `l`.
   - **Storage.**
     - Blocked, full, or holding rubbish for `mistlog-left-sidebar` and `mistlog-recent-pages`.
     - Two tabs toggling (the second tab's state on reload).
     - The head script with every stored value.
   - **Hydration.** Server-render `AppShell` (`renderToString`) and hydrate it with the sidebar stored closed, and on a phone-width `matchMedia`. Any mismatch, flash or warning?
   - **The phone menu.**
     - Focus trap with nothing focusable after Recent, with a Recent link focused, and with the New page button disabled while it works.
     - Escape while the search box is open over it.
     - Resizing from phone to desktop while open.
     - Opening it while an editor has focus (the phone toolbar must not stay above it).
   - **Recent.**
     - A page renamed, deleted or restored.
     - A journal day with no text.
     - A page opened in the side panel (should it count?).
     - 9+ visits.
     - The same page reached by `/docs/<id>` and by `/page/<slug>`.
     - URL-encoded slugs and `aria-current`.
   - **Index status.**
     - The number of `/api/index/status` requests over a session of 20 navigations with `pending` 0, and while `pending` > 0.
     - Errors and slow answers arriving after the sidebar unmounts.
     - Confirm there is no timer.
   - **Permissions.** Can `/api/index/status` or Recent reveal anything about a page the viewer can't read (invariant 5)?
3. **Check the layout** at 360, 390, 767, 768 and 1280 px wide, with and without the right side panel showing pages. Check for horizontal scroll, the header's overflow, and the sidebar and side panel together on a laptop.
4. **Do not change product code.** Report defects instead. Do not deploy or run anything against production.

## Report

For each defect, give:

- a severity (high, medium or low);
- a failing test or exact steps;
- the file and line;
- a suggested fix.

Then list what held up, and what you couldn't test.
