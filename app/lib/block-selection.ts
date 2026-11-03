import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { indentPlan } from "./bullets";
import { applyEdits, readLines } from "./bullet-editing";
import { COLLAPSED_ATTR, hiddenLines } from "./folding";
import { blockAt, extendRange, moveRange, type LineRange } from "./block-range";
import { zoomOf } from "./zoom-editing";

/**
 * Selecting whole blocks (PRD F39, rules in block-range.ts). Esc selects
 * the caret's block; Shift+↑/↓ grows the selection and ↑/↓ moves it. On the
 * selected blocks: Tab/Shift+Tab indent, Backspace/Delete remove them,
 * Cmd/Ctrl+C copies and Cmd/Ctrl+X cuts whole lines, Enter goes back to
 * editing and Esc leaves the selection.
 *
 * While blocks are selected, the editor's own selection spans their text (so
 * the browser fires copy and cut) but is not drawn; the blocks are
 * highlighted instead. Typing, pasting and input methods are swallowed, so
 * they can never replace the selected text. Other Cmd/Ctrl shortcuts
 * (undo, select all) leave the block selection first and then run.
 * Changes need an editable editor outside suggest mode; copying always works.
 */

interface ModeSource {
  get: (key: string) => string | undefined;
}

/** The selected blocks, as positions between top-level lines, so remote edits map them. */
interface SelectionState {
  from: number;
  to: number;
}

export const blockSelectionKey = new PluginKey<SelectionState | null>("blockSelection");

type Meta = { select: SelectionState } | { clear: true };

