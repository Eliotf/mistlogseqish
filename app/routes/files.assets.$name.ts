import type { Route } from "./+types/files.assets.$name";
import { getCloudflare } from "~/lib/cloudflare.server";
import { serveAsset } from "~/lib/asset-store.server";

/**
 * GET /files/assets/<name>: an image from an imported Logseq graph's
 * `assets/` folder (PRD F31), as linked by `![alt](../assets/<name>)`.
 * Permission checks go here with M4.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  const { env } = getCloudflare(context);
  return serveAsset(env.FILES, params.name);
}
