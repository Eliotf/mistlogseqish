# Review guide: Durable Object usage fix

For a senior engineer reviewing this change. Find the commit with `git log -- docs/reviews/do-usage-fix-review.md`.

## What happened

On 2026-10-27 the live site exceeded the Cloudflare free plan's daily Durable Object duration limit: 13,000 GB-s, about 28 hours of awake time at 128 MB. Durable Object requests then failed until 00:00 UTC.

**Cause, found by reading code and confirmed locally:**

1. **Mist's server never hibernated.** `DocumentAgent` created a y-protocols `Awareness`, whose constructor starts a 3-second `setInterval` (`node_modules/y-protocols/awareness.js`, around line 59). A Durable Object with a pending timer cannot hibernate, so every document with an open connection was billed for its whole time open.
2. **The journal feed (2.2) multiplied it.** Each live day is a separate document, so one feed tab with 17 days cost about 17 awake-hours per hour.
3. **Browsers re-send presence every 15 seconds** (y-protocols' renewal) for every editor with a presence state. That alone would wake each document regularly, even without cause 1.

Local development and CI do not use the Cloudflare account's quota. Only the live site does.

## What changed

| File | What it does |
|---|---|
| `agents/document.ts` | `createRelayAwareness(doc)` creates the `Awareness` and clears its `_checkInterval`, a private field, hence the cast and comment. The server still applies, encodes and relays awareness. Browsers expire stale remote states after 30 s, and `onClose` removes a departing connection's state. |
| `app/lib/connection-budget.ts` | **New.** `shouldBePresent`. `usePresenceWhileFocused(editor, awareness, user)` sets presence (`setLocalState({ user })`) only while the editor is focused and the tab visible, and clears it (`setLocalState(null)`) otherwise, so y-protocols has nothing to renew. `useDisconnectWhenHidden(socket)` closes the PartySocket after 5 minutes hidden and calls `reconnect()` when shown, only if it closed it. |
| `app/components/Editor.tsx` | Calls `usePresenceWhileFocused`. |
| `app/lib/useYjsEditor.ts` | Calls `useDisconnectWhenHidden(socket)`. |
| `tests/unit/lib/connection-budget.test.tsx` | **New**, 9 tests. |
| `tests/integration/agents/document-agent.test.ts` | Hibernation guardrail: starting a `DocumentAgent` and serving a request leaves no pending timer, and `createRelayAwareness` leaves no interval. |
| `PRD.md`, `docs/technical-architecture.md`, `AGENTS.md` | A risk updated with what happened, a decision, a "Durable Object Usage" section, and a rule: no repeating timers on Durable Objects. |

## Design decisions to validate

1. **Clear the interval rather than replace `Awareness`.** This keeps y-protocols' tested encode, apply and remove logic, at the cost of touching a private field. If an upgrade renames `_checkInterval`, the guardrail test fails, because the timer count would not be 0.
2. **No server-side expiry of stale presence.** A browser that vanishes without closing leaves a stale state on the server until that document restarts. New joiners drop it after 30 s, because browsers track freshness themselves.
3. **Presence only while focused in a visible tab** (owner-approved). A collaborator's cursor disappears when they click away, sooner than before. There is no visible change for a single user.
4. **Hidden tabs disconnect after 5 minutes** (owner-approved). Returning shows "Connecting" briefly. The server's sync messages on connect, and the browser's reply, reconcile missed changes in both directions.
5. **Not done, by owner's choice:** disconnecting far-off feed days, and upgrading to Workers Paid.

## How to verify

```sh
npm run typecheck && npm run lint && npm run test && npm run build
```

Expected: 758 tests pass.

**Checks already run by the author, all on this machine:**

- **A hibernation probe.** A temporary constructor log was added (then removed). One connection was held idle for 25 s, then made an edit:
  - **before:** 1 object, never recreated, so it never hibernated
  - **after:** 2 objects; it hibernated and was rebuilt from storage
- **An idle feed in headless Chrome.** A temporary per-message log was added (then removed), with a 17-day feed idle for 40 s:
  - **before:** 6 messages to documents, and documents could not hibernate anyway
  - **after:** 0 messages, and no restarts

  The first "after" run was invalid, because the page never loaded. It was rerun with timeouts and a check that the page had loaded.
- **Mutation testing.** Leaving the interval running fails the guardrail; never clearing presence fails 3 tests.
- **A test that proved nothing was replaced.** A fake-timer "no renewals" test passed for the wrong reason: lib0 captures `Date.now` at import, so renewals can never fire in tests. It now asserts the precondition y-protocols relies on, a null local state.
- **A real bug caught by the tests:** restoring presence with `setLocalStateField` is a no-op on a null state. It now uses `setLocalState({ user })`.

## After deploying

Watch the Durable Objects usage (duration) chart in the Cloudflare dashboard for a day. Awake time should track time spent typing, not time tabs are open.

## Review checklist

- [ ] Nothing else on the server path starts a repeating timer. `schedule()` uses alarms, which are fine; the index's one-off 300 ms `setTimeout` clears itself.
- [ ] Clearing presence on blur cannot break `CollaborationCaret`.
- [ ] Reconnecting after a hidden period cannot lose or duplicate edits.
- [ ] `WorkspaceAgent` has no timers and no WebSockets.

## Known limitations

- **Stale presence from a crashed browser** can be replayed to new joiners until its document restarts. It is gone within 30 s for them.
- **There is no automated end-to-end hibernation test.** The probe was manual; the unit guardrail covers the timer.
- **Usage is not monitored in the app.** The Cloudflare dashboard is the source of truth.
