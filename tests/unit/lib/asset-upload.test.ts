import { describe, it, expect, vi, afterEach } from "vitest";
import { sendImage, sendImages, type GraphImage, type SendResult } from "~/lib/asset-upload";
import { assetContentType, graphImageName, isAssetName, MAX_ASSET_BYTES } from "~/lib/images";

const image = (name: string, size = 3): GraphImage => ({ name, file: new Blob([new Uint8Array(size)]) });

describe("graph image names", () => {
  it("takes images straight inside an assets folder", () => {
    expect(graphImageName("Logseq/assets/image_1_0.png")).toBe("image_1_0.png");
    expect(graphImageName("g/Assets/Photo.JPG")).toBe("Photo.JPG");
  });

  it("leaves out other files, nested folders and hidden files", () => {
    for (const path of ["g/assets/paper.pdf", "g/assets/drawing.svg", "g/assets/sub/a.png", "g/pages/a.png", "g/assets/.DS_Store", "a.png"]) {
      expect(graphImageName(path), path).toBeNull();
    }
  });

  it("knows the image types it keeps", () => {
    expect(assetContentType("a.jpeg")).toBe("image/jpeg");
    expect(assetContentType("a.webp")).toBe("image/webp");
    expect(assetContentType("a.svg")).toBeNull();
    expect(assetContentType("png")).toBeNull();
  });

  it("refuses names that could reach outside assets", () => {
    for (const name of ["", "a/b.png", "a\\b.png", ".hidden.png", "a\nb.png", `${"x".repeat(200)}.png`]) {
      expect(isAssetName(name), JSON.stringify(name)).toBe(false);
    }
    expect(isAssetName("my photo (1).png")).toBe(true);
  });
});

describe("sendImages", () => {
  it("sends every image and counts what happened", async () => {
    const results: Record<string, SendResult> = { "a.png": "stored", "b.png": "exists", "c.png": "too-big", "d.png": "failed", "e.png": "stored" };
    const progress: number[] = [];
    const outcome = await sendImages(Object.keys(results).map((n) => image(n)), (done) => progress.push(done), async ({ name }) => results[name]);
    expect(outcome).toEqual({ stored: 2, exists: 1, tooBig: ["c.png"], failed: ["d.png"] });
    expect(progress).toEqual([1, 2, 3, 4, 5]);
  });

  it("carries on past an error", async () => {
    const outcome = await sendImages([image("a.png"), image("b.png")], () => {}, async ({ name }) => {
      if (name === "a.png") throw new Error("offline");
      return "stored";
    });
    expect(outcome).toEqual({ stored: 1, exists: 0, tooBig: [], failed: ["a.png"] });
  });

  it("sends at most three at once", async () => {
    let running = 0;
    let most = 0;
    await sendImages(Array.from({ length: 8 }, (_, i) => image(`${i}.png`)), () => {}, async () => {
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      return "stored";
    });
    expect(most).toBe(3);
  });

  it("does nothing for no images", async () => {
    expect(await sendImages([], () => {}, vi.fn())).toEqual({ stored: 0, exists: 0, tooBig: [], failed: [] });
  });
});

describe("sendImage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("PUTs the image under its name and reads the result", async () => {
    const fetch = vi.fn(async () => Response.json({ ok: true, result: "exists" }));
    vi.stubGlobal("fetch", fetch);
    expect(await sendImage(image("my photo.png"))).toBe("exists");
    expect(fetch).toHaveBeenCalledWith("/api/files/assets/my%20photo.png", expect.objectContaining({ method: "PUT" }));
  });

  it("doesn't send an image that is too big", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect(await sendImage(image("big.png", MAX_ASSET_BYTES + 1))).toBe("too-big");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: "size" }, { status: 413 })));
    expect(await sendImage(image("a.png"))).toBe("too-big");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })));
    expect(await sendImage(image("a.png"))).toBe("failed");
  });
});
