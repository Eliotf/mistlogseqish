import type { Route } from "./+types/api.pages.titles";
import { isPageId, parseJournalDate, journalTitle } from "~/lib/note-ids";
import { UNTITLED } from "~/lib/page-title";
import { MAX_TITLE_IDS, type LinkTarget } from "~/lib/page-titles";
import { workspaceIndex } from "~/lib/document-loader.server";

/**
 * GET /api/pages/titles?ids=a,b,c
 * What links to these pages should show (PRD 6.1): current title, kind,
 * slug, and whether the page is empty or missing. A journal day that has no
 * notes yet still exists as a link target (its ID is fixed), so it gets its
 * date as the title. Read from the workspace index.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const raw = new URL(request.url).searchParams.get("ids") ?? "";
  const ids = [...new Set(raw.split(",").filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_TITLE_IDS || !ids.every(isPageId)) {
    return Response.json({ error: `ids must be 1 to ${MAX_TITLE_IDS} page IDs` }, { status: 400 });
  }
  try {
    const index = await workspaceIndex(context);
    const found = new Map((await index.pagesByIds(ids)).map((p) => [p.pageId, p]));
    const pages: Record<string, LinkTarget> = {};
    for (const id of ids) {
      const page = found.get(id);
      const date = parseJournalDate(id);
      if (page) {
        pages[id] = {
          title: page.kind === "journal" && date ? journalTitle(date) : page.title || UNTITLED,
          kind: page.kind,
          slug: page.slug,
          empty: !page.hasContent,
          missing: false,
        };
      } else if (date) {
        pages[id] = { title: journalTitle(date), kind: "journal", slug: null, empty: true, missing: false };
      } else {
        pages[id] = { title: "", kind: "page", slug: null, empty: false, missing: true };
      }
    }
    return Response.json({ pages });
  } catch (err) {
    console.error("Loading link titles failed", err);
    return Response.json({ error: "Couldn't load titles" }, { status: 503 });
  }
}
