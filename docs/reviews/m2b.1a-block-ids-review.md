# Review guide: M2b.1a, permanent block IDs

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/m2b.1a-block-ids-review.md`.

## What this step does

Every line now has a permanent, invisible ID (PRD F41). Nothing in the interface uses it yet. Zoom (F40), the reworked Tasks page (F6) and later block references need it.

- **Where it lives:** a `blockId` attribute on each paragraph, holding a UUID. It is stored in Yjs, drawn as `data-block-id`, and recorded in the index inside each line's saved content (`DocLine.id`).
- **Document format version 5.** A tab running older code would delete the attribute, so the existing guard refuses it.

## Decisions (owner-approved, 2026-11-01)

1. **Every block gets an ID when it is created.** The alternative, assigning IDs only when a line is first referenced, was rejected: two tabs could assign different IDs to the same line at the same time, and one reference would silently break.
2. **One writer per line.**
   - A browser labels only the lines its own edit creates, in the same transaction.
   - The server labels every other line, once.
3. **Rules:**
   - Splitting keeps the ID with the original text.
   - Joining keeps the upper line's ID.
   - Moving keeps it.
   - Pasted lines get new IDs.

## What changed

| File | What |
|---|---|
| `app/lib/block-ids.ts` | **New.** Shared by the editor and the server: `BLOCK_ID_ATTR`, `isBlockId`, `newBlockId`, `linesNeedingIds` (the rules) and `assignBlockIds` (the server's Yjs pass) |
| `app/lib/block-id-editing.ts` | **New.** `BlockParagraph`, which is Paragraph with the attribute, plus `labelNewLines` in an `appendTransaction` |
| `app/components/Editor.tsx` | Uses `BlockParagraph` instead of `Paragraph` |
| `agents/document.ts` | `labelLines()`. It runs on load, after a browser's edit that adds lines, and on imported content |
| `app/lib/note-lines.ts`, `note-parser.ts` | `DocLine.id`, read from both Yjs and ProseMirror |
| `app/shared/constants.ts` | `DOC_FORMAT_VERSION` 5 |
| Tests | `block-ids` (11), `block-id-editing` (9), `document-agent` "block IDs" (7) |
| Docs | PRD (F41, changelog), architecture "Block IDs", AGENTS.md gotcha |

## Where to look hardest

1. **What counts as a new line** (`labelNewLines`).
   - Each old line's start is mapped through the edit with `assoc 1`. Anything not hit is new.
   - With `assoc -1`, a line inserted directly above another (Enter before the text) would be treated as the old line, and the text would lose its ID. A test catches this.
   - Check other transaction shapes: `replaceWith` across lines, drag and drop within the editor, `setContent`.
2. **Duplicates** (`linesNeedingIds`).
   - ProseMirror's `tr.split` copies attributes, so after a split both halves briefly hold the same ID. The half that existed before keeps it.
   - Among lines that are all eligible (the server's pass), the first one keeps it.
3. **Lines the browser must not label.**
   - A line that existed before the edit stays unlabelled even when you type into it. Only the server labels it, so two tabs cannot race to label it.
   - Remote (y-sync) transactions are skipped.
4. **Server pass inside the update handler.**
   - It runs as a nested `transact` (SERVER_ORIGIN) inside Yjs's `update` event, only for client edits whose transaction changed the fragment's child list. Text edits within a line skip it.
   - It is wrapped in try/catch.
   - It writes nothing, and emits no update, when every line already has a unique ID.
5. **Uncreated journals.**
   - The handler returns before labelling until the first real text, so an empty line is neither labelled nor saved.
   - On load, an uncreated journal's fragment is empty, so labelling writes nothing.
6. **The first line of a new page.** ProseMirror creates it before any edit, so the browser never labels it. The server labels it once the page has text, and that change reaches the browser while the user may be typing. In headless Chrome, typing straight through it kept every character.

## Known gaps

- **Text pasted from outside the app** gets new IDs. Copying lines inside the app also gives new IDs. That is deliberate for now; F43/F44 (block references) may want "cut and paste keeps the ID".
- **No interface uses the IDs yet** (zoom comes in M2b.1e).
- **Export as `id::`** is not built.

## How to verify

```sh
npm run typecheck && npm run lint && npm run test
```

What I ran:

- **Checks:** typecheck, lint and test all exit 0. There are 918 tests, 27 of them new. The coverage floors for lines and functions went up to 81.
- **Deliberate breaks:** each rule was broken on purpose and the tests caught every one:
  - `assoc -1`
  - no remote check
  - no duplicate rule
  - no server labelling on update
  - no server labelling on load
- **Headless Chrome against `npm run dev`:**
  - On a fresh journal day, typing fast through the server's labelling kept every character.
  - Enter and a split gave each line a unique ID.
  - The IDs were the same after a reload.
  - No console errors.

**A false alarm while testing:** a script that called `editor.commands.focus()` and typed straight away lost its first character in the feed. TipTap focuses the editor on the next animation frame, so the key arrived before the editor had focus. It made no difference whether this change was applied. With a 150 ms pause, or a real mouse click followed by immediate typing, 14 of 14 runs kept every character. Browser scripts should wait a frame after `focus()`.
