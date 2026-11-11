import type { Route } from "./+types/api.index.status";
import { workspaceIndex } from "~/lib/document-loader.server";
import type { IndexStatus } from "~/lib/left-sidebar";

/**
 * GET /api/index/status
 * The left sidebar's index status line (PRD F8): how many pages the index
 * is still catching up on after a rebuild. Read from the workspace index,
 * which browsers never reach directly. Only a count, so it reveals no page.
 */
export async function loader({ context }: Route.LoaderArgs) {
  try {
    const index = await workspaceIndex(context);
    const status: IndexStatus = { pending: (await index.indexStatus()).pending };
    return Response.json(status);
  } catch (err) {
    console.error("Index status failed", err);
    return Response.json({ error: "Couldn't read the index status" }, { status: 503 });
  }
}
