import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { applyEdits, readLines } from "./bullet-editing";
import { cyclePlan } from "./tasks";
import { parseLine, priorityAt } from "./note-parser";

/**
 * Tasks in the editor (PRD F6, F42). Cmd/Ctrl+Enter cycles the lines the
 * selection touches (tasks.ts: TODO -> DOING -> LATER -> NOW -> DONE).
 * Keywords and `[#A]`-style priorities are styled text, and a DONE line's
 * text is struck through; the text itself is never changed by styling.
 * Selected blocks cycle in block-selection.ts. In suggest mode the shortcut
 * does nothing (task changes as suggestions are part of F34).
 */

interface ModeSource {
  get: (key: string) => string | undefined;
}

/** Cycle the task keyword of lines `lines` (indexes). */
export function cycleLines(state: EditorState, lines: readonly number[]): Transaction {
  const read = readLines(state.doc);
  const tr = state.tr;
  applyEdits(tr, read, cyclePlan(read.texts, lines));
  return tr;
}

export const TaskEditing = Extension.create<{ docState: ModeSource | null }>({
  name: "taskEditing",

  addOptions() {
    return { docState: null };
  },

  addKeyboardShortcuts() {
    return {
      "Mod-Enter": () => {
        if (!this.editor.isEditable || this.editor.view.composing) return false;
        if (this.options.docState?.get("mode") === "suggest") return true;
        const { state, dispatch } = this.editor.view;
        const first = state.selection.$from.index(0);
        const last = state.selection.$to.index(0);
        const lines = Array.from({ length: last - first + 1 }, (_, k) => first + k);
        dispatch(cycleLines(state, lines).scrollIntoView());
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [taskDecorations()];
  },
});

const FENCE_RE = /^\t*(?:- )?```/;

/** Style task keywords and priorities, and strike through the text of DONE lines. */
export function taskDecorations(): Plugin {
  const key = new PluginKey<DecorationSet>("taskDecorations");
  const build = (doc: ProseMirrorNode): DecorationSet => {
    const decorations: Decoration[] = [];
    let inFence = false;
    doc.forEach((node, offset) => {
      const text = node.textContent;
      if (FENCE_RE.test(text)) {
        inFence = !inFence;
        return;
      }
      if (inFence) return;
      const shape = parseLine(text);
      if (!shape.task) return;
      const start = offset + 1;
      const kwStart = shape.bodyStart - shape.task.length - (text[shape.bodyStart - 1] === " " ? 1 : 0);
      decorations.push(Decoration.inline(start + kwStart, start + kwStart + shape.task.length, { class: `task-kw task-${shape.task.toLowerCase()}` }));
      if (shape.task === "DONE" && shape.bodyStart < text.length) {
        decorations.push(Decoration.inline(start + shape.bodyStart, start + text.length, { class: "task-done-text" }));
      }
      const priority = priorityAt(text);
      if (priority) {
        decorations.push(Decoration.inline(start + priority.at, start + priority.at + 4, { class: `task-priority task-priority-${priority.priority.toLowerCase()}` }));
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
