import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { bulletContentStart, indentOf, blockEnd } from "./bullets";
import { COLLAPSED_ATTR, foldedAncestors, hasChildren, hiddenLines, nearestVisible } from "./folding";
import { BLOCK_ID_ATTR } from "./block-ids";
import { zoomRange } from "./zoom";
import { zoomKey } from "./zoom-editing";
import { modKeyLabel } from "./mod-key";

/**
 * Folding in the editor (PRD F37, rules in folding.ts). A line with children
 * gets an arrow by its bullet (shown on hover); Cmd/Ctrl+↑ folds the
 * caret's line and Cmd/Ctrl+↓ unfolds it. The fold is the line's
 * `collapsed` attribute, so it syncs; it is kept out of undo, like Logseq.
 *
 * Nothing is ever typed into a hidden line:
 * - arrow keys skip over folded children;
 * - an edit of this tab's that leaves the caret in a folded block (Tab under
 *   a folded line, Backspace into one, a paste) unfolds it;
 * - when a fold (this tab's or another's) hides the caret, the caret moves to
 *   the folded line, writing nothing;
 * - Enter at the end of a folded line adds a sibling after its children.
 */

interface ModeSource {
  get: (key: string) => string | undefined;
}

interface FoldState {
  decorations: DecorationSet;
  texts: string[];
  collapsed: boolean[];
  hidden: boolean[];
  /** Position where each line's text starts. */
  starts: number[];
  /** Folds that apply: inside a zoom, only those strictly within the zoomed block. */
  effective: boolean[];
  /** The zoomed block (zoom-editing.ts): it always shows its children, and folds outside it do not apply. */
  zoomRoot: string | null;
}

export const foldingKey = new PluginKey<FoldState>("folding");

/** Marks a transaction that folds or unfolds, so the caret it hides is moved rather than unfolding again. */
const FOLD = "folding/fold";

