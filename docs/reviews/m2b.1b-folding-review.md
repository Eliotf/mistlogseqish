# Review guide: M2b.1b, folding

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/m2b.1b-folding-review.md`.

## What this step does

A line with children can be folded (PRD F37):

- **Arrow:** an arrow appears by its bullet on hover. Clicking it folds or unfolds the line.
- **Keys:** Cmd/Ctrl+↑ folds the caret's line and Cmd/Ctrl+↓ unfolds it.
- **Folded bullet:** it gets a ring, and its children are hidden.
- **Storage:** the fold is stored in the page, so it syncs to other devices and to other people viewing the page.

## Decisions (owner-approved)

1. **Folded state lives in the page**, as a `collapsed` attribute on the line (Logseq's `collapsed:: true`) (2026-11-01).
2. **Format version.** The attribute is part of document format 5, alongside `blockId`. Format 5 has not been pushed yet, so this needs no second version bump. Both must ship together.
3. **Behaviour** (2026-11-02, following Logseq):
   - Folding is kept out of undo.
   - An edit that leaves the caret inside a folded block unfolds it.
   - Enter at the end of a folded line adds a sibling after its children.

## What changed

| File | What |
|---|---|
| `app/lib/folding.ts` | **New.** Pure logic: `hasChildren`, `hiddenLines`, `foldedAncestors`, `nearestVisible` |
| `app/lib/folding-editing.ts` | **New.** `Folding` extension: the attribute, decorations, the arrow widget, keys, `setFolded`, `keepCaretVisible`, Enter after a folded line |
| `app/components/Editor.tsx` | Registers `Folding` |
| `app/app.css` | `.fold-hidden`, `.is-folded`, `.fold-toggle` |
| `app/lib/bullets.ts` | `blockEnd` accepts a readonly array |
| `app/shared/constants.ts` | Format 5 note |
| Tests | `folding` (6), `folding-editing` (12) |
| Docs | PRD (F37, decision, changelog), architecture "Folding" |

## Where to look hardest

1. **`keepCaretVisible`** decides between three cases. Check that no transaction shape slips through:
   - **Local edit:** it unfolds.
   - **A fold, whether local or remote:** it moves the caret to the folded line and writes nothing.
   - **A selection move:** the caret skips past the folded block in the same direction.

   The remote case must never write, or two tabs could fight over the fold.
2. **Hidden lines are `display: none` paragraphs.**
   - Native caret movement skips them, as checked in Chrome.
   - What about Shift+arrow range selections across a fold, Cmd+A, and search?
   - Copying a selection that spans a folded block copies its hidden children too, which matches Logseq.
3. **The arrow widget** uses `stopEvent: () => true` and its own mousedown handler, so ProseMirror never sees the click. The widget's `key` changes with the folded state, so it is redrawn.
4. **Split and join on a folded line.**
   - `tr.split` copies attributes, so both halves of a split folded line are marked folded.
   - The half without children hides nothing. The other half keeps its children folded.
   - If the new half becomes a hidden child, the "local edit" rule unfolds the block.
5. **Suggest mode:**
   - Folding still works in suggest mode, because it is an attribute, not text.
   - Enter after a folded line is left to Mist in suggest mode, as `BulletEditing` already does.

## Known gaps

- There is no "fold all" or "unfold all" (Logseq's `t o`). The command palette comes in M2b.3.
- A folded line that loses all its children keeps `collapsed: true` but shows nothing folded. Logseq does the same.
- Zooming into a folded block (M2b.1e) will need to show its children.

## How to verify

```sh
npm run typecheck && npm run lint && npm run test
```

What I ran:

- **Checks:** typecheck, lint and test all exit 0. There are 936 tests, 18 of them new. The coverage floors for statements and branches went up to 80 and 74.
- **Deliberate breaks:** each rule was broken on purpose and the tests caught every one:
  - no unfold on edit
  - no fold exemption
  - fold recorded in undo
  - no remote check
  - no folded Enter
  - no direction
  - folds kept on paste
- **Headless Chrome against `npm run dev`:**
  - real mouse clicks and keys: hover arrow, click to fold, native ↑/↓ skipping the folded children, Cmd+↓/↑, Enter at the end of a folded line
  - reload: the fold is still there
  - screenshots taken
  - no console errors

The first walk-through found that the arrow was drawn a line too low, so a click missed it. The CSS is fixed. jsdom has no layout, so the unit tests could not catch this.
