# Mistlog: Product Requirements

**Status:** Draft v0.2 · **Last updated:** 2026-10-21

> **How to keep this alive.** Edit in place. When scope, status or a decision changes, update the feature table, add a line to the Decision log, and add a line to the Changelog. Agents: read the milestone you are working on before starting, and update this file in the same PR when behaviour changes.

Status key: ✅ prototyped (UI demo only, not built for real) · 🟢 works today (inherited from Mist) · 🟡 planned · ⬜ future · ❌ cut

## 1. Summary

Mistlog is a Logseq-style notes app for one person (and the people they share pages with): daily notes, `[[backlinks]]`, tasks, and shareable pages, with every page stored on a server so that syncing across devices is simple and safe.

It starts from [Mist](https://github.com/inanimate-tech/mist) (Cloudflare Workers, TipTap, Yjs), which already has a good markdown editor, live sync between devices, sharing by URL, and a live-formatting feel. Mistlog keeps Mist's storage model (one live Yjs document per page) and adds the linked-notes layer on top.

## 2. Problem

- Logseq's model (daily journal, links, backlinks, tasks) is great, but syncing files between devices is fiddly and sharing a single page with someone is awkward.
- Mist makes sharing markdown easy, but it is document-oriented: no daily notes, no linking between pages, no tasks, and documents expire after 99 hours.

## 3. Goals and non-goals

**Goals**
- Capture first: open the app and type immediately, with today's journal ready.
- Notes link to each other, every page shows what links to it, and **links never break**, including when a page is renamed.
- Sync across devices that is fast and never loses text.
- Share a single page by link (view or edit) without exposing anything else.
- No lock-in: every page can be exported as a Logseq-compatible markdown file.

**Non-goals (for now)**
- Block-level references and a true outliner (pages are documents with indented bullets).
- Native mobile apps (responsive web first).
- Plugins, themes marketplace, graph database features.
- Storing pages as markdown files on the server (see Decision log, 2026-10-21).

## 4. Principles

1. Links are permanent. A link points at a page, not at a piece of text, so renaming never breaks it.
2. Never lose the user's text. Edits from every device merge; nothing is overwritten.
3. Markdown-shaped text, exportable at any time. Page text follows Logseq conventions so that export is a straight conversion.
4. Keyboard first, with the Logseq muscle memory where it makes sense (Tab to indent, `[[` to link).
5. Private by default, shared on purpose.
6. Small and fast. Prefer boring, well-understood parts, and reuse what Mist already does.

## 5. Features

| ID | Feature | Status | Milestone | Notes |
|----|---------|--------|-----------|-------|
| F0 | Documents persist (remove Mist's 99-hour expiry) | 🟢 | M1 | Done 2026-10-22: Mist's deleting `alarm()` override removed, so leftover deletion alarms on older documents fire harmlessly |
| F1 | Daily notes feed (today on top, lazily created) | 🟢 | M2 | One document per day with a fixed ID, e.g. `journal-2026-10-21`. Days with no notes are skipped; today's journal is created on first keystroke. Mist's document header is shown on every day (revisit after M2, see open questions) |
| F2 | Pages with titles and readable URLs | ✅ | M2 | One document per page with a random permanent ID. The title lives in the page's document and is copied to the index. Titles are unique ignoring case; renaming to an existing title is refused (merge is F32). URLs are `/page/<slug>` and `/journal/YYYY-MM-DD`; after a rename the old slug redirects |
| F3 | `[[wikilinks]]` by page ID, with auto-pair and title autocomplete | 🟢 | M2 | See 6.1. Logseq style: `[[Title]]` is editable text; linking to a new title creates an empty placeholder page. Steps: ~~2.5a showing links~~ and ~~2.5b typing and editing links~~ (done 2026-10-28), ~~2.5c pasting~~ and ~~2.5d side panel (F18)~~ (done 2026-10-29) |
| F4 | Backlinks / linked references panel | ✅ | M2 | Below the page content, grouped by linking page. Query on the workspace index |
| F5 | Editable page titles; rename updates every link instantly | 🟢 titles | M2 | One title change in the index; no linking page is rewritten (see 6.1). Journal titles are dates, not editable |
| F6 | Tasks: `TODO` / `DOING` / `DONE` and a Tasks view | ✅ | M2 | Cmd/Ctrl+Enter cycles. Shown as styled text in the editor (no checkbox). Built after links and backlinks, so the Tasks view can reuse the references design (decision 2026-10-28). Cycling and styling are parked on the local branch `wip/tasks`; ticking from the Tasks view is to be redesigned |
| F7 | Bullets and indent | 🟢 | M2 | Tab / Shift+Tab indent with a tab character, children move with their parent. Enter continues a bullet at the same level; Backspace on an empty bullet outdents, then removes it. Logseq-compatible text |
| F8 | Collapsible left and right sidebars (`t l`, `t r`) | ✅ | M2 | Left: Journals, Tasks, Search, recent pages, index status line. Right: pages opened side by side (F18) |
| F9 | Live markdown formatting, always-editable | 🟢 | — | Mist's TipTap editor (each line a paragraph, markdown styled in place) |
| F10 | Sync across devices with automatic merge | 🟢 | — | Yjs in a Durable Object per page. Offline editing is F14 |
| F11 | Sharing: private / link view / link edit | ✅ UI | M4 | Today any document URL is readable and editable by anyone |
| F12 | Accounts and login | 🟡 | M4 | Until then, Cloudflare Access gates the whole site (done in M0, sign-in with a Cloudflare account) |
| F13 | Search across pages | 🟡 | M2 | Title and full text, from the workspace index. To fix in the search chunk: link text is indexed as the stored copy, so a link is still found by its old title after a rename |
| F14 | Offline editing | ⬜ | M3 | Yjs IndexedDB persistence (new dependency, needs approval) |
| F15 | Export to Logseq markdown | 🟡 | M3 | `pages/<slug>.md` and `journals/YYYY_MM_DD.md`, links written as `[[Current Title]]` |
| F16 | Comments and suggest mode (CriticMarkup) | 🟢 | — | Inherited from Mist and kept, along with live collaboration (F30). How they fit the workspace index, export and sharing is to be designed later (see open questions) |
| F17 | Responsive layout for phones | 🟡 | M2 | Left panel opens from a hamburger button. While typing, a keyboard toolbar offers indent, outdent, task, link and date. Dragging a bullet sideways could be added later as a shortcut |
| F18 | Cmd/Ctrl+click a link opens the page in the right panel | 🟢 | M2 | Like Roam's side-by-side pages (done 2026-10-29, chunk 2.5d). Cmd/Ctrl+click or Alt+Shift+Enter opens a page there; pages stack newest first (at most 10), each a live editor with a close button; `t r` shows or hides the panel; remembered per browser. On a page it takes the comments column's place (its Comments button hides it). A full-screen sheet on phones |
| F20 | Fuzzy dates | ⬜ | M5 | See 6.2 |
| F21 | All pages list | ⬜ | M5 | See 6.3 |
| F22 | Pomodoro timer (`{{POMO}}`) | ⬜ | M5 | See 6.4 |
| F30 | Live multiplayer on shared pages | 🟢 | — | Already how Mist works; needs permissions (M4) before it is safe to use with others |
| F31 | Graph view, templates, Logseq import, attachments (R2) | ⬜ | M6 | Unprioritised ideas |
| F32 | Merge pages | ⬜ | M6 | Offered when renaming a page to a title that already exists, as Logseq does. Links to both pages point to the merged page |
| F34 | Suggesting indentation changes in suggest mode | ⬜ | Later | Design the UI first: how an indent or outdent is shown as a suggestion, and accepted or rejected. Until then, bullet keys do nothing special in suggest mode (2.3) |
| F33 | Live title updates across open tabs and devices | ⬜ | M6 | Until then, other tabs pick up a new title on next load or focus. Needs a live connection to the index |

## 6. Feature specs

Details marked *TBC* need confirming before build.

### 6.1 Links by page ID (F3, F5)

The core of the linked-notes idea. A link stores the permanent ID of the page it points to. The title shown is looked up, so a rename can never leave a link pointing at the old name.

- **Storage:** a link is a `wikilink` mark on the text in the page's Yjs document, with a `pageId` attribute. This follows the same pattern as Mist's CriticMarkup marks (`app/lib/critic-marks.ts`).
- **Display:** a link always shows the target page's current title from the workspace index. The text stored inside the mark is a snapshot of the title and may be refreshed when the page is opened, but correctness never depends on it.
- **Text, as in Logseq:** a link is `[[`, the title, `]]` in the page's text. The brackets are real characters; the title carries the `wikilink` mark. With the cursor elsewhere it reads as a link (faint brackets, the current title underlined). With the cursor between the brackets it is plain text to edit.
- **Creating a link:** typing `[[` adds `]]` and opens title suggestions (keyboard: arrows, Enter or Tab to choose, Esc to close). Choosing a page links it. Typing `]` steps out of the brackets. Title matching ignores case.
- **When the cursor leaves a link** (or the editor loses focus), its text decides what it links to: the same page if unchanged or only its case changed; another page or a journal whose title it now names; a new empty placeholder page if no page has the title (a link needs an ID, so the page must exist); nothing, as plain text, if it is empty or a bracket was deleted. Until a new page is linked (for example offline) the text shows dashed as "not linked yet".
- **New pages from links:** `POST /api/pages` reserves the title in the index before creating the page, so two tabs linking the same new title get one page.
- **A renamed link's stored title** is updated to the current title only when your cursor enters that link (outside undo history). Opening a page never rewrites links.
- **Suggest mode:** links show and open, but are not rewritten or relinked; editing links as suggestions comes with F34.
- **Pasted or dropped text:** `[[Title]]` in it is linked at once by the same rules as typing (a journal date, an existing title, or a new empty page). Links copied from Mistlog keep their page ID. If the page can't be had (offline) the text stays dashed and links next time the cursor passes through. Import (F31) will use the same rules.
- **Rename:** changes the title in one place, the workspace index. No other page is edited, so rename is instant and works even when linking pages are offline or never opened.
- **Delete:** links keep their `pageId` and are shown dashed as unresolved. Restoring the page heals them.
- **Journals:** journal pages have fixed IDs (`journal-YYYY-MM-DD`), so they are valid link targets from day one.
- **Export:** each link is written as `[[Current Title]]`, so exported files work in Logseq.
- **Acceptance:** rename a page linked from 50 pages; every link shows the new title on next render with no edits to the 50 pages. Delete a page; its links render as unresolved; restore it; they resolve again.
- **Tests:** link mark round-trip through Yjs, paste conversion, case-insensitive matching, rename with no writes to linking docs, deleted-target rendering, export output.

### 6.2 Fuzzy dates (F20)

Inspired by the Roam Toolkit's natural-language dates (see the Ness Labs overview of Roam browser extensions). Type a natural phrase and get a link to that day's journal page.

- Phrases: `today`, `tomorrow`, `yesterday`, `next friday`, `in 3 days`, `in 2 weeks`, `last monday`, `oct 31`.
- Trigger syntax: both. Type `@` after a space (`@next fri`), or type a phrase inside `[[ ]]`, where dates appear among the page suggestions. `@` only triggers after a space or at the start of a line, so email addresses do not.
- A suggestion list shows each phrase with its resolved date. Accepting inserts an ID link to that day's journal (`journal-YYYY-MM-DD`), creating the journal lazily if needed.
- Dates resolve in the user's timezone, with a setting for week start.
- Journal titles use Logseq's default format, `MMM do, yyyy` (`Oct 22nd, 2026`), so exported files match what Logseq expects.
- Acceptance: typing `in 2 weeks` from 2026-10-20 offers `Nov 3rd, 2026`; accepting it creates the link; the target day's journal shows a backlink.
- Tests: parser unit tests across phrases, month/year boundaries, DST, and week-start settings.

### 6.3 All pages (F21)

A page that lists every page.

- Route `/pages`, linked from the left sidebar.
- Columns: title, backlink count, last edited, shared badge. Sortable, with a filter box.
- Toggle to include or hide journal pages (hidden by default).
- Click to open. "New page" creates and focuses the title.
- Delete a page (with confirmation). Links to it remain and are shown dashed as unresolved (see 6.1).
- Must respect permissions (only pages the viewer can read).
- Acceptance: with 500 pages the list renders and sorts without noticeable lag (paginate or virtualise if needed).

### 6.4 Pomodoro (F22)

Like Roam's `{{POMO}}` timer. Typing `{{POMO}}` in a page renders an inline timer.

- Defaults: 25 minute focus, 5 minute break, longer break after 4 rounds. Configurable.
- Controls: start, pause, reset. Shows remaining time inline.
- On completion: browser notification and a sound (both optional in settings).
- Optional: append a log line such as `- 🍅 Pomodoro completed 14:25` to today's journal (*TBC*).
- Must survive reload and backgrounded tabs, so store an end timestamp rather than counting with `setInterval`.
- Whether the running timer syncs across devices is *TBC*.
- The `{{POMO}}` text stays in the page text as-is, so exported files remain portable.

## 7. Technical approach

**Hosting:** Cloudflare Workers (React Router 7 SSR), deployed from GitHub.

**Page storage (unchanged from Mist):** each page and each journal day is one `DocumentAgent` Durable Object holding a Yjs document in its built-in SQLite. Clients connect over WebSocket and edits merge automatically, which gives sync across devices and live collaboration without a custom sync protocol. Mist's 99-hour expiry is removed.

**Page text conventions:** inside the Yjs document, text follows Logseq conventions so that export is a straight conversion: bullets are `- `, nesting is a literal tab character, tasks are `TODO` / `DOING` / `DONE` at the start of a line. Links are marks carrying a page ID (6.1).

**Workspace index:** a single `WorkspaceAgent` Durable Object (one per workspace; one in total while single-user) holds, in its SQLite:
- a page registry (every page ID and creation date, recorded at creation; never cleared, because Durable Objects cannot be listed)
- `pages` (id, kind page or journal, title, journal date, updated_at, deleted)
- `links` (source page id, target page id)
- `tasks` (page id, line, state, text)
- a full-text search table of page text

Each `DocumentAgent` re-indexes itself after edits settle (debounced with the Agents SDK's `schedule()`): it runs the shared parser over its document and sends the results to the workspace, retrying until the index confirms. A parser version change triggers a full rebuild through the registry, and a weekly check re-indexes any page whose entry is out of date. Existing Mist-era documents are not backfilled; they index themselves when opened. The index is always rebuilt from documents, never the other way round. Backlinks, autocomplete, search, the Tasks view and the journal feed are queries on the index. Users see nothing unless results may be incomplete. Details, including the status messages: `docs/technical-architecture.md`, "Workspace Index".

**Shared parser:** one module in `app/lib/` extracts links, tags, tasks and journal dates from a document. The index and the editor both use it.

**Quality gates:**
- CI (`.github/workflows/ci.yml`) runs typecheck, lint and tests on every push and pull request.
- Coverage thresholds in `vitest.config.ts` are fixed floors (lines 72, branches 62, functions 68, statements 70 as of 2026-10-27, raised with bullets and indenting). They stop coverage falling but do not rise on their own. Mist's original thresholds rose with the calendar towards 80 / 75 / 80 / 80 and failed CI on every commit, so they were frozen.
- **Coverage must be raised back towards 80 / 75 / 80 / 80.** Raise the floors by hand in the same PR whenever new tests lift coverage, and review progress at the end of each milestone. Most of the current gap is in Mist code (routes, hooks) that M1 and M2 will replace, so new code should arrive well tested.
- Cloudflare Workers Builds deploys every push to `main` and does not wait for GitHub CI, so its build command runs `npm run typecheck && npm run lint && npm run test && npm run build` itself. If any check fails, nothing deploys. This gate has not been verified yet (M0 task).

**Access:** Cloudflare Access gates the whole `workers.dev` address (set up 2026-10-22). Visitors sign in with their Cloudflare account; there is no one-time email code. Every path is covered, including document WebSocket connections and `/new`. The Worker does not yet verify the Access token itself, and a custom domain added later needs its own Access application. Per-page permissions (M4) are checked before a WebSocket connection to a `DocumentAgent` is accepted and on every index query.

## 8. Milestones

- [ ] **M0 Foundation:** import Mist into our own repo, deploy it to Cloudflare, connect GitHub for auto-deploy, add CI, add AGENTS.md and this PRD, lock the site down with Cloudflare Access while unfinished. Done so far: repo, auto-deploy via Workers Builds (verified 2026-10-22), CI, AGENTS.md, PRD, coverage thresholds frozen so CI can pass, Cloudflare Access with Cloudflare-account login (verified 2026-10-22), Workers Builds command set to run the checks before building (2026-10-22, not yet verified). Still to do:
  - [ ] **Verify the deploy gate.** (1) Open the Workers Builds log for a recent build and confirm `typecheck`, `lint` and `test` run before `build`. (2) Push a throwaway branch `chore/test-deploy-gate` with a test that always fails (`expect(1).toBe(2)`); confirm its preview build fails at `test`, nothing is uploaded, and the live site is unchanged; then delete the branch. Needs builds for non-production branches turned on; do not test on `main`, because a broken gate would put the failing code live.
- [ ] **M1 Persistence and index:** ~~remove the 99-hour expiry (including for existing documents)~~ (done 2026-10-22); ~~shared parser, including the `wikilink` mark definition~~ (done 2026-10-22); ~~`WorkspaceAgent` index with page registry and parser-versioned rebuild~~ (done 2026-10-23; the rebuild itself runs in the weekly check chunk); ~~documents report to the index and retry until confirmed~~ (done 2026-10-23); weekly index check (can land after M2). ~~Remove Mist's Fathom analytics~~ (kept, 2026-10-24).
- [ ] **M2 Notes core:** page identity in three parts: ~~2.1a titles (includes rename, formerly 2.7)~~ (done 2026-10-24), ~~2.1b readable URLs~~ (done 2026-10-25), ~~2.1d instant renames~~ (done 2026-10-26), ~~2.1c journal pages~~ (done 2026-10-26); ~~2.2 journal feed~~ (done 2026-10-27; owner checked scrolling and typing: "fine for now", revisit if it slows as days build up); ~~2.3 bullets and indenting~~ (done 2026-10-27); then 2.5 wikilinks (~~2.5a showing links~~ and ~~2.5b typing and editing links~~ done 2026-10-28; ~~2.5c pasting~~ and ~~2.5d side panel~~ done 2026-10-29) and 2.6 backlinks, then 2.4 tasks (reordered 2026-10-28); journal feed (replaces Mist's landing page and `/new`); bullets and indent; tasks; ID-based wikilinks with autocomplete and placeholder pages; backlinks below the page; rename; sidebars with Cmd/Ctrl+click to open in the right panel; search; responsive layout. Build order and UI details are agreed through a clickable prototype first.
- [ ] **M3 Portability and offline:** export to Logseq markdown, offline editing.
- [ ] **M4 Sharing:** accounts, visibility model, share dialog, permission-aware backlinks and search.
- [ ] **M5 Quality-of-life:** all pages list, fuzzy dates, pomodoro.
- [ ] **M6 Later:** graph view, import from Logseq, attachments.

## 9. Open questions

1. **Design later:** how Mist's collaborative features (comments, suggest mode, live editing) fit the new architecture. For example: whether pending suggestions and comment text are indexed, how they appear in exported markdown, and how they interact with sharing permissions (M4).
2. Do we want a read-only public site for link-shared pages, or require login to view? Decide at M4.
3. **Revisit:** page addresses. `/docs/<id>` is the permanent, canonical address and `/page/<slug>` the readable one (2.1b), with clashing slugs getting a short ID suffix. The owner likes `/docs/<id>` as the canonical source because it maps cleanly to one markdown file per page for portability (F15). Revisit whether readable slugs are worth their complexity once export exists.
4. **Revisit after M2:** each day in the journal feed has a compact Mist bar (edit or suggest, connection, share, open day). Check whether it clutters the feed once real notes build up.

## 10. Risks

- **Index drift:** the index can lag behind or disagree with documents. Mitigation: documents retry until the index confirms; a parser version change rebuilds through the page registry; a weekly check fixes anything missed; the UI flags results that may be incomplete. Residual risk: a parser bug gives consistently wrong results that no check detects, so the parser needs thorough tests.
- **Losing the page registry:** it is the one part of the index that cannot be rebuilt. If lost, pages stay intact but are hard to find until opened. Mitigation: a small, append-only table that rebuilds never touch.
- **Journal feed connections:** each day in the feed is its own live document. Mitigation: connect only days that are on screen.
- **Lock-in:** pages live as Yjs data, not files. Mitigation: export (F15) early, in M3, and keep page text in Logseq conventions.
- **Hand-typed and pasted links:** text that looks like a link but has no page ID could be missed. Mitigation: convert on paste and import, show unresolved links clearly, and test it.
- **Test coverage drifts down or never recovers:** the floors were frozen at 54% lines to get CI green. Mitigation: raise the floors whenever coverage rises and review at each milestone (section 7, Quality gates).
- **Editor complexity:** Logseq-style behaviours (Tab, `[[` autocomplete) are fiddly in TipTap. Mitigation: build and test them as small, separate extensions.
- **Access only at the edge:** Cloudflare Access is the only thing keeping strangers out. The Worker does not check who is signing in, and a new hostname (custom domain) would be open until it gets its own Access application. Mitigation: verify the Access token in the Worker (M4), and add Access before pointing any new domain at the Worker.
- **Cloudflare plan limits:** the free plan allows about 28 hours of Durable Object time a day (13,000 GB-s). On 2026-10-27 the live site hit it: Mist's server-side Yjs awareness ran a 3-second timer that stopped every open document hibernating, and the journal feed opened many documents at once. Mitigation (2026-10-28): documents hibernate when idle, browsers only send presence from the editor in use, and hidden tabs disconnect after 5 minutes. Rule: nothing on a Durable Object may run a repeating timer (AGENTS.md). Watch the Durable Objects usage chart after changes that add connections.
- **Other free-plan limits:** Workers Logs keeps 200,000 events a day (`observability` is on in `wrangler.jsonc`); beyond that, logs are sampled but the app keeps working. Durable Objects also allow 100,000 requests a day (WebSocket messages to hibernating objects count as one-twentieth each; index updates and scheduled wake-ups count fully). Expected single-user use is well under both. Decision 2026-10-28: no log sampling for now; add `head_sampling_rate` if logs get sampled often.

## 11. Decision log

| Date | Decision | Why |
|------|----------|-----|
| 2026-10-20 | Host on Cloudflare (not Vercel) | Mist already runs on Workers and Durable Objects, and Vercel cannot hold WebSockets, which matters for live editing |
| 2026-10-20 | Documents, not an outliner | Far less work; block references can come later |
| 2026-10-20 | ~~D1 as source of truth for page text, exposed as files via API~~ | Superseded 2026-10-21 |
| 2026-10-20 | ~~Async sharing with safe sync first, live multiplayer later~~ | Superseded 2026-10-21: Mist's storage already gives live sync |
| 2026-10-21 | Keep Mist's storage (one Yjs Durable Object per page); drop markdown files as the stored format and compare-and-swap saves | Reuses working sync and merge instead of building them; export keeps us portable |
| 2026-10-21 | Remove Mist's 99-hour document expiry | Notes must persist |
| 2026-10-21 | Links point to a permanent page ID, not a title | Renaming must never break a link; otherwise the linked-notes model fails. Rename becomes one title update |
| 2026-10-21 | Cross-page features use a workspace index in a Durable Object | Each page is isolated, so backlinks, search and tasks need one place to query; no new Cloudflare product needed |
| 2026-10-21 | Keep TipTap as the editor | Mist's line-per-paragraph model keeps markdown text exact |
| 2026-10-21 | Journal pages have fixed IDs (`journal-YYYY-MM-DD`) | Today's journal can be created on first open, and journals are link targets from day one (resolves the old "are journals linkable" question) |
| 2026-10-21 | Pasted or imported `[[Title]]` text is converted to an ID link | Keeps every link ID-based; unresolvable text stays plain and is shown as unresolved |
| 2026-10-22 | Freeze coverage thresholds at current levels instead of Mist's calendar-based ramp | The ramp failed CI on every commit regardless of changes, so CI could not tell good commits from bad. Floors are raised by hand as tests are added, back towards 80% |
| 2026-10-22 | Lock the site with Cloudflare Access, signing in with a Cloudflare account (not one-time email codes) | Keeps strangers out with no code changes while accounts (F12) are unbuilt |
| 2026-10-22 | Define the `wikilink` mark (name, `pageId`) in the shared parser chunk in M1, before the link UI in M2 | The parser and index need to read links before the editor can create them |
| 2026-10-22 | No backfill for existing documents; a document indexes itself when opened | Durable Objects cannot be listed, and existing documents are Mist-era test pages with no links or titles |
| 2026-10-22 | Index keeps a page registry that rebuilds never clear | Makes "rebuild from documents" possible when documents cannot be listed |
| 2026-10-22 | ~~Reuse `DocumentAgent.alarm()` for debounced indexing and retries~~ | Superseded the same day: the Agents SDK already uses `alarm()` for its scheduler |
| 2026-10-22 | Remove Mist's `alarm()` override; use the Agents SDK's `schedule()` for debounced indexing and retries | Restoring the SDK's handler makes old deletion alarms harmless with no clean-up code, and the scheduler already does debouncing and retries |
| 2026-10-22 | Index drift handled by retry-until-confirmed, parser-version rebuilds and a weekly check; UI signals only when results may be incomplete | Drift fixes itself without bothering the user; full rebuilds are rare |
| 2026-10-22 | Readable page URLs (`/page/<slug>`), with old slugs redirecting after a rename | Shareable, memorable links; the permanent ID stays internal |
| 2026-10-22 | Page titles unique ignoring case; renaming to an existing title is refused until merge (F32) exists | Avoids ambiguous links and autocomplete |
| 2026-10-22 | Linking to a new title creates an empty placeholder page | ID links need an ID at link time; matches Logseq |
| 2026-10-22 | Enter and Backspace follow Logseq bullet behaviour | Tab alone does not feel like Logseq |
| 2026-10-22 | Tasks are styled text in the editor, not checkboxes | Keeps the editor plain text; the Tasks view has checkboxes |
| 2026-10-22 | Backlinks sit below the page; the right panel is for pages opened side by side with Cmd/Ctrl+click | Logseq's layout for backlinks, Roam's for side-by-side reading |
| 2026-10-22 | Backspace after a link reopens it for editing; Esc restores the original link | Logseq muscle memory, without ever leaving a link broken by accident |
| 2026-10-22 | Fuzzy dates trigger with both `@` and inside `[[ ]]` | Both felt natural in the prototype; `@` only after a space avoids email addresses |
| 2026-10-22 | Show Mist's document header on every day in the journal feed, to revisit after M2 | Keeps Mist's controls one click away; may clutter the feed later |
| 2026-10-22 | Phone editing uses a keyboard toolbar | One tap for every action, works on any phone, matches Logseq mobile |
| 2026-10-22 | Journal titles use Logseq's default format (`Oct 22nd, 2026`) | Exported files match what Logseq expects |
| 2026-10-22 | Keep Mist's collaborative features: comments, suggest mode and live editing | They are a reason to build on Mist; how they fit the architecture is designed later |
| 2026-10-22 | ~~Remove Mist's Fathom analytics~~ | Reversed 2026-10-24 |
| 2026-10-24 | Keep Mist's Fathom analytics | Owner's choice; it only loads when `VITE_FATHOM_SITE_ID` is set |
| 2026-10-22 | Single user first | The index is per workspace, so teams can be added later |
| 2026-10-22 | Parser rules: a tag is `#` at the start of a line or after whitespace, followed by letters, digits, `_`, `-` or `/`, and not only digits; no tags or tasks inside code fences or inline code; no tags inside link text; links count everywhere, once per page per line; only tab characters indent | Matches Logseq's behaviour closely enough and avoids false positives such as headings, URL fragments and issue numbers. See `app/lib/note-parser.ts` |
| 2026-10-22 | `DOC_FORMAT_VERSION` is bumped when the editor starts writing `wikilink` marks (chunk 2.5), not when the mark is defined | Defining the mark changes no stored document |
| 2026-10-23 | Documents send their lines to the index, and the index runs the parser | One place parses on the server and records the parser version; backlinks and search need the line text anyway |
| 2026-10-23 | The workspace index is never reachable from a browser: the Worker refuses `/agents/workspace-agent/*`, and the agent refuses requests and connections | Only other Durable Objects call it, over RPC; UI queries will go through server routes that can check permissions |
| 2026-10-23 | The index does not enforce unique titles | It copies what documents say; refusing an entry would make it drift. Rename checks the index before allowing a title |
| 2026-10-23 | ~~Documents re-index on a 2-second throttle, not a debounce~~ | Superseded 2026-10-27 by indexing after a pause with a 2-second maximum wait |
| 2026-10-23 | Stale index updates are ignored using strictly increasing `updatedAt` values from each document | Retries can arrive late; this needs no schema change, unlike a separate sequence number |
| 2026-10-23 | Pages send an empty title to the index until page titles exist (chunk 2.1); journals are titled from their date | Nothing displays index titles yet |
| 2026-10-24 | Split chunk 2.1 into 2.1a titles, 2.1b readable URLs and 2.1c journal pages; merge 2.7 (rename) into 2.1a | With ID links, renaming is editing the title; links showing the new title belongs with links (2.5) |
| 2026-10-24 | Page titles live in the page's Yjs document (`meta.title`) | They sync live between tabs and the index already reads them |
| 2026-10-24 | `/docs/<id>` stays the permanent address; `/page/<slug>` redirects work for old slugs; clashing slugs get a short ID suffix | Readable links without breaking permanent ones (see open question 3) |
| 2026-10-24 | "New page" and "Today" sit in the document header until the sidebar exists (2.8) | They need a home before the sidebar is built |
| 2026-10-24 | Title rules: whitespace collapsed, 1 to 200 characters, no `[[` or `]]`; unique across pages and journals ignoring case; if the check fails, the rename is refused | Keeps exported `[[Title]]` links valid; failing closed avoids duplicate titles when the index is unreachable |
| 2026-10-25 | Slug history survives index rebuilds (the `slugs` table is never cleared, like the registry) | Old slugs cannot be recovered from documents, and old links must keep redirecting |
| 2026-10-25 | Slugs keep letters and digits from any script, accents included, lowercased; everything else becomes `-`; up to 80 characters | Readable for non-English titles; ASCII-only would empty non-Latin slugs |
| 2026-10-25 | ~~After a rename, the browser address updates on the next page load, not instantly~~ | Superseded the same day by renaming through the server (2.1d) |
| 2026-10-25 | Redirects are temporary (302), and any non-canonical form of a slug (old, different case or accent composition) redirects to the current one | Slugs change on rename; one canonical address per page |
| 2026-10-25 | If the index is unreachable, `/docs/<id>` still loads the page (slug lookup fails open) | An index problem must never lock the user out of a page |
| 2026-10-25 | Rename through the server: `POST /api/rename` claims the title in the index atomically (unique check, title and slug in one step) and returns the new address; the browser switches to it at once (chunk 2.1d) | The new address works immediately, and two renames to the same title can no longer both succeed |
| 2026-10-25 | A page re-indexes immediately when its title changes; other edits keep the 2-second throttle | Titles drive addresses and uniqueness; typing does not need to be faster yet (revisit with search and backlinks) |
| 2026-10-26 | Only the server writes page titles. `/api/rename` calls the page's `DocumentAgent`, which (holding a per-document lock shared with reindexing) claims the title in the index and only then writes `meta.title`; title writes from browsers are reverted | Uniqueness was enforced on the index's copy while browsers could write the original, and a reindex in flight could carry an old title past a claim. With one writer and one lock, neither can happen |
| 2026-10-26 | Journal-date titles ("Oct 30th, 2026", any ordinal) are reserved for journals, even before the journal exists | Otherwise a page could take a future journal's title and clash when the journal is first written |
| 2026-10-26 | Titles are stored in Unicode NFC with invisible characters removed, and compared NFC-lowercase | Two titles that look identical must not both pass |
| 2026-10-26 | Renames must pause while the index rebuilds (constraint for chunk 1.6) | A claim against a half-rebuilt index could allow a duplicate |
| 2026-10-26 | A journal is created by its first real text (not by opening it, an empty paragraph or whitespace); nothing is saved for a journal before that | Matches the prototype; browsing days leaves no empty records |
| 2026-10-26 | "Today" is decided in the browser's time zone; the server never decides today | Cloudflare runs on UTC and could be a day off |
| 2026-10-26 | Any real date can be opened at `/journal/YYYY-MM-DD`, past or future; `/docs/journal-…` redirects there | Fuzzy-date links will point at future days |
| 2026-10-27 | Index 0.3 seconds after a pause in typing, at most 2 seconds after the first unindexed edit; keep the persisted 2-second schedule as a backup; no fast indexing during retry backoff | Supersedes the 2-second throttle (2026-10-23): search, backlinks and the feed's day list are fresh almost immediately, with few extra index calls |
| 2026-10-27 | The journal feed replaces Mist's home page (demo document, onboarding, drag-and-drop upload); `/new` stays for scripts with no link to it | The feed is the home of a notes app; `/new` costs nothing to keep |
| 2026-10-27 | Each day in the feed gets a compact Mist bar (edit or suggest, connection, share, open day); comments, threads and accepting suggestions happen on the day's own page | A full side panel per day does not fit a feed |
| 2026-10-27 | Every feed day is a live editor; days connect 1200px before reaching the screen (the first three at once) and stay connected; older days load in batches of 7 as you scroll, with a button for keyboard users | Scrolling should feel like Roam's daily notes |
| 2026-10-27 | Tab on a plain line makes it a bullet as well as indenting it | In Logseq every nested line is a bullet; keeps exported files clean |
| 2026-10-27 | Bullets display as dots with indentation guides; the text keeps `- ` and tabs | The prototype's look, without changing the Logseq-compatible text |
| 2026-10-27 | In suggest mode the bullet keys do nothing special (Tab stays in the editor); designing indentation suggestions is F34, for later | Indentation changes do not fit CriticMarkup suggestions yet |
| 2026-10-27 | Backspace right after a bullet outdents, then removes the bullet, whether or not the line has text | One consistent rule |
| 2026-10-28 | Keep Durable Objects asleep when idle: no repeating timers on them (Mist's awareness interval stopped), presence only from the focused editor in a visible tab, and tabs hidden for 5 minutes disconnect until shown | The free plan's daily Durable Object time was exhausted by documents that could never hibernate. Disconnecting far-off feed days and the paid plan were considered and not chosen |
| 2026-10-28 | Links show the target's current title over the stored copy; the copy is never rewritten | Rewriting it on open would make two tabs duplicate text, show up as suggestions in suggest mode, sit in undo history, move comments, wake Durable Objects, and edit pages just by viewing them |
| 2026-10-28 | Tabs running older code are refused (`DOC_FORMAT_VERSION` 4) by the Worker with close code 4001 and asked to reload | An editor that meets a mark it does not know deletes that text, and the deletion syncs everywhere. Closing tabs by hand on each deploy misses phones and tabs opened mid-deploy, and later, other people's tabs |
| 2026-10-28 | Links are editable text, Logseq style: `[[` and `]]` are stored as text, the cursor between them shows plain text, and leaving the link relinks it by its text (same page, another page, a new page, or unlinked). Replaces the earlier "one unit" links and "Backspace reopens, Esc restores" | Owner wants Logseq's interaction. Only the mark is set or removed by relinking, which two tabs can do at once safely |
| 2026-10-28 | A renamed link's stored title is rewritten when the cursor enters it, outside undo history; never on open | You must see what you edit. The remaining risk is two cursors entering the same renamed link within a second, which would duplicate that title |
| 2026-10-28 | Clicking a link opens the page; Alt+Enter opens the link the cursor is in; Cmd/Ctrl+click opens the page until the side panel (2.5d) | Logseq behaviour; every mouse action has a keyboard path |
| 2026-10-28 | Side panel (F18) is step 2.5d of links | Owner asked for it alongside links |
| 2026-10-29 | On a page, the side panel takes the comments column while it shows pages; its Comments button hides it | Keeps the page readable at laptop widths (owner's choice over a third column or tabs) |
| 2026-10-29 | The side panel holds at most 10 pages and is remembered per browser; Alt+Shift+Enter opens a link there | Each page is a live connection; keyboard path for Cmd/Ctrl+click |
| 2026-10-29 | Pasting `[[New title]]` creates the page, as typing does | Same rule as typing and as Logseq; a large paste can create many pages |
| 2026-10-28 | Build links (2.5) and backlinks (2.6) before tasks (2.4); park the tasks work | Ticking tasks from a separate Tasks view meant the server editing pages by matching lines, which failed in a browser run and felt over-complicated. With backlinks in place, the Tasks view can reuse the references design |
| 2026-10-22 | Gate deploys by running the checks in the Workers Builds command | Workers Builds ignores GitHub CI; this is the smallest change that stops failing code going live |

## 12. Changelog

- 2026-10-20: v0.1. Initial draft from the UI prototype and planning conversation. Future features added: fuzzy dates, all pages, pomodoro.
- 2026-10-21: v0.2. Keep Mist's storage instead of markdown files on D1. Links by page ID (new spec 6.1). Added workspace index, export, persistence and offline as features. Marked sync and live multiplayer as already working. Reordered milestones (persistence and index in M1, accounts moved to M4). Resolved the editor open question; added URL and comments questions. Recorded the fixed journal IDs and paste conversion decisions. Updated AGENTS.md to match (renamed from `@AGENTS.md`).
- 2026-10-22: Added Quality gates (section 7): coverage floors frozen with a commitment to raise them back towards 80%, and deploy gating. Updated M0 progress and added a coverage risk.
- 2026-10-22: Cloudflare Access is on (Cloudflare-account login). Updated F12, section 7 Access, M0 progress, and replaced the open-access risk with an edge-only-access risk.
- 2026-10-22: Workers Builds command now runs the checks. Added an M0 task to verify the deploy gate with a throwaway failing branch.
- 2026-10-22: Index design: page registry, retry until confirmed, parser-version rebuilds, weekly check, and when the UI signals possible drift (details in `docs/technical-architecture.md`). `wikilink` mark defined in M1. No backfill. Rewrote the index drift risk and added a registry risk.
- 2026-10-22: Phase 2 review: readable URLs, unique titles, placeholder pages, Logseq bullet keys, tasks as styled text, backlinks below the page. Added F17 responsive layout, F18 Cmd/Ctrl+click to the right panel, F32 merge pages, F33 live title updates. Resolved the URL question; added questions on the feed header and phone controls.
- 2026-10-22: Decisions from the clickable prototype: link editing reopens on Backspace, both date triggers, keyboard toolbar on phones, Logseq journal title format, Mist header on every feed day (to revisit). Kept Mist's collaborative features (comments, suggest mode, live editing), removing Fathom (added to M1), single user first. Open questions reduced to fitting the collaborative features into the architecture, public shared pages (M4) and the feed header revisit.
- 2026-10-22: F0 done: Mist's 99-hour expiry removed. Indexing will use the Agents SDK's `schedule()` instead of overriding `alarm()`.
- 2026-10-22: Shared parser done (M1 chunk 1.3): page IDs, `wikilink` mark definition, line parser, Yjs and ProseMirror converters. Recorded the parser rules; coverage floors raised.
- 2026-10-23: Workspace index done (M1 chunk 1.4): `WorkspaceAgent` Durable Object (binding and migration `v2`), index tables with registry and full-text search, private from browsers. Nothing reports to it until chunk 1.5. Coverage floors raised.
- 2026-10-23: Index reporting done (M1 chunk 1.5): documents re-index about 2 seconds after edits, retry with backoff until confirmed, ignore stale updates, re-index on open and register on creation. Verified end to end locally. Coverage floors raised.
- 2026-10-24: Fathom kept (reverses 2026-10-22). Chunk 2.1 split into titles, readable URLs and journal pages; rename merged into titles. Added open question 3 on canonical `/docs/<id>` addresses.
- 2026-10-24: Page titles done (M2 chunk 2.1a): editable title stored in `meta.title`, uniqueness checked through `/api/title-check`, "New page" in the header. `DOC_FORMAT_VERSION` 3. Coverage floors raised.
- 2026-10-25: Readable URLs done (M2 chunk 2.1b): `/page/<slug>` with redirects from old slugs and from `/docs/<id>`; index schema version 2 (first index migration, with a `slugs` table). Coverage floors raised.
- 2026-10-25: Instant renames done (M2 chunk 2.1d): `POST /api/rename` replaces `/api/title-check`, claims titles atomically and returns the new address; title changes re-index immediately. Closes the 2.1a uniqueness race and reverses the 2.1b "address updates on next load" decision.
- 2026-10-26: Server-owned titles (part of 2.1d, before it shipped): a review of every title write path found uniqueness could be bypassed or raced. Renames now go through `DocumentAgent.rename` under a per-document lock; browsers can't write `meta.title`; journal-date titles reserved; NFC and invisible-character normalisation. Recorded a rebuild constraint for 1.6.
- 2026-10-26: Journal pages done (M2 chunk 2.1c): `/journal/YYYY-MM-DD`, created on first text, "Today" button in the header, read-only date heading. Fixed a 1.5 bug found while testing: a failing index check in `onConnect` ran before the document was sent and could stop a tab receiving it; it now runs afterwards and never throws.
- 2026-10-27: Faster indexing: 0.3 seconds after a pause in typing (2-second maximum wait), replacing the 2-second throttle; measured locally at about 0.3 seconds from text to searchable.
- 2026-10-27: Journal feed done (M2 chunk 2.2): `/` shows today's journal then earlier days, every day a live editor, older days loading as you scroll. Verified in headless Chrome locally: 17 live days, no long tasks while scrolling, no console errors.
- 2026-10-27: Bullets and indenting done (M2 chunk 2.3): Tab and Shift+Tab with children, Enter continuing bullets, Backspace outdenting, dots and guides. Added F34 (suggesting indentation, for later). Owner checked the feed.
- 2026-10-28: Durable Object usage fix after hitting the free plan's daily limit: documents now hibernate when idle (measured locally: an open 17-day feed sends 0 messages in 40 idle seconds, and documents hibernate).
- 2026-10-28: Added the other free-plan limits (Workers Logs, Durable Object requests) to the risks. Reordered M2: wikilinks and backlinks before tasks; tasks work parked.
- 2026-10-28: Showing links done (M2 chunk 2.5a): links show the current title (stale copies hidden), move and delete as one unit, open on click or Alt+Enter, copy as `[[Title]]`; `GET /api/pages/titles`; older tabs refused with a reload prompt (`DOC_FORMAT_VERSION` 4). Side panel added as 2.5e. Coverage floors raised.
- 2026-10-28: Typing and editing links done (M2 chunk 2.5b, with 2.5a reworked): Logseq-style `[[Title]]` text, `[[` suggestions, relinking when the cursor leaves, pages created from links (`POST /api/pages`, `GET /api/pages/search`). Steps renumbered: 2.5c pasting, 2.5d side panel. Coverage floors raised.
- 2026-10-29: Pasting links done (M2 chunk 2.5c): pasted or dropped `[[Title]]` text links at once; links copied from Mistlog keep their page. Line coverage reached the 80% target; floors raised.
- 2026-10-29: Side panel done (M2 chunk 2.5d, F18): Cmd/Ctrl+click or Alt+Shift+Enter opens a page beside the current one; `t r` toggles it. Links (2.5) complete; next is 2.6 backlinks.
