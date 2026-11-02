# Review guide: M2b.1c, moving blocks

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/m2b.1c-moving-blocks-review.md`.

## What this step does

Blocks can be moved (PRD F38):

- **Keys:** Alt+Shift+↑/↓ swaps the caret's block with the previous or next block at the same level. The caret stays where it was in the moved line. Nothing moves at the first or last block of a level, and a block never leaves its parent.
- **Dragging:** drag a bullet to move its block. A line shows where it will land: above the line you drop it on, at that line's level.
- **What moves with a block:** its children, including folded ones, along with their block IDs and folds. A move undoes in one step.

## Decisions (owner-approved)

- **Matching the prototype (2026-11-01):** swapping with the neighbour at the same level, and dropping above the target at its level. There is no dropping in as a child; the owner said dragging above is enough.
- **Turned off in suggest mode and read-only editors,** like indenting.

## What changed

| File | What |
|---|---|
| `app/lib/moving.ts` | **New.** Pure logic: `moveBlockPlan`, `dropPlan`, `indexAfterMove`, `movedIndent` |
| `app/lib/block-moving.ts` | **New.** `BlockMoving`: the keys, `applyMove`, the drag handle widget, the drop indicator, `handleDrop` |
| `app/components/Editor.tsx` | Registers `BlockMoving` |
| `app/app.css` | `.bullet-handle`, `.drop-above` |
| Tests | `moving` (8), `block-moving` (11) |
| Docs | PRD (F38, changelog), architecture "Moving Blocks" |

## Where to look hardest

1. **Yjs has no move operation (accepted risk).**
   - A moved line is deleted and inserted again, and y-tiptap may instead rewrite neighbouring elements in place.
   - So a keystroke that another device types into a moved line at the same instant can be lost, or land in the wrong line.
   - Moves are rare and quick, which is why this is accepted. Is that acceptable, or should moves be refused while another client's cursor is in the block?
2. **`applyMove`.**
   - Moving up deletes the block and then inserts it; moving down inserts it and then deletes it, so positions stay valid.
   - Re-indenting rebuilds the node with `node.type.create(attrs, …)`. That keeps the attributes, but check that marks across the tab boundary survive. Indentation is unmarked text by convention (`bullet-editing.ts`).
3. **Dragging.**
   - The handle is a widget with `stopEvent`, so ProseMirror never starts its own text drag.
   - `handleDrop` returns true for every block drag, including onto another editor, so ProseMirror never inserts the drag data as text.
   - The dragged block is tracked by block ID, with the line number as a fallback for unlabelled lines.
   - `dragging` is module state, cleared on drop and on `dragend`.
4. **The handle covers the bullet's text** (`z-index: 1`). Clicking a bullet therefore no longer puts the caret before the "-". Zoom (M2b.1e) will use that click.
5. **Dropping onto a hidden line can't happen** (hidden lines aren't drawn). Dropping just below a folded block lands after its hidden children only if you drop on the next visible line, which is correct.

## Known gaps

- There is no drop target after the last line of a page.
- Blocks can't be moved between pages, or into or out of the side panel.
- Dragging doesn't work on touch screens, because they have no HTML drag events. Keyboard moving works everywhere.
- Moving the selected blocks comes with block selection (M2b.1d).

## How to verify

```sh
npm run typecheck && npm run lint && npm run test
```

What I ran:

- **Checks:** typecheck, lint and test all exit 0. There are 955 tests, 19 of them new. The coverage floors for lines and functions went up to 82.
- **Deliberate breaks:** each rule was broken on purpose and the tests caught every one:
  - escaping the parent
  - dropping a block into itself
  - dragging over another editor
  - dropping on another editor
  - tracking the block by line number only
  - moving in suggest mode
  - dragging in a read-only editor
  - attributes lost on a move
  - the caret not kept

  The two cross-editor breaks needed stronger tests first, which I added.
- **Headless Chrome against `npm run dev`:**
  - real keys: Alt+Shift+↑/↓
  - a real HTML drag, through CDP drag interception: the drop line showed at the target's level, the block landed at that level with its IDs, and everything survived a reload
  - no console errors

The first browser run found that the bullet's text sat on top of the handle, so no drag could start. jsdom has no layout, so the unit tests could not catch this. It's fixed with `z-index`.
