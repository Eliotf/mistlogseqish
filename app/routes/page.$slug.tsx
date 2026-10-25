import { data, redirect } from "react-router";
import type { Route } from "./+types/page.$slug";
import { loadDocument, workspaceIndex } from "~/lib/document-loader.server";
import { pagePath } from "~/lib/slug";

/**
 * /page/<slug>: a page's readable address. Old slugs (from before a rename)
 * redirect to the current one; unknown slugs are 404. The page itself is the
 * same screen as /docs/<id>.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const index = await workspaceIndex(context);
  const resolved = await index.resolveSlug(params.slug);
  if (!resolved) throw data(null, { status: 404 });
  // Old slugs, and different case or accent composition, go to the one canonical address
  if (!resolved.current || params.slug.normalize("NFC") !== resolved.currentSlug) {
    throw redirect(pagePath(resolved.pageId, resolved.currentSlug));
  }
  const doc = await loadDocument(context, resolved.pageId);
  return { ...doc, path: pagePath(resolved.pageId, resolved.currentSlug) };
}

export { default, meta } from "./docs.$id";
