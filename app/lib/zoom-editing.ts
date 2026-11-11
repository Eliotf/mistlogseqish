import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { indentOf } from "./bullets";
import { BLOCK_ID_ATTR, isBlockId } from "./block-ids";
import type { LineRange } from "./block-range";
import { ancestorsOf, zoomRange } from "./zoom";

/**
 * Zooming into a block in the editor (PRD F40, rules in zoom.ts). Only the
 * zoomed block and its children are shown. The page decides what is zoomed
 * (the ?block= address) and sets it with setZoom. A bullet click
 * (block-moving.ts), Cmd/Ctrl+. (zoom into the caret's block) and
 * Cmd/Ctrl+, (zoom out one level) ask the page to change it with a
 * ZOOM_EVENT on the editor, like links do (OPEN_LINK_EVENT).
 *
 * While zoomed, this tab's edits stay inside the block: a transaction that
 * would change a line outside it, remove the zoomed line, or leave a line it
 * held outside it (an outdent past it, plain lines pasted at its end) is
 * refused. Other tabs' edits always apply. If the zoomed block disappears,
 * the whole page is shown and the page says so (ZoomCrumbs).
 */

/** Sent on the editor's DOM to ask the page to zoom into a block, or out to the whole page (null). */
export const ZOOM_EVENT = "mistlog-zoom";

export interface ZoomDetail {
  blockId: string | null;
}

export function requestZoom(dom: HTMLElement, blockId: string | null): void {
  dom.dispatchEvent(new CustomEvent<ZoomDetail>(ZOOM_EVENT, { detail: { blockId } }));
}

interface ZoomState {
  root: string | null;
  /** The lines shown, or null when not zoomed (or the block is gone). */
  range: LineRange | null;
  decorations: DecorationSet;
}

export const zoomKey = new PluginKey<ZoomState>("zoom");

