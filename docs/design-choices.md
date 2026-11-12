# Significant design choices (open)

Big questions that change Mistlog's architecture, written down so the owner can consider them without holding up features they don't affect. When one is decided, record the decision in `PRD.md` (decision log) and mark it decided here.

| # | Question | Status | Holds up |
|---|---|---|---|
| 1 | Local-first: is the copy on each device the real one, not a cache? | Open (raised 2026-11-12) | F14 offline, anything that creates pages offline |
| 2 | A native iPhone (Swift) app alongside the web app? | Open (raised 2026-11-12) | Nothing yet |
| — | Short-term offline journal (A–D, F below) | Built 2026-11-12 as an interim layer, then **held** (not live): it's on the local branch `offline-interim`, waiting on questions 1 and 3. See "What the interim offline layer is" | — |
| 3 | Render screens in the browser from local data, rather than on the server? | Open (raised 2026-11-12) | Simplifying the offline layer |
| 4 | Token-based access: share pages (and blocks) by revocable token, with people now and agents over MCP later? | Open, planned (raised 2026-11-12); four decisions to make, see section 4 | F11 sharing, F12 (in part), M4, an MCP server |

Known risks we're holding are in `PRD.md` section 10 (Risks). Features that don't depend on these go ahead as normal: editor behaviour, layout, tasks, references, and so on.

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

### What the interim offline layer is (built 2026-11-12, held)

It's held on the branch `offline-interim`, not live: the owner chose to come back to it once questions 1 and 3 are considered. It meets the need (open the site offline, then read and edit the journal) without deciding question 1. It works around how the app is built today:
- screens are rendered on the server, with their data in server loaders;
- sync is one live connection per page;
- the list of journal days comes only from the server's index;
- Cloudflare Access sits in front of everything.

| Piece | Why it exists | What replaces it once questions 1 and 3 are decided |
|---|---|---|
| `public/sw.js`, built files cached first | Code on the phone | **Stays** |
| `public/sw.js`, each page's HTML and route data (`.data`) kept by address, and an unseen page sent to `/` | Screens arrive as server HTML with their data baked in | One app shell rendered in the browser (question 3): cache `index.html` and nothing else |
| `clientLoader` fallbacks in `home.tsx` and `journal.$date.tsx` | Data comes from server loaders | Screens read local data first, then refresh |
| `savedJournalDays`, which finds days from IndexedDB's database names | The only list of days is the server's | A query on the local index |
| `POST /api/journals/state`, `DocumentAgent.savedState`, `keepRecentDays` (base64, hourly) | No way to fetch many pages without a live connection each | One sync connection for many pages, or syncing the whole workspace |
| `OfflineNotice` (from `navigator.onLine`) | Shows when there's no connection | **Stays**, and may merge with the connection badge |
| Manifest and icons | Add to Home Screen | **Stays** |

Its risks will go in `PRD.md` section 10 (the "Offline:" entries, on the branch) when it ships. When question 1 or 3 is decided, remove the rows above marked as replaced, rather than building on them.

## 3. Render screens in the browser from local data

Mistlog renders every screen on the server (React Router SSR), with data from server loaders. That's why offline support needed per-address HTML caching and offline fallbacks in each route. The alternative: a client-rendered app shell whose screens read the local copies (and later a local index) first, then refresh from the server. This pairs with local-first (question 1).

- **Gains:**
  - offline needs only one cached shell;
  - screens appear instantly from local data;
  - no loader fallbacks.
- **Costs:**
  - the first visit shows a blank shell until scripts load;
  - no server-rendered HTML for shared pages (matters with M4 sharing, and could be kept for those routes only);
  - a rework of each route's data loading.

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

---

## 4. Token-based access (sharing with people, then agents)

**The ask (2026-11-12).** Simple token-based access to pages, and maybe blocks: first for sharing with other people, in time for agents over MCP. Tokens are stored so they can be revoked. Anyone who is neither signed in nor holding a token gets access denied. Made from the Share button on each page.

**The catch: Cloudflare Access.** Access sits in front of every address today, so someone holding a token but not on the email whitelist never reaches Mistlog. Share links need a door in Access: a Bypass rule for `/s/*` (and later `/mcp`), set in the Cloudflare dashboard. That door is only safe once the Worker checks the Access sign-in itself, which it doesn't yet (the "Access only at the edge" risk in `PRD.md` section 10). So the Worker's own check has to be built and live first. Then the rule holds everywhere: signed in through Access, or holding a valid token, or access denied.

### Plan

**Step 0. The Worker checks the sign-in (before anything else).**
- On every request, verify Cloudflare's signed Access token (`Cf-Access-Jwt-Assertion`) against the team's public keys and the application's `aud`. WebCrypto can do it, so no new dependency.
- Anything without a valid sign-in and outside `/s/` gets 403, including the live editing connections (`/agents/document-agent/*`).
- Local dev skips the check, but only on localhost with a setting in `.dev.vars`.

