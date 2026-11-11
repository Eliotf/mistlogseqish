# Review guide: F44, slash menu

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/f44-slash-menu-review.md`.

## What it does

`/` at the start of a line or after a space opens a list of commands, narrowed by the text typed after it:
- Task keywords: TODO, DOING, LATER, NOW, DONE.
- Date, which opens the `@` list.
- Link, which opens `[[ ]]` with its page suggestions.
- Headings 1 to 3.

Choosing a command removes the `/query` and runs the command in the same transaction. A task or heading command is a prefix edit (`applyEdits`), so marks on the rest of the line survive. Embed and template wait for F48 and F51.

## Design

| File | What |
|---|---|
| `app/lib/inline-trigger.ts` | **New.** `canTriggerAt` (start of line or after a space, not in a link) and `triggerQuery`, shared by `@` and `/` |
| `app/lib/slash-commands.ts` | **New**, pure. The command list, `matchCommands` (label prefix, then contains, then other words), `headingEdit` |
| `app/lib/slash-menu.ts` | **New** extension `SlashMenu`, priority 200 like `DateTrigger`; `runSlashCommand` |
| `app/lib/date-trigger.ts` | Now uses the shared trigger helpers (no behaviour change; its 11 tests still pass) |
| `app/lib/link-suggestions.ts` | `command` items (label, plus hint in grey) |
| `app/lib/markdown-decorations.ts` | A heading may follow a task keyword |

## Found while building

`/h2` on `- LATER plan` first wrote `- ## LATER plan`. The parser only reads a keyword at the start of a line's text, so the line silently stopped being a task. The heading now goes after the keyword (`- LATER ## plan`), and the heading display allows for that.

## Tests and checks

- 13 new tests:
  - `matchCommands` and `headingEdit`;
  - the menu in a real editor: open, narrow, keys, undo, link, date, the places it must not open, Escape and blur.
- 14 deliberate breaks, all caught.
- Walked through in Chrome on a made-up page, deleted afterwards:
  - `/` lists all 10 commands; a screenshot confirmed the layout.
  - `/lat` sets LATER, and `/h2` gives a heading.
  - `/link` opens the link suggestions.
  - No console errors.
