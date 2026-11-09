import { IMPORT_BATCH, type ImportedLine, type ImportRecord } from "./import-lines";
import { linkedLines, targetOf, titlesToResolve, type ImportPlan, type ResolvedTitles } from "./logseq-import";

/**
 * Running a Logseq import, and undoing one, from the browser (PRD F31): the
 * steps of /api/import/:step in small batches, with progress. Each step is
 * safe to repeat, so a failed request is retried, and an import cut short
 * can be continued by running it again with the same import ID.
 */

/** Lines per write request, so one request stays small; a longer page goes alone. */
const LINES_PER_WRITE = 4000;
const RETRY_DELAYS_MS = [1000, 3000, 8000];

export interface ImportApi {
  /** The imports not undone, newest first. */
  list(): Promise<ImportRecord[]>;
  /** Start importing the folder named label; refused while another import is running or being undone. */
  start(label: string | null): Promise<{ ok: true; importId: string } | { ok: false; current: ImportRecord }>;
  pages(importId: string, titles: string[]): Promise<ResolvedTitles>;
  write(importId: string, pages: Array<{ pageId: string; lines: ImportedLine[] }>): Promise<{ written: string[]; failed: string[] }>;
  /** The finished import's record (what undo will remove), or null if the index no longer has it. */
  finish(importId: string): Promise<ImportRecord | null>;
  undo(importId: string): Promise<{ done: boolean; left: number }>;
}

export class ImportStepError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function post<T>(step: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api/import/${step}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    throw new ImportStepError(0, "Couldn't reach Mistlog");
  }
  const answer = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok && res.status !== 409) throw new ImportStepError(res.status, answer.error ?? `HTTP ${res.status}`);
  if (res.status === 409 && step !== "start") throw new ImportStepError(409, answer.error ?? "Conflict");
  return answer;
}

export const importApi: ImportApi = {
  async list() {
    return (await post<{ imports: ImportRecord[] }>("list", {})).imports;
  },
  async start(label) {
    const answer = await post<{ importId?: string; current?: ImportRecord }>("start", { label });
    return answer.importId ? { ok: true, importId: answer.importId } : { ok: false, current: answer.current! };
  },
  async pages(importId, titles) {
    return (await post<{ resolved: ResolvedTitles }>("pages", { importId, titles })).resolved;
  },
  write(importId, pages) {
    return post("write", { importId, pages });
  },
  async finish(importId) {
    return (await post<{ record?: ImportRecord | null }>("finish", { importId })).record ?? null;
  },
  undo(importId) {
    return post("undo", { importId });
  },
};

/** Retry a step that failed to reach the server or the index (it is safe to repeat). */
export async function withRetry<T>(step: () => Promise<T>, wait = (ms: number) => new Promise((r) => setTimeout(r, ms))): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await step();
    } catch (err) {
      const retryable = err instanceof ImportStepError && (err.status === 0 || err.status >= 500);
      if (!retryable || attempt >= RETRY_DELAYS_MS.length) throw err;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}

export type ImportProgress = { phase: "pages" | "writing"; done: number; total: number };

export interface ImportOutcome {
  /** Documents written to. */
  written: number;
  /** Titles of pages that couldn't be written (or had no page). */
  failed: string[];
  /** The finished import, as the index has it. */
  record: ImportRecord | null;
}

/** Group writes so each request has at most IMPORT_BATCH pages and about LINES_PER_WRITE lines. */
export function writeBatches<T extends { lines: unknown[] }>(pages: T[]): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let lines = 0;
  for (const page of pages) {
    if (current.length && (current.length >= IMPORT_BATCH || lines + page.lines.length > LINES_PER_WRITE)) {
      batches.push(current);
      current = [];
      lines = 0;
    }
    current.push(page);
    lines += page.lines.length;
  }
  if (current.length) batches.push(current);
  return batches;
}

/**
 * Run (or continue) an import: find or create the page for every title,
 * write each page's lines, then mark it finished.
 */
export async function runImport(
  importId: string,
  plan: ImportPlan,
  onProgress: (progress: ImportProgress) => void,
  { api = importApi, wait }: { api?: ImportApi; wait?: (ms: number) => Promise<unknown> } = {},
): Promise<ImportOutcome> {
  const titles = titlesToResolve(plan);
  const resolved: ResolvedTitles = {};
  for (let i = 0; i < titles.length; i += IMPORT_BATCH) {
    onProgress({ phase: "pages", done: i, total: titles.length });
    Object.assign(resolved, await withRetry(() => api.pages(importId, titles.slice(i, i + IMPORT_BATCH)), wait));
  }

  const failed: string[] = [];
  const toWrite: Array<{ pageId: string; title: string; lines: ImportedLine[] }> = [];
  for (const page of plan.pages) {
    const pageId = targetOf(page, resolved);
    if (!pageId) failed.push(page.title);
    else if (page.lines.length) toWrite.push({ pageId, title: page.title, lines: linkedLines(page, resolved) });
  }
  let written = 0;
  let done = 0;
  for (const batch of writeBatches(toWrite)) {
    onProgress({ phase: "writing", done, total: toWrite.length });
    const result = await withRetry(() => api.write(importId, batch.map(({ pageId, lines }) => ({ pageId, lines }))), wait);
    written += result.written.length;
    const failedIds = new Set(result.failed);
    failed.push(...batch.filter((p) => failedIds.has(p.pageId)).map((p) => p.title));
    done += batch.length;
  }
  onProgress({ phase: "writing", done, total: toWrite.length });
  const record = await withRetry(() => api.finish(importId), wait);
  return { written, failed, record };
}

/** Undo an import, a few documents at a time, until it is gone. */
export async function runUndo(
  importId: string,
  onProgress: (left: number) => void,
  { api = importApi, wait }: { api?: ImportApi; wait?: (ms: number) => Promise<unknown> } = {},
): Promise<void> {
  for (;;) {
    const { done, left } = await withRetry(() => api.undo(importId), wait);
    if (done) return;
    onProgress(left);
  }
}
