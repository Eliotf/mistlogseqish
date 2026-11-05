import { IndexeddbPersistence } from "y-indexeddb";
import type * as Y from "yjs";
import { DOC_FORMAT_VERSION } from "~/shared/constants";

/**
 * A copy of each page you open, kept in this browser (IndexedDB), before
 * full offline mode (PRD F14). A page shows its saved copy at once while it
 * connects, and edits not yet sent survive a reload; the server and the
 * saved copy merge like any two Yjs replicas, so nothing is overwritten.
 *
 * The name carries the document format version, so after a format change a
 * copy written by older code is never loaded. A deleted page's copy is
 * cleared (useYjsEditor). Copies stay in this browser only.
 */

export function cacheName(docId: string): string {
  return `mistlog:v${DOC_FORMAT_VERSION}:${docId}`;
}

/** Start keeping `doc` in this browser. Null where there is no IndexedDB (the server, tests, private modes that block it). */
export function openLocalCache(docId: string, doc: Y.Doc): IndexeddbPersistence | null {
  if (typeof indexedDB === "undefined") return null;
  try {
    return new IndexeddbPersistence(cacheName(docId), doc);
  } catch (err) {
    console.warn("Could not keep this page in the browser", err);
    return null;
  }
}
