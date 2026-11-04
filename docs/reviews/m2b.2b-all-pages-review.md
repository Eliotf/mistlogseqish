# Review guide: M2b.2b, All pages with delete

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/m2b.2b-all-pages-review.md`.

## What this step does

`/pages`, linked as "Pages" in the header, lists every page (PRD F21, section 6.3):

- **Columns:** title, how many other pages link to it, and when it was last edited.
- **Filtering and sorting:** filter by title; click a column to sort by it and click again to flip. Journal days are hidden unless "Include journal days" is ticked.
- **Size:** the first 200 rows show, then "Show all".
- **Delete:** each page has a Delete button with an inline confirmation ("Links to it will show as missing").
- **After a delete:**
  - the page disappears everywhere: list, search, Tasks and backlinks
  - its addresses return 404, and its title is free for another page
  - links to it show as missing, and open tabs on it switch to "Deleted" and stop editing

This is the second step towards importing the owner's Logseq graph. It's how an import is checked, and how a bad one is cleaned up.

## Decisions

- **Deleting is soft** (2026-11-04): the page's Yjs state stays in its Durable Object. Nothing that was written is ever erased (invariant 2), a later Trash can restore it, and "undo this import" can't destroy text.
- **Journal days can't be deleted yet** (2026-11-04). A day's address is fixed, so a soft-deleted day would reappear the next time its date was opened. This will be settled together with the import's undo.
- **Deferred:** the shared badge and permission filtering come with sharing (M4).

## What changed

| File | What |
|---|---|
| `agents/workspace-index.ts` | Schema 4 (`deleted_pages`). `allPages`, `deletePage`, `isDeleted`; `updatePage` and `registerPage` ignore deleted pages |
| `agents/document.ts` | `deletePage()` under the index lock. The `deleted` marker makes `exists()` false; connections are refused and closed with 4002; the delete is undone if the index fails |
| `agents/workspace.ts` | `deletePage` and `allPages` RPCs |
| `app/lib/all-pages.ts` | **New.** Row type, filter, sort (untitled pages last) |
| `app/routes/pages.tsx`, `app/components/AllPagesView.tsx` | **New.** The page and the view |
| `app/routes/api.pages.delete.ts` | **New.** `POST { pageId }`, JSON only |
| `app/shared/constants.ts`, `useYjsEditor`, `Editor`, `ConnectionStatus` | `CLOSE_DELETED_PAGE` 4002, `deleted` state, read-only editor, a "Deleted" status |
| `AppHeader`, `NewPageButton` | A "Pages" link; on phones, "New" and a smaller brand so the header still fits at 390px |
| Tests | `all-pages` (4), index (5 and a migration), `DocumentAgent.deletePage` (3), routes (8), view (6), browser state (2). The SQL mock now deletes only matching rows, as SQLite does |

## Where to look hardest

1. **The order of operations in `deletePage`.**
   - The marker is written before the index call, so a reindex already queued under the lock sees `exists() === false` and does nothing.
   - If the index call fails, the marker is removed.
   - If the index call succeeds but the response is lost, the document stays deleted and the index has deleted it too, so the two agree.
2. **Resurrection.**
   - `updatePage` and `registerPage` are no-ops for deleted IDs; tested.
   - Could anything else re-add a deleted page? Check `claimTitle` on a deleted ID (it inserts into `registry` and `pages`). Only `DocumentAgent.rename` and `createWithTitle` call it, and a deleted document refuses both because `exists()` is false. Please confirm.
3. **Links to a deleted page** stay in the linking pages' `links` rows. `pagesByIds` doesn't return the deleted page, so the browser shows those links as missing. Backlinks of a deleted page are never shown.
4. **Hydration:** dates are rendered only in the browser. An earlier version formatted them on the server too, and the browser walk-through caught the mismatch.

## Known gaps

- There's no Trash or restore yet; the data is kept for it.
- Journal days can't be deleted.
- Permissions and the shared badge come with M4.
- On phones narrower than 390px, the header still scrolls sideways until the menu button arrives (phase B).

## How to verify

```sh
npm run typecheck && npm run lint && npm run test && npm run build
```

What I ran:

- **Checks:** typecheck, lint, test and build all exit 0. There are 1,102 tests. The coverage floors for statements and branches went up to 83 and 78.
- **Deliberate breaks:** 11 rules were broken on purpose, and the tests caught every one.
- **Headless Chrome against `npm run dev`:**
  - two pages, one linking to the other, showed a backlink count of 1
  - Delete asked for confirmation, then removed the row
  - a second tab open on the page switched to "Deleted" and became read-only
  - the link showed as missing, and the page's address returned 404
  - no console errors, after the hydration fix
  - at 390px the phone header fits exactly
