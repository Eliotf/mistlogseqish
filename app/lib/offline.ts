import { useSyncExternalStore } from "react";
import * as Y from "yjs";
import { cacheName, openLocalCache } from "./local-cache";
import { journalId, parseJournalDate } from "./note-ids";
import { base64ToBytes, KEEP_DAYS_EVERY_MS, MAX_KEPT_DAYS } from "./offline-days";

/**
 * Reading the journal offline (PRD F14; docs/design-choices.md, the short
 * term plan): the service worker (public/sw.js) lets the site open without a
 * connection, the feed and day screens fall back to the copies kept in this
 * browser, recent days are kept even if not opened, and the app says when
 * it is offline. Browser only: nothing here runs at module load.
 */

/** Start the service worker. Production only: in development Vite serves source files it must not keep. */
export function registerServiceWorker(production = import.meta.env.PROD): void {
  if (!production || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch((err: unknown) => console.warn("Offline use isn't available in this browser", err));
}

function subscribeOnline(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Whether the browser thinks it has a connection (always true on the server, so hydration matches). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

/**
 * Whether a failed route load means "no connection", rather than an answer
 * from the server (a 404, a redirect), which must still be shown.
 */
export function isOfflineError(err: unknown): boolean {
  // A Response, or React Router's error response, carries a status: the server answered
  if (err && typeof err === "object" && "status" in err && "statusText" in err) return false;
  return true;
}

/** Journal days with a copy in this browser, newest first. Empty where the browser can't list them. */
export async function savedJournalDays(): Promise<string[]> {
  if (typeof indexedDB === "undefined" || typeof indexedDB.databases !== "function") return [];
  // Copies are named by page ID (local-cache.ts); a journal's ID carries its date
  const base = cacheName("");
  try {
    const names = (await indexedDB.databases()).map((db) => db.name ?? "");
    return names
      .filter((name) => name.startsWith(`${base}journal-`))
      .map((name) => parseJournalDate(name.slice(base.length)))
      .filter((date): date is string => date !== null)
      .sort()
      .reverse();
  } catch {
    return [];
  }
}

const KEPT_AT = "mistlog:kept-days-at";

interface KeepOptions {
  fetch?: typeof fetch;
  now?: number;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  /** Saves one day's content in this browser; by default its copy in IndexedDB (local-cache.ts). */
  save?: (date: string, update: Uint8Array) => Promise<void>;
}

/** Merge a day's content into its copy in this browser, as opening it would (Yjs: nothing is overwritten). */
async function saveDay(date: string, update: Uint8Array): Promise<void> {
  const doc = new Y.Doc();
  const cache = openLocalCache(journalId(date), doc);
  if (!cache) return;
  try {
    await cache.whenSynced;
    Y.applyUpdate(doc, update);
  } finally {
    await cache.destroy();
    doc.destroy();
  }
}

/**
 * Keep copies of these journal days (the feed's recent days with notes) in
 * this browser, so they can be read offline without having been opened.
 * At most once an hour, in one request; never while offline. Returns how
 * many days were saved.
 */
export async function keepRecentDays(days: readonly string[], { fetch: fetchFn = fetch, now = Date.now(), storage = safeStorage(), save = saveDay }: KeepOptions = {}): Promise<number> {
  const wanted = days.slice(0, MAX_KEPT_DAYS);
  if (!wanted.length || (typeof navigator !== "undefined" && !navigator.onLine)) return 0;
  const last = storage?.getItem(KEPT_AT);
  if (last && now - Number(last) < KEEP_DAYS_EVERY_MS) return 0;
  const res = await fetchFn("/api/journals/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dates: wanted }) });
  if (!res.ok) return 0;
  const { states } = (await res.json()) as { states: Record<string, string | null> };
  let saved = 0;
  for (const date of wanted) {
    const state = states[date];
    if (!state) continue;
    await save(date, base64ToBytes(state));
    saved++;
  }
  try {
    storage?.setItem(KEPT_AT, String(now));
  } catch {
    // Storage full or blocked: try again next visit
  }
  return saved;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
