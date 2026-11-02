# Review guide: M2b.1d, block selection

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/m2b.1d-block-selection-review.md`.

## What this step does

Whole blocks can be selected (PRD F39). Esc selects the caret's block and its children, and the blocks are highlighted. Then:

| Key | What it does |
|---|---|
| Shift+↑ | Adds the visible line above, with its whole block |
| Shift+↓ | Adds the next block |
| ↑ / ↓ | Selects the neighbouring block instead |
| Tab / Shift+Tab | Indents or outdents the selected blocks |
| Backspace / Delete | Removes them, in one undo step |
| Cmd/Ctrl+C | Copies whole lines as Logseq text (tabs and `- ` kept), plus HTML that keeps links |
| Cmd/Ctrl+X | Copies, then removes the blocks |
| Enter | Goes back to editing the first block |
| Esc | Leaves the selection |

Typing and pasting do nothing while blocks are selected.

## Decisions (owner-approved, 2026-11-01)

- The key list comes from the prototype. The owner confirmed nothing is missing.
- Cmd/Ctrl+Enter on a selection cycles tasks. It arrives with the tasks rework (M2b.1f), because task cycling is not built yet.

## What changed

| File | What |
|---|---|
| `app/lib/block-range.ts` | **New.** Pure logic: `blockAt`, `extendRange`, `moveRange` |
| `app/lib/block-selection.ts` | **New.** `BlockSelection` (priority 1000) and `BlockSelectionStart` (priority 1, Esc). Selection state mapped through edits; keys; copy and cut; swallowing input |
| `app/lib/bullet-editing.ts` | Exports `readLines`, `applyEdits` and `Lines` for reuse |
| `app/components/BubbleToolbar.tsx` | No Comment bubble during a block selection. `detectContext` is exported for its test |
| `app/components/Editor.tsx`, `app/app.css` | Registration; `.has-block-selection`, `.block-selected` |
| Tests | `block-range` (6), `block-selection` (19) |
| Docs | PRD (F39, changelog), architecture "Block Selection" |

## Where to look hardest

1. **The text selection under the highlight.** While blocks are selected, the editor's text selection spans them, so the browser fires copy and cut events. Anything that acts on a non-empty text selection could misfire.
   - The Comment bubble did misfire; it's fixed, with a regression test.
   - Typing, `beforeinput`, `handleTextInput` and paste are all swallowed.
   - Are there other paths? Drag-and-drop of the text, spellcheck replacement, or IME composition, which starts without a keydown we see?
2. **Priority.** `BlockSelection` must run before every key handler, including `BulletEditing`'s Tab and Enter and the link plugin's handlers. Esc must run after the link suggestion list, so that list closes first. Both are tested.
3. **Leaving the selection.**
   - Any local transaction that sets the selection ends it.
   - Remote (y-sync) transactions don't end it; their positions are mapped instead.
   - Lines another tab adds exactly at either edge stay outside the selection: the start maps with assoc 1 and the end with assoc −1.
4. **Cmd/Ctrl shortcuts.**
   - Cmd/Ctrl+C and Cmd/Ctrl+X pass through to the browser's copy and cut events.
   - Any other Cmd/Ctrl shortcut leaves the selection first, then runs.
   - A lone Shift, Cmd, Ctrl or Alt keydown is ignored, so the selection doesn't end when you reach for Shift.
5. **Copy format.**
   - Plain text is one line per block, so it pastes into Logseq as an outline.
   - The HTML comes from ProseMirror's `serializeForClipboard`, so a paste back into Mistlog keeps link page IDs. Pasted lines get new block IDs, and arrive unfolded.

## Known gaps

- Selected blocks can't be moved with Alt+Shift+↑/↓ (Logseq can do this). The keys are swallowed.
- Shift+click doesn't select a range of blocks.
- Pasting over selected blocks does nothing. Logseq replaces them.
- Selecting across editors, for example several days in the feed, isn't supported.

## How to verify

```sh
npm run typecheck && npm run lint && npm run test
```

What I ran:

- **Checks:** typecheck, lint and test all exit 0. There are 980 tests, 25 of them new. Every coverage floor went up: statements 81, branches 75, functions 83, lines 83.
- **Deliberate breaks:** each of 16 rules was broken on purpose. The first run missed 5, so I strengthened 3 tests and replaced 1. The fifth wasn't a real difference: ProseMirror already refills an empty page, so I removed that special case from the code instead. The final run catches every break.
- **Headless Chrome against `npm run dev`:**
  - real keys: Esc, Shift+↑, a typed "x" (ignored), ↓, Tab and Shift+Tab, Backspace, Cmd+Z
  - real clipboard: Cmd+C put `\t- a1\n- b\n\t- b1` on the system clipboard; Cmd+X and Cmd+V round-tripped
  - screenshots taken
  - no console errors

The first browser run showed Mist's Comment bubble over the selected blocks, which is now fixed.
