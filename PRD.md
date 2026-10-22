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
| F0 | Documents persist (remove Mist's 99-hour expiry) | 🟡 | M1 | Existing documents already have a deletion alarm set, so the alarm handler must stop deleting, not just stop being scheduled |
| F1 | Daily notes feed (today on top, lazily created) | ✅ | M2 | One document per day with a fixed ID, e.g. `journal-2026-10-21` |
| F2 | Pages with titles | ✅ | M2 | One document per page, random permanent ID, title stored separately |
| F3 | `[[wikilinks]]` by page ID, with auto-pair and title autocomplete | ✅ | M2 | See 6.1 |
| F4 | Backlinks / linked references panel | ✅ | M2 | Query on the workspace index |
| F5 | Editable page titles; rename updates every link instantly | ✅ | M2 | One title change in the index; no linking page is rewritten (see 6.1). Journal titles are dates, not editable |
| F6 | Tasks: `TODO` / `DOING` / `DONE` and a Tasks view | ✅ | M2 | Cmd/Ctrl+Enter cycles; checkbox in Tasks view toggles |
| F7 | Tab / Shift+Tab indent (tab character, children move with parent) | ✅ | M2 | Logseq-compatible text |
| F8 | Collapsible left and right sidebars (`t l`, `t r`) | ✅ | M2 | |
| F9 | Live markdown formatting, always-editable | 🟢 | — | Mist's TipTap editor (each line a paragraph, markdown styled in place) |
| F10 | Sync across devices with automatic merge | 🟢 | — | Yjs in a Durable Object per page. Offline editing is F14 |
| F11 | Sharing: private / link view / link edit | ✅ UI | M4 | Today any document URL is readable and editable by anyone |
| F12 | Accounts and login | 🟡 | M4 | Until then, Cloudflare Access gates the whole site (done in M0, sign-in with a Cloudflare account) |
| F13 | Search across pages | 🟡 | M2 | Title and full text, from the workspace index |
| F14 | Offline editing | ⬜ | M3 | Yjs IndexedDB persistence (new dependency, needs approval) |
| F15 | Export to Logseq markdown | 🟡 | M3 | `pages/<slug>.md` and `journals/YYYY_MM_DD.md`, links written as `[[Current Title]]` |
| F16 | Comments and suggest mode (CriticMarkup) | 🟢 | — | Inherited from Mist. Keep or cut is an open question |
| F20 | Fuzzy dates | ⬜ | M5 | See 6.2 |
| F21 | All pages list | ⬜ | M5 | See 6.3 |
| F22 | Pomodoro timer (`{{POMO}}`) | ⬜ | M5 | See 6.4 |
| F30 | Live multiplayer on shared pages | 🟢 | — | Already how Mist works; needs permissions (M4) before it is safe to use with others |
| F31 | Graph view, templates, Logseq import, attachments (R2) | ⬜ | M6 | Unprioritised ideas |

## 6. Feature specs

Details marked *TBC* need confirming before build.

### 6.1 Links by page ID (F3, F5)

The core of the linked-notes idea. A link stores the permanent ID of the page it points to. The title shown is looked up, so a rename can never leave a link pointing at the old name.

- **Storage:** a link is a `wikilink` mark on the text in the page's Yjs document, with a `pageId` attribute. This follows the same pattern as Mist's CriticMarkup marks (`app/lib/critic-marks.ts`).
- **Display:** a link always shows the target page's current title from the workspace index. The text stored inside the mark is a snapshot of the title and may be refreshed when the page is opened, but correctness never depends on it.
- **Creating a link:** typing `[[` opens title autocomplete. Choosing a page inserts a link to its ID. Typing a title that matches no page and closing with `]]` creates the page and links to it. Title matching ignores case.
- **Pasted or imported text:** plain `[[Title]]` text is converted to an ID link on paste and on import. Anything that cannot be resolved stays as plain text and is shown as an unresolved link.
- **Rename:** changes the title in one place, the workspace index. No other page is edited, so rename is instant and works even when linking pages are offline or never opened.
- **Delete:** links keep their `pageId` and are shown dashed as unresolved. Restoring the page heals them.
- **Journals:** journal pages have fixed IDs (`journal-YYYY-MM-DD`), so they are valid link targets from day one.
- **Export:** each link is written as `[[Current Title]]`, so exported files work in Logseq.
- **Acceptance:** rename a page linked from 50 pages; every link shows the new title on next render with no edits to the 50 pages. Delete a page; its links render as unresolved; restore it; they resolve again.
- **Tests:** link mark round-trip through Yjs, paste conversion, case-insensitive matching, rename with no writes to linking docs, deleted-target rendering, export output.

### 6.2 Fuzzy dates (F20)

Inspired by the Roam Toolkit's natural-language dates (see the Ness Labs overview of Roam browser extensions). Type a natural phrase and get a link to that day's journal page.

- Phrases: `today`, `tomorrow`, `yesterday`, `next friday`, `in 3 days`, `in 2 weeks`, `last monday`, `oct 31`.
- Trigger syntax: *TBC*. Candidates: a prefix such as `@`, or recognising phrases inside `[[ ]]`.
- A suggestion list shows each phrase with its resolved date. Accepting inserts an ID link to that day's journal (`journal-YYYY-MM-DD`), creating the journal lazily if needed.
- Dates resolve in the user's timezone, with a setting for week start.
- Display format for journal titles is a setting (*TBC*, Logseq's default is `MMM do, yyyy`).
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
- `pages` (id, kind page or journal, title, journal date, updated_at, deleted)
- `links` (source page id, target page id)
- `tasks` (page id, line, state, text)
- a full-text search table of page text

Each `DocumentAgent` re-indexes itself after edits settle (debounced): it runs the shared parser over its document and sends the results to the workspace. The index is always rebuilt from documents, never the other way round. Backlinks, autocomplete, search, the Tasks view and the journal feed are queries on the index.

**Shared parser:** one module in `app/lib/` extracts links, tags, tasks and journal dates from a document. The index and the editor both use it.

**Quality gates:**
- CI (`.github/workflows/ci.yml`) runs typecheck, lint and tests on every push and pull request.
- Coverage thresholds in `vitest.config.ts` are fixed floors (lines 54, branches 43, functions 43, statements 51 as of 2026-10-22). They stop coverage falling but do not rise on their own. Mist's original thresholds rose with the calendar towards 80 / 75 / 80 / 80 and failed CI on every commit, so they were frozen.
- **Coverage must be raised back towards 80 / 75 / 80 / 80.** Raise the floors by hand in the same PR whenever new tests lift coverage, and review progress at the end of each milestone. Most of the current gap is in Mist code (routes, hooks) that M1 and M2 will replace, so new code should arrive well tested.
- Cloudflare Workers Builds deploys every push to `main` and does not wait for GitHub CI, so its build command runs `npm run typecheck && npm run lint && npm run test && npm run build` itself. If any check fails, nothing deploys. This gate has not been verified yet (M0 task).

**Access:** Cloudflare Access gates the whole `workers.dev` address (set up 2026-10-22). Visitors sign in with their Cloudflare account; there is no one-time email code. Every path is covered, including document WebSocket connections and `/new`. The Worker does not yet verify the Access token itself, and a custom domain added later needs its own Access application. Per-page permissions (M4) are checked before a WebSocket connection to a `DocumentAgent` is accepted and on every index query.

## 8. Milestones

- [ ] **M0 Foundation:** import Mist into our own repo, deploy it to Cloudflare, connect GitHub for auto-deploy, add CI, add AGENTS.md and this PRD, lock the site down with Cloudflare Access while unfinished. Done so far: repo, auto-deploy via Workers Builds (verified 2026-10-22), CI, AGENTS.md, PRD, coverage thresholds frozen so CI can pass, Cloudflare Access with Cloudflare-account login (verified 2026-10-22), Workers Builds command set to run the checks before building (2026-10-22, not yet verified). Still to do:
  - [ ] **Verify the deploy gate.** (1) Open the Workers Builds log for a recent build and confirm `typecheck`, `lint` and `test` run before `build`. (2) Push a throwaway branch `chore/test-deploy-gate` with a test that always fails (`expect(1).toBe(2)`); confirm its preview build fails at `test`, nothing is uploaded, and the live site is unchanged; then delete the branch. Needs builds for non-production branches turned on; do not test on `main`, because a broken gate would put the failing code live.
- [ ] **M1 Persistence and index:** remove the 99-hour expiry (including for existing documents), shared parser, `WorkspaceAgent` index, documents report to the index with a one-off backfill.
- [ ] **M2 Notes core:** page identity and titles, journal feed, tab indent, tasks, ID-based wikilinks with autocomplete, backlinks, rename, sidebars, search.
- [ ] **M3 Portability and offline:** export to Logseq markdown, offline editing.
- [ ] **M4 Sharing:** accounts, visibility model, share dialog, permission-aware backlinks and search.
- [ ] **M5 Quality-of-life:** all pages list, fuzzy dates, pomodoro.
- [ ] **M6 Later:** graph view, import from Logseq, attachments.

## 9. Open questions

1. Do Mist's comments and suggest mode (F16) stay? They work today, but they add complexity to the editor and to export.
2. Fuzzy date trigger syntax and the journal title display format.
3. Single user only at first, or teams/workspaces from the start? (The index is one Durable Object per workspace either way.)
4. Keep Mist's Fathom analytics hooks, or remove them?
5. Do we want a read-only public site for link-shared pages, or require login to view?
6. Page URLs: keep Mist's random-ID URLs (`/docs/k3x9…`), or show a readable slug that redirects to the ID?

## 10. Risks

- **Index drift:** the index can lag behind or disagree with documents. Mitigation: the index is always rebuilt from documents, re-indexing is idempotent, and a full rebuild can be run at any time.
- **Journal feed connections:** each day in the feed is its own live document. Mitigation: connect only days that are on screen.
- **Lock-in:** pages live as Yjs data, not files. Mitigation: export (F15) early, in M3, and keep page text in Logseq conventions.
- **Hand-typed and pasted links:** text that looks like a link but has no page ID could be missed. Mitigation: convert on paste and import, show unresolved links clearly, and test it.
- **Test coverage drifts down or never recovers:** the floors were frozen at 54% lines to get CI green. Mitigation: raise the floors whenever coverage rises and review at each milestone (section 7, Quality gates).
- **Editor complexity:** Logseq-style behaviours (Tab, `[[` autocomplete) are fiddly in TipTap. Mitigation: build and test them as small, separate extensions.
- **Access only at the edge:** Cloudflare Access is the only thing keeping strangers out. The Worker does not check who is signing in, and a new hostname (custom domain) would be open until it gets its own Access application. Mitigation: verify the Access token in the Worker (M4), and add Access before pointing any new domain at the Worker.
- **Cloudflare plan limits:** check Durable Object limits on the free plan before relying on them.

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
| 2026-10-22 | Gate deploys by running the checks in the Workers Builds command | Workers Builds ignores GitHub CI; this is the smallest change that stops failing code going live |

## 12. Changelog

- 2026-10-20: v0.1. Initial draft from the UI prototype and planning conversation. Future features added: fuzzy dates, all pages, pomodoro.
- 2026-10-21: v0.2. Keep Mist's storage instead of markdown files on D1. Links by page ID (new spec 6.1). Added workspace index, export, persistence and offline as features. Marked sync and live multiplayer as already working. Reordered milestones (persistence and index in M1, accounts moved to M4). Resolved the editor open question; added URL and comments questions. Recorded the fixed journal IDs and paste conversion decisions. Updated AGENTS.md to match (renamed from `@AGENTS.md`).
- 2026-10-22: Added Quality gates (section 7): coverage floors frozen with a commitment to raise them back towards 80%, and deploy gating. Updated M0 progress and added a coverage risk.
- 2026-10-22: Cloudflare Access is on (Cloudflare-account login). Updated F12, section 7 Access, M0 progress, and replaced the open-access risk with an edge-only-access risk.
- 2026-10-22: Workers Builds command now runs the checks. Added an M0 task to verify the deploy gate with a throwaway failing branch.