function isRemote(tr: Transaction): boolean {
  return !!(tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;
}

function lines(doc: ProseMirrorNode): { texts: string[]; ids: unknown[]; starts: number[] } {
  const texts: string[] = [];
  const ids: unknown[] = [];
  const starts: number[] = [];
  doc.forEach((node, offset) => {
    texts.push(node.textContent);
    ids.push(node.attrs[BLOCK_ID_ATTR]);
    starts.push(offset);
  });
  return { texts, ids, starts };
}

/** The zoomed lines as positions: from before the zoomed line to after its last child. */
function rangePositions(doc: ProseMirrorNode, range: LineRange): { from: number; to: number } {
  const { starts } = lines(doc);
  return { from: starts[range.from], to: range.to < starts.length ? starts[range.to] : doc.content.size };
}

function build(doc: ProseMirrorNode, root: string | null): ZoomState {
  if (!root) return { root, range: null, decorations: DecorationSet.empty };
  const { texts, ids, starts } = lines(doc);
  const range = zoomRange(texts, ids, root);
  if (!range) return { root, range: null, decorations: DecorationSet.empty };
  const decorations: Decoration[] = [];
  // The zoomed block is drawn flush left: its own indent takes no space (the text keeps it)
  const base = indentOf(texts[range.from]);
  texts.forEach((_text, i) => {
    if (i >= range.from && i < range.to) {
      if (base > 0) {
        decorations.push(Decoration.inline(starts[i] + 1, starts[i] + 1 + base, { class: "zoom-indent" }));
        // The hanging indent of wrapped lines leaves out the hidden tabs too (app.css, .md-line)
        decorations.push(Decoration.node(starts[i], starts[i] + doc.child(i).nodeSize, { style: `--zoom-base: ${base}` }));
      }
      return;
    }
    decorations.push(Decoration.node(starts[i], starts[i] + doc.child(i).nodeSize, { class: "zoom-hidden" }));
  });
  return { root, range, decorations: DecorationSet.create(doc, decorations) };
}

/** The zoomed block, its range, or null. */
export function zoomOf(state: EditorState): { root: string; range: LineRange } | null {
  const zs = zoomKey.getState(state);
  return zs?.root && zs.range ? { root: zs.root, range: zs.range } : null;
}

/** Zoom into block `root`, or out to the whole page with null. */
export function setZoom(state: EditorState, root: string | null): Transaction {
  return state.tr.setMeta(zoomKey, root);
}

/** Whether this tab's transaction keeps to the zoomed block (see the module comment). */
export function staysInZoom(tr: Transaction, state: EditorState): boolean {
  const zoom = zoomOf(state);
  if (!zoom || !tr.docChanged || isRemote(tr)) return true;
  let { from, to } = rangePositions(state.doc, zoom.range);
  for (const step of tr.steps) {
    let outside = false;
    // Nothing may change at or before the line boundary above the zoomed line, or after its last child
    step.getMap().forEach((oldStart, oldEnd) => {
      if (oldStart <= from || oldEnd > to) outside = true;
    });
    if (outside) return false;
    const map = step.getMap();
    from = map.map(from, -1);
    to = map.map(to, 1);
  }
  const after = zoomRange(lines(tr.doc).texts, lines(tr.doc).ids, zoom.root);
  if (!after) return false;
  // Every line the zoom held (and any added inside it) must still be in it
  return rangePositions(tr.doc, after).to >= to;
}

/** Zoomed: keep the caret inside the zoomed lines. */
function keepCaretInZoom(state: EditorState): Transaction | null {
  const zoom = zoomOf(state);
  const { $head } = state.selection;
  if (!zoom || $head.depth !== 1) return null;
  const line = $head.index(0);
  if (line >= zoom.range.from && line < zoom.range.to) return null;
  const { starts } = lines(state.doc);
  const target = line < zoom.range.from ? zoom.range.from : zoom.range.to - 1;
  const pos = line < zoom.range.from ? starts[target] + 1 : starts[target] + 1 + state.doc.child(target).content.size;
  return state.tr.setSelection(TextSelection.create(state.doc, pos));
}

/** Enter at the end of the zoomed line adds its first child, as in Logseq. */
function enterOnZoomedLine(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const zoom = zoomOf(state);
  const { $head, empty } = state.selection;
  if (!zoom || !empty || $head.depth !== 1 || $head.index(0) !== zoom.range.from) return false;
  if ($head.parentOffset !== $head.parent.content.size) return false;
  if (!dispatch) return true;
  const { texts, starts } = lines(state.doc);
  const prefix = `${"\t".repeat(indentOf(texts[zoom.range.from]) + 1)}- `;
  const at = zoom.range.from + 1 < starts.length ? starts[zoom.range.from + 1] : state.doc.content.size;
  const tr = state.tr.insert(at, state.schema.nodes.paragraph.create(null, state.schema.text(prefix)));
  tr.setSelection(TextSelection.create(tr.doc, at + 1 + prefix.length));
  dispatch(tr.scrollIntoView());
  return true;
}

export const Zoom = Extension.create<{ suggesting: () => boolean }>({
  name: "zoom",
  // Before Folding and BulletEditing, so Enter on the zoomed line is handled here
  priority: 120,

  addOptions() {
    return { suggesting: () => false };
  },

  addKeyboardShortcuts() {
    return {
      // Zoom into the caret's block
      "Mod-.": () => {
        const { $head } = this.editor.state.selection;
        if ($head.depth !== 1) return false;
        const id: unknown = $head.parent.attrs[BLOCK_ID_ATTR];
        if (!isBlockId(id)) return false;
        requestZoom(this.editor.view.dom, id);
        return true;
      },
      // Zoom out one level
      "Mod-,": () => {
        const zoom = zoomOf(this.editor.state);
        if (!zoom) return false;
        const { texts, ids } = lines(this.editor.state.doc);
        const parent = ancestorsOf(texts, zoom.range.from).at(-1);
        const parentId = parent === undefined ? null : ids[parent];
        requestZoom(this.editor.view.dom, isBlockId(parentId) ? parentId : null);
        return true;
      },
      Enter: () => {
        if (!this.editor.isEditable || this.editor.view.composing || this.options.suggesting()) return false;
        return enterOnZoomedLine(this.editor.state, this.editor.view.dispatch);
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<ZoomState>({
        key: zoomKey,
        state: {
          init: (_, state) => build(state.doc, null),
          apply: (tr, old) => {
            const meta = tr.getMeta(zoomKey) as string | null | undefined;
            if (meta !== undefined) return build(tr.doc, meta);
            return tr.docChanged ? build(tr.doc, old.root) : old;
          },
        },
        filterTransaction: staysInZoom,
        appendTransaction: (_trs, _old, state) => keepCaretInZoom(state),
        props: {
          decorations: (state) => zoomKey.getState(state)?.decorations,
          attributes: (state): Record<string, string> => (zoomOf(state) ? { class: "is-zoomed" } : {}),
        },
      }),
    ];
  },
});
