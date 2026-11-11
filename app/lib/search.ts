/**
 * Search across pages (PRD F13): what GET /api/search returns, and how the
 * search box shows it. Shared by the workspace index, the route and the
 * browser (client code must not import from agents/).
 */
import { isJournalTitle } from "./note-ids";
import { normalizeTitle, titleKey } from "./page-title";

/** Markers around matched words in snippets; the search box turns them into highlights. */
export const SNIPPET_START = "\u0002";
export const SNIPPET_END = "\u0003";

/** Most results the index returns for one query, whatever is asked. */
export const MAX_SEARCH_RESULTS = 50;
/** Longest query searched; the rest is ignored. */
export const MAX_SEARCH_QUERY = 200;
/** Rows in each group of the search box, as in the prototype. */
export const SEARCH_TITLE_LIMIT = 6;
export const SEARCH_RECENT_LIMIT = 8;
export const SEARCH_TEXT_LIMIT = 8;

/** A page found by search, with what it takes to show and open it. */
export interface SearchPage {
  pageId: string;
  /** Current title; journals are titled by their date. Empty for an untitled page. */
  title: string;
  kind: "page" | "journal";
  slug: string | null;
}

/** A page whose text matched. */
export interface SearchHit extends SearchPage {
  /** Some of its text, with SNIPPET_START / SNIPPET_END around matched words. */
  snippet: string;
}

export interface SearchResults {
  /** Pages whose title matches (for an empty query, recently edited pages). */
  titles: SearchPage[];
  /** Pages whose text matches. */
  text: SearchHit[];
  /** Pages the index is still catching up on: results may be missing some. */
  pending: number;
}

/** A snippet as pieces to show, the matched words marked. Lines are joined with spaces. */
export function snippetParts(snippet: string): Array<{ text: string; match: boolean }> {
  const parts: Array<{ text: string; match: boolean }> = [];
  let match = false;
  let text = "";
  const flush = () => {
    if (text) parts.push({ text, match });
    text = "";
  };
  for (const ch of snippet.replace(/\s*\n\s*/g, " ")) {
    if (ch === SNIPPET_START || ch === SNIPPET_END) {
      flush();
      match = ch === SNIPPET_START;
    } else {
      text += ch;
    }
  }
  flush();
  return parts;
}

/** One row of the search box, in the order shown. */
export type SearchRow =
  | { kind: "title"; page: SearchPage }
  | { kind: "text"; hit: SearchHit }
  /** Create a page with this title (or open the journal day it names). */
  | { kind: "create"; title: string; journal: boolean };

/**
 * The search box's rows for a query and its results: titles, then text
 * matches, then (as in the prototype) a row to create a page with the query
 * as its title, unless a page already has that title or it can't be one.
 */
export function searchRows(query: string, results: SearchResults): SearchRow[] {
  const rows: SearchRow[] = [
    ...results.titles.map((page): SearchRow => ({ kind: "title", page })),
    ...results.text.map((hit): SearchRow => ({ kind: "text", hit })),
  ];
  const normal = normalizeTitle(query);
  if (query.trim() && normal.ok) {
    const key = titleKey(normal.title);
    const journal = isJournalTitle(normal.title);
    if (!results.titles.some((p) => titleKey(p.title) === key)) rows.push({ kind: "create", title: normal.title, journal });
  }
  return rows;
}

/** GET /api/search: what the search box shows for a query. */
export async function fetchSearch(query: string, signal?: AbortSignal): Promise<SearchResults> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal });
  if (!res.ok) throw new Error(`search: ${res.status}`);
  return (await res.json()) as SearchResults;
}
