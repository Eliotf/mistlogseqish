import { describe, it, expect, vi } from "vitest";
import { convertGraph } from "~/lib/logseq-import";
import { IMPORT_BATCH } from "~/lib/import-lines";
import { ImportStepError, runImport, runUndo, withRetry, writeBatches, type ImportApi, type ImportProgress } from "~/lib/import-run";

const noWait = async () => {};

/** A server that resolves every title to an ID made from it. */
function fakeApi(overrides: Partial<ImportApi> = {}): ImportApi & { writes: Array<Array<{ pageId: string; lines: unknown[] }>> } {
  const writes: Array<Array<{ pageId: string; lines: unknown[] }>> = [];
  return {
    writes,
    list: async () => [],
    start: async () => ({ ok: true, importId: "imp1" }),
    pages: async (_id, titles) => Object.fromEntries(titles.map((t) => [t.toLowerCase(), `p-${t.toLowerCase()}`])),
    write: async (_id, pages) => {
      writes.push(pages);
      return { written: pages.map((p) => p.pageId), failed: [] };
    },
    finish: async () => null,
    undo: async () => ({ done: true, left: 0 }),
    ...overrides,
  };
}

describe("runImport", () => {
  it("resolves titles in batches, writes linked lines to each page and day, then finishes", async () => {
    const plan = convertGraph([
      { path: "g/pages/Books.md", text: "- read [[Novels]]" },
      { path: "g/journals/2026_11_04.md", text: "- went to [[Books]]" },
    ]);
    const record = { importId: "imp1", state: "done" as const, startedAt: 1, finishedAt: 2, pages: 3, created: 1 };
    const finish = vi.fn(async () => record);
    const api = fakeApi({ finish });
    const progress: ImportProgress[] = [];
    const outcome = await runImport("imp1", plan, (p) => progress.push(p), { api, wait: noWait });
    expect(outcome).toEqual({ written: 2, failed: [], record });
    expect(api.writes.flat()).toEqual([
      { pageId: "journal-2026-11-04", lines: [{ text: "- went to [[Books]]", blockId: null, collapsed: false, links: [{ from: 12, to: 17, pageId: "p-books" }] }] },
      { pageId: "p-books", lines: [{ text: "- read [[Novels]]", blockId: null, collapsed: false, links: [{ from: 9, to: 15, pageId: "p-novels" }] }] },
    ]);
    expect(finish).toHaveBeenCalledWith("imp1");
    expect(progress[0]).toEqual({ phase: "pages", done: 0, total: 2 });
    expect(progress.at(-1)).toEqual({ phase: "writing", done: 2, total: 2 });
  });

  it("asks for at most a batch of titles at a time, and skips pages with no lines", async () => {
    const files = Array.from({ length: IMPORT_BATCH * 2 + 1 }, (_, i) => ({ path: `g/pages/P${i}.md`, text: "" }));
    const pages = vi.fn(fakeApi().pages);
    const api = fakeApi({ pages });
    const outcome = await runImport("imp1", convertGraph(files), () => {}, { api, wait: noWait });
    expect(pages.mock.calls.map(([, titles]) => titles.length)).toEqual([IMPORT_BATCH, IMPORT_BATCH, 1]);
    expect(api.writes).toEqual([]);
    expect(outcome.written).toBe(0);
  });

  it("names the pages that had no page or couldn't be written", async () => {
    const plan = convertGraph([
      { path: "g/pages/Books.md", text: "- a" },
      { path: "g/pages/Lost.md", text: "- b" },
      { path: "g/pages/Gone.md", text: "- c" },
    ]);
    const api = fakeApi({
      pages: async () => ({ books: "p-books", lost: null, gone: "p-gone" }),
      write: async (_id, pages) => ({ written: pages.filter((p) => p.pageId !== "p-gone").map((p) => p.pageId), failed: ["p-gone"] }),
    });
    expect(await runImport("imp1", plan, () => {}, { api, wait: noWait })).toEqual({ written: 1, failed: ["Lost", "Gone"], record: null });
  });

  it("stops, without finishing, when a step keeps failing", async () => {
    const finish = vi.fn(async () => null);
    const api = fakeApi({ finish, write: async () => Promise.reject(new ImportStepError(503, "down")) });
    const plan = convertGraph([{ path: "g/pages/A.md", text: "- a" }]);
    await expect(runImport("imp1", plan, () => {}, { api, wait: noWait })).rejects.toThrow("down");
    expect(finish).not.toHaveBeenCalled();
  });
});

describe("withRetry", () => {
  it("retries network and server failures with growing pauses, then gives up", async () => {
    const waits: number[] = [];
    const step = vi.fn().mockRejectedValueOnce(new ImportStepError(0, "offline")).mockRejectedValueOnce(new ImportStepError(503, "busy")).mockResolvedValue("ok");
    expect(await withRetry(step, async (ms) => void waits.push(ms))).toBe("ok");
    expect(waits).toEqual([1000, 3000]);
    const always = vi.fn().mockRejectedValue(new ImportStepError(500, "broken"));
    await expect(withRetry(always, noWait)).rejects.toThrow("broken");
    expect(always).toHaveBeenCalledTimes(4);
  });

  it("does not retry a refusal", async () => {
    const step = vi.fn().mockRejectedValue(new ImportStepError(409, "not running"));
    await expect(withRetry(step, noWait)).rejects.toThrow("not running");
    expect(step).toHaveBeenCalledTimes(1);
  });
});

describe("writeBatches", () => {
  const page = (lines: number) => ({ lines: Array.from({ length: lines }) });

  it("keeps each request to a batch of pages and a few thousand lines; a long page goes alone", () => {
    const sizes = (pages: Array<{ lines: unknown[] }>) => writeBatches(pages).map((b) => b.map((p) => p.lines.length));
    expect(sizes(Array.from({ length: IMPORT_BATCH + 1 }, () => page(1)))).toEqual([Array(IMPORT_BATCH).fill(1), [1]]);
    expect(sizes([page(3000), page(1500), page(9000), page(10)])).toEqual([[3000], [1500], [9000], [10]]);
    expect(sizes([])).toEqual([]);
  });
});

describe("runUndo", () => {
  it("asks again until the import is undone, reporting what is left", async () => {
    const undo = vi.fn().mockResolvedValueOnce({ done: false, left: 7 }).mockResolvedValueOnce({ done: false, left: 1 }).mockResolvedValue({ done: true, left: 0 });
    const left: number[] = [];
    await runUndo("imp1", (n) => left.push(n), { api: fakeApi({ undo }), wait: noWait });
    expect(left).toEqual([7, 1]);
    expect(undo).toHaveBeenCalledTimes(3);
  });
});
