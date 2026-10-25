import type { Route } from "./+types/api.rename";
import { isPageId } from "~/lib/note-ids";
import { normalizeTitle, type RenameResult } from "~/lib/page-title";
import { pagePath } from "~/lib/slug";
import { workspaceIndex } from "~/lib/document-loader.server";

/**
 * POST /api/rename with JSON { pageId, title }.
 * Validates the title, then claims it in the workspace index in one step
 * (unique across pages and journals, ignoring case) and returns the page's
 * new address. The client then saves the title to the page's Yjs doc.
 * Requiring JSON means a form on another site cannot trigger a rename.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Use POST" }, { status: 405 });
  }
  if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) {
    return Response.json({ error: "Send JSON" }, { status: 415 });
  }
  let body: { pageId?: unknown; title?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const pageId = typeof body.pageId === "string" ? body.pageId : "";
  if (!isPageId(pageId)) {
    return Response.json({ error: "Invalid page" }, { status: 400 });
  }

  const result = normalizeTitle(typeof body.title === "string" ? body.title : "");
  if (!result.ok) {
    return Response.json({ ok: false, reason: result.reason } satisfies RenameResult);
  }

  const index = await workspaceIndex(context);
  const claim = await index.claimTitle(pageId, result.title, Date.now());
  let answer: RenameResult;
  if (claim.ok) {
    answer = { ok: true, title: claim.title, path: pagePath(pageId, claim.slug) };
  } else if (claim.reason === "taken") {
    answer = { ok: false, reason: `A page called “${claim.holder.title}” already exists.` };
  } else {
    answer = { ok: false, reason: "Journal titles are dates and can't be renamed." };
  }
  return Response.json(answer);
}
