/**
 * Markdown images in page text (PRD F31, attachments): `![alt](src)`, with
 * Logseq's optional size after it (`{:height 300, :width 400}`). The text
 * stays as written; image-preview.ts shows the picture.
 */

export interface ImageRef {
  /** Offsets of the whole `![alt](src){...}` in the line's text. */
  from: number;
  to: number;
  alt: string;
  src: string;
  width: number | null;
}

const IMAGE_REGEX = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)(\{[^}\n]*\})?/g;

/** Every image written in `text`, in order. */
export function findImages(text: string): ImageRef[] {
  const found: ImageRef[] = [];
  IMAGE_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = IMAGE_REGEX.exec(text)) !== null) {
    const width = match[3] ? /:width\s+(\d+(?:\.\d+)?)/.exec(match[3]) : null;
    found.push({
      from: match.index,
      to: match.index + match[0].length,
      alt: match[1],
      src: match[2],
      width: width ? Math.round(Number(width[1])) : null,
    });
  }
  return found;
}

/** Where attachments from a Logseq graph's `assets/` folder are served. */
export const ASSETS_PATH = "/files/assets/";

/**
 * The address to load an image from, or null for one that can't be shown:
 * web addresses as written, Logseq's `../assets/<name>` (and `assets/<name>`)
 * from Mistlog's own store, and anything else (local paths, `javascript:`)
 * not at all.
 */
export function imageAddress(src: string): string | null {
  if (/^https?:\/\//i.test(src)) return src;
  const asset = /^(?:\.\.\/|\/)?assets\/([^?#]+)$/.exec(src);
  if (!asset) return null;
  const name = safeDecode(asset[1]);
  if (!name || !isAssetName(name)) return null;
  return ASSETS_PATH + encodeURIComponent(name);
}

/** The image types an asset may be, by extension: SVG is left out, as it can carry scripts. */
export const ASSET_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
};

/** The largest asset accepted, in bytes. */
export const MAX_ASSET_BYTES = 10 * 1024 * 1024;

/** A file name an asset can be stored under: no folders, nothing hidden, and not too long. */
export function isAssetName(name: string): boolean {
  return name.length > 0 && name.length <= 200 && !/[/\\]/.test(name) && ![...name].some((c) => c.charCodeAt(0) < 0x20) && !name.startsWith(".");
}

/** The type to serve an asset as, or null if it isn't an image Mistlog keeps. */
export function assetContentType(name: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  return (ext && ASSET_TYPES[ext]) ?? null;
}

/**
 * The name of an image in a picked graph folder's `assets/` folder, from the
 * path the browser gives it (`graph/assets/image_1_0.png`), or null for
 * anything else (other files, and files in folders inside `assets/`, which
 * Logseq's links don't use).
 */
export function graphImageName(path: string): string | null {
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2 || parts[parts.length - 2].toLowerCase() !== "assets") return null;
  const name = parts[parts.length - 1];
  return isAssetName(name) && assetContentType(name) ? name : null;
}

function safeDecode(text: string): string | null {
  try {
    return decodeURIComponent(text);
  } catch {
    return null;
  }
}
