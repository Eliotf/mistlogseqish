# Review guide: M2b.1e, zoom

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/m2b.1e-zoom-review.md`.

## What this step does

You can zoom into a block (PRD F40):

- **Zooming in:** click a bullet, or press Cmd/Ctrl+. in a line. The page then shows only that block and its children, drawn flush left.
- **The address:** it gains `?block=<id>`, so Back and Forward zoom out and in, and the address can be shared or reloaded.
- **Zooming out:** a breadcrumb (page › the blocks above › this block) zooms out to any level, and Cmd/Ctrl+, zooms out one level.
- **From elsewhere:** in the journal feed or the side panel, a bullet click opens that page zoomed in.
- **Editing while zoomed:** edits stay inside the block, and Enter at the end of the zoomed line adds its first child.
- **A missing block:** if the block disappears, the whole page is shown with "That block is no longer on this page."

## Decisions (owner-approved)

- **From the prototype (2026-11-01):** a bullet click zooms, the address shows `?block=`, and the breadcrumb zooms out.
- **Keyboard path** (needed by AGENTS.md): Logseq's Cmd/Ctrl+. and Cmd/Ctrl+,.
- **Zoom happens in the main view only,** as in the prototype. The feed and side panel open the page zoomed.

## What changed

| File | What |
|---|---|
| `app/lib/zoom.ts` | **New.** Pure logic: `zoomRange`, `ancestorsOf`, `crumbText`, `zoomCrumbs`, `zoomHref`, `ZOOM_PARAM` |
| `app/lib/zoom-editing.ts` | **New.** `Zoom`: `setZoom`, hidden and flush-left decorations, `staysInZoom` (filter), caret clamp, Enter, keys, `ZOOM_EVENT` |
| `app/components/ZoomCrumbs.tsx` | **New.** The breadcrumb, and the "no longer on this page" note |
| `app/components/Editor.tsx`, `ConnectedEditor.tsx` | `zoom` and `onZoom` props |
| `app/routes/docs.$id.tsx` | Reads `?block=`, navigates to zoom. Redirects keep the query |
| `app/routes/page.$slug.tsx` | The old-slug redirect keeps the query |
| `app/components/JournalDay.tsx`, `SidePanel.tsx` | A bullet click opens the page zoomed |
| `app/lib/block-moving.ts` | A click (not a drag) on the bullet handle sends the zoom request |
| `app/lib/folding-editing.ts` | Zoom-aware: the zoomed block shows its children; there's no arrow on it; folds outside it are ignored |
| `app/lib/block-selection.ts`, `block-range.ts` | Selections never reach outside the zoom. Shift+↓ never adds a hidden block |
| Tests | `zoom` (5), `zoom-editing` (13), `zoom-crumbs` (4), `page-routes` (+2, and loaders now get a request) |
| Docs | PRD (F40, changelog), architecture "Zoom", AGENTS.md (a zsh gotcha) |

## Where to look hardest

1. **`staysInZoom` is the safety net, and it decides what you can't do while zoomed.** It refuses a local transaction that:
   - touches at or before the line boundary above the zoomed line, or after its last child;
   - removes the zoomed line's ID;
   - leaves a line it held outside the block.

   Check for false refusals: anything a user should be able to do inside a zoom that it blocks, such as multi-line paste of indented text, or undo. Undo is a y-sync (remote) transaction, so it is never filtered.
2. **Plugin order.**
   - Folding and block selection read the zoom by different routes. Folding keeps the zoomed block in its own state, updated from the same `setZoom` meta, so it doesn't depend on plugin order.
   - Block selection calls `zoomOf(state)`, which reads the zoom plugin's state.
   - Zoom's Enter (priority 120) runs before Folding's (110) and BulletEditing's.
3. **`ZOOM_EVENT` vs React.** The extension never calls React. It sends a DOM event, and `Editor` turns that into `onZoom`, like links do. With no `onZoom`, a bullet click does nothing.
4. **Flush left.**
   - The zoomed block's indentation tabs get an inline decoration with `tab-size: 0; font-size: 0`. The text keeps the tabs.
   - Check the caret at the start of such a line: arrow keys step over invisible tabs.
5. **The breadcrumb** reads the Yjs doc (`linesFromYjs`) through `useSyncExternalStore`, with a JSON-string snapshot so React re-renders only when the crumbs change. `ancestorsOf` now uses `blockEnd`, the same rule as folding and zoom, after a deliberate break showed the old indent scan disagreed with them across blank lines.

## Known gaps

- Zooming happens only in the main view; the side panel and feed open the page instead.
- The zoomed block can't be moved with Alt+Shift+↑/↓ while zoomed (refused). Zoom out first.
- Pasting plain, unindented lines at the end of a zoomed block is refused rather than indented to fit.

## How to verify

```sh
npm run typecheck && npm run lint && npm run test
```

What I ran:

- **Checks:** typecheck, lint and test all exit 0. There are 1,004 tests, 24 of them new. The coverage floors for statements and branches went up to 82 and 76.
- **Deliberate breaks:** each of 16 rules was broken on purpose. The first run missed four:
  - Enter before the zoomed line's text was untested, so I added a test.
  - Delete at the end of the zoomed block was untested, so I added a test.
  - The zoomed line losing its ID was untested, so I added a test.
  - The breadcrumb ancestors disagreed with the block rule, which was a real bug, now fixed.

  The final run catches every break.
- **Headless Chrome against `npm run dev`:**
  - real clicks and keys: a bullet click zoomed with `?block=`; edits and Enter on the zoomed line stayed inside; Backspace at its start was refused
  - navigation: the breadcrumb zoomed out, Back returned, Cmd+, and Cmd+. worked, and a zoomed address survived a reload
  - the feed: a bullet click opened the day zoomed
  - screenshots taken
  - no console errors
