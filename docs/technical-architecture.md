# Technical Architecture

Technology choices, rules, and architectural decisions for Mistlog. Product scope and the reasons behind decisions live in `PRD.md`; this file describes how the system is built.

## Platform

Everything runs on Cloudflare. No other hosting, no external databases, no separate asset storage.

- **Cloudflare Workers** — single worker serving the entire application.
- **Durable Objects** — each page and each journal day is a `DocumentAgent` Durable Object holding a Yjs document in its built-in SQLite. A single `WorkspaceAgent` Durable Object (instance `default`) holds the workspace index (see below).
- **Cloudflare Access** — gates the whole `workers.dev` address; an email whitelist in the Access policy decides who gets in, signing in with a one-time PIN or a Cloudflare account. The Worker does not verify the Access token itself yet (planned for M4).

## Framework Stack

- **React Router 7** — SSR enabled, serving from Cloudflare Workers. Uses `v8_viteEnvironmentApi` and `v8_middleware` future flags.
- **Cloudflare Agents SDK** — wrapper around the project providing agent routing. Agents are Durable Objects with a higher-level API for real-time WebSocket connections.
- **Vite** — build tooling with `@cloudflare/vite-plugin`, `@tailwindcss/vite`, `@react-router/dev/vite`, and `vite-tsconfig-paths`.
- **Tailwind CSS 4** — styling.
- **TypeScript** — strict type checking.
- **TipTap 3** — multiplayer markdown editor. Core technology for the document editing experience. Backed by Durable Object persistent state via Yjs.

## Directory Structure

```
agents/       Server-side Durable Object agents
app/          React Router application
  components/ Shared UI components
  lib/        Utilities, editor logic, shared parser, Yjs provider
  routes/     File-based routing
  shared/     Constants and types shared between client and server
docs/         Project documentation
workers/      Cloudflare Worker entry point (workers/app.ts)
tests/        Test suite
```

## Critical Rule: Server/Client Separation

Client-side React components must **never** import from the `agents/` directory — not even constants, types, or enums. If both client and server need shared types/constants, put them in `app/shared/`.

This is the most common source of build errors. The Cloudflare Workers environment (server) and the browser (client) are separate runtimes.

## Worker Entry Point Pattern

The worker entry at `workers/app.ts` handles requests in this order:

1. `routeAgentRequest(request, env)` — handles `/agents/:agent/:name` WebSocket and HTTP requests to agents.
2. React Router SSR — handles everything else.

Agents are exported from the worker entry file and configured as Durable Object bindings in `wrangler.jsonc`.

## Links

A link is a `wikilink` mark on text in the page's Yjs document, with a `pageId` attribute. The mark's name and attributes are defined once in the shared parser module (M1, chunk 1.3), so the server and the editor agree on them before any link UI exists. The displayed title always comes from the index, so renaming a page never edits linking pages. See `PRD.md` section 6.1.

**Links in the editor (2.5a and 2.5b), Logseq style.** A link is text: `[[`, the title, `]]`. The brackets are real characters and the title carries the `wikilink` mark. Logic lives in `app/lib/wikilink-editing.ts`; the suggestions list is `app/lib/link-suggestions.ts`.

- **Spans:** `linkSpans` finds every `[[...]]`. A span is linked when one page's mark covers its whole title.
- **Cursor away:** faint brackets and the current title underlined.
  - A stale stored copy is hidden (`font-size: 0`, `aria-hidden`) and a widget shows the title (`side: 1`).
  - Until titles load, the copy shows. Unlinked `[[text]]` is dashed.
- **Cursor between the brackets, editor focused:** the span is plain text (`.wikilink-editing`), with suggestions once you type.
- **Entering a link to a renamed page** rewrites its stored copy to the current title, outside undo history (`addToHistory: false`). That is the only text the extension ever writes on its own. Opening a page never rewrites links: two tabs rewriting at once would duplicate text, so it happens only for the one link a person is editing.
- **Leaving a link** (cursor out, or blur) settles it in `appendTransaction`, setting or removing marks only, never text:
  - unchanged, or only the case changed: kept
  - a journal date: linked locally
  - otherwise: the mark is removed and `POST /api/pages` finds or creates the page; when it answers, every unlinked `[[text]]` with that title is marked, except the one being edited
  - marks outside brackets (a bracket was deleted), and empty titles, are unlinked
  - each title is asked for once at a time
- **Typing:** `[[` adds `]]`, `]` before `]]` steps out, and Backspace in `[[|]]` removes all four brackets. Suggestions come from `GET /api/pages/search` (untitled pages left out), with "New page: …" when nothing matches.
- **Clicking** a link you are not editing opens the page. Mousedown is cancelled, so the cursor does not move in. Alt+Enter opens the link at the cursor. Opening fires a `wikilink-open` event that `Editor` turns into navigation.
- **Pasting or dropping (2.5c):** `pastedRanges` finds where the content landed (`uiEvent` paste or drop), and every unlinked `[[...]]` there is linked by the same rules as leaving a link. HTML copied from Mistlog keeps its marks (`span[data-page-id]`), so those links are not looked up.
- **Plain-text copy** writes each link's current title.
- **Suggest mode:** none of the editing applies.
- **`POST /api/pages`** answers in this order:
  - a journal date: that day's journal
  - an existing title (ignoring case): that page
  - otherwise: `DocumentAgent.createWithTitle` on a fresh ID, which claims the title in the index under the page's index lock *before* creating anything; if another tab won, it returns that page and creates nothing
