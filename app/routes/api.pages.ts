import type { Route } from "./+types/api.pages";
import { journalDateFromTitle, journalId, journalTitle } from "~/lib/note-ids";
import { normalizeTitle, type LinkPageResult } from "~/lib/page-title";
import { generateDocumentId } from "~/shared/constants";
import { documentAgent, workspaceIndex } from "~/lib/document-loader.server";

/**
 * POST /api/pages with JSON { title }.
 * The page a link to this title points at (PRD 6.1): a journal for a date
 * title, an existing page with the title (ignoring case), or a new empty
 * page. A new page's DocumentAgent claims the title in the index before it
 * creates anything, so two tabs linking the same new title get one page.
 * Requiring JSON means a form on another site cannot create pages.
 */
/** Whether a page has text, per the index; false if it is not indexed (or the index is unreachable). */
async function hasContent(context: Route.ActionArgs["context"], pageId: string): Promise<boolean> {
  try {
    return (await (await workspaceIndex(context)).getPage(pageId))?.hasContent ?? false;
  } catch {
    return false;
  }
}

export async function action({ request, context }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Use POST" }, { status: 405 });
  }
  if (!(request.headers.get("Content-Type") ?? "").includes("application/json")) {
    return Response.json({ error: "Send JSON" }, { status: 415 });
  }
  let body: { title?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const normal = normalizeTitle(typeof body?.title === "string" ? body.title : "");
  if (!normal.ok) {
    const answer: LinkPageResult = { ok: false, reason: normal.reason };
    return Response.json(answer, { status: 400 });
  }
  const title = normal.title;

  const date = journalDateFromTitle(title);
  if (date) {
    const answer: LinkPageResult = { ok: true, pageId: journalId(date), title: journalTitle(date), slug: null, kind: "journal", empty: !(await hasContent(context, journalId(date))) };
    return Response.json(answer);
  }

  try {
    const index = await workspaceIndex(context);
    const existing = await index.findByTitle(title);
    if (existing) {
      const answer: LinkPageResult = { ok: true, pageId: existing.pageId, title: existing.title, slug: await index.currentSlug(existing.pageId), kind: existing.kind, empty: !existing.hasContent };
      return Response.json(answer);
    }
    const agent = await documentAgent(context, generateDocumentId());
    const outcome = await agent.createWithTitle(title);
    if (outcome.ok) {
      const answer: LinkPageResult = { ok: true, pageId: outcome.pageId, title: outcome.title, slug: outcome.slug, kind: "page", empty: true };
      return Response.json(answer, { status: 201 });
    }
    if (outcome.code === "taken") {
      // Another tab created it a moment ago: link to that page
      const answer: LinkPageResult = { ok: true, pageId: outcome.holder.pageId, title: outcome.holder.title, slug: await index.currentSlug(outcome.holder.pageId), kind: "page", empty: true };
      return Response.json(answer);
    }
    const answer: LinkPageResult = { ok: false, reason: outcome.code === "invalid" ? outcome.reason : "Couldn't create the page." };
    return Response.json(answer, { status: 400 });
  } catch (err) {
    console.error("Linking a page failed", err);
    const answer: LinkPageResult = { ok: false, reason: "Couldn't reach your pages right now." };
    return Response.json(answer, { status: 503 });
  }
}
