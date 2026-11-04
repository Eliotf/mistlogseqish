// @vitest-environment jsdom
/**
 * The phone toolbar's actions on the real editor with Yjs underneath (PRD F17).
 * Each must do exactly what its keyboard shortcut does.
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
import { Folding } from "~/lib/folding-editing";
import { BlockMoving } from "~/lib/block-moving";
import { Wikilink } from "~/lib/wikilink-editing";
import { runPhoneAction } from "~/lib/phone-actions";
import { linesFromYjs } from "~/lib/note-lines";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

function setup(lines: string[]) {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("default");
  for (const text of lines) {
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [new Y.XmlText(text)]);
    frag.insert(frag.length, [p]);
  }
  const docState = { get: () => "edit" };
  const titles = { get: () => undefined, request: () => {}, subscribe: () => () => {} };
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      Document,
      BlockParagraph,
      Text,
      Collaboration.configure({ document: doc }),
      BulletEditing.configure({ docState }),
      TaskEditing.configure({ docState }),
      Folding.configure({ docState }),
      BlockMoving.configure({ docState }),
      Wikilink.configure({ titles, docState, search: async () => [] }),
    ],
  });
  editors.push(editor);
  return { doc, editor };
}

function caret(editor: Editor, line: number, offset: number) {
  const starts: number[] = [];
  editor.state.doc.forEach((_n, pos) => starts.push(pos + 1));
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, starts[line] + offset)));
}

const texts = (doc: Y.Doc) => linesFromYjs(doc.getXmlFragment("default")).map((l) => l.text);
const folded = (doc: Y.Doc) => (doc.getXmlFragment("default").toArray() as Y.XmlElement[]).map((p) => p.getAttribute("collapsed") ?? null);

describe("phone toolbar actions", () => {
  it("indent and outdent, as Tab and Shift+Tab", () => {
    const { doc, editor } = setup(["- a", "- b"]);
    caret(editor, 1, 3);
    expect(runPhoneAction(editor, "indent", false)).toBe(true);
    expect(texts(doc)).toEqual(["- a", "\t- b"]);
    runPhoneAction(editor, "outdent", false);
    expect(texts(doc)).toEqual(["- a", "- b"]);
  });

  it("task cycles the caret's line, as Cmd/Ctrl+Enter", () => {
    const { doc, editor } = setup(["- a"]);
    caret(editor, 0, 3);
    runPhoneAction(editor, "task", false);
    runPhoneAction(editor, "task", false);
    expect(texts(doc)).toEqual(["- DOING a"]);
  });

  it("up and down move the caret's block, as Alt+Shift+↑/↓", () => {
    const { doc, editor } = setup(["- a", "- b", "\t- b1"]);
    caret(editor, 1, 3);
    runPhoneAction(editor, "up", false);
    expect(texts(doc)).toEqual(["- b", "\t- b1", "- a"]);
    runPhoneAction(editor, "down", false);
    expect(texts(doc)).toEqual(["- a", "- b", "\t- b1"]);
  });

  it("fold folds the caret's line, and unfolds it the second time", () => {
    const { doc, editor } = setup(["- a", "\t- a1"]);
    caret(editor, 0, 3);
    expect(runPhoneAction(editor, "fold", false)).toBe(true);
    expect(folded(doc)).toEqual([true, null]);
    runPhoneAction(editor, "fold", false);
    expect(folded(doc)).toEqual([null, null]);
  });

  it("link types [[ as a keyboard would, so the brackets pair up around the caret", () => {
    const { doc, editor } = setup(["- see "]);
    caret(editor, 0, 6);
    runPhoneAction(editor, "link", false);
    expect(texts(doc)).toEqual(["- see [[]]"]);
    expect(editor.state.selection.$head.parentOffset).toBe(8);
  });

  it("done takes focus away, closing the keyboard", () => {
    const { editor } = setup(["- a"]);
    editor.view.focus();
    expect(document.activeElement).toBe(editor.view.dom);
    runPhoneAction(editor, "done", false);
    expect(document.activeElement).not.toBe(editor.view.dom);
  });

  it("changes no outline in suggest mode or a read-only editor, but links still work in suggest mode", () => {
    const { doc, editor } = setup(["- a", "- b"]);
    caret(editor, 1, 3);
    for (const action of ["indent", "outdent", "task", "up", "down", "fold"] as const) expect(runPhoneAction(editor, action, true)).toBe(false);
    expect(texts(doc)).toEqual(["- a", "- b"]);
    expect(runPhoneAction(editor, "link", true)).toBe(true);
    editor.setEditable(false);
    expect(runPhoneAction(editor, "indent", false)).toBe(false);
  });
});
