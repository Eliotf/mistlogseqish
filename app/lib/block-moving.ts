import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { bulletContentStart, indentOf } from "./bullets";
import { dropPlan, indexAfterMove, moveBlockPlan, movedIndent, type MovePlan } from "./moving";
import { BLOCK_ID_ATTR, isBlockId } from "./block-ids";

/**
 * Moving blocks in the editor (PRD F38, rules in moving.ts).
 * Alt+Shift+↑/↓ swaps the caret's block with its neighbour at the same
 * level; dragging a bullet drops its block above the line it is dropped on,
 * at that line's level. A block moves with its children (folded or not),
 * keeping their IDs and folds, as one transaction, so it syncs and undoes as
 * one step. Not in suggest mode, like indenting.
 *
 * Yjs has no move: a moved line is deleted and inserted again, so a
 * keystroke another device types into that line at the same instant can be
 * lost. Moves are rare and quick, so this is accepted (docs/reviews/m2b.1c).
 */

interface ModeSource {
  get: (key: string) => string | undefined;
}

interface MoveState {
  decorations: DecorationSet;
  /** The line a dragged block would be dropped above, while dragging. */
  dropLine: number | null;
}

export const blockMovingKey = new PluginKey<MoveState>("blockMoving");

/**
 * The block being dragged, if any: by block ID, so edits from another tab
 * during the drag cannot change which block moves. Module-wide so a drop on
 * another editor can be told apart.
 */
let dragging: { view: EditorView; line: number; id: string | null } | null = null;

/** The dragged block's line now. */
function draggedLine(view: EditorView, from: { line: number; id: string | null }): number | null {
  if (!from.id) return from.line < view.state.doc.childCount ? from.line : null;
  let found: number | null = null;
  view.state.doc.forEach((node, _offset, index) => {
    if (found === null && node.attrs[BLOCK_ID_ATTR] === from.id) found = index;
  });
  return found;
}

function lineStarts(doc: ProseMirrorNode): number[] {
  const starts: number[] = [];
  doc.forEach((_node, offset) => starts.push(offset));
  return starts;
}

function lineTexts(doc: ProseMirrorNode): string[] {
  const texts: string[] = [];
  doc.forEach((node) => texts.push(node.textContent));
  return texts;
}

/** A copy of a line with `delta` tabs added or removed at its start. Indentation is unmarked text. */
function reindent(node: ProseMirrorNode, delta: number): ProseMirrorNode {
  if (delta === 0) return node;
  const text = node.textContent;
  const oldTabs = indentOf(text);
  const newTabs = movedIndent(text, delta);
  const rest = node.content.cut(oldTabs);
  const content = newTabs > 0 ? Fragment.from(node.type.schema.text("\t".repeat(newTabs))).append(rest) : rest;
  return node.type.create(node.attrs, content, node.marks);
}

/**
 * Apply a move to a transaction. Returns the position where the moved block
 * now starts. Lines are deleted and inserted as nodes, so their attributes
 * (block ID, fold) go with them.
 */
export function applyMove(tr: Transaction, plan: MovePlan): number {
  const doc = tr.doc;
  const starts = lineStarts(doc);
  const pos = (k: number) => (k < starts.length ? starts[k] : doc.content.size);
  const nodes: ProseMirrorNode[] = [];
  for (let k = plan.from; k < plan.to; k++) nodes.push(reindent(doc.child(k), plan.indentDelta));
  const from = pos(plan.from);
  const to = pos(plan.to);
  const at = pos(plan.before);
  if (at < from) {
    tr.delete(from, to);
    tr.insert(at, nodes);
    return at;
  }
  tr.insert(at, nodes);
  tr.delete(from, to);
  return at - (to - from);
}

function caretLine(state: EditorState): { line: number; offset: number } | null {
  const { $head } = state.selection;
  return $head.depth === 1 ? { line: $head.index(0), offset: $head.parentOffset } : null;
}

/** Alt+Shift+↑/↓. Returns false only when the caret is not in a line. */
export function moveCaretBlock(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, dir: 1 | -1): boolean {
  const caret = caretLine(state);
  if (!caret) return false;
  const plan = moveBlockPlan(lineTexts(state.doc), caret.line, dir);
  // At the first or last block of its level: keep the key, move nothing
  if (!plan || !dispatch) return true;
  const tr = state.tr;
  applyMove(tr, plan);
  const starts = lineStarts(tr.doc);
  const line = indexAfterMove(plan, caret.line);
  tr.setSelection(TextSelection.create(tr.doc, starts[line] + 1 + caret.offset));
  dispatch(tr.scrollIntoView());
  return true;
}

/** Drop the block at line `line` above line `target`. Returns false if nothing moved. */
export function dropBlock(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, line: number, target: number): boolean {
  const texts = lineTexts(state.doc);
  if (line >= texts.length || target >= texts.length) return false;
  const plan = dropPlan(texts, line, target);
  if (!plan) return false;
  if (dispatch) {
    const tr = state.tr;
    const start = applyMove(tr, plan);
    const first = tr.doc.nodeAt(start);
    tr.setSelection(TextSelection.create(tr.doc, start + 1 + (first?.content.size ?? 0)));
    dispatch(tr.scrollIntoView());
  }
  return true;
}

