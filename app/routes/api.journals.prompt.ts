import type { Route } from "./+types/api.journals.prompt";
import { documentAgent } from "~/lib/document-loader.server";
import { isTooOldForPrompt } from "~/lib/daily-prompt";
import { journalId, parseJournalDate } from "~/lib/note-ids";

/**
 * POST /api/journals/prompt with JSON { date: "YYYY-MM-DD" }
 * Start that journal day with the daily line, unless it has had it before
 * (DocumentAgent.addDailyPrompt). The browser asks for today and later days
 * only; days clearly in the past are refused here too. Permission checks go
 * here with M4.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") return Response.json({ error: "Use POST" }, { status: 405 });
  if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) return Response.json({ error: "Send JSON" }, { status: 415 });
  let date: unknown;
  try {
    date = ((await request.json()) as { date?: unknown } | null)?.date;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (typeof date !== "string" || parseJournalDate(`journal-${date}`) === null) return Response.json({ error: "Send a date (YYYY-MM-DD)" }, { status: 400 });
  if (isTooOldForPrompt(date, new Date())) return Response.json({ error: "Only today and later days get the daily line" }, { status: 400 });
  try {
    const result = await (await documentAgent(context, journalId(date))).addDailyPrompt();
    if (!result.ok) return Response.json({ error: result.code === "deleted" ? "This day was deleted" : "Not a journal day" }, { status: result.code === "deleted" ? 410 : 400 });
    return Response.json({ added: result.added });
  } catch (err) {
    console.error("Adding the daily line failed", err);
    return Response.json({ error: "Couldn't reach your journal right now." }, { status: 503 });
  }
}
