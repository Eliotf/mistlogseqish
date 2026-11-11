import type { Route } from "./+types/api.search";
import { workspaceIndex } from "~/lib/document-loader.server";
import { MAX_SEARCH_QUERY, SEARCH_RECENT_LIMIT, SEARCH_TEXT_LIMIT, SEARCH_TITLE_LIMIT, type SearchResults } from "~/lib/search";

/**
 * GET /api/search?q=
 * The search box (PRD F13): pages whose title matches, then pages whose text
 * matches with a snippet; an empty query lists recently edited pages. Read
 * from the workspace index, which browsers never reach directly. Sharing
 * (M4) must filter these results to pages the viewer can read (invariant 5).
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, MAX_SEARCH_QUERY).trim();
  try {
    const index = await workspaceIndex(context);
    const results: SearchResults = await index.searchPages(q, q ? SEARCH_TITLE_LIMIT : SEARCH_RECENT_LIMIT, SEARCH_TEXT_LIMIT);
    return Response.json(results);
  } catch (err) {
    console.error("Search failed", err);
    return Response.json({ error: "Couldn't search pages" }, { status: 503 });
  }
}
