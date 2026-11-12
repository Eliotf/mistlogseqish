import type { Route } from "./+types/api.journals.state";
import { documentAgent } from "~/lib/document-loader.server";
import { journalId, parseJournalDate } from "~/lib/note-ids";
import { MAX_KEPT_DAYS } from "~/lib/offline-days";

/**
 * POST /api/journals/state with JSON { dates: ["YYYY-MM-DD", ...] }
 * Each day's content as one Yjs update (base64), or null for a day nobody
 * has written in, so the browser can keep recent days for offline use
 * without connecting to each (PRD F14). Read-only. Permission checks go
 * here with M4.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405 });
  if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) return Response.json({ error: "Send JSON" }, { status: 415 });
  let dates: unknown;
  try {
    dates = ((await request.json()) as { dates?: unknown } | null)?.dates;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const valid =
    Array.isArray(dates) && dates.length <= MAX_KEPT_DAYS && dates.every((d) => typeof d === "string" && parseJournalDate(`journal-${d}`) !== null);
  if (!valid) return Response.json({ error: `Send up to ${MAX_KEPT_DAYS} dates (YYYY-MM-DD)` }, { status: 400 });
  try {
    const states: Record<string, string | null> = {};
    for (const date of new Set(dates as string[])) states[date] = await (await documentAgent(context, journalId(date))).savedState();
    return Response.json({ states });
  } catch (err) {
    console.error("Reading journal days failed", err);
    return Response.json({ error: "Couldn't reach your journal right now." }, { status: 503 });
  }
}