- **Titles:** `app/lib/page-titles.ts` is one title store per browser. It batches IDs into `GET /api/pages/titles` (up to 200), caches the answers, refreshes on returning to the tab, and is primed with pages learned from suggestions or creation. `WorkspaceIndex.pagesByIds` queries 100 IDs at a time (the Durable Object SQLite bound-parameter limit).
- **Known limit:** full-text search indexes the stored copy, so a link is found by its old title until the search chunk.

**Linked references (2.6, F4).**

- **Data:** `GET /api/pages/backlinks?id=` reads `WorkspaceIndex.backlinks`. That returns each linking line as the index stored it (text and marks), grouped by source page, most recently updated first, never the page itself. The route adds journal titles and slugs and keeps only link marks (`app/lib/backlink-lines.ts`).
- **Display:** `app/components/Backlinks.tsx` shows the section below every page and journal day (`DocumentLayout`).
  - `lineSegments` drops the indent and bullet and splits out links with faint brackets.
  - Links show current titles from the title store.
- **Refreshing:** it fetches on open and when the tab is shown again, never polling, and keeps its list if a refresh fails.
- **Opening:** clicks go through `useOpenLink` (side panel on Cmd/Ctrl+click), shared with the editor.

**Side panel (2.5d, F18).**

- **State:** `app/lib/side-panel.tsx` holds it, for every screen through `SidePanelProvider` in `app/root.tsx`, which also wires `t r`.
  - The open pages are newest first, capped at 10.
  - Whether it's shown, plus the list, is kept in `localStorage` through a small store read with `useSyncExternalStore`. The server renders it empty, so there's no hydration mismatch.
- **Opening a link there:** Cmd/Ctrl+click, or Alt+Shift+Enter, sets `side` on the `wikilink-open` event. `ConnectedEditor` opens the page in the panel, or navigates for missing pages or when no provider is present.
- **What it shows:** `app/components/SidePanel.tsx` renders each page as a live editor (`useYjsEditor` plus `DocumentProvider`) with its title from the title store.
- **Layout:** it's a full-height right-hand column on wide screens and a fixed full-screen sheet on phones. `DocumentLayout` hides the comments column while the panel shows pages.

**Older tabs are refused (`DOC_FORMAT_VERSION` 4).** An editor whose schema lacks a mark deletes text carrying it: y-tiptap drops what it cannot convert, and the deletion syncs to everyone.

- Browsers send `?format=<DOC_FORMAT_VERSION>` on the document WebSocket.
- `workers/app.ts` refuses a missing or older format by accepting the socket and closing it with code 4001 (`refuseOutdatedEditor`), so the page's Durable Object never wakes. A close inside `onConnect` is lost, because partyserver calls `onConnect` before returning the handshake.
- `DocumentAgent.onConnect` refuses them too, sending nothing.
- On 4001, `useYjsEditor` stops PartySocket reconnecting and sets `outdated`. `ConnectionStatus` then shows "Updated: reload" and the editor turns read-only.
- Any new mark or node needs a version bump.

## Tags

- A tag (PRD F45) is `#name` or `#[[multi word name]]` in the text; its name carries the same `wikilink` mark (`pageId`) as a link's title, so the index counts it as a link (linked references, backlink counts) and a rename never edits tagging pages. There is no new mark, so no format change.
- Where tags are is decided once, by `tagsInLine` in the shared parser (invariant 7): after whitespace or at the line start, `#` then letters, digits, `_`, `-` or `/` (not only digits), or `#[[...]]`; not in inline code or inside a `[[link]]`'s text. `isPlainTagName` says whether a title can be written `#name`.
- In the editor (`wikilink-editing.ts`) tags are spans like links (`kind: "tag"`): a plain `#tag` counts as being edited from after the `#` to its end, so typing on keeps it open and a space settles it. A span the current edit just created starts empty, so suggestions show from its first letter. Choosing a suggestion writes `#name` or `#[[name]]` and a space. A plain tag whose page gains a space is rewritten as `#[[...]]` when your cursor enters it, and copies as `#[[...]]`.

## Shared Note Parser

One module, used by both the workspace index (server) and the editor (client), so links, tags and tasks are extracted one way (AGENTS.md invariant 7).

| File | Role |
|---|---|
| `app/lib/note-ids.ts` | Page IDs: Mist's random 8-character IDs for pages, `journal-YYYY-MM-DD` for journals (validated as real dates) |
| `app/lib/wikilink.ts` | The `wikilink` mark: name, `pageId` attribute, ProseMirror spec. The editor's TipTap extension (chunk 2.5) wraps this spec |
| `app/lib/note-parser.ts` | `parseLine` (indent, bullet, task) and `parseNote` (links, tags, tasks, search text), plus `PARSER_VERSION` |
| `app/lib/note-lines.ts` | Converts a Yjs fragment (server) or ProseMirror doc (client) into the parser's input: one line per paragraph, with mark ranges |

