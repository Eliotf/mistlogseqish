# Review guide: F14a, pages kept in the browser

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/f14a-browser-copy-review.md`.

## What this step does

Each page you open is kept in the browser's IndexedDB:

- **It opens at once** with its saved copy, then merges with the server as usual.
- **Unsent edits survive.** Edits made while the server can't be reached survive a reload, and are sent when it's back.

This is the first part of offline mode (F14). The owner asked for it before full offline mode, mainly for phone use.

## Decisions (owner-approved, 2026-11-05)

- **New dependency:** `y-indexeddb@9.0.12`, the Yjs author's own IndexedDB persistence (peer dependency: `yjs ^13`).
- **No change to the phone toolbar.** The iPhone keyboard's own bar can't be hidden by a website, and the owner will use Chrome.

## What changed

| File | What |
|---|---|
| `package.json`, lock file | `y-indexeddb` |
| `app/lib/local-cache.ts` | **New.** `cacheName`, and `openLocalCache`, which returns null without IndexedDB |
| `app/lib/useYjsEditor.ts` | Opens the copy for the page and destroys it on unmount. On close code 4002 (page deleted) it clears the copy |
| Tests | `local-cache` (4), with `y-indexeddb` mocked |
| Docs | PRD (F14 partly done, decision, changelog), architecture "Browser Copy" |

## Where to look hardest

1. **The merge order.**
   - The saved copy can load before or after the server's sync step.
   - `YjsProvider` sends every doc update whose origin isn't itself, so updates applied from IndexedDB are sent to the server either way.
   - Yjs merges are commutative, so there's no overwrite in either order.
2. **Resurrection.** A saved copy holds content the server may no longer have:
   - **A deleted page:** its copy is cleared on 4002. But a browser that never reconnects after the delete keeps its copy, and that page refuses connections anyway.
   - **A server-side reset in development:** the copy re-uploads the old content. That's the "never lose the user's text" direction, so it's intended.
3. **Format changes.** Copies are named by `DOC_FORMAT_VERSION`, so a newer format never loads an older copy. Older copies are left in IndexedDB rather than deleted, which leaks a little storage.
4. **Several tabs on one page** share one database. `y-indexeddb` appends updates and compacts them, deleting only up to the key it read, so another tab's later writes survive. Each tab still syncs with the others through the server, as before.
5. **Block IDs.** Lines loaded from IndexedDB reach ProseMirror as y-sync changes, so the browser never labels them.

## Known gaps

- Opening the app with no connection doesn't work yet; that needs a service worker.
- Nothing on screen says a page shows a saved copy.
- Old-format copies are never cleaned up, and nothing clears copies on sign-out (there are no accounts yet).

## How to verify

```sh
npm run typecheck && npm run lint && npm run test && npm run build
```

What I ran:

- **Checks:** typecheck, lint, test and build all exit 0. There are 1,119 tests.
- **Headless Chrome with real IndexedDB against `npm run dev`:**
  1. Typed "- first line" while connected.
  2. Stopped the server; the status showed OFFLINE.
  3. Typed " plus unsent words".
  4. Restarted the server and reloaded. The text showed at once, before sync.
  5. A second Chrome profile with an empty cache then saw "- first line plus unsent words", so the unsent edit reached the server.
  6. No console errors.
