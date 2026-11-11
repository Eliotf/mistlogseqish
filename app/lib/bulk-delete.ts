import type { AllPagesRow } from "./all-pages";
import { UNTITLED, type DeletePageResult } from "./page-title";

/**
 * Deleting several pages at once from All pages (PRD F21). The browser asks
 * POST /api/pages/delete once per page, so each request stays well inside
 * the Workers subrequest budget, and sends at most BULK_DELETE_BATCH of them
 * at a time, so a big selection doesn't flood the Worker or the index.
 */

/** Delete requests in flight at once. */
export const BULK_DELETE_BATCH = 5;

/** Titles named in the confirmation before "and N more". */
export const CONFIRM_TITLES = 8;

/** Rows that can be ticked: pages, not journal days (days can't be deleted yet). */
export function selectableRows(rows: readonly AllPagesRow[]): AllPagesRow[] {
  return rows.filter((row) => row.kind === "page");
}

/** A delete that leaves the page gone: done now, or already deleted elsewhere. */
export function deleteSucceeded(result: DeletePageResult): boolean {
  return result.ok || result.code === "missing";
}

/**
 * Delete each page, BULK_DELETE_BATCH at a time, and return which ones are
 * gone and which failed. One failure doesn't stop the rest. `onProgress`
 * hears how many have been answered so far.
 */
export async function deletePagesInBatches(
  pageIds: readonly string[],
  deleteOne: (pageId: string) => Promise<DeletePageResult>,
  onProgress?: (done: number) => void,
  batch = BULK_DELETE_BATCH,
): Promise<{ deleted: string[]; failed: string[] }> {
  const deleted: string[] = [];
  const failed: string[] = [];
  for (let start = 0; start < pageIds.length; start += batch) {
    const chunk = pageIds.slice(start, start + batch);
    const results = await Promise.all(
      chunk.map((pageId) => deleteOne(pageId).catch((): DeletePageResult => ({ ok: false, code: "failed" }))),
    );
    results.forEach((result, i) => (deleteSucceeded(result) ? deleted : failed).push(chunk[i]));
    onProgress?.(deleted.length + failed.length);
  }
  return { deleted, failed };
}

/** Quoted titles for a message: all of them, or the first `max` and "and N more". */
export function describeTitles(titles: readonly string[], max = CONFIRM_TITLES): string {
  const quoted = titles.map((title) => `“${title || UNTITLED}”`);
  if (quoted.length <= max) return quoted.length > 1 ? `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}` : (quoted[0] ?? "");
  return `${quoted.slice(0, max).join(", ")} and ${quoted.length - max} more`;
}

/** "1 page", "3 pages". */
export function pagesCount(n: number): string {
  return `${n} ${n === 1 ? "page" : "pages"}`;
}