Tests in `tests/unit/lib/note-*.test.ts` include a round trip through Yjs using y-tiptap's converters (the same code the editor syncs with) and check that the server and client produce identical parser output.

## Page Titles

- A page's title is `meta.title` in its Yjs document (`DOC_FORMAT_VERSION` 3), so it syncs live between tabs. Journals are titled from their date and have no stored title.
- **Only the server writes titles.** Uniqueness is a cross-page rule enforced by the index, while the title itself lives in each document, so there must be exactly one writer, and it must go through the index first.
  - `PageTitle` (`app/components/PageTitle.tsx`) calls `POST /api/rename` with JSON `{ pageId, title }` (`app/routes/api.rename.ts`). Non-JSON bodies are refused, so another site's form cannot rename.
  - The route calls `DocumentAgent.rename(title)` on the page's own Durable Object. It refuses journals and documents that were never created, validates with `normalizeTitle`, then, holding the document's **index lock**, calls the index's `claimTitle`.
  - `claimTitle` runs in one transaction. It refuses a title another page or journal has (compared NFC-lowercase with `titleKey`) and any journal-date title (`isJournalTitle`), then records the title and assigns the slug.
  - Only after a successful claim does `DocumentAgent` write `meta.title` (origin `SERVER_ORIGIN`). It broadcasts the change to every connected browser, re-indexes at once, and the route returns the new address. The browser then moves to that address.
  - **Browsers cannot write `meta.title`.** Updates from browsers are applied with origin `CLIENT_ORIGIN`. If one changes `meta.title`, `DocumentAgent` puts the approved title back (origin `SERVER_ORIGIN`) and the revert reaches every tab.
- **The index lock** (`withIndexLock` in `agents/document.ts`) serialises `reindex` and `rename` for one document. A rename claims only after any reindex in flight has finished, so no reindex carrying the old title can reach the index after the claim. Without it, a page could briefly appear to have its old title, letting another page take its new one. The lock is per document; the index serialises claims across documents.
- Title rules live in `app/lib/page-title.ts` (`normalizeTitle`): NFC, invisible characters (zero-width, bidirectional controls, soft hyphen, BOM) removed, whitespace collapsed, 1 to 200 characters, no `[[` or `]]`.
- **Rebuild constraint (chunk 1.6).** While the index is rebuilding, `claimTitle` must refuse, because titles not yet re-indexed would look free.
- **Residual risk.** The server writes `meta.title` in the same synchronous step that `claimTitle` returns in. If the process died between the two, the index would hold a title the document lacks until the next reindex reverts it.
- Because links store page IDs, renaming changes nothing else. Links will show the new title once they read it from the index (chunk 2.5).

## Journal Pages

- A journal day is the `DocumentAgent` named `journal-YYYY-MM-DD`, opened at `/journal/YYYY-MM-DD` (`app/routes/journal.$date.tsx`). Any real date can be opened; invalid dates are 404, and `/docs/journal-…` redirects. `pagePath` returns the journal address for journal IDs.
- **Created by its first real text.** Journals have no `POST`. `DocumentAgent`'s update handler, for a journal without the `exists` marker, checks whether the document now has non-whitespace text (`createJournalIfWritten`). If so it records `exists` and `createdAt`, stamps `DOC_FORMAT_VERSION` and registers with the index. Until then it **does not persist** the Yjs state, so opening a day leaves nothing behind; the first text persists the whole document. Tabs still sync before creation. (The TipTap editor writes nothing into an empty document when it opens; the text check is a safety net.)
- Titles are the date (`journalTitle`), shown read-only by `JournalHeading`; `meta.title` writes are reverted and renames refused. The weekday is rendered on the server (it is the same in every time zone); "Today" and the "Not saved yet" note are decided in the browser with `useSyncExternalStore`.
- The header's "Today" button navigates to `/journal/<localDate(now)>`, computed in the browser's time zone when clicked.
- `onConnect` sends the document to the new tab first, then runs `indexOnOpen` (never throws), so indexing can never stop a tab receiving its document.

## Journal Feed

- `/` (`app/routes/home.tsx`) is the journal feed. The loader asks the index for the newest days with notes (`journals(7)`) and fails open: if the index is unreachable, the feed still shows today, with a retry for earlier days.
- `JournalFeed` (`app/components/JournalFeed.tsx`) puts today first. Today is decided in the browser with `useSyncExternalStore`; the server renders a placeholder of the same height. Earlier days (before today, so future days are hidden) follow, newest first. Older batches load from `GET /api/journals?before=&limit=` (`app/routes/api.journals.ts`) when a sentinel near the bottom comes within 800px of the screen, or from a "Show older days" button.
- Each day is a `JournalDay`: a live editor with its own Yjs connection and Mist document context (`DocumentProvider`, `ConnectedEditor`, `DayBar`). Days show a light placeholder until they come within 1200px of the screen (`CONNECT_MARGIN`), the first three at once, then stay connected so scrolling back is instant.
- `AppHeader` and `ConnectedEditor` are shared with the single-page screen (`docs.$id.tsx`), so both render the same header and editor wiring.
- Day headings are `h2` under one visually hidden `h1` ("Journals"), and do not set the browser tab title.

