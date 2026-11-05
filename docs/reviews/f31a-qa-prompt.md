# QA prompt: F31a, Logseq import dry run

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change adds `/import`. You pick a Logseq graph folder; the browser converts it to Mistlog pages (`app/lib/logseq-import.ts`) and asks `POST /api/import/check` which titles and days already exist. A report says what an import would do. Nothing is written.

Read first:

- `AGENTS.md`, especially invariants 2, 4 and 7
- `PRD.md` F31 and the 2026-11-05 import decisions
- `docs/technical-architecture.md` "Logseq Import"
- `docs/reviews/f31a-import-dry-run-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code.
2. **Add tests in `tests/unit/lib/logseq-import-qa.test.ts`.** Use made-up graphs only; never use real notes. Cover:
   - pages with only properties
   - `title::` that is a date
   - unusual indentation: 4 spaces, tabs after spaces, a first line indented
   - fences that never close
   - nested fences
   - property lines after a continuation line
   - CRLF together with a BOM
   - very long lines
   - empty files
   - Unicode titles in different normalisation forms
   - `%` sequences in file names
   - namespaced files in both formats
   - journal file names with impossible dates
   - links inside code
   - tags such as `#[[x]]y`
   - `id::` with uppercase letters
   - many duplicate IDs
3. **Check that nothing loses text.** Every non-blank line of every input file must appear in the output (apart from `id::`, `collapsed::` and `title::`). Write a property-style test for it.
4. **Check the route:** limits, invalid dates, and that nothing is written.

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
