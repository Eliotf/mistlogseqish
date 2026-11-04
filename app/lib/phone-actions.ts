import type { Editor as TiptapEditor } from "@tiptap/core";
import { indentSelection } from "./bullet-editing";
import { cycleLines } from "./task-editing";
import { moveCaretBlock } from "./block-moving";
import { foldingKey, setFolded } from "./folding-editing";

/**
 * What the phone keyboard toolbar's buttons do (PRD F17). Each is the same
 * command as its keyboard shortcut, so the same rules apply (suggest mode,
 * zoom, read-only). Each returns whether it did anything.
 */

export type PhoneAction = "outdent" | "indent" | "task" | "link" | "up" | "down" | "fold" | "done";

/** Actions that change the outline: off in suggest mode, as their keys are. */
export const OUTLINE_ACTIONS: ReadonlySet<PhoneAction> = new Set(["outdent", "indent", "task", "up", "down", "fold"]);

/** Type text as the browser would, so the link extension's typing rules (auto-pairing `[[`) apply. */
function typeText(editor: TiptapEditor, text: string): void {
  const { view } = editor;
  for (const ch of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp("handleTextInput", (f) => f(view, from, to, ch, () => view.state.tr.insertText(ch, from, to)));
    if (!handled) view.dispatch(view.state.tr.insertText(ch, from, to));
  }
}

function caretLine(editor: TiptapEditor): number | null {
  const { $head } = editor.state.selection;
  return $head.depth === 1 ? $head.index(0) : null;
}

export function runPhoneAction(editor: TiptapEditor, action: PhoneAction, suggesting: boolean): boolean {
  if (!editor.isEditable) return false;
  if (suggesting && OUTLINE_ACTIONS.has(action)) return false;
  const { state, dispatch } = editor.view;
  switch (action) {
    case "outdent":
    case "indent":
      return indentSelection(state, dispatch, action === "indent" ? 1 : -1);
    case "task": {
      const first = state.selection.$from.index(0);
      const last = state.selection.$to.index(0);
      dispatch(cycleLines(state, Array.from({ length: last - first + 1 }, (_, k) => first + k)).scrollIntoView());
      return true;
    }
    case "up":
    case "down":
      return moveCaretBlock(state, dispatch, action === "up" ? -1 : 1);
    case "fold": {
      const line = caretLine(editor);
      if (line === null) return false;
      const folded = foldingKey.getState(state)?.collapsed[line] ?? false;
      return setFolded(state, dispatch, line, !folded);
    }
    case "link":
      typeText(editor, "[[");
      return true;
    case "done":
      editor.view.dom.blur();
      return true;
  }
}
