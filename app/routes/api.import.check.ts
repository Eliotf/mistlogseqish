import type { Route } from "./+types/api.import.check";
import { workspaceIndex } from "~/lib/document-loader.server";
import { titleKey } from "~/lib/page-title";
import { parseJournalDate } from "~/lib/note-ids";

/** More than any real graph needs; keeps one request bounded. */
export const MAX_CHECK_ITEMS = 20000;

/**
 * POST /api/import/check with JSON { titles, dates }: for a Logseq import's
 * dry run (PRD F31), which titles are pages already and which days
 * (YYYY-MM-DD) already have notes. Only titles and dates are sent, never a
 * page's text. Reads the index; writes nothing. Permission checks go here
 * with M4.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405 });
  if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) {
    return Response.json({ error: "Send JSON" }, { status: 415 });
  }
  let body: { titles?: unknown; dates?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const titles = Array.isArray(body?.titles) ? body.titles.filter((t): t is string => typeof t === "string") : [];
  const dates = Array.isArray(body?.dates) ? body.dates.filter((d): d is string => typeof d === "string" && parseJournalDate(`journal-${d}`) !== null) : [];
  if (titles.length + dates.length > MAX_CHECK_ITEMS) return Response.json({ error: "Too many" }, { status: 413 });
  const keys = [...new Set(titles.map(titleKey))];
  try {
    const index = await workspaceIndex(context);
    return Response.json(await index.importCheck(keys, [...new Set(dates)]));
  } catch (err) {
    console.error("Import check failed", err);
    return Response.json({ error: "The index couldn't be reached" }, { status: 503 });
  }
}
