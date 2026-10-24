import { getAgentByName } from "agents";
import type { Route } from "./+types/api.title-check";
import { getCloudflare } from "~/lib/cloudflare.server";
import { isPageId } from "~/lib/note-ids";
import { normalizeTitle, type TitleCheck } from "~/lib/page-title";
import { WORKSPACE_NAME } from "~/shared/constants";

/**
 * GET /api/title-check?title=...&pageId=...
 * Whether a page may take a title: it must pass the title rules and not be
 * used by another page or journal, ignoring case. Browsers reach the
 * workspace index only through server routes like this one.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const pageId = url.searchParams.get("pageId") ?? "";
  if (!isPageId(pageId)) {
    return Response.json({ error: "Invalid page" }, { status: 400 });
  }

  const result = normalizeTitle(url.searchParams.get("title") ?? "");
  if (!result.ok) {
    return Response.json({ available: false, reason: result.reason } satisfies TitleCheck);
  }

  const { env } = getCloudflare(context);
  const index = await getAgentByName(env.WorkspaceAgent, WORKSPACE_NAME);
  const clash = await index.findByTitle(result.title, pageId);
  const body: TitleCheck = clash
    ? { available: false, reason: `A page called “${clash.title}” already exists.` }
    : { available: true, title: result.title };
  return Response.json(body);
}