function isRemote(tr: Transaction): boolean {
  return !!(tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;
}

function lineStarts(doc: ProseMirrorNode): number[] {
  const starts: number[] = [];
  doc.forEach((_node, offset) => starts.push(offset));
  return starts;
}

/** The selected blocks as line indexes, or null if none are selected. */
export function selectedLines(state: EditorState): LineRange | null {
  const sel = blockSelectionKey.getState(state);
  if (!sel) return null;
  const starts = lineStarts(state.doc);
  const from = starts.indexOf(sel.from);
  const to = sel.to === state.doc.content.size ? starts.length : starts.indexOf(sel.to);
  return from >= 0 && to > from ? { from, to } : null;
}

/** Lines, and which are hidden: inside a folded block, or outside the zoomed block. */
function lineInfo(state: EditorState) {
  const texts: string[] = [];
  const collapsed: boolean[] = [];
  state.doc.forEach((node) => {
    texts.push(node.textContent);
    collapsed.push(node.attrs[COLLAPSED_ATTR] === true);
  });
  const zoom = zoomOf(state)?.range;
  const effective = zoom ? collapsed.map((c, i) => c && i > zoom.from && i < zoom.to) : collapsed;
  const hidden = hiddenLines(texts, effective).map((h, i) => h || (!!zoom && (i < zoom.from || i >= zoom.to)));
  return { texts, hidden, starts: lineStarts(state.doc) };
}

/** Select lines range.from..range.to: block highlight plus an undrawn text selection over them. */
export function selectLines(state: EditorState, range: LineRange): Transaction {
  const starts = lineStarts(state.doc);
  const from = starts[range.from];
  const to = range.to < starts.length ? starts[range.to] : state.doc.content.size;
  const tr = state.tr.setSelection(TextSelection.create(state.doc, from + 1, to - 1));
  return tr.setMeta(blockSelectionKey, { select: { from, to } } satisfies Meta).scrollIntoView();
}

/** Leave the block selection with the caret at the end of line `line`. */
function leave(state: EditorState, line: number): Transaction {
  const starts = lineStarts(state.doc);
  const end = starts[line] + 1 + state.doc.child(line).content.size;
  return state.tr.setSelection(TextSelection.create(state.doc, end)).setMeta(blockSelectionKey, { clear: true } satisfies Meta);
}

/** Esc in a line: select its block. */
export function selectCaretBlock(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const { $head } = state.selection;
  if ($head.depth !== 1) return false;
  if (dispatch) dispatch(selectLines(state, blockAt(lineInfo(state).texts, $head.index(0))));
  return true;
}

/** Remove the selected lines, leaving the caret at the end of the line above (or the start of the page). */
function deleteLines(state: EditorState, range: LineRange): Transaction {
  const starts = lineStarts(state.doc);
  const from = starts[range.from];
  const to = range.to < starts.length ? starts[range.to] : state.doc.content.size;
  // Deleting every line leaves one empty line: ProseMirror refills the page
  const tr = state.tr.setMeta(blockSelectionKey, { clear: true } satisfies Meta).delete(from, to);
  tr.setSelection(TextSelection.create(tr.doc, range.from > 0 ? from - 1 : 1));
  return tr.scrollIntoView();
}

/** The selected lines for the clipboard: Logseq text (one line each, tabs and "- " kept) and HTML that keeps links. */
export function clipboardFor(view: EditorView, range: LineRange): { text: string; html: string } {
  const doc = view.state.doc;
  const starts = lineStarts(doc);
  const to = range.to < starts.length ? starts[range.to] : doc.content.size;
  const { dom } = view.serializeForClipboard(doc.slice(starts[range.from], to));
  const lines: string[] = [];
  for (let i = range.from; i < range.to; i++) {
    const inline = new Slice(doc.child(i).content, 0, 0);
    lines.push(view.someProp("clipboardTextSerializer", (f) => f(inline, view)) ?? doc.child(i).textContent);
  }
  return { text: lines.join("\n"), html: dom.innerHTML };
}

function copyOrCut(view: EditorView, event: ClipboardEvent, cut: boolean, canEdit: () => boolean): boolean {
  const range = selectedLines(view.state);
  if (!range || !event.clipboardData) return false;
  event.preventDefault();
  const { text, html } = clipboardFor(view, range);
  event.clipboardData.clearData();
  event.clipboardData.setData("text/html", html);
  event.clipboardData.setData("text/plain", text);
  if (cut && canEdit()) view.dispatch(deleteLines(view.state, range));
  return true;
}

const MODIFIER_KEYS = new Set(["Shift", "Meta", "Control", "Alt", "CapsLock", "Fn"]);

/** Keys while blocks are selected. Returns true if the key was used or swallowed. */
export function handleSelectionKey(view: EditorView, event: KeyboardEvent, canEdit: () => boolean): boolean {
  const range = selectedLines(view.state);
  if (!range) return false;
  const { state, dispatch } = view;
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key;
  if (MODIFIER_KEYS.has(key)) return false;
  // Copy and cut go through the browser's events (copyOrCut)
  if (mod && (key === "c" || key === "x")) return false;
  if (mod) {
    dispatch(leave(state, range.from));
    return false;
  }
  const info = lineInfo(state);
  if (key === "Escape" || (key === "Enter" && !event.shiftKey && !event.altKey)) {
    dispatch(leave(state, range.from));
  } else if ((key === "ArrowUp" || key === "ArrowDown") && !event.altKey) {
    const dir = key === "ArrowUp" ? -1 : 1;
    const next = event.shiftKey ? extendRange(info.texts, info.hidden, range, dir) : moveRange(info.texts, info.hidden, range, dir);
    dispatch(selectLines(state, next));
  } else if (key === "Tab" && canEdit()) {
    const edits = indentPlan(info.texts, range.from, range.to - 1, event.shiftKey ? -1 : 1);
    if (edits) {
      const tr = state.tr;
      applyEdits(tr, readLines(state.doc), edits);
      dispatch(tr);
    }
  } else if ((key === "Backspace" || key === "Delete") && canEdit()) {
    dispatch(deleteLines(state, range));
  }
  // Everything else is swallowed: typing must never replace the selected blocks
  return true;
}

function buildDecorations(state: EditorState): DecorationSet {
  const range = selectedLines(state);
  if (!range) return DecorationSet.empty;
  const starts = lineStarts(state.doc);
  const decorations: Decoration[] = [];
  for (let i = range.from; i < range.to; i++) {
    decorations.push(Decoration.node(starts[i], starts[i] + state.doc.child(i).nodeSize, { class: "block-selected" }));
  }
  return DecorationSet.create(state.doc, decorations);
}

/** While blocks are selected: runs before every other editor key handler. */
export const BlockSelection = Extension.create<{ docState: ModeSource | null }>({
  name: "blockSelection",
  priority: 1000,

  addOptions() {
    return { docState: null };
  },

  addProseMirrorPlugins() {
    const canEdit = () => this.editor.isEditable && this.options.docState?.get("mode") !== "suggest";
    const clear = (view: EditorView) => {
      if (blockSelectionKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(blockSelectionKey, { clear: true } satisfies Meta));
    };
    return [
      new Plugin<SelectionState | null>({
        key: blockSelectionKey,
        state: {
          init: () => null,
          apply: (tr, old) => {
            const meta = tr.getMeta(blockSelectionKey) as Meta | undefined;
            if (meta) return "select" in meta ? meta.select : null;
            if (!old) return null;
            // The user put the caret somewhere else (a click, say)
            if (tr.selectionSet && !isRemote(tr)) return null;
            if (!tr.docChanged) return old;
            const from = tr.mapping.mapResult(old.from, 1);
            const to = tr.mapping.mapResult(old.to, -1);
            return to.pos > from.pos ? { from: from.pos, to: to.pos } : null;
          },
        },
        props: {
          decorations: buildDecorations,
          attributes: (state): Record<string, string> => (blockSelectionKey.getState(state) ? { class: "has-block-selection" } : {}),
          handleKeyDown: (view, event) => handleSelectionKey(view, event, canEdit),
          handleTextInput: (view) => !!blockSelectionKey.getState(view.state),
          handlePaste: (view) => !!blockSelectionKey.getState(view.state),
          handleDOMEvents: {
            beforeinput: (view, event) => {
              if (!blockSelectionKey.getState(view.state)) return false;
              event.preventDefault();
              return true;
            },
            copy: (view, event) => copyOrCut(view, event, false, canEdit),
            cut: (view, event) => copyOrCut(view, event, true, canEdit),
            mousedown: (view) => {
              clear(view);
              return false;
            },
            blur: (view) => {
              clear(view);
              return false;
            },
          },
        },
      }),
    ];
  },
});

/** Esc to select the caret's block: after every other editor key handler, so an open suggestion list closes first. */
export const BlockSelectionStart = Extension.create({
  name: "blockSelectionStart",
  priority: 1,

  addKeyboardShortcuts() {
    return {
      Escape: () => selectCaretBlock(this.editor.state, this.editor.view.dispatch),
    };
  },
});
