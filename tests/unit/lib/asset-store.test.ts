import { describe, it, expect, vi } from "vitest";
import { serveAsset, storeAsset, type AssetBucket } from "~/lib/asset-store.server";
import { MAX_ASSET_BYTES } from "~/lib/images";
import { action } from "~/routes/api.files.assets.$name";
import { loader } from "~/routes/files.assets.$name";
import { cloudflareContext } from "~/lib/cloudflare.server";
import { RouterContextProvider } from "react-router";

/** An in-memory stand-in for the R2 bucket. */
function fakeBucket() {
  const objects = new Map<string, { bytes: Uint8Array; type?: string }>();
  const bucket = {
    head: vi.fn(async (key: string) => (objects.has(key) ? ({ key } as R2Object) : null)),
    get: vi.fn(async (key: string) => {
      const o = objects.get(key);
      return o ? ({ body: new Blob([o.bytes]).stream(), size: o.bytes.byteLength } as unknown as R2ObjectBody) : null;
    }),
    put: vi.fn(async (key: string, value: ArrayBuffer, options?: R2PutOptions) => {
      objects.set(key, { bytes: new Uint8Array(value), type: (options?.httpMetadata as R2HTTPMetadata | undefined)?.contentType });
      return { key } as R2Object;
    }),
  };
  return { bucket: bucket as unknown as AssetBucket & typeof bucket, objects };
}

const bytes = (n: number) => new Uint8Array(n).fill(7).buffer;

describe("storeAsset", () => {
  it("stores an image under assets/ with its type", async () => {
    const { bucket, objects } = fakeBucket();
    expect(await storeAsset(bucket, "image_1_0.png", bytes(4))).toEqual({ ok: true, result: "stored" });
    expect(objects.get("assets/image_1_0.png")?.type).toBe("image/png");
  });

  it("keeps an image already stored, never replacing it", async () => {
    const { bucket, objects } = fakeBucket();
    await storeAsset(bucket, "a.png", bytes(4));
    expect(await storeAsset(bucket, "a.png", bytes(9))).toEqual({ ok: true, result: "exists" });
    expect(objects.get("assets/a.png")?.bytes.byteLength).toBe(4);
    expect(bucket.put).toHaveBeenCalledTimes(1);
  });

  it("refuses bad names, other types, empty and oversized files", async () => {
    const { bucket } = fakeBucket();
    expect(await storeAsset(bucket, "../a.png", bytes(1))).toEqual({ ok: false, error: "name" });
    expect(await storeAsset(bucket, "a.svg", bytes(1))).toEqual({ ok: false, error: "type" });
    expect(await storeAsset(bucket, "a.png", bytes(0))).toEqual({ ok: false, error: "empty" });
    expect(await storeAsset(bucket, "a.png", bytes(MAX_ASSET_BYTES + 1))).toEqual({ ok: false, error: "size" });
    expect(bucket.put).not.toHaveBeenCalled();
  });
});

describe("serveAsset", () => {
  it("serves a stored image so it can't run as a page", async () => {
    const { bucket } = fakeBucket();
    await storeAsset(bucket, "a.jpg", bytes(5));
    const res = await serveAsset(bucket, "a.jpg");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect((await res.arrayBuffer()).byteLength).toBe(5);
  });

  it("answers 404 for a missing image, a bad name or another type, without asking the bucket for those", async () => {
    const { bucket } = fakeBucket();
    expect((await serveAsset(bucket, "missing.png")).status).toBe(404);
    expect((await serveAsset(bucket, ".x.png")).status).toBe(404);
    expect((await serveAsset(bucket, "a.svg")).status).toBe(404);
    expect(bucket.get).toHaveBeenCalledTimes(1);
  });
});

function contextWith(bucket: AssetBucket) {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, { env: { FILES: bucket } as unknown as Env, ctx: {} as ExecutionContext });
  return context;
}

describe("asset routes", () => {
  it("stores with PUT and serves it back", async () => {
    const { bucket } = fakeBucket();
    const context = contextWith(bucket);
    const put = await action({ request: new Request("https://x/api/files/assets/a.png", { method: "PUT", body: bytes(3) }), params: { name: "a.png" }, context } as never);
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ ok: true, result: "stored" });
    const got = await loader({ request: new Request("https://x/files/assets/a.png"), params: { name: "a.png" }, context } as never);
    expect(got.status).toBe(200);
  });

  it("refuses other methods, other types and declared oversized bodies", async () => {
    const { bucket } = fakeBucket();
    const context = contextWith(bucket);
    const post = await action({ request: new Request("https://x/", { method: "POST", body: bytes(1) }), params: { name: "a.png" }, context } as never);
    expect(post.status).toBe(405);
    const svg = await action({ request: new Request("https://x/", { method: "PUT", body: bytes(1) }), params: { name: "a.svg" }, context } as never);
    expect(svg.status).toBe(415);
    const big = await action({
      request: new Request("https://x/", { method: "PUT", body: bytes(1), headers: { "Content-Length": String(MAX_ASSET_BYTES + 1) } }),
      params: { name: "a.png" },
      context,
    } as never);
    expect(big.status).toBe(413);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("says when storing fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { bucket } = fakeBucket();
    bucket.head.mockRejectedValueOnce(new Error("R2 down"));
    const res = await action({ request: new Request("https://x/", { method: "PUT", body: bytes(1) }), params: { name: "a.png" }, context: contextWith(bucket) } as never);
    expect(res.status).toBe(503);
    vi.restoreAllMocks();
  });
});
