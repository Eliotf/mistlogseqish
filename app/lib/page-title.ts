/**
 * Page title rules, shared by the title editor and the server's title check.
 * Titles live in the page's Yjs document (meta.title) and are unique across
 * pages and journals, ignoring case (PRD F2).
 */

export const MAX_TITLE_LENGTH = 200;

export type TitleResult = { ok: true; title: string } | { ok: false; reason: string };

/** What the server says about a proposed title. */
export type TitleCheck = { available: true; title: string } | { available: false; reason: string };

/** Collapse whitespace and validate. Returns the title to store, or why it cannot be used. */
export function normalizeTitle(raw: string): TitleResult {
  const title = raw.replace(/\s+/g, " ").trim();
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