**Step 1. Share links for pages.**
- **Where tokens live:** a new table in the workspace index (a schema migration). Each row holds:
  - the page (and a block, for step 2);
  - a scope (`page`, `block`, later `workspace`) and a mode (`view`, `edit`, later `append`), so MCP needs no second migration;
  - a kind (`person` or `agent`) and the owner's label for it ("Sam", "Claude");
  - created, last used (updated at most hourly, to spare Durable Object requests), revoked, and an optional expiry.
- **What's stored:** a SHA-256 hash of the token, never the token itself, so a leak of the index gives nothing away.
- **The token:** 256 random bits, so it can't be guessed. It has an `mlg_` prefix so a pasted one is easy to spot.
- **Share dialog:** the Share button opens a dialog listing the page's links, with New link (view or edit, plus a label), Copy, and Revoke.
- **What a guest sees at `/s/<token>`:** that page only.
  - **Hidden:** the sidebar, search, linked references, Tasks, and `[[` title suggestions.
  - **Links to other pages:** shown as the text already written in the page, but they don't open, and their current titles aren't looked up. Otherwise a shared page would reveal the names of pages the guest can't read (invariant 5).
- **Live editing:** the editing connection goes through `/s/<token>/ws`. The Worker checks the token, then forwards to the page's `DocumentAgent` with a view or edit label. The Worker sets that label itself and strips any copy sent from outside.
- **View-only:** on a view-only connection, `DocumentAgent` answers sync requests but ignores incoming edits.
- **Revoking:** closes that link's open connections at once (connections are tagged with their token), not just future ones.
- **All other API routes** (backlinks, search, titles, rename, delete, import) refuse token holders.

**Step 2. Blocks.**
- A page syncs as one live Yjs document, so a guest's browser can't be sent half of one: it would hold the whole page.
- So block sharing starts as a **read-only snapshot**: the server renders the block and its children afresh each time the link is opened.
- Live or editable shared blocks would need a separate synced copy of the block, which is a big job. Only worth it if snapshots fall short.

**Step 3. MCP for agents.**
- The same token table with kind `agent`, and an MCP endpoint at `/mcp` (a second Access Bypass), using the Agents SDK's MCP support. Tokens arrive in the `Authorization: Bearer` header.
- **Possible tools:**
  - read a page or block;
  - search, limited to what the token covers;
  - add lines to a page or today's journal, through Yjs so edits merge (invariant 2).
- An agent probably wants more than one page: that's the `workspace` scope, read-only at first.
- Some MCP clients (claude.ai connectors) expect OAuth rather than a bearer token. Claude Code takes a bearer token. OAuth would mean a new dependency (Cloudflare's `workers-oauth-provider`), so ask first if it's needed.

### Risks

- **Token in the address:** it lands in the guest's browser history and in Workers Logs (the owner's). Share pages send `Referrer-Policy: no-referrer` so it doesn't leak to other sites through links.
- **Offline copies stay:** the guest's browser keeps an IndexedDB copy of the page. Revoking stops new syncing but can't wipe what they already have.
- **Comments are visible:** comments and suggestions live in the page's Yjs document, so a view link shows them. Separate comment or suggest modes could come later.
- **Access is all-or-nothing:** everyone on the Access whitelist still has full access, including making and revoking links (the 2026-11-05 decision). Per-person accounts are still F12.
- **Cost:** each token check is one call to the workspace index (one more subrequest and Durable Object request). Fine at this scale.

### How it touches the other questions

- **Local-first (1):** a guest's device must only ever sync what its token covers. The token model has to come before any whole-workspace sync.
- **Rendering in the browser (3):** share pages may want server-rendered HTML even if the rest of the app moves to a browser-rendered shell.

### Needs approval before building (AGENTS.md "ask first")

- Changing authentication and permissions.
- A change to the sync protocol (view-only connections).
- New Worker settings for Access's application `aud` and team domain.
- The Access Bypass rules for `/s/*` and later `/mcp` (the owner sets them in the dashboard, only after step 0 is live).

### Decisions for the owner

1. **Copying a link again later.** Recommended: each link is shown once, when made, as GitHub does with tokens; only the hash is stored, and a lost link means making another. The alternative stores the token so the dialog can copy it any time: more convenient, less safe.
2. **Expiry by default?** Suggested: never, with an expiry you can choose.
3. **Read-only snapshots for shared blocks at first?** Suggested: yes.
4. **Order.** Suggested: steps 0 and 1 first (about one iteration), then MCP, then blocks, since an agent may be more use than sharing a block.

When decided, write it into `PRD.md` as spec 6.5 under M4, with decision log rows, the F11 and F12 rows, and the "Access only at the edge" risk updated.
