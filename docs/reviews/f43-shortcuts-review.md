# Review guide: F43, the keyboard shortcut sheet and go-to shortcuts

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/f43-shortcuts-review.md`.

## What this step does

PRD F43: "`?` shows every shortcut; `g j` journals, `g a` all pages". In the prototype the key list sits in its prototype-only controls panel, which `?` opens. Here it is a dialog of its own:

1. **`?` opens the sheet** when the focus isn't in an input, text area, select or editable content (so `?` typed in a page stays text). It is matched on `event.key`, so Shift doesn't matter, and it is ignored with Cmd, Ctrl or Alt held or while composing.
2. **A button too.** A small `?` button ("Keyboard shortcuts") sits beside the theme menu in the header.
3. **Modal.** Focus goes to the close button. Tab and Shift+Tab wrap inside the sheet. Esc, the close button or a click outside closes it, and the focus goes back where it was. `?` again while open does nothing.
4. **Go-to shortcuts.** `g` then `j` goes to `/`, and `g` then `a` goes to `/pages`, through React Router. The second key must come within 1 second (`GO_CHORD_MS`, like `t r`'s `CHORD_MS`). A modifier on either key, typing, composing or any other key cancels the sequence. Pressing Shift or Meta alone doesn't. They do nothing while the sheet is open.

## Design

| Piece | What |
|---|---|
| `app/lib/shortcuts.ts` | The list (`SHORTCUT_GROUPS`, each entry an `id`, `keys` and an `action`); `keyLabel` (Mod shown as ⌘ or Ctrl, Up/Down as arrows); `isTypingTarget`; `isSheetShortcut`; `goChord`, a small state machine with an injectable clock; `GO_TARGETS` |
| `app/lib/shortcut-sheet.tsx` | `ShortcutSheetProvider`: open/close with focus return (as `SearchBoxProvider` does), and one window `keydown` listener for `?` and the `g` sequences |
| `app/components/ShortcutSheet.tsx` | The dialog. Its own capture-phase listener handles Esc and the Tab focus trap. The list area is focusable, so it scrolls from the keyboard on a short screen |
| `app/components/ShortcutsButton.tsx` | The header button. It renders nothing outside the provider |
| `app/root.tsx` | Mounts the provider inside `SearchBoxProvider`, and the sheet beside `SearchBox` |
| `app/components/AppHeader.tsx` | One line: `<ShortcutsButton />` before `<ThemeSelector />` |

Mod labels come from `useModKeyLabel()` at render, never at module load (AGENTS.md gotcha). The sheet renders only when open, so the server never renders it.

## How the list stays in step with the code

`tests/unit/lib/shortcuts.test.ts` has a `CHECKS` table keyed by shortcut id:

- **TipTap keymap entries** (Enter, Tab, Backspace, Mod-Enter, Mod-z and redo, Alt-Shift-Arrow, Mod-Arrow, Mod-. and Mod-, , Alt-Enter, Alt-Shift-Enter, Escape) are read from each extension's `addKeyboardShortcuts` with `getExtensionField`, without running any handler. The test also checks that `Editor.tsx` loads that extension.
- **Everything else** (plugin `handleKeyDown`, components, mouse) is checked by file and snippet: the handling code must still be there.
- The table's keys must equal the list's ids. A new entry without a check fails, and so does a check left behind for an entry that was removed.
- `?`, `g j`, `g a` and the sheet are tested by behaviour in `tests/unit/components/shortcut-sheet.test.tsx`. That file also renders the sheet and compares every row's keys and action with the list.

The snippet checks are deliberately literal. Reformatting a handler breaks them, and the fix is to update the snippet.

## What's listed (each checked against the code)

Getting around: `?`, `g j`, `g a`, Mod+K, `t r`. Search box: ↑/↓, Enter, Mod+Enter or Mod+click, Esc. Writing: Enter, Tab/Shift+Tab, Backspace, Mod+Enter, Mod+Z, Mod+Shift+Z/Mod+Y. Blocks: Alt+Shift+↑/↓, Mod+↑/↓, Mod+., Mod+, , clicking a bullet. Links and dates: `[[`, `@`, choosing and closing suggestions, Alt+Enter, Alt+Shift+Enter, Mod+click. Selecting blocks: Esc, Shift+↑/↓, ↑/↓, Tab/Shift+Tab, Mod+Enter, Mod+C/Mod+X, Backspace/Delete, Esc/Enter. On a page: Enter and Esc in the title, Mod+Shift+M (comment), hold P (preview).

Not listed: `t l`, which doesn't exist yet (it comes with F8). Keys local to one control, such as Esc on All pages' delete confirmation and Enter/Esc in comment boxes, are left out to keep the sheet readable.

## What changed

| File | What |
|---|---|
| `app/lib/shortcuts.ts`, `app/lib/shortcut-sheet.tsx` | New, as above |
| `app/components/ShortcutSheet.tsx`, `app/components/ShortcutsButton.tsx` | New, as above |
| `app/root.tsx`, `app/components/AppHeader.tsx` | Mount the provider and sheet; header button |
| `vitest.config.ts` | Functions floor 84 → 85 |
| Tests | `tests/unit/lib/shortcuts.test.ts` (54, including one per list entry), `tests/unit/components/shortcut-sheet.test.tsx` (22) |

## Deliberate breaks (each caught by a test)

Each of these was applied alone and the two test files run. All failed, and every change was restored:

- `?` not checking for typing.
- `?` requiring no Shift.
- No Tab wrap (focus trap).
- No focus return.
- Esc not closing.
- Backdrop not closing.
- No chord timeout.
- Chord ignoring modifiers.
- Another key not cancelling the chord.
- `g a` going to the wrong path.
- Chords working while the sheet is open.
- `Mod-.` removed from Zoom's keymap.
- `Alt-Shift-ArrowUp` removed from BlockMoving.
- CommentInput's key changed.
- A listed entry with no check.
- The sheet dropping a group.
- The sheet dropping alternative keys.
- Mod not replaced.
- The button missing from the header.
- The sheet not mounted in root.
- `navigate` replaced by a no-op.

## Walked through (local dev server on 5175, headless Chrome over CDP, one throwaway page)

- `?` on `/tasks` opened the sheet with 7 groups and ⌘ for Mod, and the focus went to the close button. Tab stayed inside. Esc closed it.
- With the header button focused, Enter opened the sheet. Esc closed it, and the focus went back to the button.
- A click on the backdrop closed it.
- `g j` went from `/tasks` to `/`, and `g a` to `/pages`. A marker set on `window` survived both, so neither was a full page load.
- `g`, a 1.3 s pause, then `j` did nothing. So did `g` then Cmd+J.
- On a throwaway page (made with `POST /api/pages`), typing `a ? g j b` in the editor gave the text `a?gjb`. No sheet opened and the page didn't change. The page was deleted afterwards (200).
- At 375 px wide the sheet is one column, scrolls, and doesn't widen the page.

## Worth a careful look

- **The Mist panel's Cmd/Ctrl+Shift+M** (`CommentInput.tsx`) checks `e.key === "m"` with Shift held. Where Shift makes `key` an upper-case "M" (Ctrl+Shift+M on Windows and Linux, at least), it may never fire. It is listed because the handler exists. It is older Mist code, outside this change, and was not changed here.
- **`?` while the search box is open** is typed into the search field, as it should be. Mod+K while the sheet is open opens the search box over it (search listens in the capture phase, before anything else). Both are then open, and Esc closes the sheet first. This is rare and harmless, so I left it.
- **`isTypingTarget` overlaps `side-panel.tsx`'s private `isTyping`.** I didn't change `side-panel.tsx`, because the sidebar work (F8, `t l`) is changing it in parallel. Once that lands, `useToggleShortcut` could use `isTypingTarget`, which also handles elements inside editable content and is testable in jsdom.
