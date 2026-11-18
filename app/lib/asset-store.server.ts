import { assetContentType, isAssetName, MAX_ASSET_BYTES } from "./images";

/**
 * Attachments from Logseq graphs (PRD F31): images kept in the R2 bucket
 * bound as FILES, under `assets/<name>`, Logseq's own file names, so the
 * `../assets/<name>` links in imported pages find them. A stored file is
 * never replaced or removed from here.
 */

/** The parts of an R2 bucket this uses, so tests can pass a fake. */
export type AssetBucket = Pick<R2Bucket, "get" | "head" | "put">;

const key = (name: string) => `assets/${name}`;

/** Headers for serving a stored image: never run as a page, never guessed as another type. */
function servingHeaders(type: string, size: number): Headers {
  return new Headers({
    "Content-Type": type,
    "Content-Length": String(size),
    "Cache-Control": "private, max-age=86400",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
  });
}

/** GET /files/assets/<name>: the stored image, or 404. */
export async function serveAsset(bucket: AssetBucket, name: string): Promise<Response> {
  const type = assetContentType(name);
  if (!isAssetName(name) || !type) return new Response("Not found", { status: 404 });
  const object = await bucket.get(key(name));
  if (!object) return new Response("Not found", { status: 404 });
  return new Response(object.body, { headers: servingHeaders(type, object.size) });
}

export type StoreAssetResult =
  | { ok: true; result: "stored" | "exists" }
  | { ok: false; error: "name" | "type" | "size" | "empty" };

/** Store an image under `name`, unless one is stored already (which is kept as it is). */
export async function storeAsset(bucket: AssetBucket, name: string, body: ArrayBuffer): Promise<StoreAssetResult> {
  if (!isAssetName(name)) return { ok: false, error: "name" };
  const type = assetContentType(name);
  if (!type) return { ok: false, error: "type" };
  if (body.byteLength === 0) return { ok: false, error: "empty" };
  if (body.byteLength > MAX_ASSET_BYTES) return { ok: false, error: "size" };
  if (await bucket.head(key(name))) return { ok: true, result: "exists" };
  await bucket.put(key(name), body, { httpMetadata: { contentType: type } });
  return { ok: true, result: "stored" };
}
