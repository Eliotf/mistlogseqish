import { titleKey } from "./page-title";

/**
 * The All pages list (PRD F21, section 6.3): what the index returns for each
 * page, and the pure filtering and sorting the view applies. Shared by the
 * index (server) and the view (browser).
 */

/** One row of the All pages list. Plain fields only: it crosses RPC. */
export interface AllPagesRow {
  pageId: string;
  kind: "page" | "journal";
  title: string;
  slug: string | null;
  hasContent: boolean;
  /** When the page was last indexed (ms); 0 if it never has been. */
  updatedAt: number;
  /** Other pages that link here. */
  backlinks: number;
}

export type SortKey = "title" | "backlinks" | "updated";
export type SortDir = "asc" | "desc";

/** Rows whose title contains `query` (ignoring case), journals only if asked for. */
export function filterPages(rows: readonly AllPagesRow[], query: string, journals: boolean): AllPagesRow[] {
  const q = titleKey(query);
  return rows.filter((row) => (journals || row.kind === "page") && (!q || titleKey(row.title).includes(q)));
}

/** Rows sorted by `key`; ties keep a stable order by title (untitled last), then ID. */
export function sortPages(rows: readonly AllPagesRow[], key: SortKey, dir: SortDir): AllPagesRow[] {
  const sign = dir === "asc" ? 1 : -1;
  // Untitled pages go after titled ones, rather than first
  const byTitle = (a: AllPagesRow, b: AllPagesRow) =>
    Number(!a.title) - Number(!b.title) || titleKey(a.title).localeCompare(titleKey(b.title)) || a.pageId.localeCompare(b.pageId);
  return [...rows].sort((a, b) => {
    const primary = key === "title" ? byTitle(a, b) : key === "backlinks" ? a.backlinks - b.backlinks : a.updatedAt - b.updatedAt;
    return primary !== 0 ? sign * primary : byTitle(a, b);
  });
}

/** Clicking a column: the same column flips direction; a new one starts with what is most useful first. */
export function nextSort(current: { key: SortKey; dir: SortDir }, key: SortKey): { key: SortKey; dir: SortDir } {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  return { key, dir: key === "title" ? "asc" : "desc" };
}
