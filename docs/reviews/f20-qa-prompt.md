# QA prompt: F20, fuzzy dates

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change adds fuzzy dates:

- `app/lib/fuzzy-dates.ts` turns phrases into dates.
- `app/lib/date-trigger.ts` adds an `@` list in the editor.
- `app/lib/wikilink-editing.ts` adds date items to the `[[` suggestions.
- The phone toolbar gets an `@` button.

Read first:

- `AGENTS.md`, especially invariant 1 and the gotchas about "today" and the suggestion list
- `PRD.md` 6.2, and the decision of 2026-11-11
- `docs/reviews/f20-fuzzy-dates-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code.
2. **Add tests in new files ending `-qa.test.ts`.** Try to break:
   - **Phrases:** every phrase at month, year and leap-year boundaries. Run with `TZ` set to a zone with daylight saving, and to one far from UTC (`Pacific/Kiritimati`).
   - **The `@` list:** after punctuation, after a tab, at the start of a nested line, after a link, while another tab edits the same line (a Yjs change from elsewhere), with undo just after choosing, and with IME composition.
   - **The `[[` list:** dates against pages titled like dates ("tomorrow", "Nov 3rd, 2026"), and tags.
   - **Every link written:** check it carries a journal ID and round-trips through Yjs and the shared parser.
3. **Do not change product code.** Report defects instead. Do not deploy.

## Report

For each defect, give:

- a severity (high, medium or low);
- a failing test or exact steps;
- the file and line;
- a fix.

Then list what held up, and what you couldn't test.
