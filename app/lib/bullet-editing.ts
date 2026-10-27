import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { backspacePlan, bulletContentStart, enterPlan, indentOf, indentPlan, type PrefixEdit } from "./bullets";

/**
 * Logseq-style bullet keys and bullet display for Mist's editor (PRD F7).
 * The logic lives in bullets.ts; this applies it to the ProseMirror doc,
 * where each top-level paragraph is one line. Changes go through
 * transactions, so they sync over Yjs and undo normally.
 *
 * In suggest mode these keys do nothing special (Tab stays in the editor),
 * because indentation changes do not fit CriticMarkup suggestions yet.
 */

interface ModeSource {
  get: (key: string) => string | undefined;
}

interface Lines {
  texts: string[];
  /** Position where each line's text starts. */
  starts: number[];
}

function readLines(doc: ProseMirrorNode): Lines {
  const texts: string[] = [];
  const starts: number[] = [];
  doc.forEach((node, offset) => {
    texts.push(node.textContent);
    starts.push(offset + 1);
  });
  return { texts, starts };
}

/** Apply prefix edits, last line first so earlier positions stay valid. Inserted text never carries marks. */
function applyEdits(tr: Transaction, lines: Lines, edits: PrefixEdit[]): void {
  for (const edit of [...edits].sort((a, b) => b.line - a.line)) {
    const from = lines.starts[edit.line] + edit.from;
    const to = lines.starts[edit.line] + edit.to;
    if (edit.text) tr.replaceWith(from, to, tr.doc.type.schema.text(edit.text));
    else tr.delete(from, to);
  }
}

function caretLine(state: EditorState): { index: number; offset: number } | null {
  const { $from, empty } = state.selection;
  if (!empty || $from.depth !== 1) return null;
  return { index: $from.index(0), offset: $from.parentOffset };
}

/** Indent or outdent the lines the selection touches. Returns false if nothing could move. */
export function indentSelection(state: EditorState, dispatch: ((tr: Transaction) => void) | undefined, dir: 1 | -1): boolean {
  const lines = readLines(state.doc);
  const first = state.selection.$from.index(0);
  const last = state.selection.$to.index(0);
  const edits = indentPlan(lines.texts, first, last, dir);
  if (!edits) return false;
  if (dispatch) {
    const tr = state.tr;
    applyEdits(tr, lines, edits);
    dispatch(tr.scrollIntoView());
  }
  return true;
}

function handleEnter(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const caret = caretLine(state);
  if (!caret) return false;
  const lines = readLines(state.doc);
  const plan = enterPlan(lines.texts, caret.index, caret.offset);
  if (!plan) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  const schema = state.schema;
  if (plan.kind === "edits") {
    applyEdits(tr, lines, plan.edits);
    const start = readLines(tr.doc).starts[plan.caretLine];
    tr.setSelection(TextSelection.create(tr.doc, start + plan.caretOffset));
  } else if (plan.kind === "above") {
    const lineStart = lines.starts[caret.index] - 1;
    tr.insert(lineStart, schema.nodes.paragraph.create(null, schema.text(plan.text)));
  } else {
    // Split with ProseMirror so text moving to the new line keeps its marks
    const pos = lines.starts[caret.index] + caret.offset;
    tr.split(pos);
    const newStart = pos + 2;
    tr.insert(newStart, schema.text(plan.prefix));
    tr.setSelection(TextSelection.create(tr.doc, newStart + plan.prefix.length));
  }
  dispatch(tr.scrollIntoView());
  return true;
}

function handleBackspace(state: EditorState, dispatch?: (tr: Transaction) => void): boolean {
  const caret = caretLine(state);
  if (!caret) return false;
  const lines = readLines(state.doc);
  const plan = backspacePlan(lines.texts, caret.index, caret.offset);
  if (!plan) return false;
  if (!dispatch) return true;
  const tr = state.tr;
  applyEdits(tr, lines, plan.edits);
  const start = readLines(tr.doc).starts[caret.index];
  tr.setSelection(TextSelection.create(tr.doc, start + plan.caretOffset));
  dispatch(tr.scrollIntoView());
  return true;
}

export const BulletEditing = Extension.create<{ docState: ModeSource | null }>({
  name: "bulletEditing",

  addOptions() {
    return { docState: null };
  },

  addKeyboardShortcuts() {
    const suggesting = () => this.options.docState?.get("mode") === "suggest";
    const composing = () => this.editor.view.composing;
    const run = (fn: (state: EditorState, dispatch?: (tr: Transaction) => void) => boolean) => () => {
      if (composing()) return false;
      return fn(this.editor.state, this.editor.view.dispatch);
    };
    return {
      // Tab is always kept in the editor; it only indents outside suggest mode
      Tab: () => {
        if (composing()) return false;
        if (!suggesting()) indentSelection(this.editor.state, this.editor.view.dispatch, 1);
        return true;
      },
      "Shift-Tab": () => {
        if (composing()) return false;
        if (!suggesting()) indentSelection(this.editor.state, this.editor.view.dispatch, -1);
        return true;
      },
      Enter: () => (suggesting() ? false : run(handleEnter)()),
      Backspace: () => (suggesting() ? false : run(handleBackspace)()),
    };
  },

  addProseMirrorPlugins() {
    return [bulletDecorations()];
  },
});

const FENCE_RE = /^\t*(?:- )?```/;

/**
 * Show indentation and bullets the Logseq way without changing the text:
 * each leading tab is a fixed-width indent with a faint guide, and a
 * bullet's "-" is drawn as a dot. Code fences are left alone.
 */
export function bulletDecorations(): Plugin {
  const key = new PluginKey<DecorationSet>("bulletDecorations");
  const build = (doc: ProseMirrorNode): DecorationSet => {
    const decorations: Decoration[] = [];
    let inFence = false;
    doc.forEach((node, offset) => {
      const text = node.textContent;
      const start = offset + 1;
      if (FENCE_RE.test(text)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;
      const indent = indentOf(text);
      for (let i = 0; i < indent; i++) {
        decorations.push(Decoration.inline(start + i, start + i + 1, { class: "md-indent" }));
      }
      if (bulletContentStart(text) !== null) {
        decorations.push(Decoration.inline(start + indent, start + indent + 1, { class: "md-bullet" }));
      }
    });
    return DecorationSet.create(doc, decorations);
  };
  return new Plugin({
    key,
    state: {
      init: (_, state) => build(state.doc),
      apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
    },
    props: {
      decorations: (state) => key.getState(state),
    },
  });
}
