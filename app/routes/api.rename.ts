import type { Route } from "./+types/api.rename";
import { isPageId } from "~/lib/note-ids";
import type { RenameResult } from "~/lib/page-title";
import { pagePath } from "~/lib/slug";
import { documentAgent } from "~/lib/document-loader.server";

/**
 * POST /api/rename with JSON { pageId, title }.
 * Asks the page's DocumentAgent to rename it. The agent validates the title,
 * claims it in the workspace index (unique across pages and journals,
 * ignoring case) under its index lock, and only then writes meta.title,
 * which syncs to every tab. Returns the page's new address.
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
  const pageId = typeof body?.pageId === "string" ? body.pageId : "";
  if (!isPageId(pageId)) {
    return Response.json({ error: "Invalid page" }, { status: 400 });
  }
  const title = typeof body.title === "string" ? body.title : "";

  let outcome;
  try {
    const agent = await documentAgent(context, pageId);
    outcome = await agent.rename(title);
  } catch (err) {
    console.error("Rename failed", err);
    const answer: RenameResult = { ok: false, reason: "Couldn't save the title right now. Try again in a moment." };
    return Response.json(answer, { status: 503 });
  }

  let answer: RenameResult;
  let status = 200;
  if (outcome.ok) {
    answer = { ok: true, title: outcome.title, path: pagePath(pageId, outcome.slug) };
  } else if (outcome.code === "taken") {
    answer = { ok: false, reason: `A page called “${outcome.holderTitle}” already exists.` };
  } else if (outcome.code === "invalid") {
    answer = { ok: false, reason: outcome.reason };
  } else if (outcome.code === "journal-title") {
    answer = { ok: false, reason: "Dates like this are journal titles. Choose another title." };
  } else if (outcome.code === "journal") {
    answer = { ok: false, reason: "Journal titles are dates and can't be renamed." };
  } else {
    answer = { ok: false, reason: "This page doesn't exist." };
    status = 404;
  }
  return Response.json(answer, { status });
}
