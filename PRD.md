# Mistlog: Product Requirements

**Status:** Draft v0.1 · **Last updated:** 2026-10-20

> **How to keep this alive.** Edit in place. When scope, status or a decision changes, update the feature table, add a line to the Decision log, and add a line to the Changelog. Agents: read the milestone you are working on before starting, and update this file in the same PR when behaviour changes.

Status key: ✅ prototyped (UI demo only, not built for real) · 🟡 planned · ⬜ future · ❌ cut

## 1. Summary

Mistlog is a Logseq-style notes app for one person (and the people they share pages with): daily notes, `[[backlinks]]`, tasks, and shareable pages, with every page stored as a plain markdown file on a server so that syncing across devices is simple and safe.

It starts from [Mist](https://github.com/inanimate-tech/mist) (Cloudflare Workers, TipTap, Yjs), which already has a good markdown editor, sharing by URL, and a live-formatting feel.

## 2. Problem

- Logseq's model (daily journal, links, backlinks, tasks) is great, but syncing files between devices is fiddly and sharing a single page with someone is awkward.
- Mist makes sharing markdown easy, but it is document-oriented: no daily notes, no linking between pages, no tasks, and documents expire.

## 3. Goals and non-goals

**Goals**
- Capture first: open the app and type immediately, with today's journal ready.
- Notes link to each other, and every page shows what links to it.
- Pages are plain markdown files, Logseq-compatible, so the user is never locked in.
- Sync across devices that is fast and never loses text.
- Share a single page by link (view or edit) without exposing anything else.

**Non-goals (for now)**
- Block-level references and a true outliner (pages are documents with indented bullets).
- Real-time multiplayer cursors (planned later; async sharing comes first).
- Native mobile apps (responsive web first).
- Plugins, themes marketplace, graph database features.

## 4. Principles

1. Plain markdown is the source of truth.
2. Never lose the user's text. Conflicts get merged or kept, never overwritten.
3. Keyboard first, with the Logseq muscle memory where it makes sense (Tab to indent, `[[` to link).
4. Private by default, shared on purpose.
5. Small and fast. Prefer boring, well-understood parts.

## 5. Features

| ID | Feature | Status | Milestone | Notes |
|----|---------|--------|-----------|-------|
| F1 | Daily notes feed (today on top, lazily created) | ✅ | M2 | One file per day: `journals/YYYY_MM_DD.md` |
| F2 | Pages as markdown files | ✅ | M1 | `pages/<slug>.md` |
| F3 | `[[wikilinks]]` with auto-pair and title autocomplete | ✅ | M2 | Autocomplete searches page titles and shows the file path |
| F4 | Backlinks / linked references panel | ✅ | M2 | Derived from a link index |
| F5 | Editable page titles, rename rewrites links | ✅ | M2 | Journal titles are dates, not editable |
| F6 | Tasks: `TODO` / `DOING` / `DONE` and a Tasks view | ✅ | M2 | Cmd/Ctrl+Enter cycles; checkbox in Tasks view toggles |
| F7 | Tab / Shift+Tab indent (tab character, children move with parent) | ✅ | M2 | Logseq-compatible file format |
| F8 | Collapsible left and right sidebars (`t l`, `t r`) | ✅ | M2 | |
| F9 | Live markdown formatting, always-editable | ✅ | M2 | Prototype uses a textarea overlay; production uses TipTap (see decisions) |
| F10 | Sync: versioned saves, merge on conflict, offline queue, CLI | 🟡 | M3 | See section 7 |
| F11 | Sharing: private / link view / link edit | ✅ UI | M4 | Backend and permissions still to build |
| F12 | Accounts and login | 🟡 | M1 | Replaces Mist's public-by-URL model |
| F13 | Search across pages | 🟡 | M2 | Title and full text |
| F20 | Fuzzy dates | ⬜ | M5 | See 6.1 |
| F21 | All pages list | ⬜ | M5 | See 6.2 |
| F22 | Pomodoro timer (`{{POMO}}`) | ⬜ | M5 | See 6.3 |
| F30 | Live multiplayer on shared pages (Durable Objects) | ⬜ | M6 | Reuses Mist's existing agent code |
| F31 | Graph view, templates, Logseq import, attachments (R2) | ⬜ | M6 | Unprioritised ideas |

## 6. Future feature specs

These are first drafts. Details marked *TBC* need confirming before build.

### 6.1 Fuzzy dates (F20)

Inspired by the Roam Toolkit's natural-language dates (see the Ness Labs overview of Roam browser extensions). Type a natural phrase and get a link to that day's journal page.

- Phrases: `today`, `tomorrow`, `yesterday`, `next friday`, `in 3 days`, `in 2 weeks`, `last monday`, `oct 31`.
- Trigger syntax: *TBC*. Candidates: a prefix such as `@`, or recognising phrases inside `[[ ]]`.
- A suggestion list shows each phrase with its resolved date. Accepting inserts a link to that day, e.g. `[[Oct 24th, 2026]]`.
- Dates resolve in the user's timezone, with a setting for week start.
- **Dependency:** journal pages must become linkable targets (currently only normal pages are). The link text maps to `journals/YYYY_MM_DD.md`, and the display format is a setting (*TBC*, Logseq's default is `MMM do, yyyy`).
- Acceptance: typing `in 2 weeks` from 2026-10-20 offers `Nov 3rd, 2026`; accepting it creates the link; the target day's journal shows a backlink.
- Tests: parser unit tests across phrases, month/year boundaries, DST, and week-start settings.

### 6.2 All pages (F21)

A page that lists every page.

- Route `/pages`, linked from the left sidebar.
- Columns: title, backlink count, last edited, shared badge. Sortable, with a filter box.
- Toggle to include or hide journal pages (hidden by default).
- Click to open. "New page" creates and focuses the title.
- Delete a page (with confirmation). Links to it remain as unresolved links and are shown dashed.
- Must respect permissions (only pages the viewer can read).
- Acceptance: with 500 pages the list renders and sorts without noticeable lag (paginate or virtualise if needed).

### 6.3 Pomodoro (F22)

Like Roam's `{{POMO}}` timer. Typing `{{POMO}}` in a page renders an inline timer.

- Defaults: 25 minute focus, 5 minute break, longer break after 4 rounds. Configurable.
- Controls: start, pause, reset. Shows remaining time inline.
- On completion: browser notification and a sound (both optional in settings).
- Optional: append a log line such as `- 🍅 Pomodoro completed 14:25` to today's journal (*TBC*).
- Must survive reload and backgrounded tabs, so store an end timestamp rather than counting with `setInterval`.
- Whether the running timer syncs across devices is *TBC*.
- The `{{POMO}}` text stays in the markdown file as-is, so the file remains portable.

## 7. Technical approach

**Hosting:** Cloudflare Workers (React Router 7 SSR), deployed from GitHub.
**Storage:** D1 (SQLite) holds pages (markdown text, version, owner, visibility), links (source, target), shares, users, with FTS for search. R2 holds attachments later.
**Files on a server:** pages are exposed as files, e.g. `GET/PUT /api/files/pages/foo.md`. A local folder can mirror them via a CLI.
**Sync protocol:**
- Every page has an integer `version`. Save is `UPDATE ... WHERE id = ? AND version = ?`.
- A mismatch returns 412 with the current page. The client three-way merges (base, theirs, mine) and retries. If it cannot merge cleanly it keeps a conflicted copy.
- Devices pull `GET /api/changes?since=<cursor>`. Offline edits queue in IndexedDB.
**Link index:** on every save, parse `[[links]]` and `#tags` into the links table. Backlinks are a query. Unlinked mentions come from full-text search.
**Live editing (later):** Mist's Durable Object agents stay in the repo and are re-enabled for shared pages in M6.

## 8. Milestones

- [ ] **M0 Foundation:** import Mist into our own repo, deploy it unchanged to Cloudflare, connect GitHub for auto-deploy, add CI, add AGENTS.md and this PRD, lock the site down while unfinished.
- [ ] **M1 Storage and auth:** D1 schema and migrations, pages API with compare-and-swap saves, login, remove 99-hour expiry and public-by-default.
- [ ] **M2 Notes core:** port the prototype behaviours onto TipTap: journal feed, wikilinks with autocomplete, backlinks, rename, tasks, indent, sidebars, search.
- [ ] **M3 Sync:** change feed, offline queue, conflict merge, CLI folder sync.
- [ ] **M4 Sharing:** visibility model, share dialog, permission-aware backlinks and search.
- [ ] **M5 Quality-of-life:** all pages list, fuzzy dates, pomodoro.
- [ ] **M6 Later:** live collaboration on shared pages, graph view, import from Logseq, attachments.

## 9. Open questions

1. Editor: keep Mist's TipTap document model and serialise to markdown, or build the always-editable overlay editor from the prototype? (Leaning TipTap for correctness, borrowing the prototype's behaviour.)
2. Do journal pages become linkable targets in M2 or only when fuzzy dates land?
3. Fuzzy date trigger syntax and the display date format.
4. Single user only at first, or teams/workspaces from the start?
5. Keep Mist's Fathom analytics hooks, or remove them?
6. Do we want a read-only public site for link-shared pages, or require login to view?

## 10. Risks

- **Merge quality:** line-based merging can mangle edits to the same line. Mitigation: conflicted copies and tests; consider a proper diff3 library.
- **Editor complexity:** Logseq-style behaviours (Tab, `[[` autocomplete, always-editable) are fiddly in TipTap. Mitigation: build and test them as small, separate extensions.
- **Link index drift:** index and markdown can disagree. Mitigation: the index is rebuilt from markdown, never the other way round.
- **Cloudflare plan limits:** check Durable Object and D1 limits on the free plan before relying on them.

## 11. Decision log

| Date | Decision | Why |
|------|----------|-----|
| 2026-10-20 | Host on Cloudflare (not Vercel) | Mist already runs on Workers and Durable Objects, and Vercel cannot hold WebSockets, which matters for live editing later |
| 2026-10-20 | Async sharing with safe sync first, live multiplayer later | Fast and safe sync is enough to start |
| 2026-10-20 | Markdown stored as Logseq-compatible files (tab-indented bullets, `YYYY_MM_DD` journals) | Portability and no lock-in |
| 2026-10-20 | D1 as source of truth for page text, exposed as files via API | Atomic compare-and-swap saves and simple queries |
| 2026-10-20 | Documents, not an outliner | Far less work; block references can come later |

## 12. Changelog

- 2026-10-20: v0.1. Initial draft from the UI prototype and planning conversation. Future features added: fuzzy dates, all pages, pomodoro.
