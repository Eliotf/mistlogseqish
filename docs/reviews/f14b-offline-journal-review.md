# Review guide: F14b, reading the journal offline

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/f14b-offline-journal-review.md`.

## What it does

The owner can open the site on their phone with no connection and read and edit the day's journal (`docs/design-choices.md`, items A to D and F). The data model is unchanged: documents still live in IndexedDB (y-indexeddb) and sync through Yjs.

| Piece | What |
|---|---|
| `public/sw.js` | **New** service worker. Pages and route data (`.data`) come from the network first, with the last good copy kept and served only when offline; a page never seen goes to `/`. Built files (`/assets/*`) come from the cache first. `/api`, `/agents`, other origins, errors and redirects are never kept. Both caches have a size limit, and old versions' caches are cleared |
| `app/lib/offline.ts` | **New.** `registerServiceWorker` (production only), `useOnline`, `isOfflineError`, `savedJournalDays` (from the copies' IndexedDB names), `keepRecentDays` |
| `app/lib/offline-days.ts` | **New**, shared. base64 helpers and limits (10 days, hourly) |
| `app/routes/api.journals.state.ts` | **New.** `POST { dates }` returns each day's Yjs state, read-only, via `DocumentAgent.savedState` |
| `agents/document.ts` | `savedState()`: `encodeStateAsUpdate`, or null if the page was never created or is deleted |
| `app/routes/home.tsx`, `journal.$date.tsx` | `clientLoader`: server first; offline, the saved days, or the day from its copy. A server answer (a 404) is still thrown |
| `OfflineNotice`, `AppShell` | Registration, plus a notice while `navigator.onLine` is false |
| `public/manifest.webmanifest`, icons, `root.tsx` | Add to Home Screen |

## Safety

- **Never replaces content.** Kept days are merged into the local copy with `Y.applyUpdate`, the same as a sync (invariant 2).
- **Never serves old code while online.** Pages always come from the network first when there is one, and the Worker's refusal of outdated editors still applies.
- **No timers or polling.** Recent days are kept once per feed visit, at most hourly: one request costing about 20 subrequests.
- **New risks** are in PRD section 10: an expired sign-in, older code, iOS clearing storage, and data at rest on the phone.

## Tests and checks

- 18 new unit tests: the service worker run as it ships in a fake `self`, the offline helpers, the route, and the fallbacks. 2 agent integration tests.
- 12 deliberate breaks, all caught after tightening 3 tests. One check was redundant and was removed.
- Walked through on a production build (`npm run preview`), in headless Chrome, with the server stopped:
  - The feed and today's page load.
  - A TODO written beforehand shows on both.
  - A day never seen goes to the journal.
  - No console errors.
- Chrome's offline emulation turned out not to stop the service worker's own requests. A gotcha was added to AGENTS.md.

## Not done

- **E (today's tasks offline):** waits for the local index (design choice 1).
- **Not tested on a real iPhone or Android phone.**
