// @vitest-environment jsdom
/**
 * Bullet keys on the real TipTap editor with Yjs underneath, as in the app.
 * Keys are delivered through ProseMirror's handleKeyDown, like a real keypress.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as Y from "yjs";
import { Editor, Mark } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Collaboration from "@tiptap/extension-collaboration";
import { TextSelection } from "@tiptap/pm/state";
import { BulletEditing } from "~/lib/bullet-editing";
import { CriticAddition, CriticDeletion, CriticComment } from "~/lib/critic-marks";
import { linesFromYjs } from "~/lib/note-lines";

// An inclusive mark (text typed at its edge joins it). Mist's own marks are all
// non-inclusive, so this is what proves inserted indentation never inherits a mark.
const Sticky = Mark.create({ name: "sticky", inclusive: true, renderHTML: () => ["span", { class: "sticky" }, 0] });

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
  const modeMap = { get: (key: string) => (key === "mode" ? mode : undefined) };
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [Document, Paragraph, Text, CriticAddition, CriticDeletion, CriticComment, Sticky, Collaboration.configure({ document: doc }), BulletEditing.configure({ docState: modeMap })],
  });
  editors.push(editor);
  return editor;
}

/** Put the caret on line `line` at `offset` (or select from one place to another). */
function caret(editor: Editor, line: number, offset: number, toLine = line, toOffset = offset) {
  const starts: number[] = [];
  editor.state.doc.forEach((_n, pos) => starts.push(pos + 1));
  const tr = editor.state.tr.setSelection(TextSelection.create(editor.state.doc, starts[line] + offset, starts[toLine] + toOffset));
  editor.view.dispatch(tr);
}

function press(editor: Editor, key: string, opts: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  return editor.view.someProp("handleKeyDown", (f) => f(editor.view, event)) ?? false;
}

const text = (doc: Y.Doc) => linesFromYjs(doc.getXmlFragment("default")).map((l) => l.text);

