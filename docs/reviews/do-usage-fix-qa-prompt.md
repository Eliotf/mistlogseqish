# QA prompt: Durable Object usage fix

Paste everything below the line into a coding model that has access to this repository, opened at the repo root.

---

You are doing independent quality assurance on a change made by another AI model. Find real defects; do not restate the code. The goal of the change is that idle Durable Objects hibernate, because the free plan's daily duration limit was exceeded. Anything that keeps an object awake, or wakes it repeatedly while nobody is typing, is a defect.

Read first:

1. `AGENTS.md`, especially the "no repeating timers" rule
2. `docs/technical-architecture.md`, "Durable Object Usage"
3. `docs/reviews/do-usage-fix-review.md`

## What to do

1. **Run the checks:** `npm ci`, `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`. Report exact results.
2. **Hunt for anything that keeps a Durable Object awake.** Search `agents/`, `workers/` and everything they import, including `node_modules` code that runs on the server, for:
   - `setInterval`
   - self re-arming `setTimeout`
   - unresolved promises
   - long-lived streams

   Check `agents/workspace.ts` and the Agents SDK's own behaviour.
3. **Hunt for browser traffic while idle.** Look for anything in `app/` that sends WebSocket messages without user action, such as heartbeats, awareness renewals or resyncs. Check `app/lib/yjs-provider.ts`, `useYjsEditor.ts`, the editor extensions, and PartySocket's reconnect behaviour.
4. **Try to break the client logic.** Add tests in `tests/unit/lib/connection-budget-qa.test.tsx`. Explore:
   - focus moving between two editors in the feed
   - blur caused by clicking the bubble toolbar
   - visibility changing rapidly
   - the page loading hidden
   - unmounting while hidden
   - reconnect after a hidden period while edits were made in another tab: are they received?
5. **Presence correctness.** With two clients, check:
   - does a collaborator's cursor appear when they type, and disappear when they blur?
   - is a stale state ever stuck on a client?
   - does `CollaborationCaret` misbehave after `setLocalState(null)`?
6. **If you can run headless Chrome against `npm run dev`,** repeat the author's idle measurement: count incoming WebSocket messages over 60 idle seconds with the feed open, then with a document page open, using a temporary log in `onMessage` that you remove afterwards. Report the counts. Also check that documents hibernate (a temporary constructor log, held idle for 25 s, then an edit).

## Rules

- Only add test files. Temporary logging for measurement must be removed, with no diff left. If a test you write fails because of a real bug, keep it, mark it with `it.fails(...)` and add a comment explaining the bug.
- Do not lower coverage floors or weaken tests. Do not deploy or touch any Cloudflare account. Do not commit or push.

## Report format

Start with one line: the check results.

Then list findings, most severe first. For each:

- **Severity**: high (an object kept awake or woken repeatedly while idle, or lost edits), medium, or low.
- **Where**: `file:line`.
- **What**: one sentence.
- **Evidence**.
- **Suggested fix**.

Then "Not checked". If you find no real defects, say so plainly.
