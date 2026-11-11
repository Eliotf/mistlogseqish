import { describe, it, expect } from "vitest";
import type { AllPagesRow } from "~/lib/all-pages";
import type { DeletePageResult } from "~/lib/page-title";
import { BULK_DELETE_BATCH, deletePagesInBatches, describeTitles, pagesCount, selectableRows } from "~/lib/bulk-delete";

const row = (pageId: string, title: string, over: Partial<AllPagesRow> = {}): AllPagesRow => ({
  pageId, kind: "page", title, slug: null, hasContent: true, updatedAt: 0, backlinks: 0, ...over,
});

describe("Deleting several pages", () => {
  it("lets pages be ticked, never journal days", () => {
    const rows = [row("aaaa0001", "Garden"), row("journal-2026-11-04", "Nov 4th, 2026", { kind: "journal" }), row("aaaa0002", "Books")];
    expect(selectableRows(rows).map((r) => r.pageId)).toEqual(["aaaa0001", "aaaa0002"]);
  });

  it(`sends at most ${BULK_DELETE_BATCH} deletes at a time, and all of them in the end`, async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `cccc${String(i).padStart(4, "0")}`);
    let inFlight = 0;
    let most = 0;
    const seen: string[] = [];
    const progress: number[] = [];
    const result = await deletePagesInBatches(
      ids,
      async (pageId) => {
        inFlight++;
        most = Math.max(most, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
        seen.push(pageId);
        return { ok: true, title: pageId };
      },
      (done) => progress.push(done),
    );
    expect(most).toBe(BULK_DELETE_BATCH);
    expect(seen.sort()).toEqual(ids);
    expect(result).toEqual({ deleted: ids, failed: [] });
    expect(progress).toEqual([5, 10, 12]);
  });

  it("keeps going past failures, and counts a page already deleted as gone", async () => {
    const outcomes: Record<string, DeletePageResult | Error> = {
      aaaa0001: { ok: true, title: "Garden" },
      aaaa0002: { ok: false, code: "failed" },
      aaaa0003: { ok: false, code: "missing" },
      aaaa0004: new Error("network"),
      aaaa0005: { ok: false, code: "journal" },
      aaaa0006: { ok: true, title: "Books" },
    };
    const result = await deletePagesInBatches(Object.keys(outcomes), async (pageId) => {
      const outcome = outcomes[pageId];
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }, undefined, 2);
    expect(result).toEqual({ deleted: ["aaaa0001", "aaaa0003", "aaaa0006"], failed: ["aaaa0002", "aaaa0004", "aaaa0005"] });
  });

  it("names titles, then the rest as a count", () => {
    expect(describeTitles([])).toBe("");
    expect(describeTitles(["Garden"])).toBe("“Garden”");
    expect(describeTitles(["Garden", ""])).toBe("“Garden” and “Untitled”");
    expect(describeTitles(["A", "B", "C"])).toBe("“A”, “B” and “C”");
    expect(describeTitles(["A", "B", "C", "D", "E"], 3)).toBe("“A”, “B”, “C” and 2 more");
    expect(pagesCount(1)).toBe("1 page");
    expect(pagesCount(3)).toBe("3 pages");
  });
});
