# Review guide: F47, headings

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/f47-headings-review.md`.

## What it does

Markdown headings were only recognised at the very start of a line (`## Notes`). In an outline every line starts with its bullet, and Logseq writes headings as `- ## Notes`, so those, including the imported graph's, showed as plain text. The heading pattern in `app/lib/markdown-decorations.ts` now allows an optional bullet first (`\t*- `), at any depth.

- **Only the display changes.** The text stays as written, so export is unaffected (invariant 4), and there's no schema or document format change.
- **Only the `#`s and the heading text are decorated.** The bullet is left to the bullet styling.
- **Tags are untouched.** A heading needs a space after one to six `#`s, and a tag has none (`- #tag`).

## Scope

The PRD's F47 also listed namespaces (`parent/child` titles grouped in All pages). The owner dropped them on 2026-11-11; this is recorded as a PRD decision.

## Tests

The existing heading tests still pass. Two are new:
- headings after a bullet at depths 0 and 2;
- seven strings that must not become headings: tags, seven `#`s, no text, `#` mid-line, no space after the bullet, and spaces in place of tabs.

## Walked through (local dev server, a made-up page, deleted afterwards)

- `- ## Section heading` shows at 22.5px, weight 600, against 16px body text.
- The line below it, with a `#tag`, stays plain.
- No console errors.
