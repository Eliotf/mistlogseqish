import type { Route } from "./+types/api.pages.search";
import { journalTitle, parseJournalDate } from "~/lib/note-ids";
import { workspaceIndex } from "~/lib/document-loader.server";

const LIMIT = 8;

/** One `[[` suggestion. */
export interface PageSuggestion {
  pageId: string;
  title: string;
  kind: "page" | "journal";
  slug: string | null;
  empty: boolean;
}

/**
 * GET /api/pages/search?q=
 * Titles for `[[` suggestions: titles starting with the query first, then
 * containing it; an empty query lists recently updated pages. Read from the
 * workspace index.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 200);
  try {
    const index = await workspaceIndex(context);
    // Untitled pages cannot be told apart, so they are not offered
    const pages = (await index.searchTitles(q, LIMIT + 4)).filter((p) => p.title || parseJournalDate(p.pageId)).slice(0, LIMIT);
    const slugs = new Map((await index.pagesByIds(pages.map((p) => p.pageId))).map((p) => [p.pageId, p.slug]));
    // searchTitles returns whole page rows, so hasContent is current
    const suggestions: PageSuggestion[] = pages.map((p) => {
      const date = parseJournalDate(p.pageId);
      return { pageId: p.pageId, title: date ? journalTitle(date) : p.title, kind: p.kind, slug: slugs.get(p.pageId) ?? null, empty: !p.hasContent };
    });
    return Response.json({ pages: suggestions });
  } catch (err) {
    console.error("Searching titles failed", err);
    return Response.json({ error: "Couldn't search pages" }, { status: 503 });
  }
}
