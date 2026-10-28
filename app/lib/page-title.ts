/**
 * Page title rules, shared by the title editor and the server's rename route.
 * Titles live in the page's Yjs document (meta.title) and are unique across
 * pages and journals, ignoring case (PRD F2).
 */

export const MAX_TITLE_LENGTH = 200;

export type TitleResult = { ok: true; title: string } | { ok: false; reason: string };

/** What DocumentAgent.rename reports. The rename route turns it into a RenameResult. */
export type DocumentRenameResult =
  | { ok: true; title: string; slug: string | null }
  | { ok: false; code: "taken"; holderTitle: string }
  | { ok: false; code: "invalid"; reason: string }
  | { ok: false; code: "journal" | "journal-title" | "missing" };

/** What DocumentAgent.createWithTitle reports. */
export type CreateWithTitleResult =
  | { ok: true; pageId: string; title: string; slug: string | null }
  | { ok: false; code: "taken"; holder: { pageId: string; title: string } }
  | { ok: false; code: "invalid"; reason: string }
  | { ok: false; code: "journal" | "exists" };

/** POST /api/pages: the page a link to this title points at (found or created), or why not. */
export type LinkPageResult = { ok: true; pageId: string; title: string; slug: string | null; kind: "page" | "journal"; empty: boolean } | { ok: false; reason: string };

/** The server's answer to a rename: the saved title and the page's new address, or why not. */
export type RenameResult = { ok: true; title: string; path: string } | { ok: false; reason: string };

// Zero-width characters, word joiner, BOM, soft hyphen and bidirectional
// controls: invisible, so two titles that look the same could differ
const INVISIBLE_RE = /[\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * Normalise and validate a title. Returns the title to store, or why it
 * cannot be used. Titles are NFC, so composed and decomposed accents
 * compare equal, and invisible characters are removed.
 */
export function normalizeTitle(raw: string): TitleResult {
  const title = raw.normalize("NFC").replace(INVISIBLE_RE, "").replace(/\s+/g, " ").trim();
  if (!title) return { ok: false, reason: "A page needs a title." };
  if (title.length > MAX_TITLE_LENGTH) {
    return { ok: false, reason: `Titles can be up to ${MAX_TITLE_LENGTH} characters.` };
  }
  // Exported pages write links as [[Title]], so brackets would break them
  if (title.includes("[[") || title.includes("]]")) {
    return { ok: false, reason: "Titles can't contain [[ or ]]." };
  }
  return { ok: true, title };
}

/** The title to display for a page with no title yet. */
export const UNTITLED = "Untitled";

/** How titles are compared for uniqueness and for links: NFC, lowercase, trimmed. */
export function titleKey(title: string): string {
  return title.normalize("NFC").trim().toLowerCase();
}
