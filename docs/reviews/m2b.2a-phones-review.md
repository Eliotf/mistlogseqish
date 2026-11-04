# Review guide: M2b.2a, phones (first part)

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/m2b.2a-phones-review.md`.

## What this step does

Mistlog becomes usable for outlining on a phone (PRD F17). The owner edits on their phone, so this was moved to the front of M2b.2 (decision 2026-11-04).

- **Keyboard toolbar:** while you type on a touch screen, a row of buttons sits just above the on-screen keyboard: ⇤ outdent, ⇥ indent, ☐ task, `[[` link, ↑ and ↓ to move the block, ▾ fold and ✓ done (closes the keyboard). The buttons never take focus, so the keyboard stays open.
- **Header:** compact on phones, without the page address. On page screens it also drops the theme picker, and the connection status shows only its dot.
- **Feed:** each day no longer shows Mist's Edit / Suggest / Connected / Share / Open day bar on phones. The date heading opens the day.
- **Page:** Mist's Editing / Comments / Preview panel starts collapsed instead of taking the bottom third of the screen.
- **Folding and bullets:** fold arrows always show on touch screens, and the bullet's tap target (zoom) is wider.

## Decisions

- **Keyboard toolbar instead of gestures** (2026-10-22, from the prototype).
- **Button set** (2026-11-04): the prototype's outdent, indent, task, link and done, plus up, down and fold, now that the outliner exists. The prototype's `@` date button waits for fuzzy dates (F20).
- **Phones first in M2b.2,** before the index rebuild (2026-11-04).

## What changed

| File | What |
|---|---|
| `app/lib/active-editor.ts` | **New.** The focused editor, for controls outside it |
| `app/lib/phone-actions.ts` | **New.** Each toolbar button as its keyboard command |
| `app/components/PhoneToolbar.tsx` | **New.** The toolbar, which follows `visualViewport` |
| `app/components/Editor.tsx`, `app/root.tsx` | Registration on focus and blur; the toolbar is mounted once |
| `AppHeader`, `TodayButton`, `NewPageButton`, `ConnectionStatus`, `docs.$id.tsx` | Compact header below `sm` |
| `DayBar`, `MobilePanel` | Hidden on phones; collapsed by default |
| `app/app.css` | Touch rules for fold arrows and bullets |
| Tests | `active-editor` (1), `phone-actions` (7), `phone-toolbar` (5), `editor-outdated` (+1), `mobile-panel` (2 updated for the collapsed start) |

## Where to look hardest

1. **Focus.**
   - Buttons use `onPointerDown` with `preventDefault` and `tabIndex=-1`.
   - On iOS Safari, a tap on a non-focusable element normally doesn't blur a contenteditable, but this has only been checked in Chrome's touch emulation, not on a real iPhone. If the keyboard drops on a tap, the fix is to restore focus straight after the action.
2. **Keyboard position.**
   - `bottom = innerHeight - visualViewport.height - visualViewport.offsetTop`, updated on the viewport's `resize` and `scroll` events.
   - iOS also scrolls the layout viewport when the keyboard opens, so check on a real device that the bar sits right on the keyboard rather than above or behind it.
3. **Active editor lifetime.**
   - A late blur from the editor that lost focus must not clear the newly focused one, which matters in the feed with several editors. This is tested.
   - On unmount, the editor clears itself.
4. **`MobilePanel` starts collapsed.** That changes Mist's behaviour for comments on phones: you now tap "Comments" to see threads. Two tests were updated to tap the tab first. They still check the same content, so they were not weakened.

## Known gaps

- There's no left panel or hamburger yet; it comes with the sidebar (F8).
- There's no date button yet (F20).
- Selecting blocks (Esc) has no phone button.
- Dragging bullets doesn't work on touch screens; use ↑ and ↓ instead.
- None of this has been tested on a real phone yet. The owner will check on the live site.

## How to verify

```sh
npm run typecheck && npm run lint && npm run test && npm run build
```

What I ran:

- **Checks:** typecheck, lint, test and build all exit 0. There are 1,064 tests.
- **Deliberate breaks:** 8 rules were broken on purpose, and the tests caught every one.
- **Headless Chrome at 390×844 with touch emulation and an iPhone user agent against `npm run dev`:**
  - the feed and page headers are exactly 390px wide, with no day bars
  - tapping a line showed the toolbar
  - Indent and Task worked with focus kept, Fold hid the child, and Done closed it
  - fold arrows are visible
  - screenshots taken
  - no console errors
