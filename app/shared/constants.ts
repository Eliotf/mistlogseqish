export const APP_NAME = "mist";

/** The name shown in the header and browser tab. */
export const APP_DISPLAY_NAME = "mistlogseqish";

export function isValidDocumentId(id: string): boolean {
  if (id.length !== 8) return false;
  return /^[a-z0-9]+$/.test(id);
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 8;

export function generateDocumentId(): string {
  let id = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    id += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  }
  return id;
}

export const USER_COLOURS = [
  { color: "#E57373", light: "#FFCDD2" },
  { color: "#81C784", light: "#C8E6C9" },
  { color: "#64B5F6", light: "#BBDEFB" },
  { color: "#FFB74D", light: "#FFE0B2" },
  { color: "#BA68C8", light: "#E1BEE7" },
  { color: "#4DD0E1", light: "#B2EBF2" },
  { color: "#FF8A65", light: "#FFCCBC" },
  { color: "#AED581", light: "#DCEDC8" },
] as const;

/**
 * Yjs document format version. Bump when the shared type schema changes
 * (e.g. switching CriticMarkup from plain text to ProseMirror marks).
 *
 * v1: plain text with CriticMarkup delimiters, threads in Y.Map("threads")
 * v2: CriticMarkup stored as ProseMirror marks, threads in Y.Map("threads")
 * v3: optional page title in Y.Map("meta").title
 * v4: `wikilink` marks (links by page ID)
 *
 * Browsers send the version their code understands when they connect, and
 * DocumentAgent refuses older ones: an editor that meets a mark it does not
 * know deletes that text, and the deletion syncs everywhere.
 */
export const DOC_FORMAT_VERSION = 4;

/** WebSocket query parameter carrying the browser's DOC_FORMAT_VERSION. */
export const FORMAT_PARAM = "format";

/** Close code DocumentAgent uses to refuse a browser running older code. */
export const CLOSE_OUTDATED_CLIENT = 4001;

/** True if a connection URL comes from code that understands this document format. */
export function clientUnderstandsFormat(url: string): boolean {
  const raw = new URL(url).searchParams.get(FORMAT_PARAM);
  const version = raw !== null && /^\d+$/.test(raw) ? Number(raw) : 0;
  return version >= DOC_FORMAT_VERSION;
}

/** Name of the single WorkspaceAgent instance while Mistlog is single-user. */
export const WORKSPACE_NAME = "default";

/** Protocol message type: Yjs sync */
export const MSG_SYNC = 0;
/** Protocol message type: Yjs awareness */
export const MSG_AWARENESS = 1;
