import Paragraph from "@tiptap/extension-paragraph";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { BLOCK_ID_ATTR, linesNeedingIds, newBlockId } from "./block-ids";

/**
 * The editor's half of permanent block IDs (PRD F41, rules in block-ids.ts).
 *
 * Lines are paragraphs with an invisible `blockId` attribute. After each
 * local edit, lines the edit created get a new ID in the same transaction,
 * so the line reaches Yjs already labelled. Lines that existed before the
 * edit are never labelled here, even when they have no ID: the server does
 * that, so two tabs cannot give one line different IDs.
 *
 * Splitting a line keeps the ID on the upper half (the lower half is new);
 * joining keeps the upper line's ID; pasted lines get new IDs, because the
 * attribute is never read from pasted HTML.
 */

export const blockIdKey = new PluginKey("blockIds");

function isRemote(tr: Transaction): boolean {
  return !!(tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;
}

/** The transaction that labels new lines after local `trs`, or null if none need it. */
export function labelNewLines(trs: readonly Transaction[], oldState: EditorState, newState: EditorState): Transaction | null {
  if (!trs.some((tr) => tr.docChanged) || trs.some(isRemote)) return null;
  const mapping = new Mapping();
  for (const tr of trs) mapping.appendMapping(tr.mapping);

  // Where each line that was already there now starts
  const kept = new Set<number>();
  oldState.doc.forEach((_node, offset) => {
    const result = mapping.mapResult(offset, 1);
    if (!result.deleted) kept.add(result.pos);
  });

  const ids: unknown[] = [];
  const eligible: boolean[] = [];
  const starts: number[] = [];
  newState.doc.forEach((node, offset) => {
    ids.push(node.attrs[BLOCK_ID_ATTR]);
    eligible.push(node.type.name === "paragraph" && !kept.has(offset));
    starts.push(offset);
  });
  const missing = linesNeedingIds(ids, eligible);
  if (missing.length === 0) return null;
  const tr = newState.tr;
  for (const i of missing) tr.setNodeAttribute(starts[i], BLOCK_ID_ATTR, newBlockId());
  return tr;
}

export const BlockParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      [BLOCK_ID_ATTR]: {
        default: null,
        // Never taken from pasted HTML: a pasted line is a new block
        parseHTML: () => null,
        renderHTML: (attrs: Record<string, unknown>) => (attrs[BLOCK_ID_ATTR] ? { "data-block-id": attrs[BLOCK_ID_ATTR] } : {}),
        keepOnSplit: false,
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: blockIdKey,
        appendTransaction: (trs, oldState, newState) => labelNewLines(trs, oldState, newState),
      }),
    ];
  },
});
