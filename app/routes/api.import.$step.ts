import type { Route } from "./+types/api.import.$step";
import { documentAgent, workspaceIndex } from "~/lib/document-loader.server";
import { IMPORT_BATCH, importLabel, isImportedLines, type ImportedLine } from "~/lib/import-lines";
import { journalDateFromTitle, journalId, isPageId } from "~/lib/note-ids";
import { normalizeTitle, titleKey } from "~/lib/page-title";
import { generateDocumentId } from "~/shared/constants";

/**
 * Logseq import and its undo (PRD F31, decisions 2026-11-05), driven by the
 * browser one small step at a time, so each request stays well inside
 * Workers' per-request limits and an interrupted import can be continued or
 * undone. All are JSON POSTs (a form on another site cannot start them).
 *
 * - list: the imports not undone, newest first.
 * - start { label }: begin an import of the folder named label; refused
 *   while another is running or being undone (409, with it).
 * - pages { importId, titles }: the page for each title (an existing page or
 *   journal, or a new empty page). A new page is recorded in the import
 *   before it is created, so undo always finds it; an existing page is
 *   recorded too, so undoing another import that created it keeps it.
 * - write { importId, pages: [{ pageId, lines }] }: add lines below each
 *   document's content. Writing the same document twice adds nothing.
 * - finish { importId }: the import is complete; answers with its record.
 * - undo { importId }: undo the next few documents (remove the lines the
 *   import added; delete pages it created, unless another import uses them).
 *   Repeat until done. Refused while another import is running or being
 *   undone (409, busy).
 *
 * Permission checks go here with M4.
 */

type Body = Record<string, unknown>;
type Index = Awaited<ReturnType<typeof workspaceIndex>>;
type Context = Route.ActionArgs["context"];

const json = (body: unknown, status = 200) => Response.json(body, { status });

export async function action({ request, context, params }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "Use POST" }, 405);
  if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) return json({ error: "Send JSON" }, 415);
  let body: Body;
  try {
    body = ((await request.json()) ?? {}) as Body;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (typeof body !== "object" || Array.isArray(body)) return json({ error: "Invalid JSON" }, 400);

  try {
    const index = await workspaceIndex(context);
    if (params.step === "list") return json({ imports: await index.listImports() });
    if (params.step === "start") {
      const importId = crypto.randomUUID();
      const started = await index.startImport(importId, importLabel(body.label), Date.now());
      return started.ok ? json({ importId }, 201) : json({ error: "Another import is in progress", current: started.current }, 409);
    }
    const importId = typeof body.importId === "string" ? body.importId : "";
    if (!importId) return json({ error: "No importId" }, 400);
    switch (params.step) {
      case "pages":
        return await resolveTitles(context, index, importId, body.titles);
      case "write":
        return await writePages(context, index, importId, body.pages);
      case "finish":
        return (await index.finishImport(importId, Date.now())) ? json({ record: await index.getImport(importId) }) : json({ error: "No such running import" }, 409);
      case "undo":
        return await undoSome(context, index, importId);
      default:
        return json({ error: "Not found" }, 404);
    }
  } catch (err) {
    console.error(`Import step ${params.step} failed`, err);
    return json({ error: "Couldn't reach your pages right now." }, 503);
  }
}

async function resolveTitles(context: Context, index: Index, importId: string, titles: unknown): Promise<Response> {
  if (!Array.isArray(titles) || titles.length > IMPORT_BATCH || !titles.every((t) => typeof t === "string")) return json({ error: `Send up to ${IMPORT_BATCH} titles` }, 400);
  if (!(await index.isRunningImport(importId))) return json({ error: "No such running import" }, 409);
  const resolved: Record<string, string | null> = {};
  for (const raw of titles as string[]) {
    resolved[titleKey(raw)] = await pageForTitle(context, index, importId, raw);
  }
  return json({ resolved });
}

/** The page a title links to, creating it (recorded as the import's) if there is none. Null if it can't be had. */
async function pageForTitle(context: Context, index: Index, importId: string, raw: string): Promise<string | null> {
  const normal = normalizeTitle(raw);
  if (!normal.ok) return null;
  const date = journalDateFromTitle(normal.title);
  if (date) return journalId(date);
  const existing = await index.findByTitle(normal.title);
  if (existing) {
    await index.recordImportPage(importId, existing.pageId, false);
    return existing.pageId;
  }
  const pageId = generateDocumentId();
  await index.recordImportPage(importId, pageId, true);
  const outcome = await (await documentAgent(context, pageId)).createWithTitle(normal.title);
  if (outcome.ok) return pageId;
  await index.forgetImportPage(importId, pageId);
  // Created by someone else a moment ago: link to theirs
  return outcome.code === "taken" ? outcome.holder.pageId : null;
}

async function writePages(context: Context, index: Index, importId: string, pages: unknown): Promise<Response> {
  const valid =
    Array.isArray(pages) &&
    pages.length <= IMPORT_BATCH &&
    pages.every((p: unknown) => typeof p === "object" && p !== null && typeof (p as Body).pageId === "string" && isPageId((p as Body).pageId as string) && isImportedLines((p as Body).lines));
  if (!valid) return json({ error: `Send up to ${IMPORT_BATCH} pages of lines` }, 400);
  if (!(await index.isRunningImport(importId))) return json({ error: "No such running import" }, 409);
  const written: string[] = [];
  const failed: string[] = [];
  for (const { pageId, lines } of pages as Array<{ pageId: string; lines: ImportedLine[] }>) {
    // Recorded first, so undo finds it even if the write is cut short
    await index.recordImportPage(importId, pageId, false);
    const result = await (await documentAgent(context, pageId)).importLines(importId, lines);
    (result.ok ? written : failed).push(pageId);
  }
  return json({ written, failed });
}

async function undoSome(context: Context, index: Index, importId: string): Promise<Response> {
  const started = await index.startUndo(importId);
  if (started === "busy") return json({ error: "Another import is in progress", busy: true }, 409);
  if (started === "missing") return json({ error: "No such import to undo" }, 409);
  for (const { pageId, created } of await index.importPagesToUndo(importId, IMPORT_BATCH)) {
    const doc = await documentAgent(context, pageId);
    await doc.undoImport(importId);
    // Handed over before it is forgotten, so a repeat finds it kept again
    if (created && !(await index.handOverImportPage(importId, pageId))) {
      const deleted = await doc.deletePage();
      // "missing": never created, or deleted since; either way it is gone
      if (!deleted.ok && deleted.code === "failed") throw new Error(`Could not delete ${pageId}`);
    }
    await index.forgetImportPage(importId, pageId);
  }
  const done = await index.finishUndo(importId);
  const left = done ? 0 : ((await index.getImport(importId))?.pages ?? 0);
  return json({ done, left });
}