describe("bullet keys in the editor", () => {
  it("Tab indents the line and its children, and the stored text uses tabs", () => {
    const doc = docWith(["- a", "- b", "\t- b1", "- c"]);
    const editor = makeEditor(doc);
    caret(editor, 1, 3);
    expect(press(editor, "Tab")).toBe(true);
    expect(text(doc)).toEqual(["- a", "\t- b", "\t\t- b1", "- c"]);
  });

  it("Shift+Tab outdents the line and its children", () => {
    const doc = docWith(["- a", "\t- b", "\t\t- b1"]);
    const editor = makeEditor(doc);
    caret(editor, 1, 4);
    press(editor, "Tab", { shiftKey: true });
    expect(text(doc)).toEqual(["- a", "- b", "\t- b1"]);
  });

  it("keeps the caret on the same text after indenting", () => {
    const doc = docWith(["- a", "- hello"]);
    const editor = makeEditor(doc);
    caret(editor, 1, 4); // after "he"
    press(editor, "Tab");
    expect(editor.state.selection.$from.parentOffset).toBe(5);
  });

  it("Tab keeps focus in the editor even when the line cannot indent", () => {
    const doc = docWith(["- first"]);
    const editor = makeEditor(doc);
    caret(editor, 0, 2);
    expect(press(editor, "Tab")).toBe(true);
    expect(text(doc)).toEqual(["- first"]);
  });

  it("Tab indents every selected line", () => {
    const doc = docWith(["- a", "- b", "- c", "- d"]);
    const editor = makeEditor(doc);
    caret(editor, 1, 2, 2, 2);
    press(editor, "Tab");
    expect(text(doc)).toEqual(["- a", "\t- b", "\t- c", "- d"]);
  });

  it("Enter continues a bullet at the same level and moves the rest of the text", () => {
    const doc = docWith(["\t- hello world"]);
    const editor = makeEditor(doc);
    caret(editor, 0, 8);
    expect(press(editor, "Enter")).toBe(true);
    expect(text(doc)).toEqual(["\t- hello", "\t-  world"]);
    expect(editor.state.selection.$from.parentOffset).toBe(3);
  });

  it("Enter at the end of a line with children starts its first child", () => {
    const doc = docWith(["- parent", "\t- child"]);
    const editor = makeEditor(doc);
    caret(editor, 0, 8);
    press(editor, "Enter");
    expect(text(doc)).toEqual(["- parent", "\t- ", "\t- child"]);
  });

  it("Enter on an empty nested bullet outdents it, and at the top level ends the list", () => {
    const doc = docWith(["- a", "\t- "]);
    const editor = makeEditor(doc);
    caret(editor, 1, 3);
    press(editor, "Enter");
    expect(text(doc)).toEqual(["- a", "- "]);
    caret(editor, 1, 2);
    press(editor, "Enter");
    expect(text(doc)).toEqual(["- a", ""]);
  });

  it("Enter with the caret before the content adds an empty bullet above", () => {
    const doc = docWith(["- item"]);
    const editor = makeEditor(doc);
    caret(editor, 0, 2);
    press(editor, "Enter");
    expect(text(doc)).toEqual(["- ", "- item"]);
  });

  it("Enter on a plain line is left to the editor's normal split, adding no bullet", () => {
    const doc = docWith(["plain text"]);
    const editor = makeEditor(doc);
    caret(editor, 0, 5);
    press(editor, "Enter");
    expect(text(doc)).toEqual(["plain", " text"]);
  });

  it("Backspace right after the bullet outdents, then removes the bullet", () => {
    const doc = docWith(["- a", "\t- b"]);
    const editor = makeEditor(doc);
    caret(editor, 1, 3);
    press(editor, "Backspace");
    expect(text(doc)).toEqual(["- a", "- b"]);
    expect(editor.state.selection.$from.parentOffset).toBe(2);
    press(editor, "Backspace");
    expect(text(doc)).toEqual(["- a", "b"]);
    expect(editor.state.selection.$from.parentOffset).toBe(0);
  });

  it("Backspace elsewhere is left to the editor", () => {
    const doc = docWith(["- item"]);
    const editor = makeEditor(doc);
    caret(editor, 0, 4);
    expect(press(editor, "Backspace")).toBe(false);
  });

  it("keeps marks on text that moves to a new bullet", () => {
    const doc = docWith(["- keep suggested"]);
    const editor = makeEditor(doc);
    const start = 1;
    editor.view.dispatch(editor.state.tr.addMark(start + 7, start + 16, editor.schema.marks.criticAddition.create()));
    caret(editor, 0, 7);
    press(editor, "Enter");
    const second = editor.state.doc.child(1);
    expect(second.textContent).toBe("- suggested");
    let marked = "";
    second.forEach((n) => {
      if (n.marks.some((m) => m.type.name === "criticAddition")) marked += n.text;
    });
    expect(marked).toBe("suggested");
  });

  it("never gives inserted indentation a mark from the text after it", () => {
    const doc = docWith(["- a", "- b"]);
    const editor = makeEditor(doc);
    const lineStart = editor.state.doc.child(0).nodeSize + 1;
    editor.view.dispatch(editor.state.tr.addMark(lineStart, lineStart + 3, editor.schema.marks.sticky.create()));
    caret(editor, 1, 3);
    press(editor, "Tab");
    const first = editor.state.doc.child(1).firstChild!;
    expect(first.text?.startsWith("\t")).toBe(true);
    expect(first.marks).toEqual([]);
  });

  it("undoes an indent in one step", () => {
    const doc = docWith(["- a", "- b", "\t- b1"]);
    const editor = makeEditor(doc);
    caret(editor, 1, 3);
    press(editor, "Tab");
    expect(text(doc)).toEqual(["- a", "\t- b", "\t\t- b1"]);
    editor.commands.undo();
    expect(text(doc)).toEqual(["- a", "- b", "\t- b1"]);
  });

  it("merges two people indenting different lines at the same time", () => {
    const a = docWith(["- one", "- two", "- three", "- four"]);
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    const ea = makeEditor(a);
    const eb = makeEditor(b);
    caret(ea, 1, 2);
    press(ea, "Tab");
    caret(eb, 3, 2);
    press(eb, "Tab");
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(text(a)).toEqual(["- one", "\t- two", "- three", "\t- four"]);
    expect(text(b)).toEqual(text(a));
  });

  it("does nothing special in suggest mode, but Tab stays in the editor", () => {
    const doc = docWith(["- a", "- b"]);
    const editor = makeEditor(doc, "suggest");
    caret(editor, 1, 3);
    expect(press(editor, "Tab")).toBe(true);
    expect(text(doc)).toEqual(["- a", "- b"]);
    // Enter splits normally: no bullet continued
    press(editor, "Enter");
    expect(text(doc)).toEqual(["- a", "- b", ""]);
    // Backspace right after a bullet does not remove the bullet. (Deleting the
    // character itself is done by the browser, which jsdom does not emulate.)
    caret(editor, 1, 2);
    press(editor, "Backspace");
    expect(text(doc)).toEqual(["- a", "- b", ""]);
  });
});

describe("bullet display", () => {
  it("draws bullets as dots and tabs as indent guides, without changing the text", () => {
    const doc = docWith(["- top", "\t- nested", "plain", "```", "- in code", "```"]);
    const editor = makeEditor(doc);
    const dom = editor.view.dom;
    expect([...dom.querySelectorAll(".md-bullet")].map((n) => n.textContent)).toEqual(["-", "-"]);
    expect(dom.querySelectorAll(".md-indent")).toHaveLength(1);
    expect(text(doc)).toEqual(["- top", "\t- nested", "plain", "```", "- in code", "```"]);
  });
});
