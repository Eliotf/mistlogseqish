/* global self, caches, fetch, URL, Response */
/*
 * Mistlog's service worker (PRD F14, offline journal; docs/design-choices.md).
 * It lets the site open without a connection, showing the journal from the
 * copies of pages kept in this browser (local-cache.ts). It never decides
 * what a page says: documents live in IndexedDB and sync through Yjs.
 *
 * - Pages (navigations) and their route data (`.data`): network first, so
 *   online you always get the newest code and data; the last good copy is
 *   kept and served only when the network fails.
 * - Built files (/assets/..., named by their content): cache first, kept
 *   after the first load.
 * - Everything else (/api, /agents, other sites, sign-in redirects) is left
 *   to the network.
 *
 * Plain JS in public/, served at /sw.js. Tests load it with a fake `self`
 * (tests/unit/lib/service-worker.test.ts).
 */

const VERSION = "v1";
const PAGES = `mistlog-pages-${VERSION}`;
const ASSETS = `mistlog-assets-${VERSION}`;
/** Built files kept at most; the oldest go first (each deploy adds new names). */
const MAX_ASSETS = 150;
/** Pages kept at most. */
const MAX_PAGES = 60;

/** What to do with a request: "page" (network first), "asset" (cache first), or null (leave it). */
function kindOf(request, origin) {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  if (url.origin !== origin) return null;
  if (url.pathname.startsWith("/assets/")) return "asset";
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/agents/")) return null;
  if (request.mode === "navigate" || url.pathname.endsWith(".data")) return "page";
  return null;
}

/** Only real answers from this site are kept: not errors, and not a redirect (such as a sign-in page). */
function keepable(response, origin) {
  return !!response && response.ok && !response.redirected && response.type === "basic" && new URL(response.url).origin === origin;
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}

async function page(request, origin) {
  const cache = await caches.open(PAGES);
  try {
    const response = await fetch(request);
    if (keepable(response, origin)) {
      await cache.put(request, response.clone());
      await trim(cache, MAX_PAGES);
    }
    return response;
  } catch (err) {
    // Offline: the last copy of this page; a page not seen before goes to the journal, if that is kept
    const saved = await cache.match(request, { ignoreSearch: true });
    if (saved) return saved;
    const home = new URL("/", origin).href;
    if (request.mode === "navigate" && request.url !== home && (await cache.match(home))) return Response.redirect(home, 302);
    throw err;
  }
}

async function asset(request, origin) {
  const cache = await caches.open(ASSETS);
  const saved = await cache.match(request);
  if (saved) return saved;
  const response = await fetch(request);
  if (keepable(response, origin)) {
    await cache.put(request, response.clone());
    await trim(cache, MAX_ASSETS);
  }
  return response;
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Caches from older versions of this file go
      for (const name of await caches.keys()) if (name.startsWith("mistlog-") && !name.endsWith(`-${VERSION}`)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const origin = self.location.origin;
  const kind = kindOf(event.request, origin);
  if (kind === "page") event.respondWith(page(event.request, origin));
  else if (kind === "asset") event.respondWith(asset(event.request, origin));
});

// For tests
self.__mistlogServiceWorker = { kindOf, keepable, page, asset, PAGES, ASSETS, MAX_PAGES };
