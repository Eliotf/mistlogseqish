import type { Route } from "./+types/api.files.assets.$name";
import { getCloudflare } from "~/lib/cloudflare.server";
import { storeAsset } from "~/lib/asset-store.server";
import { MAX_ASSET_BYTES } from "~/lib/images";

/**
 * PUT /api/files/assets/<name> with the image as the body: keep an image
 * from a Logseq graph's `assets/` folder (PRD F31), sent by the import page.
 * One already stored under the name is kept, not replaced. Only PUT, which
 * a form on another site can't send. Permission checks go here with M4.
 */
export async function action({ request, params, context }: Route.ActionArgs) {
  if (request.method !== "PUT") {
    return Response.json({ error: "Use PUT" }, { status: 405 });
  }
  // Refuse a large body before reading it, when its size is given
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_ASSET_BYTES) {
    return Response.json({ ok: false, error: "size" }, { status: 413 });
  }
  const { env } = getCloudflare(context);
  try {
    const outcome = await storeAsset(env.FILES, params.name, await request.arrayBuffer());
    const status = outcome.ok ? 200 : outcome.error === "size" ? 413 : outcome.error === "type" ? 415 : 400;
    return Response.json(outcome, { status });
  } catch (err) {
    console.error("Storing an asset failed", err);
    return Response.json({ ok: false, error: "failed" }, { status: 503 });
  }
}
