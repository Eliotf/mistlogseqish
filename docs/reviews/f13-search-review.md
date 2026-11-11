# Review guide: F13, search across pages

For a senior engineer reviewing this change. Find the commits with `git log -- docs/reviews/f13-search-review.md`.

## What this step does

1. **A search box.** Cmd+K (Mac) or Ctrl+K (elsewhere) from anywhere, even while typing in a page, or Search in the header, opens the prototype's search box. It lists titles first (those starting with the query, then those containing it), then pages whose text matches, each with a snippet and the matched words highlighted, then a row to create a page with the query as its title (for a date, to open that day). An empty query lists recently edited pages.
2. **Keyboard.** ↑/↓ choose (wrapping round), Enter opens, Cmd/Ctrl+Enter opens in the side panel, Esc closes and puts the focus back where it was. Tab stays in the box. Clicking a row opens it; Cmd/Ctrl+click opens it in the side panel.
3. **What is found.** Journal days are titled by their date. Days with no text and deleted pages never appear. Untitled pages are found by their text only.
4. **The rename bug (the PRD's F13 note).** A link's text in a page is a stored copy of the title. Search indexed that copy, so after a rename the linking page was still found by the old title and not by the new one. Search now indexes the linked page's current title.

## Design

| Piece | What |
|---|---|
| `parseNote(...).runs` | New parser output: the text as runs, plain strings or `{ pageId, text }` for a link's text. A link split by another mark is one run. Parser version 3 → 4 |
| `textWithTitles(runs, titleOf)` | Joins the runs, each link as its current title, or its stored text when there is none |
| Schema 7: `page_text` | `(page_id, runs JSON)`. Derived: cleared by `clearDerived`, removed by `deletePage` |
| `writeSearchText(pageId)` | Rewrites a page's `pages_fts` row from its runs and the current titles (looked up in chunks of 100) |
| `rewriteLinkingSearchText(pageId)` | Rewrites the rows of every page linking to this one. Called when its title changes (`claimTitle`; `updatePage` with a new title, or a first index), and when it is deleted |
| `search()` | Now joins `pages` for the current title, kind and slug; leaves out journal days with no text; caps at 50 |
| `searchPages(q, titleLimit, textLimit)` | The search box in one RPC: titles by `LIKE`, then FTS hits with a body match. FTS hits matching only by title join the titles (catches accents and word prefixes `LIKE` misses). Returns `pending` too |
| `GET /api/search` | The only way a browser reaches it. Cuts queries to 200 characters. M4 filters here |
| `SearchBoxProvider`, `SearchBox`, `SearchButton` | Context and Cmd/Ctrl+K listener (capture phase), the dialog, the header button (a magnifier on phones) |

## What changed

| File | What |
|---|---|
| `app/lib/note-parser.ts` | `runs`, `TextRun`, `textWithTitles`; `PARSER_VERSION` 4 |
| `agents/workspace-index.ts` | Schema 7 migration; `page_text`; the rewrites above; `search` joined and capped; `searchPages`. Snippet markers moved to `app/lib/search.ts` and re-exported |
| `agents/workspace.ts` | `searchPages` RPC |
| `app/lib/search.ts` | Shared types, limits, `snippetParts`, `searchRows`, `fetchSearch` |
| `app/lib/search-box.tsx` | Provider, `useSearchBox`, `isSearchShortcut` |
| `app/components/SearchBox.tsx`, `SearchButton.tsx`, `AppHeader.tsx`, `app/root.tsx` | The UI |
| `app/routes/api.search.ts`, `app/routes.ts` | The route |
| `vitest.config.ts` | Lines floor 85 → 86, functions 83 → 84 |
| Tests | 67 new. Index: 30 (search box, rename, rebuild order, re-index twice, rebuild equals incremental, delete, journals, 150 links on a db that refuses more than 100 bound parameters, odd queries, caps, 6 → 7 upgrade); older upgrade tests now drop `page_text`. Parser: 5. Route: 4. Lib: 12. Component: 16. The agent RPC test gained `searchPages` assertions |

## Deliberate breaks (each caught by a test)

24 breaks, one at a time, each failing at least one test:

- `claimTitle` not rewriting linking pages; `updatePage` not rewriting them; `updatePage` skipping the first index (rebuild order).
- Search text built from the stored copy (the original bug).
- `deletePage` not rewriting linking pages.
- Empty journal days in full-text results; untitled pages and empty days in title results.
- Title-only hits listed as text matches.
- Linked titles looked up in one query (no chunks of 100).
- No result cap; a rename leaving its own FTS title stale; `page_text` not cleared; migration 7 missing; FTS input not quoted.
- Parser not merging a link split by another mark.
- Route not cutting long queries.
- Arrow keys not wrapping; Escape not closing; Ctrl+Enter ignored; matches not highlighted; snippet markers not split; focus not put back; the shortcut listener missing; a create row offered for an existing title.

## Walked through (local dev server, headless Chrome, made-up pages only)

- In a page, typed `zebra notes about [[Walk Alpha …` and chose the suggestion, then ` quokka`.
- Cmd+K opened the box with the focus in it, listing recent pages (today's journal first, titled "Nov 11th, 2026").
- "alpha quokka" found the linking page, with "Alpha" and "quokka" highlighted.
- Renamed "Walk Alpha" to "Walk Beta" through `/api/rename`. "beta quokka" then found the linking page, its snippet reading `[[Walk Beta …]] quokka`, and "alpha quokka" found nothing.
- Today's journal was found by its text and by "nov 11".
- `AND ("` and `%_` found nothing and caused no errors.
- ↑/↓ wrapped, Enter opened the page, and Esc closed the box.
- A deleted page was not found by its text or its title.
- The create row made a page and opened it.
- At phone width the header shows a magnifier and the box fits.
- No console errors.

## Worth a careful look

- **Parser version bump means a full rebuild after deploy.** Every registered page (about 900 in the owner's graph after import) re-indexes once through the existing rebuild (`REBUILD_BATCH` 10, one-second pauses). Until a page re-indexes, its search row is the old one (stored link copies) and a rename leaves it unchanged. That is the existing, tested path, but watch the Durable Object request count on the day of deploy.
- **Write amplification on rename.** A rename rewrites the search row of every page linking to the renamed page, in the index's transaction. That is one `SELECT`, one `DELETE` and one `INSERT` per linking page, plus a title lookup per 100 linked pages. A page with 500 linkers is 1,500-odd statements inside one Durable Object, so I judged it fine. It is synchronous inside `claimTitle`, so a rename's reply waits for it.
- **Storage.** `page_text` roughly doubles the text the index holds (runs, plus the FTS row).
- **Ordering independence.** A first index of a page counts as a title change (`heldRow?.title !== title`), so a rebuild that reaches a linking page before the page it links to still ends correct. The "rebuild gives the same rows" test checks the end state.
- **Text results are per page, not per line** (a decision, recorded in the PRD). FTS picks the best snippet.
- **Tags** carry the same mark, so `#old` is searched as the page's current title (without the `#[[ ]]` rewrite the editor shows).
- **Mac shortcut.** Only Cmd+K; Ctrl+K stays the system's delete-to-end-of-line in text fields.
- **Not in scope:** the left sidebar's Search entry (F8), `?` shortcut sheet (F43), per-viewer filtering (M4; the route is where it goes).
