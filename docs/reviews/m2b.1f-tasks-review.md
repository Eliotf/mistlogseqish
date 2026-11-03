# Review guide: M2b.1f, tasks

For a senior engineer reviewing this change. It is two commits; find them with `git log -- docs/reviews/m2b.1f-tasks-review.md` and the commit before it ("LATER/NOW, priorities and Cmd/Ctrl+Enter task cycling").

## What this step does

Tasks are reworked on top of the outliner (PRD F6, F42):

- **States:** besides `TODO` → `DOING` → `DONE`, there is Logseq's `LATER` → `NOW` → `DONE`.
- **Cycling:** Cmd/Ctrl+Enter starts a plain line as `TODO` and cycles from there. It works on every line a text selection touches, or on the top lines of selected blocks.
- **Priorities:** `[#A]`, `[#B]` and `[#C]` are recognised.
- **Styling:** keywords and priorities are styled text, and DONE text is struck through. Keywords are styled in linked references too.
- **The Tasks page:** `/tasks`, linked from the header. It is one read-only list:
  - NOW, DOING, TODO, LATER, with higher priority first within each, then the most recently done tasks
  - each task labelled with its page and shown like a linked reference
  - clicking a task opens its page zoomed into that line; Cmd/Ctrl+click opens the page in the side panel

## Decisions (owner-approved)

- **2026-10-28:**
  - Tasks are styled text, not checkboxes.
  - The Tasks view reuses the linked-references design.
  - Ticking a task from the Tasks view was dropped. The parked `/api/tasks/set-state` from `wip/tasks` is not brought over.
- **2026-11-01:**
  - LATER/NOW and priorities.
  - Cmd+Enter on a plain line starts with `TODO`.
  - The Tasks page is one list ordered NOW, DOING, TODO, LATER.
  - A task opens its page zoomed in.

## What changed

| File | What |
|---|---|
| `app/lib/note-parser.ts` | `LATER`, `NOW`, `TaskPriority`, `priorityAt` and `priorityOf`; tasks carry `priority` and `blockId`. `PARSER_VERSION` 2 |
| `agents/workspace-index.ts` | Schema 3: `tasks.block_id`, `priority`, `content`. `tasks()` orders by priority and returns page kind and `updatedAt` |
| `agents/workspace.ts` | `tasks()` returns serialisable `TaskItem`s. `toBacklinkLine` is shared with `backlinks()` |
| `app/lib/tasks.ts` | **New** (salvaged from `wip/tasks`): cycles, `setTaskEdit`, `cyclePlan`, `OPEN_STATES`, `TaskItem` |
| `app/lib/task-editing.ts` | **New** (salvaged): `TaskEditing` (Cmd/Ctrl+Enter, styling), `cycleLines` |
| `app/lib/block-selection.ts` | Cmd/Ctrl+Enter cycles the top lines of the selected blocks |
| `app/lib/backlink-lines.ts` | `toBacklinkLine` |
| `app/components/ReferenceLine.tsx` | **New.** The stored-line renderer, moved out of `Backlinks`. Adds `plainLinks` and keyword styling |
| `app/components/TasksView.tsx`, `app/routes/tasks.tsx` | **New.** The view and its loader. It reloads when the tab is shown again |
| `app/lib/mod-key.ts` | **New.** Safe ⌘/Ctrl label (see "Bug found") |
| `app/components/AppHeader.tsx`, `app/routes.ts`, `app/app.css` | The header link, the route, and task styles usable outside the editor |
| Tests | `tasks` (19), `task-editing` (7), `tasks-route` (3), `tasks-view` (6), `mod-key` (3), plus parser, index (migration 2→3, priority order) and agent additions |
| Docs | PRD (F6, F42, changelog), architecture "Tasks", AGENTS.md (invariant 4 and a gotcha) |

## Bug found before it shipped

`TasksView` computed its ⌘/Ctrl label from `navigator.platform` when the module loaded. The Workers runtime has a `navigator` without `platform`, so the module threw at load. Because every route is in one server build, **every page failed to render**, not just `/tasks`.

The unit tests ran in Node, which does have `navigator.platform`, so they passed. The browser walk-through against `npm run dev` (workerd) caught it.

The fix is `app/lib/mod-key.ts`, used by `TasksView` and the fold arrow's tooltip, plus a regression test that loads `TasksView` with no `navigator.platform`. That test fails against the original code. A gotcha line was added to AGENTS.md.

## Where to look hardest

1. **The parser bump without a rebuild.**
   - `PARSER_VERSION` 2 should trigger a full rebuild, but the rebuild (M1 chunk 1.6) was never built. Pages re-index only when opened.
   - Until then, an old row has no block ID (it opens the whole page) and no stored line (it shows as keyword plus text).
   - `LATER` and `NOW` lines on unopened pages are missing from the list. That's unlikely, as the keywords weren't recognised before.
   - Should chunk 1.6 come next?
2. **Migration 2→3** is three `ALTER TABLE ADD COLUMN` statements in one migration step. It is tested by rebuilding a version-2 `tasks` table, upgrading it, and re-indexing.
3. **RPC serialisability.** `TaskItem` holds only plain fields, and `content` (a `DocLine` with `unknown` attrs) never crosses the RPC boundary. This was the `never` trap from chunk 2.6.
4. **Cmd/Ctrl+Enter ownership.**
   - With blocks selected, `BlockSelection` (priority 1000) handles it.
   - Otherwise `TaskEditing` does. In suggest mode it is swallowed, and in a read-only editor it is not handled.
   - Check that zoom's filter allows cycling: the edits are inside lines, so it should.
5. **Done ordering** uses the page's last indexed time, not when the task was done. An edit elsewhere on the page moves its done tasks up.

## Known gaps

- There's no full index rebuild yet (see above).
- The Tasks page doesn't apply permissions yet (M4), the same as every index route.
- Done order follows page activity, not completion time.
- Changing a task as a suggestion is part of F34.

## How to verify

```sh
npm run typecheck && npm run lint && npm run test && npm run build
```

What I ran:

- **Checks:** typecheck, lint, test and build all exit 0. There are 1,050 tests. Coverage floors were raised in the first commit (lines 84, branches 77).
- **Deliberate breaks:** 11 in the first commit and 7 in the second, plus the original platform bug. The tests caught every one.
- **Headless Chrome against `npm run dev`:**
  - real Cmd+Enter cycled DOING and NOW, and `[#A]` was styled
  - `/tasks` listed them under NOW, DOING and TODO with the day's name
  - clicking the `[#A]` task opened `/journal/<day>?block=<id>`, showing only that line
  - screenshots taken
  - no console errors after the fix
