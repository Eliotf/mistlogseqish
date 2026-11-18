import { MAX_ASSET_BYTES } from "./images";

/**
 * Sending the images in a picked Logseq graph's `assets/` folder to
 * Mistlog (PRD F31), so the `../assets/<name>` links in imported pages
 * show them. Separate from the import: it never touches a page, and
 * sending a folder again skips the images Mistlog has already.
 */

export interface GraphImage {
  name: string;
  file: Blob;
}

export type SendResult = "stored" | "exists" | "too-big" | "failed";

/** Send one image; what happened to it. */
export type SendImage = (image: GraphImage) => Promise<SendResult>;

export const sendImage: SendImage = async ({ name, file }) => {
  if (file.size > MAX_ASSET_BYTES) return "too-big";
  const res = await fetch(`/api/files/assets/${encodeURIComponent(name)}`, { method: "PUT", body: file });
  if (res.status === 413) return "too-big";
  if (!res.ok) return "failed";
  const body = (await res.json()) as { result?: string };
  return body.result === "exists" ? "exists" : "stored";
};

export interface SendOutcome {
  stored: number;
  exists: number;
  tooBig: string[];
  failed: string[];
}

/** Images sent at once: enough to be quick, few enough not to crowd the connection. */
const AT_ONCE = 3;

/** Send every image, a few at a time, reporting how many are done. A failure doesn't stop the rest. */
export async function sendImages(images: readonly GraphImage[], onProgress: (done: number) => void, send: SendImage = sendImage): Promise<SendOutcome> {
  const outcome: SendOutcome = { stored: 0, exists: 0, tooBig: [], failed: [] };
  let next = 0;
  let done = 0;
  const worker = async () => {
    while (next < images.length) {
      const image = images[next++];
      let result: SendResult;
      try {
        result = await send(image);
      } catch {
        result = "failed";
      }
      if (result === "stored") outcome.stored++;
      else if (result === "exists") outcome.exists++;
      else if (result === "too-big") outcome.tooBig.push(image.name);
      else outcome.failed.push(image.name);
      onProgress(++done);
    }
  };
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, images.length) }, worker));
  return outcome;
}
