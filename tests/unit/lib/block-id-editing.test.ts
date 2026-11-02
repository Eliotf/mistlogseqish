// @vitest-environment jsdom
/**
 * Block IDs in the real editor with Yjs underneath, as in the app (PRD F41).
 * Keys go through ProseMirror's handleKeyDown, like a real keypress.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import * as Y from "yjs";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import Collaboration from "@tiptap/extension-collaboration";
import { TextSelection } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { BlockParagraph } from "~/lib/block-id-editing";
import { BulletEditing } from "~/lib/bullet-editing";
import { isBlockId } from "~/lib/block-ids";
import { linesFromProseMirror, linesFromYjs } from "~/lib/note-lines";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

/** A Yjs document with these lines; `null` IDs leave the line unlabelled. */
function docWith(lines: Array<[string, string | null]>): Y.Doc {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("default");
  for (const [text, id] of lines) {
    const p = new Y.XmlElement("paragraph");
    if (id) p.setAttribute("blockId", id);
    p.insert(0, [new Y.XmlText(text)]);
    frag.insert(frag.length, [p]);
  }
  return doc;
}

function makeEditor(doc: Y.Doc) {
  const modeMap = { get: () => "edit" };
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [Document, BlockParagraph, Text, Collaboration.configure({ document: doc }), BulletEditing.configure({ docState: modeMap })],
  });
  editors.push(editor);
  return editor;
}

function caret(editor: Editor, line: number, offset: number) {
  const starts: number[] = [];
  editor.state.doc.forEach((_n, pos) => starts.push(pos + 1));
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, starts[line] + offset)));
}

function press(editor: Editor, key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  editor.view.someProp("handleKeyDown", (f) => f(editor.view, event));
}

/** Each line's text and ID, from Yjs (what syncs and what the server sees). */
const lines = (doc: Y.Doc) => linesFromYjs(doc.getXmlFragment("default")).map((l) => [l.text, l.id ?? null]);

describe("block IDs in the editor", () => {
  it("splitting a line keeps its ID on the upper half and gives the lower half a new one", () => {
    const doc = docWith([["- hello world", A]]);
    const editor = makeEditor(doc);
    caret(editor, 0, 7);
    press(editor, "Enter");
    const [[upper, upperId], [lower, lowerId]] = lines(doc);
    expect([upper, upperId]).toEqual(["- hello", A]);
    expect(lower).toBe("-  world");
    expect(isBlockId(lowerId) && lowerId !== A).toBe(true);
  });

  it("Enter at the end of a line gives the new line below a new ID", () => {
    const doc = docWith([["- one", A]]);
    const editor = makeEditor(doc);
    caret(editor, 0, 5);
    press(editor, "Enter");
    const [[, first], [, second]] = lines(doc);
    expect(first).toBe(A);
    expect(isBlockId(second) && second !== A).toBe(true);
  });

  it("Enter before a line's text adds a new line above and the text keeps its ID", () => {
    const doc = docWith([["- text", A]]);
    const editor = makeEditor(doc);
    caret(editor, 0, 2);
    press(editor, "Enter");
    const [[aboveText, above], [text, id]] = lines(doc);
    expect([aboveText, text, id]).toEqual(["- ", "- text", A]);
    expect(isBlockId(above) && above !== A).toBe(true);
  });

  it("joining two lines keeps the upper line's ID", () => {
    const doc = docWith([["upper", A], ["lower", B]]);
    const editor = makeEditor(doc);
    caret(editor, 1, 0);
    editor.commands.joinBackward();
    expect(lines(doc)).toEqual([["upperlower", A]]);
  });

  it("never labels a line that was there before the edit, even one without an ID", () => {
    // The server labels those, so two tabs cannot label one line differently
    const doc = docWith([["old line", null], ["other", B]]);
    const editor = makeEditor(doc);
    caret(editor, 0, 8);
    editor.commands.insertContent("!");
    expect(lines(doc)).toEqual([["old line!", null], ["other", B]]);
  });

  it("splitting an unlabelled line labels only the new half", () => {
    const doc = docWith([["no id yet", null]]);
    const editor = makeEditor(doc);
    caret(editor, 0, 2);
    press(editor, "Enter");
    const [[, upper], [, lower]] = lines(doc);
    expect(upper).toBeNull();
    expect(isBlockId(lower)).toBe(true);
  });

  it("gives pasted lines new IDs, never the copied ones", () => {
    // jsdom has no ClipboardEvent, which ProseMirror's paste helpers create
    vi.stubGlobal("ClipboardEvent", class extends Event {});
    const doc = docWith([["target", A]]);
    const editor = makeEditor(doc);
    caret(editor, 0, 6);
    editor.view.pasteHTML(`<p data-block-id="${A}">pasted one</p><p data-block-id="${B}">pasted two</p>`);
    const result = lines(doc);
    const pastedIds = result.slice(1).map(([, id]) => id);
    expect(result[0][1]).toBe(A);
    expect(pastedIds.every((id) => isBlockId(id) && id !== A && id !== B)).toBe(true);
    expect(new Set(result.map(([, id]) => id)).size).toBe(result.length);
    vi.unstubAllGlobals();
  });

  it("leaves lines arriving from another tab alone", () => {
    const doc = docWith([["mine", A]]);
    const editor = makeEditor(doc);
    const tr = editor.state.tr.insert(editor.state.doc.content.size, editor.schema.nodes.paragraph.create(null, editor.schema.text("remote")));
    tr.setMeta(ySyncPluginKey, { isChangeOrigin: true });
    editor.view.dispatch(tr);
    expect(linesFromProseMirror(editor.state.doc).map((l) => l.id ?? null)).toEqual([A, null]);
  });

  it("shows the ID on the line's element and reads the same lines as the server", () => {
    const doc = docWith([["shown", A]]);
    const editor = makeEditor(doc);
    expect(editor.view.dom.querySelector("p")?.getAttribute("data-block-id")).toBe(A);
    expect(linesFromProseMirror(editor.state.doc)).toEqual(linesFromYjs(doc.getXmlFragment("default")));
  });
});