function isRemote(tr: Transaction): boolean {
  return !!(tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;
}

function foldToggle(view: EditorView, getPos: () => number | undefined, folded: boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = "fold-toggle";
  el.contentEditable = "false";
  el.setAttribute("role", "button");
  el.setAttribute("aria-label", folded ? "Unfold" : "Fold");
  el.setAttribute("aria-expanded", String(!folded));
  el.title = `${folded ? "Unfold" : "Fold"} (${modKeyLabel()}+${folded ? "↓" : "↑"})`;
  el.addEventListener("mousedown", (event) => {
    event.preventDefault();
    const pos = getPos();
    if (pos === undefined || !view.editable) return;
    const line = view.state.doc.resolve(pos).index(0);
    setFolded(view.state, view.dispatch, line, !folded);
  });
  return el;
}

function build(doc: ProseMirrorNode, zoomRoot: string | null): FoldState {
  const texts: string[] = [];
  const collapsed: boolean[] = [];
  const ids: unknown[] = [];
  const starts: number[] = [];
  doc.forEach((node, offset) => {
    texts.push(node.textContent);
    collapsed.push(node.attrs[COLLAPSED_ATTR] === true);
    ids.push(node.attrs[BLOCK_ID_ATTR]);
    starts.push(offset + 1);
  });
  // Zoomed: only folds strictly inside the zoomed block hide anything
  const zoom = zoomRoot ? zoomRange(texts, ids, zoomRoot) : null;
  const effective = zoom ? collapsed.map((c, i) => c && i > zoom.from && i < zoom.to) : collapsed;
  const hidden = hiddenLines(texts, effective);
  const decorations: Decoration[] = [];
  texts.forEach((text, i) => {
    const node = doc.child(i);
    if (hidden[i]) {
      decorations.push(Decoration.node(starts[i] - 1, starts[i] - 1 + node.nodeSize, { class: "fold-hidden" }));
      return;
    }
    // The zoomed line always shows its children, so it has no arrow
    if (!hasChildren(texts, i) || (zoom && i === zoom.from)) return;
    const folded = effective[i];
    if (folded) decorations.push(Decoration.node(starts[i] - 1, starts[i] - 1 + node.nodeSize, { class: "is-folded" }));
    decorations.push(
      Decoration.widget(starts[i] + indentOf(text), (view, getPos) => foldToggle(view, getPos, folded), {
        side: -1,
        key: `fold-${folded ? 1 : 0}`,
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    );
  });
  return { decorations: DecorationSet.create(doc, decorations), texts, collapsed, effective, hidden, starts, zoomRoot };
}

/** Fold (or unfold) line `line`. Returns false if there is nothing to change. */
export function setFolded(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, line: number, fold: boolean): boolean {
  const fs = foldingKey.getState(state);
  if (!fs || line < 0 || line >= fs.texts.length) return false;
  if (fold && (fs.collapsed[line] || !hasChildren(fs.texts, line))) return false;
  if (!fold && !fs.collapsed[line]) return false;
  if (dispatch) {
    const tr = state.tr.setNodeAttribute(fs.starts[line] - 1, COLLAPSED_ATTR, fold ? true : null);
    dispatch(tr.setMeta(FOLD, true).setMeta("addToHistory", false));
  }
  return true;
}

function caretLine(state: EditorState): number | null {
  const { $head } = state.selection;
  return $head.depth === 1 ? $head.index(0) : null;
}

/** Enter at the end of a folded line: a new line after its hidden children, at the same level. */
function enterAfterFolded(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const fs = foldingKey.getState(state);
  const { $head, empty } = state.selection;
  const line = caretLine(state);
  if (!fs || !empty || line === null || !fs.collapsed[line] || !hasChildren(fs.texts, line)) return false;
  if ($head.parentOffset !== $head.parent.content.size) return false;
  if (!dispatch) return true;
  const text = fs.texts[line];
  const prefix = "\t".repeat(indentOf(text)) + (bulletContentStart(text) !== null ? "- " : "");
  const end = blockEnd(fs.texts, line);
  const pos = end < fs.starts.length ? fs.starts[end] - 1 : state.doc.content.size;
  const schema = state.schema;
  const tr = state.tr.insert(pos, schema.nodes.paragraph.create(null, prefix ? schema.text(prefix) : null));
  tr.setSelection(TextSelection.create(tr.doc, pos + 1 + prefix.length));
  dispatch(tr.scrollIntoView());
  return true;
}

/** Keep the caret out of hidden lines (see the module comment). */
export function keepCaretVisible(trs: readonly Transaction[], oldState: EditorState, newState: EditorState): Transaction | null {
  const fs = foldingKey.getState(newState);
  const line = caretLine(newState);
  if (!fs || line === null || !fs.hidden[line]) return null;
  const { anchor, head } = newState.selection;
  const moveTo = (target: number, atEnd: boolean) => {
    const pos = atEnd ? fs.starts[target] + newState.doc.child(target).content.size : fs.starts[target];
    const tr = newState.tr.setSelection(TextSelection.create(newState.doc, anchor === head ? pos : anchor, pos));
    return tr;
  };

  const localEdit = trs.some((tr) => tr.docChanged) && !trs.some(isRemote) && !trs.some((tr) => tr.getMeta(FOLD));
  if (localEdit) {
    const tr = newState.tr;
    for (const j of foldedAncestors(fs.texts, fs.effective, line)) tr.setNodeAttribute(fs.starts[j] - 1, COLLAPSED_ATTR, null);
    return tr.setMeta(FOLD, true).setMeta("addToHistory", false);
  }
  if (trs.some((tr) => tr.docChanged)) {
    // A fold hid the caret: move it to the end of the folded line
    const target = nearestVisible(fs.hidden, line, -1);
    return target === null ? null : moveTo(target, true);
  }
  // The caret moved into a folded block: carry on past it the way it was going
  const dir = head >= oldState.selection.head ? 1 : -1;
  const target = nearestVisible(fs.hidden, line, dir) ?? nearestVisible(fs.hidden, line, dir === 1 ? -1 : 1);
  return target === null ? null : moveTo(target, dir === -1);
}

export const Folding = Extension.create<{ docState: ModeSource | null }>({
  name: "folding",
  // Before BulletEditing, so Enter on a folded line is handled here
  priority: 110,

  addOptions() {
    return { docState: null };
  },

  addGlobalAttributes() {
    return [
      {
        types: ["paragraph"],
        attributes: {
          [COLLAPSED_ATTR]: {
            default: null,
            // Pasted lines arrive unfolded
            parseHTML: () => null,
            renderHTML: () => ({}),
            keepOnSplit: false,
          },
        },
      },
    ];
  },

  addKeyboardShortcuts() {
    const editable = () => this.editor.isEditable && !this.editor.view.composing;
    const caret = () => caretLine(this.editor.state);
    return {
      "Mod-ArrowUp": () => {
        const line = caret();
        return editable() && line !== null && setFolded(this.editor.state, this.editor.view.dispatch, line, true);
      },
      "Mod-ArrowDown": () => {
        const line = caret();
        return editable() && line !== null && setFolded(this.editor.state, this.editor.view.dispatch, line, false);
      },
      Enter: () => {
        if (!editable() || this.options.docState?.get("mode") === "suggest") return false;
        return enterAfterFolded(this.editor.state, this.editor.view.dispatch);
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<FoldState>({
        key: foldingKey,
        state: {
          init: (_, state) => build(state.doc, null),
          apply: (tr, old) => {
            const zoom = tr.getMeta(zoomKey) as string | null | undefined;
            if (zoom !== undefined) return build(tr.doc, zoom);
            return tr.docChanged ? build(tr.doc, old.zoomRoot) : old;
          },
        },
        props: {
          decorations: (state) => foldingKey.getState(state)?.decorations,
        },
        appendTransaction: keepCaretVisible,
      }),
    ];
  },
});
