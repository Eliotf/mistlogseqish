import type { Route } from "./+types/api.journals";
import { parseJournalDate } from "~/lib/note-ids";
import { workspaceIndex } from "~/lib/document-loader.server";

const MAX_LIMIT = 31;

/**
 * GET /api/journals?before=YYYY-MM-DD&limit=7
 * Journal days with notes, newest first, before an optional date (exclusive),
 * for the journal feed. Read from the workspace index.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const before = url.searchParams.get("before");
  if (before !== null && parseJournalDate(`journal-${before}`) === null) {
    return Response.json({ error: "Invalid date" }, { status: 400 });
  }
  const limit = Number(url.searchParams.get("limit") ?? 7);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    return Response.json({ error: `limit must be 1 to ${MAX_LIMIT}` }, { status: 400 });
  }
  try {
    const index = await workspaceIndex(context);
    const pages = await index.journals(limit, before ?? undefined);
    return Response.json({ days: pages.map((p) => p.journalDate).filter((d): d is string => d !== null) });
  } catch (err) {
    console.error("Loading journal days failed", err);
    return Response.json({ error: "Couldn't load days" }, { status: 503 });
  }
}
