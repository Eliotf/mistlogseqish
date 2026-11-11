# Review guide: F8 and F17, the left sidebar and phone menu

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/f8-left-sidebar-review.md`.

## What this step does

The prototype's left sidebar, and on phones the same contents behind ☰ (PRD F8, F17; decision of 2026-11-11):

1. **Sidebar.** Journals, Today, All pages, Tasks, Search (opens the Cmd/Ctrl+K box) and New page; then Recent; then, at the foot, a status line while the index is catching up and the hint "t l · t r toggle panels".
2. **Shown or hidden** with `t l` (not while typing in an editor or field) or the header's sidebar button. Remembered per browser; a closed sidebar doesn't flash open while the page loads.
3. **Header.** Today, Tasks, Pages and New page move into the sidebar, as the decision of 2026-10-24 planned. The header keeps the name, the sidebar button (☰ on phones) and the theme. Search stays in the header on phones (no Cmd/Ctrl+K there) and while the sidebar is hidden.
4. **Recent.** The last 8 pages and journal days opened in this browser, newest first, by their current title. Deleted pages are left out (the page on screen is always listed, even before the index knows it).
5. **Phone menu.** Below 768px, ☰ opens the contents in a panel sliding in from the left. Escape, tapping outside, ✕, choosing a link or moving to another screen closes it. The focus moves in, Tab and Shift+Tab wrap inside, and the focus goes back to ☰ after. `t l` opens and closes it there.
6. **`t r`** was already wired to the right side panel; it still is.

## Design

| Piece | What |
|---|---|
| `app/lib/left-sidebar.tsx` | `LeftSidebarProvider`: a small store (shown, recent) in `localStorage` behind try/catch, read with `useSyncExternalStore` (server: shown, nothing recent); phone menu state with focus return; `useRecordVisit`; `useIndexStatus`; `SIDEBAR_HEAD_SCRIPT` |
| `app/components/LeftSidebar.tsx` | `SidebarContents` (shared), `LeftSidebar` (the `nav` column), `PhoneMenu` (modal dialog with focus trap), `SidebarButtons` (header) |
| `app/components/AppShell.tsx` | Providers and the screen layout moved out of `root.tsx`, so they can be tested; adds the sidebar, the menu and `t l` |
| `GET /api/index/status` | `{ pending }` from `WorkspaceAgent.indexStatus()`. Asked when the sidebar appears, when the tab is shown again and, while pending > 0, on each move. Never on a timer |
| `useToggleShortcut(toggle, key)` | The `t r` hook takes the second key, so `t l` reuses it. Not a shortcut registry (F43 is building the shortcut sheet separately) |
| `PageTitle` | After a rename, primes the title store if it knows the page (with `missing: false`), so Recent and links show the new title at once |

## What changed

| File | What |
|---|---|
| `app/lib/left-sidebar.tsx`, `app/components/LeftSidebar.tsx`, `app/components/AppShell.tsx` | New |
| `app/routes/api.index.status.ts`, `app/routes.ts` | New route |
| `app/root.tsx` | Uses `AppShell`; the head script; `suppressHydrationWarning` on `<html>` (the head scripts set its attributes) |
| `app/app.css` | Hides `.left-sidebar` under `html[data-left-sidebar="closed"]` |
| `app/components/AppHeader.tsx` | Sidebar button and ☰; Today, Tasks, Pages and New page removed; Search only on phones and while the sidebar is hidden |
| `app/components/TodayButton.tsx`, `NewPageButton.tsx` | Take a `className` for the sidebar row; the header-only "New" abbreviation is gone |
| `app/routes/docs.$id.tsx` | `useRecordVisit(id)` |
| `app/lib/side-panel.tsx` | `useToggleShortcut` takes the key |
| `app/components/PageTitle.tsx` | Primes the title store after a rename |
| `vitest.config.ts` | Functions floor 84 → 85 |
| Tests | `left-sidebar.test.tsx` (31), `index-status-route.test.ts` (2), one in `page-title.test.tsx`. The AppHeader test in `feed-pieces.test.tsx` now checks the sidebar buttons; Today and New page are checked in the sidebar instead |

## Deliberate breaks (each caught by a test)

- `t l` matching `r` instead of `l`
- the typing guard removed (`t l` and `t r` while typing)
- the closed state not saved
- no try/catch around reading storage
- the head script's marker not cleared on opening
- no wrap from first to last in the focus trap
- no focus return on closing
- Escape not closing
- the scrim not closing
- focus not moved into the menu
- the menu not closing on moving to another screen
- deleted pages listed under Recent
- visits not recorded
- the status asked on every move
- the column shown on phones
- `t l` toggling the hidden column on phones
- the header's Search hidden while the sidebar is hidden
- the search box opened before the menu closes (focus lost)
- the rename priming a page as still missing
- the route returning the whole status object
- the head script reading the wrong key

## Walked through (local dev server on 5174, headless Chrome over CDP, made-up page only)

- **Desktop (1280×800).**
  - The sidebar is shown on a first visit, with Journals marked current on `/`.
  - `t l` hides it; the state is stored, and it stays hidden after a reload with no flash (marker set).
  - The header's Search comes back while it's hidden. The button brings the sidebar back.
  - Search opens the box, and Escape returns the focus to the Search entry.
  - New page opens a page with the title focused. `t l` typed in the title went into the title.
  - After the rename the page shows under Recent with its new title.
  - `t r` flips the side panel's stored state and leaves the sidebar alone.
- **Phone (390×844, touch).**
  - ☰ is shown and there's no column. No horizontal scroll.
  - ☰ opens the menu with the focus on ✕. Twelve Tabs and two Shift+Tabs stayed inside.
  - Escape closes it and the focus goes back to ☰. Tapping outside closes it.
  - Tasks navigates and closes it. Search closes it and opens the box, and Escape there puts the focus back on ☰.
  - While editing, the keyboard toolbar shows. ☰ hides it (the editor loses focus) and the menu is on top. Recent is in the menu too.
- **Clean-up.** The test page was deleted through `/api/pages/delete`, and it dropped out of Recent. Storage was cleared.
- **Console.** No errors. (A first run showed a hydration warning for `data-left-sidebar` on `<html>`, fixed with `suppressHydrationWarning`. The Radix "Invalid hook call" seen once is the known dev-only Vite re-optimisation in AGENTS.md.)

## Worth a careful look

- **A new route.** `GET /api/index/status` returns only a count. It reveals no page, but sharing (M4) may want it limited to signed-in viewers.
- **Status cost.** Each full page load with the sidebar shown asks once (1 Durable Object call plus `getAgentByName`'s own fetch). While a rebuild runs, each move asks again. There are no timers, so the count only moves when the user moves.
- **Recent is per browser.** It is not synced across devices; that is the prototype's behaviour, and it costs no server work. A page renamed in another tab shows its old title until the tab is next shown (title refresh), as links do (F33).
- **The page on screen is listed even if the index calls it missing.** That covers a page just created. A deleted page can't be on screen (its address is a 404), so this doesn't bring deleted pages back.
- **`suppressHydrationWarning` on `<html>`** silences attribute mismatches on that one element only (React doesn't apply it to children).
- **Favourites are left out.** The PRD doesn't say how a page becomes a favourite (no star, no property), so there is nothing to list yet.