function setDropLine(view: EditorView, line: number | null): void {
  if (blockMovingKey.getState(view.state)?.dropLine === line) return;
  view.dispatch(view.state.tr.setMeta(blockMovingKey, line));
}

/** The line under a drag event, or null outside the lines. */
function lineAtEvent(view: EditorView, event: DragEvent): number | null {
  const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!found) return null;
  const $pos = view.state.doc.resolve(found.inside >= 0 ? found.inside : found.pos);
  return $pos.depth >= 1 ? $pos.index(0) : Math.min($pos.index(0), view.state.doc.childCount - 1);
}

function dragHandle(view: EditorView, getPos: () => number | undefined, canMove: () => boolean): HTMLElement {
  const el = document.createElement("span");
  el.className = "bullet-handle";
  el.contentEditable = "false";
  el.draggable = true;
  el.setAttribute("aria-hidden", "true");
  el.title = "Drag to move this block (or Alt+Shift+↑/↓)";
  el.addEventListener("dragstart", (event) => {
    const pos = getPos();
    if (pos === undefined || !canMove()) {
      event.preventDefault();
      return;
    }
    const line = view.state.doc.resolve(pos).index(0);
    const id: unknown = view.state.doc.child(line).attrs[BLOCK_ID_ATTR];
    dragging = { view, line, id: isBlockId(id) ? id : null };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("application/x-mistlog-block", String(line));
      const lineDom = view.nodeDOM(lineStarts(view.state.doc)[line]);
      if (lineDom instanceof HTMLElement) event.dataTransfer.setDragImage(lineDom, 0, 0);
    }
  });
  el.addEventListener("dragend", () => {
    dragging = null;
    setDropLine(view, null);
  });
  return el;
}

function buildHandles(doc: ProseMirrorNode, canMove: () => boolean): Decoration[] {
  const decorations: Decoration[] = [];
  doc.forEach((node, offset) => {
    const text = node.textContent;
    if (bulletContentStart(text) === null) return;
    decorations.push(
      Decoration.widget(offset + 1 + indentOf(text), (view, getPos) => dragHandle(view, getPos, canMove), {
        side: -1,
        key: "bullet-handle",
        ignoreSelection: true,
        stopEvent: () => true,
      }),
    );
  });
  return decorations;
}

export const BlockMoving = Extension.create<{ docState: ModeSource | null }>({
  name: "blockMoving",

  addOptions() {
    return { docState: null };
  },

  addKeyboardShortcuts() {
    const run = (dir: 1 | -1) => () => {
      if (!this.editor.isEditable || this.editor.view.composing) return false;
      if (this.options.docState?.get("mode") === "suggest") return true;
      return moveCaretBlock(this.editor.state, this.editor.view.dispatch, dir);
    };
    return {
      "Alt-Shift-ArrowUp": run(-1),
      "Alt-Shift-ArrowDown": run(1),
    };
  },

  addProseMirrorPlugins() {
    const canMove = () => this.editor.isEditable && this.options.docState?.get("mode") !== "suggest";
    const build = (doc: ProseMirrorNode, dropLine: number | null): MoveState => {
      const decorations = buildHandles(doc, canMove);
      if (dropLine !== null && dropLine < doc.childCount) {
        const start = lineStarts(doc)[dropLine];
        // Drawn from the target's indent, to show the level the block lands at
        const indent = indentOf(doc.child(dropLine).textContent);
        decorations.push(Decoration.node(start, start + doc.child(dropLine).nodeSize, { class: "drop-above", style: `--drop-indent: ${indent}` }));
      }
      return { decorations: DecorationSet.create(doc, decorations), dropLine };
    };
    return [
      new Plugin<MoveState>({
        key: blockMovingKey,
        state: {
          init: (_, state) => build(state.doc, null),
          apply: (tr, old) => {
            const meta = tr.getMeta(blockMovingKey) as number | null | undefined;
            const dropLine = meta === undefined ? (tr.docChanged ? null : old.dropLine) : meta;
            return tr.docChanged || dropLine !== old.dropLine ? build(tr.doc, dropLine) : old;
          },
        },
        props: {
          decorations: (state) => blockMovingKey.getState(state)?.decorations,
          handleDOMEvents: {
            dragover: (view, event) => {
              if (!dragging) return false;
              // Only within the editor the block came from
              if (dragging.view !== view) return true;
              event.preventDefault();
              setDropLine(view, lineAtEvent(view, event));
              return true;
            },
            dragleave: (view, event) => {
              if (dragging?.view === view && !view.dom.contains(event.relatedTarget as Node | null)) setDropLine(view, null);
              return false;
            },
          },
          handleDrop: (view, event) => {
            if (!dragging) return false;
            const from = dragging;
            dragging = null;
            event.preventDefault();
            setDropLine(view, null);
            if (from.view !== view) return true;
            const target = lineAtEvent(view, event);
            const line = draggedLine(view, from);
            if (target !== null && line !== null) dropBlock(view.state, view.dispatch, line, target);
            return true;
          },
        },
      }),
    ];
  },
});
