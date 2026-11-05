# Review guide: M2b.3a, tags as pages

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/m2b.3a-tags-review.md`.

## What this step does

`#tag` and `#[[multi word]]` are now links to pages (PRD F45), as in Logseq:

- **Suggestions:** typing `#` and a letter shows the same page list as `[[`. Choosing a page writes `#name`, or `#[[name]]` if the name has spaces, followed by a space.
- **Creating pages:** a typed `#word` with no matching page creates that page when you move on.
- **Pasted tags** are linked at once.
- **Display:** a tag shows its page's current title, in the tag colour with a faint `#`. Clicking it opens the page.
- **References:** tagged lines show in the page's linked references and in All pages' backlink counts.

This is the third step towards the import: the owner's graph has 198 tags.

## Decisions (owner-approved, 2026-11-05)

- A typed `#word` creates its page.
- `#` shows the suggestion list.
- No prototype step, since tags behave like `[[ ]]`.

## What changed

| File | What |
|---|---|
| `app/lib/note-parser.ts` | `tagsInLine` (shared by the index and the editor), `isPlainTagName`; multi-word tags in the parsed tags. `PARSER_VERSION` 3 |
| `app/lib/wikilink-editing.ts` | Spans have a `kind` (`link` or `tag`) and `bracketed`. Changes to editing, display, copying, choosing a suggestion, new-span detection, and rewriting `#name` as `#[[...]]` |
| `app/app.css` | Tag styles and the `--color-tag` colour for both themes |
| Tests | Parser (4), editor (9), plus the span shape in an existing link test |
| Docs | PRD (F45, decision, changelog), architecture "Tags" |

## Where to look hardest

1. **No new mark.** A tag's name carries the existing `wikilink` mark, so tabs on format 5 understand it and there's no format bump. The index already counts marks as links, which is how tags reach linked references.
2. **Where a plain tag ends.** Its span runs from after the `#` up to and including its end, because you keep typing there. Typing a space or moving away settles it. Check typing punctuation straight after a tag (`#books,`): the comma isn't part of the tag, so the tag settles.
3. **The new-span rule.** In the link plugin's `apply`, a span that the current local edit created starts with an empty stored title, so suggestions show from the first letter and settling treats it as new. This was added for tags, but it applies to links too; `[[` already started empty, so nothing changes there.
4. **Existing plain `#tags` in Mistlog pages** show as dashed ("Not linked yet") until your cursor passes through them, which then links them (and creates their pages). The owner agreed to this.
5. **Parser version 3.** Multi-word tags now count in the parsed tags, which changes the parser's output. After deploy the index rebuild (chunk 1.6) re-reads every page in the background.

## Known gaps

- The `tags::` page property comes with properties (F46).
- Nothing reads the index's `tags` table yet; queries come with F50.
- Pasting many new `#words` creates many pages, as Logseq does.

## How to verify

```sh
npm run typecheck && npm run lint && npm run test && npm run build
```

What I ran:

- **Checks:** typecheck, lint, test and build all exit 0. There are 1,115 tests. The coverage floor for lines went up to 85.
- **Deliberate breaks:** 10 rules were broken on purpose. Two slipped through at first: suggestions from the first letter, and a `#[[tag]]` inside code. I added both tests, and now all 10 are caught.
- **Headless Chrome against `npm run dev`:**
  - typing `#garden…` created and linked a page
  - suggestions listed existing pages, and choosing one wrote the tag and a space
  - clicking the tag opened its page, whose linked references showed the tagging line
  - a screenshot shows the tag colour
  - no console errors
