import type { Route } from "./+types/api.pages.backlinks";
import { isPageId, journalTitle, parseJournalDate } from "~/lib/note-ids";
import { UNTITLED } from "~/lib/page-title";
import type { BacklinkGroup } from "~/lib/backlink-lines";
import { workspaceIndex } from "~/lib/document-loader.server";

/**
 * GET /api/pages/backlinks?id=<pageId>
 * Linked references (PRD F4): pages that link to this one, most recently
 * updated first, each with the lines that link here as the index last saw
 * them. Read from the workspace index; a page never lists itself.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!isPageId(id)) {
    return Response.json({ error: "Invalid page" }, { status: 400 });
  }
  try {
    const index = await workspaceIndex(context);
    const backlinks = await index.backlinks(id);
    const slugs = new Map((await index.pagesByIds(backlinks.map((b) => b.sourceId))).map((p) => [p.pageId, p.slug]));
    const groups: BacklinkGroup[] = backlinks.map((b) => {
      const date = parseJournalDate(b.sourceId);
      return {
        pageId: b.sourceId,
        title: date ? journalTitle(date) : b.sourceTitle || UNTITLED,
        kind: b.sourceKind,
        slug: slugs.get(b.sourceId) ?? null,
        lines: b.lines,
      };
    });
    return Response.json({ groups });
  } catch (err) {
    console.error("Loading linked references failed", err);
    return Response.json({ error: "Couldn't load linked references" }, { status: 503 });
  }
}
