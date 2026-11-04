import type { Route } from "./+types/api.pages.delete";
import { isPageId } from "~/lib/note-ids";
import type { DeletePageResult } from "~/lib/page-title";
import { documentAgent } from "~/lib/document-loader.server";

/**
 * POST /api/pages/delete with JSON { pageId }: delete a page (PRD F21).
 * Asks the page's DocumentAgent, which takes it out of the workspace index
 * under its index lock and closes its open tabs. Its storage is kept.
 * Requiring JSON means a form on another site cannot trigger a delete.
 * Permission checks go here with M4.
 */
export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Use POST" }, { status: 405 });
  }
  if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) {
    return Response.json({ error: "Send JSON" }, { status: 415 });
  }
  let body: { pageId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const pageId = typeof body?.pageId === "string" ? body.pageId : "";
  if (!isPageId(pageId)) {
    return Response.json({ error: "Invalid page" }, { status: 400 });
  }

  let outcome: DeletePageResult;
  try {
    const agent = await documentAgent(context, pageId);
    outcome = await agent.deletePage();
  } catch (err) {
    console.error("Delete failed", err);
    outcome = { ok: false, code: "failed" };
  }
  const status = outcome.ok ? 200 : outcome.code === "missing" ? 404 : outcome.code === "journal" ? 400 : 503;
  return Response.json(outcome, { status });
}
