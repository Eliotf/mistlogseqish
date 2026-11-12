/**
 * Keeping recent journal days in the browser for offline use (PRD F14, the
 * offline journal; docs/design-choices.md). Shared by the server route
 * (api.journals.state.ts), DocumentAgent and the browser (offline.ts).
 */

/** Days asked for in one request: each costs two Durable Object subrequests. */
export const MAX_KEPT_DAYS = 10;

/** How often a browser refreshes its copies of recent days, at most. */
export const KEEP_DAYS_EVERY_MS = 60 * 60 * 1000;

/** Bytes as base64 (a Yjs update in JSON). Chunked, so a long page doesn't overflow the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export function base64ToBytes(base64: string): Uint8Array {
  const text = atob(base64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}
