# Significant design choices (open)

Big questions that change Mistlog's architecture, written down so the owner can consider them without holding up features they don't affect. When one is decided, record the decision in `PRD.md` (decision log) and mark it decided here.

| # | Question | Status | Holds up |
|---|---|---|---|
| 1 | Local-first: is the copy on each device the real one, not a cache? | Open (raised 2026-11-12) | F14 offline, anything that creates pages offline |
| 2 | A native iPhone (Swift) app alongside the web app? | Open (raised 2026-11-12) | Nothing yet |

Features that don't depend on these go ahead as normal: editor behaviour, layout, tasks, references, and so on.

---

## 1. Local-first

**The prompt.** A software engineer friend: "In today's world, and particularly when you use Yjs (which is backed by a CRDT) you can do local first, ie you don't have a cache, you're editing a true copy locally that syncs."

**Where Mistlog is today.** For every page you've opened, it's already local-first:
- Yjs edits a true copy in the browser, saved in IndexedDB (y-indexeddb, F14 part 1). Edits apply there first and merge with the server later.
- Nothing waits for the server.

**What isn't local yet:**
1. **Pages you haven't opened** aren't on the device.
2. **Everything that spans pages** comes only from the server's workspace index: backlinks, search, Tasks, All pages, link titles, and the journal feed's list of days.
3. **Making a page needs the server,** to keep titles unique. That covers new pages and typed links that create pages.
4. **The app itself needs the network to load.** There's no service worker, and the feed and page screens get their first data from server loaders.

**What fully local-first would mean.** The server becomes a sync and backup peer, not the source of truth:
- **Sync the whole workspace to each device.** About 900 pages, a few MB. This needs a batched sync route rather than one connection per page.
- **Build the index in the browser** from the local copies. This fits Mistlog: the parser is already shared with the browser (invariant 7), and the index is already rebuilt from documents (invariant 3).
- **Create pages offline** with a random ID, and claim the title on the server when you reconnect. A rule is needed for when two devices made the same title.

**Costs and risks:**
- A first sync of every page to each device.
- Phone storage limits. iOS may clear a website's storage it hasn't used for about a week, unless it's added to the Home Screen.
- Sharing (M4): a device may only sync pages its viewer can read.
- Two indexes to keep in step: the local one and the server's.

**Suggested path.** Each step is useful on its own, and only step 4 changes how pages are created.
1. A service worker, so the app opens offline.
2. Background sync of recent journal days, then of every page.
3. A local index, so search, backlinks, Tasks and the feed work offline.
4. Creating pages offline, with title claims on reconnect.

## The short-term need: read today's journal offline

The owner wants to open the site on their phone with no connection, and read the journal where they write the day's notes and TODOs. That's step 1 plus part of step 2, with no change to the data model. The improvements involved, smallest first:

| Improvement | What it does | Size |
|---|---|---|
| **A. Service worker for the app shell** | Saves the HTML, scripts and styles, so the URL opens without a connection. Online, it always fetches fresh code first, so it never serves an old editor (which matters: `DOC_FORMAT_VERSION`) | Small |
| **B. Offline screens** | When the server loaders can't be reached, the feed and `/journal/<date>` render from the browser instead: the feed lists today and recent days found in IndexedDB, and each day opens from its local copy | Small to medium |
| **C. Keep recent days on the phone** | When online, quietly save the last 7 and next 7 journal days to IndexedDB, even if not opened, so they're there offline. A few requests, once per visit; no timers | Small |
| **D. Say when it's offline** | A visible "Offline: showing the copy on this phone; edits sync when you're back" in place of "Connected" | Small |
| **E. Today's tasks offline** | NOW, DOING and LATER from the saved days, listed at the top of today's journal or on Tasks, read from local copies | Medium (a first slice of the local index) |
| **F. Install to the Home Screen** | A web app manifest and icon, so it opens like an app. Home Screen apps on iOS are also kept from the week-long storage clearing | Small |

**Things to check while building these:**
- **Cloudflare Access.** The whole site is behind Access. When the sign-in expires while offline, the service worker must keep serving the saved shell rather than the Access login page. Sync resumes once the user signs in again.
- **Older code in a saved tab.** A cached app shell must never run older editor code against newer documents. Fetching fresh code first when online, plus the Worker's existing refusal of outdated tabs (`refuseOutdatedEditor`), covers this.

**Recommendation:** A, B, C and D first. Together they meet the need ("open the URL offline and read and edit today's journal") without deciding the bigger question. Add F if the phone clears storage. E is the first step towards the local index.

---

## 2. A Swift (native iPhone) app

**What it would add for offline use:**
- **Always opens offline:** the app's code is on the phone, so there's no service worker and no Access sign-in on the way in.
- **Storage stays put:** a native app's files aren't cleared the way a website's can be.
- **Background refresh:** iOS can wake it now and then (`BGAppRefreshTask`) to pull new journal days, so the phone is up to date before you go offline. A website can't do this on iOS.
- **Native extras:** a Home Screen widget with today's tasks, the share sheet, notifications, a reliable keyboard toolbar, and haptics.

**What it would cost:**
- **A second app to build and maintain,** in Swift, alongside the web app.
- **Apple's developer programme** ($99 a year), TestFlight to install it, and App Store review if it's ever shared.
- **Yjs in Swift is less mature.** The CRDT has a Rust core (y-crdt / Yrs) with Swift bindings, but the editor (TipTap, ProseMirror, our extensions) is web code and would need rebuilding natively, or hosting in a web view.

**Middle paths, cheapest first:**
1. **The web app installed to the Home Screen** (improvement F) with a service worker. It gets most of the offline benefit for a few days' work.
2. **A thin native shell** (a WKWebView wrapper, for example with Capacitor) around the web app. It adds background refresh, widgets and dependable storage, and keeps one editor codebase.
3. **A full Swift app.** Only worth it if the phone becomes the main way Mistlog is used and the web app's limits get in the way.

**Recommendation:** do the short-term improvements (A to D, and F) first. Revisit a native shell only if iOS storage clearing or the lack of background refresh proves a real problem in use.