## Bullets and Indentation

- The text stays Logseq-compatible: a bullet is `- ` after leading tab characters (PRD F7). Only keys and display change.
- `app/lib/bullets.ts` is pure line logic. `indentPlan` moves a line or a selection with its children, at most one level below the line above, and makes indented plain lines bullets. `enterPlan` continues a bullet, starts the first child at the end of a line with children, adds an empty bullet above when the caret is before the content, and outdents or ends an empty bullet. `backspacePlan` outdents, or removes a top-level bullet, when the caret is right after `- `. Every change rewrites only the start of a line.
- `app/lib/bullet-editing.ts` (`BulletEditing`, registered in `Editor.tsx`) applies the plans as ProseMirror transactions, so they sync over Yjs and undo normally. Inserted indentation is plain text and never takes a mark; Enter splits with `tr.split` so moved text keeps its marks. Keys are ignored during IME composition. In suggest mode, Tab and Shift+Tab are swallowed (focus stays in the editor) and Enter and Backspace are left to Mist (F34 will design indentation suggestions).
- `bulletDecorations` draws each leading tab as a fixed-width indent with a guide (`.md-indent`) and a bullet's `-` as a dot (`.md-bullet`), skipping code fences. The caret still moves one character at a time across `- `.

## Block IDs

- Every line (top-level paragraph) has a permanent `blockId` attribute, a UUID (PRD F41, document format version 5). In Yjs it is an attribute on the paragraph's `XmlElement`; in ProseMirror a paragraph attribute, drawn as `data-block-id`. The index stores it as `DocLine.id` inside each line's saved content, so references and tasks can name a line.
- **Who labels a line.** Two writers must never give one line different IDs, so there is exactly one writer per line. The browser labels only the lines its own local edit creates, in the same transaction (`app/lib/block-id-editing.ts`, `BlockParagraph`), so they reach Yjs labelled. Every other line without an ID (documents from before v5, and the first line of a new page, which ProseMirror creates before any edit) is labelled by `DocumentAgent.labelLines`: once on load, before any browser is sent the document, and after a browser's edit that adds lines. Remote (y-sync) transactions are never labelled in the browser.
- **The rules** (`linesNeedingIds` in `app/lib/block-ids.ts`, shared by both): a line needs an ID if it has none, or if its ID is held by a line that existed before the edit, or by an earlier line. A line counts as existing if its start maps through the edit (assoc 1, not deleted). So splitting keeps the ID on the upper half, Enter before the text keeps it on the text, joining keeps the upper line's ID, a moved line keeps its own, and pasted lines get new IDs because the attribute is never parsed from HTML.
- Undo restores a deleted line with its old ID (Yjs undo arrives as a remote change). The server pass writes nothing when every line already has a unique ID, so it is safe to run repeatedly.

## Folding

- A folded line has `collapsed: true` on its paragraph (Logseq's `collapsed:: true`), part of document format 5, so folds sync to every device and every viewer (PRD F37). Unfolding removes the attribute.
- `app/lib/folding.ts` is the pure logic: hidden lines, folded ancestors, the nearest visible line. A block is the line and the following lines indented deeper (`blockEnd`).
- `app/lib/folding-editing.ts` (`Folding`, priority 110 so its Enter runs before `BulletEditing`) draws hidden lines with `display: none` (`.fold-hidden`), a ring on folded bullets (`.is-folded`) and an arrow widget before the bullet on lines with children. Cmd/Ctrl+↑/↓ fold and unfold the caret's line, and only consume the key when something changes. Fold transactions carry `addToHistory: false`.
- **The caret never stays in a hidden line** (`keepCaretVisible`, an `appendTransaction`): a selection move into a folded block carries on past it in the same direction; a local edit that leaves the caret inside one unfolds its folded ancestors; a fold (local or from another tab) that hides the caret moves it to the folded line without writing anything. Enter at the end of a folded line inserts a sibling after the hidden children.

## Moving Blocks

- `app/lib/moving.ts` plans a move as `{from, to, before, indentDelta}` over line indexes: `moveBlockPlan` (Alt+Shift+↑/↓) swaps a block with the previous or next block at its level and never leaves its parent; `dropPlan` puts a dropped block above the target at the target's level. A block always moves with its children.
- `app/lib/block-moving.ts` (`BlockMoving`) applies a plan as one transaction: the block's nodes are deleted and inserted (re-indented if needed), so their attributes (block ID, fold) go with them and undo is one step. Not in suggest mode or read-only editors.
- Dragging uses an invisible handle widget over each bullet (`.bullet-handle`, above the bullet text so the mouse finds it). The dragged block is remembered by block ID, so lines added by another tab during the drag cannot change which block moves. A drop line (`.drop-above`) starts at the target's indent. Drops on another editor (another feed day, the side panel) are refused.
- Yjs has no move operation: a moved line is a new Yjs element, so a keystroke typed into that line on another device at the same instant can be lost. Accepted; see `docs/reviews/m2b.1c-moving-blocks-review.md`.

## Block Selection

- `app/lib/block-range.ts` is the pure logic: a selection is lines `from..to` and never splits a line from its children (Shift+↑ onto a parent takes its whole block); hidden lines come only with the folded block that hides them.
- `app/lib/block-selection.ts` has two extensions. `BlockSelectionStart` (priority 1) turns Esc into "select the caret's block", after every other key handler, so an open link suggestion list closes first. `BlockSelection` (priority 1000) owns the keyboard while blocks are selected: ↑/↓ move, Shift+↑/↓ grow, Tab/Shift+Tab indent (`indentPlan`), Backspace/Delete remove, Enter and Esc leave; other Cmd/Ctrl shortcuts leave the selection and pass on; every other key, text input, `beforeinput` and paste is swallowed so nothing can replace the blocks.
- The plugin state is the selection as positions between top-level lines, mapped through edits (the start with assoc 1, the end with assoc −1, so lines another tab adds at either edge stay outside). Any local selection change (a click) ends it.
- While blocks are selected, the editor's text selection spans them so the browser fires copy and cut, but it is not drawn (`.has-block-selection`); the lines get `.block-selected`. Copy and cut write Logseq text (one line each, through the editor's `clipboardTextSerializer`, so links show current titles) and HTML from `serializeForClipboard` (links keep their page IDs). `BubbleToolbar` shows nothing during a block selection.
- Changing blocks needs an editable editor outside suggest mode; copying always works.

