import { data } from "react-router";
import { getAgentByName } from "agents";
import { getCloudflare } from "./cloudflare.server";
import { WORKSPACE_NAME } from "~/shared/constants";

type LoaderContext = Parameters<typeof getCloudflare>[0];

/** The workspace index, for server routes (browsers never reach it directly). */
export function workspaceIndex(context: LoaderContext) {
  const { env } = getCloudflare(context);
  return getAgentByName(env.WorkspaceAgent, WORKSPACE_NAME);
}

/** A page's DocumentAgent, for server routes. */
export function documentAgent(context: LoaderContext, pageId: string) {
  const { env } = getCloudflare(context);
  return getAgentByName(env.DocumentAgent, pageId);
}

/** Load a document's metadata, or throw a 404 if it was never created. */
export async function loadDocument(context: LoaderContext, id: string): Promise<{ id: string; createdAt: number | null }> {
  const { env } = getCloudflare(context);
  const stub = await getAgentByName(env.DocumentAgent, id);
  const res = await stub.fetch(new Request("https://do/"));
  const { exists, createdAt } = (await res.json()) as { exists: boolean; createdAt: number | null };
  if (!exists) throw data(null, { status: 404 });
  return { id, createdAt };
}

/**
 * A page's current slug, or null. Fails open: if the index is unreachable,
 * the page still loads at its /docs/<id> address.
 */
export async function currentSlugOrNull(context: LoaderContext, pageId: string): Promise<string | null> {
  try {
    const index = await workspaceIndex(context);
    return await index.currentSlug(pageId);
  } catch (err) {
    console.error("Could not look up slug", err);
    return null;
  }
}
