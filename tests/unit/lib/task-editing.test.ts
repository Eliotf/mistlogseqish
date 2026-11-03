// @vitest-environment jsdom
/**
 * Tasks in the real editor with Yjs underneath (PRD F6, F42).
 * Keys go through ProseMirror's handleKeyDown, like a real keypress.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as Y from "yjs";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import Collaboration from "@tiptap/extension-collaboration";
import { TextSelection } from "@tiptap/pm/state";
import { BlockParagraph } from "~/lib/block-id-editing";
import { BulletEditing } from "~/lib/bullet-editing";
import { TaskEditing } from "~/lib/task-editing";
import { BlockSelection, BlockSelectionStart, selectedLines } from "~/lib/block-selection";
import { linesFromYjs } from "~/lib/note-lines";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

function docWith(lines: string[]): Y.Doc {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("default");
  for (const text of lines) {
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [new Y.XmlText(text)]);
    frag.insert(frag.length, [p]);
  }
  return doc;
}

function makeEditor(doc: Y.Doc, mode: "edit" | "suggest" = "edit") {
  const docState = { get: (key: string) => (key === "mode" ? mode : undefined) };
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      Document,
      BlockParagraph,
      Text,
      Collaboration.configure({ document: doc }),
      BulletEditing.configure({ docState }),
      TaskEditing.configure({ docState }),
      BlockSelection.configure({ docState }),
      BlockSelectionStart,
    ],
  });
  editors.push(editor);
  return editor;
}

function select(editor: Editor, line: number, offset: number, toLine = line, toOffset = offset) {
  const starts: number[] = [];
  editor.state.doc.forEach((_n, pos) => starts.push(pos + 1));
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, starts[line] + offset, starts[toLine] + toOffset)));
}

function press(editor: Editor, key: string, opts: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  return editor.view.someProp("handleKeyDown", (f) => f(editor.view, event)) ?? false;
}

const mod = { ctrlKey: true };
const texts = (doc: Y.Doc) => linesFromYjs(doc.getXmlFragment("default")).map((l) => l.text);

describe("tasks in the editor", () => {
  it("Mod+Enter starts a TODO and cycles it round, keeping the caret's place in the text", () => {
    const doc = docWith(["- buy milk"]);
    const editor = makeEditor(doc);
    select(editor, 0, 6);
    const seen: string[] = [];
    for (let i = 0; i < 4; i++) {
      expect(press(editor, "Enter", mod)).toBe(true);
      seen.push(texts(doc)[0]);
    }
    expect(seen).toEqual(["- TODO buy milk", "- DOING buy milk", "- DONE buy milk", "- buy milk"]);
    expect(editor.state.selection.$head.parentOffset).toBe(6);
  });

  it("cycles LATER -> NOW -> DONE", () => {
    const doc = docWith(["- LATER read"]);
    const editor = makeEditor(doc);
    select(editor, 0, 9);
    press(editor, "Enter", mod);
    press(editor, "Enter", mod);
    expect(texts(doc)).toEqual(["- DONE read"]);
  });

  it("cycles every line a text selection touches, each from its own state", () => {
    const doc = docWith(["- a", "- TODO b", "- c"]);
    const editor = makeEditor(doc);
    select(editor, 0, 2, 1, 4);
    press(editor, "Enter", mod);
    expect(texts(doc)).toEqual(["- TODO a", "- DOING b", "- c"]);
  });

  it("on selected blocks, cycles only their top lines, and keeps them selected", () => {
    const doc = docWith(["- a", "\t- child", "- TODO b", "- c"]);
    const editor = makeEditor(doc);
    select(editor, 0, 2);
    press(editor, "Escape");
    press(editor, "ArrowDown", { shiftKey: true });
    press(editor, "Enter", mod);
    expect(texts(doc)).toEqual(["- TODO a", "\t- child", "- DOING b", "- c"]);
    expect(selectedLines(editor.state)).toEqual({ from: 0, to: 3 });
  });

  it("does nothing in suggest mode or a read-only editor", () => {
    const suggesting = docWith(["- a"]);
    const a = makeEditor(suggesting, "suggest");
    select(a, 0, 2);
    expect(press(a, "Enter", mod)).toBe(true);
    expect(texts(suggesting)).toEqual(["- a"]);

    const readOnly = docWith(["- a", "- b"]);
    const b = makeEditor(readOnly);
    select(b, 0, 2);
    press(b, "Escape");
    b.setEditable(false);
    press(b, "Enter", mod);
    expect(texts(readOnly)).toEqual(["- a", "- b"]);
  });

  it("styles keywords and priorities, and strikes through done text, without changing it", () => {
    const editor = makeEditor(docWith(["- NOW [#A] urgent `[#B]`", "- DONE shipped", "- LATER someday", "- not a task [#A]"]));
    const cls = (sel: string) => [...editor.view.dom.querySelectorAll(sel)].map((e) => e.textContent);
    expect(cls(".task-kw")).toEqual(["NOW", "DONE", "LATER"]);
    expect(cls(".task-now")).toEqual(["NOW"]);
    expect(cls(".task-later")).toEqual(["LATER"]);
    expect(cls(".task-priority-a")).toEqual(["[#A]"]);
    expect(cls(".task-done-text")).toEqual(["shipped"]);
    expect(editor.state.doc.child(0).textContent).toBe("- NOW [#A] urgent `[#B]`");
  });

  it("does not style keywords inside a code fence", () => {
    const editor = makeEditor(docWith(["- ```", "TODO not a task", "- ```", "TODO real"]));
    expect([...editor.view.dom.querySelectorAll(".task-kw")].map((e) => e.textContent)).toEqual(["TODO"]);
  });
});