## Zoom

- A zoomed page shows one block and its children (PRD F40). The zoom is in the address, `?block=<block ID>` (`ZOOM_PARAM` in `app/lib/zoom.ts`), so Back and Forward zoom out and in, and links can open a block. Page redirects (`/docs/<id>` to `/page/<slug>`, old slugs) keep the query.
- The page owns the zoom: `docs.$id.tsx` reads `?block=` and passes `zoom` and `onZoom` to `ConnectedEditor`, which shows `ZoomCrumbs` (page › the blocks above › the zoomed block, from the live Yjs doc) and passes them on to `Editor`. The feed (`JournalDay`) and side panel (`SidePanel`) pass only `onZoom`, which navigates to that page zoomed.
- `app/lib/zoom-editing.ts` (`Zoom`, priority 120): `setZoom` (a transaction meta) sets the zoomed block; lines outside it get `.zoom-hidden`, and its own indentation is drawn with no width (`.zoom-indent`) so it sits flush left. A bullet click (the drag handle in `block-moving.ts`), Cmd/Ctrl+. (into the caret's block) and Cmd/Ctrl+, (out one level) send a `ZOOM_EVENT` on the editor, which `Editor` turns into `onZoom`, like `OPEN_LINK_EVENT` for links.
- **Edits stay inside the zoomed block** (`staysInZoom`, a `filterTransaction`): this tab's transaction is refused if a step touches the line boundary above the zoomed line or anything after its last child, if the zoomed line loses its ID, or if a line it held ends up outside it (an outdent past it, plain lines pasted at its end). Other tabs' edits always apply. The caret is kept inside it. Enter at the end of the zoomed line adds its first child.
- Folding, block selection and the breadcrumb follow the zoom: the zoomed block always shows its children (folds outside it are ignored), selections never reach outside it, and `ancestorsOf` uses the same block rule (`blockEnd`) as folding.
- If the zoomed block disappears (deleted, or moved by another tab), the editor shows the whole page and `ZoomCrumbs` says so, once the document has synced.

## Tasks

- A task is a line whose content starts with `TODO`, `DOING`, `DONE`, `LATER` or `NOW` (PRD F6, F42); a priority is the first `[#A]`–`[#C]` outside inline code. Both are parsed by the shared parser (`parseLine`, `priorityAt`; parser version 2).
- `app/lib/tasks.ts` holds the cycles (Cmd/Ctrl+Enter: none → TODO → DOING → DONE → none, LATER → NOW → DONE) as prefix edits, and the `TaskItem` shape the Tasks view gets. `app/lib/task-editing.ts` (`TaskEditing`) cycles the lines a selection touches and styles keywords and priorities; `block-selection.ts` cycles the top lines of selected blocks.
- The index's `tasks` table (schema 3) keeps each task's block ID, priority and stored line. `WorkspaceAgent.tasks` returns serialisable `TaskItem`s, the line reduced like a linked reference (`toBacklinkLine`); rows from before schema 3 come back as their keyword and text until their page is re-indexed.
- `/tasks` (`app/routes/tasks.tsx`, `TasksView`) is read-only: NOW, DOING, TODO, LATER (index order within each: priority, then journals newest first, then pages by title), and the 50 most recently changed done tasks. A task's text is one link to `zoomHref(pagePath(page), blockId)` (its links show current titles as text, via `ReferenceLine` with `plainLinks`); its page name links to the page. Cmd/Ctrl+click opens the page in the side panel. The list reloads when the tab is shown again, never by polling.
- Until the index rebuild after a parser change (M1 chunk 1.6) is built, pages are re-indexed only when opened, so tasks on pages not opened since block IDs open the whole page rather than zoomed.

## Phones

- On touch screens (`(pointer: coarse)`), `PhoneToolbar` (mounted once in `root.tsx`) shows while an editor has focus: outdent, indent, task, link, up, down, fold, done (PRD F17). It sits above the on-screen keyboard by following `window.visualViewport`. Buttons act on pointer down with `preventDefault` and `tabIndex=-1`, so focus (and the keyboard) stays in the editor.
- The focused editor is published by `Editor` to `app/lib/active-editor.ts` on focus and cleared on blur or unmount (only if it is still the active one). `app/lib/phone-actions.ts` runs each button as its keyboard command (`indentSelection`, `cycleLines`, `moveCaretBlock`, `setFolded`, typing `[[` through `handleTextInput`), so suggest mode, zoom and read-only rules are the same; outline actions are off in suggest mode.
- Below the `sm` breakpoint: the header drops the page address and the theme picker on page screens, and the connection status shows only its dot; `DayBar` is hidden in the feed; `MobilePanel` starts collapsed. On `(hover: none)` fold arrows always show; on `(pointer: coarse)` the bullet's tap target is wider.

## All Pages and Deleting

- `/pages` (`app/routes/pages.tsx`, `AllPagesView`) lists `WorkspaceAgent.allPages()`: every page and journal with its slug, last indexed time and how many other pages link to it. Filtering and sorting are pure functions in `app/lib/all-pages.ts`, which also defines the row type (shared by the index and the view). The first 200 rows render, then "Show all". Dates are formatted only in the browser, so server and client render the same HTML.
- Deleting (`POST /api/pages/delete` → `DocumentAgent.deletePage`, under the index lock): the document records a `deleted` marker (so `exists()` is false: no indexing, `GET` says it doesn't exist, new WebSockets are closed with `CLOSE_DELETED_PAGE` 4002), then the index's `deletePage` removes the page's entry, everything derived from it, its slugs and its registry entry, and records it in `deleted_pages` (schema 4). If the index call fails, the marker is removed again. Open tabs are closed with 4002; `useYjsEditor` reports `deleted`, the editor turns read-only and the status says "Deleted".
- The index ignores `updatePage` and `registerPage` for a page in `deleted_pages`, so a late update from an open tab, or a rebuild, can never bring it back. Links to it from other pages stay in their rows and show as missing. Its Yjs state stays in its Durable Object for a later Trash. Journal days can't be deleted yet.

## Browser Copy (first part of offline)

- `useYjsEditor` keeps each page's Y.Doc in IndexedDB through `y-indexeddb` (`app/lib/local-cache.ts`, database `mistlog:v<DOC_FORMAT_VERSION>:<page ID>`). The saved copy loads into the doc while the WebSocket connects, and the two merge like any Yjs replicas: the provider sends every update not from the server, so edits saved while offline reach the server on reconnect.
- The name carries the document format version, so a copy written by older code is never loaded after a format change. A page closed with `CLOSE_DELETED_PAGE` has its copy cleared; an outdated tab's copy is kept.
- Lines loaded from the saved copy arrive as remote (y-sync) changes, so the browser never labels them with block IDs; the server's rule (F41) still holds.
- Not yet: the app shell offline (a service worker), and saying on screen that a page shows a saved copy. Copies stay in this browser; nothing clears them on sign-out (there are no accounts yet).

## Logseq Import

- `app/lib/logseq-import.ts` is pure: `convertGraph(files)` turns a picked graph folder (paths and texts) into an `ImportPlan` of pages with Mistlog lines (text, block ID, fold), the titles linked but missing, skipped files with reasons, renamed and combined pages, and counts. Rules are in the module comment and PRD F31. Files are processed in code-point order, so the same folder always gives the same plan. The folder is found by the nearest `pages`, `journals`, `assets` or `logseq` above each file (the graph's own folder may be called "Logseq").
- Links and tags in imported text are found with `writtenLinks` from the shared parser, which the editor's `linkSpans` also uses (invariant 7).
- `/import` (`ImportView`) reads the folder in the browser (`webkitdirectory`), converts it, and asks `POST /api/import/check` which titles are pages already and which days have notes (`WorkspaceIndex.importCheck`, read-only, batched under the 100-parameter limit). `summarise` gives the report's numbers.
- **Writing (step 2).** The browser drives `POST /api/import/:step` (`app/routes/api.import.$step.ts`) through `app/lib/import-run.ts`, a few titles or documents per request (`IMPORT_BATCH`, sized for the free plan's 50 subrequests; `getAgentByName` itself makes one). Each step is safe to repeat, so failed requests are retried and an interrupted import is continued by choosing the folder again:
  - `start` records an import in the index (`imports` table, schema 5) and is refused while one exists that is not undone.
  - `pages` finds each title's page (existing page, journal date) or creates it with `DocumentAgent.createWithTitle`. A new page is recorded in `import_pages` as created *before* it is created, so undo always finds it; a lost race (`taken`) links to the winner and forgets the record.
  - `write` records each document in `import_pages`, then calls `DocumentAgent.importLines`, which appends the lines through Yjs (`app/lib/import-lines.ts`: paragraphs with `blockId`, `collapsed` and `wikilink` marks, as y-tiptap stores them) and, in the same synchronous step, stores the added block IDs in `doc_state` under `imports`. A second write for the same import adds nothing. Link ranges come from `linkedLines` in the browser.
  - `finish` marks it done; `undo` takes a few documents at a time: `undoImport` removes exactly the recorded block IDs (wherever the lines are now, edited or not), `deletePage` soft-deletes pages the import created, and the record is forgotten. When none are left the import is `undone` and another may start.
- Import records are not derived from documents: like the registry, a rebuild never clears them.

## Durable Object Usage

Durable Objects are billed for every second they are awake; they hibernate after about 10 idle seconds (WebSocket hibernation, on by default in the Agents SDK). The free plan allows about 28 hours of awake time a day.

- **No repeating timers on a Durable Object.** A pending `setInterval` or `setTimeout` stops hibernation. y-protocols' `Awareness` runs a 3-second interval, so `DocumentAgent` uses `createRelayAwareness`, which stops it; browsers expire stale presence after 30 seconds, and `onClose` removes a departing browser's state. Short one-off timers (the 0.3-second index timer) are fine. A test fails if starting a `DocumentAgent` leaves any timer pending.
- **Presence only from the editor in use.** y-protocols re-sends a browser's presence every 15 seconds while it is set, waking that page's object. `usePresenceWhileFocused` (`app/lib/connection-budget.ts`) clears presence unless the editor is focused in a visible tab. Collaborators' cursors disappear when they click away, and reappear when they return.
- **Hidden tabs disconnect.** `useDisconnectWhenHidden` closes a tab's connections after 5 minutes hidden and reconnects when it is shown; the server's sync messages bring it up to date.
- **Result:** an idle open page or feed costs almost nothing; awake time is spent while someone types (about 10 seconds after each burst, for the page and the index). Measured locally with headless Chrome: a 17-day feed sent 0 messages to documents in 40 idle seconds.

## Readable URLs

- `/page/<slug>` is a page's readable address; `/docs/<id>` is its permanent one and redirects (302) to the slug when the page has one. Untitled pages, and titles with no letters or digits, stay at `/docs/<id>`.
- `slugify` (`app/lib/slug.ts`) lowercases, keeps letters, digits and marks from any script, turns everything else into `-`, and caps at 80 code points.
- The index assigns slugs in `updatePage` (`assignSlug` in `agents/workspace-index.ts`). A slug another page currently holds gets a suffix: the first 4 characters of the page ID, then the full ID. A slug that is only another page's old redirect is taken over. Re-indexing keeps a page's slug stable.
- `/page/:slug` (`app/routes/page.$slug.tsx`) resolves through the index. Old slugs, and other case or accent forms, redirect to the canonical address; unknown slugs are 404. Both routes share `app/lib/document-loader.server.ts`. The `/docs/<id>` slug lookup fails open if the index is unreachable.
- After a rename the browser moves to the new address at once: `claimTitle` has already assigned the slug (chunk 2.1d).

## Workspace Index

Each page is an isolated Durable Object, so cross-page features (backlinks, `[[` autocomplete, search, the Tasks view, the journal feed) query one `WorkspaceAgent` instead. The index is always derived from documents, never the other way round.

### Implementation

- **Schema versions.** `SCHEMA_V1` is frozen as shipped. `MIGRATIONS` is an append-only list; entry *n* upgrades version *n* to *n+1*. Opening the index runs any pending migrations in one transaction, and refuses an index newer than the code. Version 2 (chunk 2.1b) adds `slugs` and slugs every titled page.

- `agents/workspace-index.ts`: `WorkspaceIndex`, all schema, updates and queries, written against a two-method SQL interface (`exec`, `transaction`).
- `agents/workspace.ts`: `WorkspaceAgent`, which adapts Durable Object storage (`storage.sql.exec`, `storage.transactionSync`) to that interface and exposes the index's methods over Durable Object RPC.
- **Private.** Only other Durable Objects call it. The Worker refuses `/agents/workspace-agent/*` before the agent router (`isPrivateAgentPath`), and the agent refuses HTTP requests and WebSocket connections. UI queries will go through server routes that can check permissions (M4).
- **Updates.** A document sends `{ pageId, title, updatedAt, lines }`. The index runs the shared parser and replaces that page's rows in one transaction, then returns an acknowledgement. Journals are titled from their date (`journalTitle`).
- **Search.** FTS5 with `unicode61 remove_diacritics 2`. Input is quoted word by word (`ftsQuery`), so FTS syntax in user input is searched literally.
- **Tests** run the real SQL on Node's built-in SQLite (`tests/helpers/sqlite.ts`). The same code was also run once inside local `workerd` (Miniflare) to confirm FTS5, transactions and the schema work on Cloudflare's SQLite.

### What it holds

- **Page registry** — every page ID and its creation date, recorded when the page is created. This is the only part of the index that cannot be rebuilt (Durable Objects cannot be listed), so rebuilds never clear it. Journals have date-based IDs (`journal-YYYY-MM-DD`) and can always be found by date.
- **Slugs** — every slug each page has had (`slugs`: `slug`, `page_id`, `current`). Like the registry, never cleared by a rebuild, because old slugs are not recorded in documents and old links must keep redirecting.
- **Derived tables** — `pages` (title, kind, journal date, updated), `links`, `tasks`, and a full-text search table. These can be cleared and rebuilt at any time.
- **Parser version** — the version of the shared parser that built each page's entry.

### How it stays correct

1. **On every edit.** Each Yjs update marks the document as needing indexing. An in-memory timer reindexes **0.3 seconds after the last edit** (`INDEX_PAUSE_MS`), or **2 seconds after the first unindexed edit** (`INDEX_MAX_WAIT_MS`), whichever comes first, so the index is fresh almost as soon as typing pauses and continuous typing still reaches it every 2 seconds. In-memory timers are lost if the object is evicted, so a persisted `schedule("reindex")` in 2 seconds (`INDEX_DELAY_SECONDS`) stays as a backup; whichever runs second finds nothing to do. While the document is retrying after a failure, the fast timer is off and only the backoff schedule runs. `reindex` sends `{ pageId, title, updatedAt, lines }` (lines from `linesFromYjs`); the index parses them and replaces only that page's rows. Re-indexing the same content twice gives the same result.
2. **Retry until confirmed.** Each document keeps an index state record in its own storage (`doc_state` key `index`): unsent edits, the last `updatedAt` sent, the last acknowledgement, and a retry count. A failed call retries after 5 s, 30 s, 2 min, then every 10 min (`INDEX_RETRY_SECONDS`), resetting after a success. Schedules are stored by the Agents SDK, so they survive restarts. Index failures are logged and never affect editing or sync.
   - **Ordering.** Each document sends strictly increasing `updatedAt` values (`max(now, lastSent + 1)`), and the index ignores any update older than the one it holds, so a slow retry can never overwrite newer content. If the index reports it holds something newer (for example after lost local state), the document sends again with a later time.
   - **Which documents.** Only documents created through `POST` (the `exists` marker) with a valid page ID are indexed or registered, so a WebSocket to an arbitrary ID cannot add entries.
   - **On open.** A document re-indexes when a client connects if it was never indexed, was indexed by an older parser, or has unsent edits. New documents register in the registry when created.
3. **Rebuild when the parser changes** (built 2026-11-04). The first time `WorkspaceAgent` is used after it wakes, it counts registered pages never indexed or indexed by an older parser (`refreshCount`). If there are any and no pass is running, it starts one: each `rebuildStep` (run by `this.schedule`, never a repeating timer) asks the next `REBUILD_BATCH` pages' `DocumentAgent.refreshIndex()` to send their lines again, saves a cursor in the index's `meta` table, and schedules the next step `REBUILD_PAUSE_SECONDS` later; the pass ends when no pages are left. Nothing is cleared first, so search, backlinks, tasks and title claims keep working, and each page's rows are replaced as it reports. A page that fails is logged and retried by the next pass (the next wake); a pass whose next step was lost (a cursor but no `rebuildStep` in `getSchedules()`) is resumed on the next wake, and a running step never starts a second chain. `indexStatus()` reports how many pages are left; the Tasks page shows it. Journals are found through the registry like pages (they register when created).
4. **Weekly check.** Once a week the index asks each registered page whether its entry is current, by comparing a short content summary, and re-indexes only those that differ (M1, chunk 1.6; can land after M2).

**Limit:** none of these catch a bug in the parser itself, because a wrong result is consistently wrong. Parser tests and the version bump in step 3 are the only defence.

### Existing documents

Mist-era documents are not backfilled, because they cannot be listed. A document indexes itself whenever it is opened.

### Alarms

`DocumentAgent` does not override `alarm()`. The Agents SDK uses `alarm()` to run tasks registered with `this.schedule()`, which is what debounced indexing and retries use. Documents created before the 99-hour expiry was removed still have a deletion alarm scheduled; when it fires, the SDK finds no scheduled task and does nothing. Scheduled work must never delete document data.

### What the user sees

Nothing in normal operation. Signals appear only where results may be incomplete, and only while they are:

| Situation | Where | Message |
|---|---|---|
| This page's latest edit is not confirmed by the index | Small dot by the backlinks heading | "Recent edits to this page aren't in search yet" |
| A rebuild is running | One line at the foot of the left sidebar, and a note above search, backlinks and Tasks results | "Updating index · 140 of 412 pages" |
| The weekly check fixed pages | Not shown; logged | — |
| User suspects drift | Settings | "Rebuild index" button, same progress line |

## Key Configuration

- `wrangler.jsonc` — Cloudflare Workers config. Must include `"nodejs_compat"` in compatibility flags (required by Agents SDK for `async_hooks`). A new Durable Object class needs a new, append-only `migrations` entry. Set `CLOUDFLARE_ACCOUNT_ID` env var for deployment.
- `react-router.config.ts` — SSR enabled with `v8_viteEnvironmentApi` and `v8_middleware` future flags.
- `vite.config.ts` — plugins: cloudflare, tailwindcss, reactRouter, tsconfigPaths.
- `vitest.config.ts` — test config with fixed coverage floors (see `PRD.md` section 7, Quality gates).

## Documentation

- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare Agents SDK: https://developers.cloudflare.com/agents/
- Durable Objects: https://developers.cloudflare.com/durable-objects/
- Cloudflare Access: https://developers.cloudflare.com/cloudflare-one/policies/access/
- React Router 7: https://reactrouter.com/
- TipTap: https://tiptap.dev/
- Yjs: https://yjs.dev/
