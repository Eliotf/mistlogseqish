# QA prompt: M2b.1f, tasks

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change reworks tasks:

- **States:** `LATER` and `NOW` join `TODO`, `DOING` and `DONE`, and `[#A]`–`[#C]` are priorities.
- **Cycling:** Cmd/Ctrl+Enter cycles the lines a selection touches, or the top lines of selected blocks.
- **Index:** parser version 2 and index schema 3, so tasks keep their block ID, priority and stored line.
- **The Tasks page:** a read-only `/tasks` lists NOW, DOING, TODO, LATER, then recently done. Each task opens its page zoomed into its line.

Read first:

- `AGENTS.md`
- `PRD.md` F6 and F42
- `docs/technical-architecture.md` "Tasks"
- `docs/reviews/m2b.1f-tasks-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code.
2. **Add parser and index tests in `tests/unit/lib/tasks-qa.test.ts`.** Cover:
   - keywords after `- ` and tabs, and keywords inside code fences
   - `[#a]` in lowercase, `[#AB]`, and `[#A]` inside a link title
   - several priorities on one line
   - LATER/NOW lines in the index
   - re-indexing the same page twice (idempotence)
   - a migration from a real version-2 database that has task rows
3. **Add editor tests:**
   - Cmd/Ctrl+Enter across a selection spanning a folded block
   - Cmd/Ctrl+Enter inside a zoom
   - Cmd/Ctrl+Enter with blocks selected where the first block is nested deeper than later ones
   - undo after cycling
   - two synced editors cycling the same line at once
4. **Check the server side:**
   - that `WorkspaceAgent.tasks()` results are serialisable (no `unknown`-typed fields reach the route)
   - that a broken stored `content` value can't crash the page
5. **Check the server bundle** for any other module-level use of browser-only globals (`navigator`, `window`, `document`, `localStorage`). See the AGENTS.md gotcha.
6. **If you can run headless Chrome against `npm run dev`:**
   - Cycle tasks with real keys.
   - Open `/tasks`, click tasks, and Cmd+click one.
   - Return to the tab after changing a task elsewhere, and check that the list updates.

## Rules

- Only add test files. Revert any temporary changes and leave no diff.
- If a test you write fails because of a real bug, keep it, mark it with `it.fails(...)`, and add a comment explaining the bug.
- Do not lower coverage floors or weaken tests.
- Do not deploy or touch any Cloudflare account. Do not commit or push.

## Report format

Start with one line: the check results, with exit codes.

Then list findings, most severe first. For each:

- **Severity**: high, medium, or low.
- **Where**: `file:line`.
- **What**: one sentence.
- **Evidence**.
- **Suggested fix**.

Then "Not checked". If you find no real defects, say so plainly.
