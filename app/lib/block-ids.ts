import * as Y from "yjs";

/**
 * Permanent block IDs (PRD F41). Every line (top-level paragraph) carries an
 * invisible `blockId` attribute, so zoom, block references and tasks can
 * point at a line that moves or changes. In Yjs it is an attribute on the
 * paragraph's XmlElement; in ProseMirror a paragraph attribute.
 *
 * Who assigns, so two writers can never label the same line differently:
 * - a browser labels only the lines its own edit creates (block-id-editing.ts);
 * - the server labels every other line without one (assignBlockIds), once.
 *
 * This module is shared by the editor and DocumentAgent; keep it free of
 * editor and server code.
 */

export const BLOCK_ID_ATTR = "blockId";

const BLOCK_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isBlockId(value: unknown): value is string {
  return typeof value === "string" && BLOCK_ID_RE.test(value);
}

/** A new block ID: a UUID, like Logseq's `id::`. */
export function newBlockId(): string {
  return crypto.randomUUID();
}

/**
 * Which lines need a new ID. Only `eligible` lines are ever changed. An
 * eligible line needs one if it has no valid ID, or if its ID is also held
 * by a line that is not eligible or comes before it. So a line split in two
 * keeps its ID on the half that was there before, and among equals the
 * first keeps it.
 */
export function linesNeedingIds(ids: ReadonlyArray<unknown>, eligible: ReadonlyArray<boolean>): number[] {
  const firstHolder = new Map<string, number>();
  const keptByIneligible = new Set<string>();
  ids.forEach((id, i) => {
    if (!isBlockId(id)) return;
    if (!firstHolder.has(id)) firstHolder.set(id, i);
    if (!eligible[i]) keptByIneligible.add(id);
  });
  const result: number[] = [];
  ids.forEach((id, i) => {
    if (!eligible[i]) return;
    if (!isBlockId(id) || keptByIneligible.has(id) || firstHolder.get(id) !== i) result.push(i);
  });
  return result;
}

/**
 * Give every line in a Yjs document fragment a unique ID (the server's
 * pass). Writes nothing when every line already has one; the caller wraps
 * it in a transaction. Returns how many lines were labelled.
 */
export function assignBlockIds(fragment: Y.XmlFragment): number {
  const lines = fragment.toArray();
  const ids = lines.map((line) => (line instanceof Y.XmlElement ? line.getAttribute(BLOCK_ID_ATTR) : undefined));
  const eligible = lines.map((line) => line instanceof Y.XmlElement);
  const missing = linesNeedingIds(ids, eligible);
  for (const i of missing) (lines[i] as Y.XmlElement).setAttribute(BLOCK_ID_ATTR, newBlockId());
  return missing.length;
}
