# QA prompt: M2b.3a, tags as pages

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code.

The change makes `#tag` and `#[[multi word]]` links to pages:

- **Storage:** the tag's name carries the same `wikilink` mark (`pageId`) as a link's title.
- **Shared rules:** tags are found by `tagsInLine` in the shared parser, used by both the index and the editor.
- **Typing:** `#` suggests pages, and a typed `#word` creates its page when you move on.
- **Pasted tags** are linked at once.
- **Renames:** a renamed page shows its current title. A plain tag is rewritten as `#[[...]]` if its page gains a space.

Read first:

- `AGENTS.md`, especially invariants 1, 4 and 7
- `PRD.md` F45 and section 6.1
- `docs/technical-architecture.md` "Tags" and "Links"
- `docs/reviews/m2b.3a-tags-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report each exit code.
2. **Add tests in `tests/unit/lib/tags-qa.test.ts`.** Use the real editor with Yjs, as `tests/unit/lib/wikilink-editing.test.ts` does. Try:
   - a tag at the very end of a line, then Enter
   - a tag followed by punctuation
   - Backspace into a tag
   - `#` typed inside a `[[link]]`
   - `#[[` auto-pairing
   - a tag inside a task line (`TODO #x`)
   - a tag inside a zoomed block
   - undo after a tag is linked
   - two editors typing the same new tag at once (two pages created?)
   - a tag to a journal date
   - a link and a tag to the same page on one line (counted once?)
   - a tag whose page is deleted
3. **Check the index:** tagged lines in backlinks; the `tags` table for `#[[...]]`; idempotence when re-indexing.
4. **If you can run headless Chrome against `npm run dev`:**
   - Type tags with real keys.
   - Use suggestions with the arrow keys.
   - Rename a page and check its tags elsewhere.
   - Check dark mode colours.

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
