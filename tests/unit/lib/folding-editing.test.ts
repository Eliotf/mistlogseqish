// @vitest-environment jsdom
/**
 * Folding in the real editor with Yjs underneath, as in the app (PRD F37).
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
import { Folding } from "~/lib/folding-editing";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

function docWith(lines: Array<string | [string, { collapsed: true }]>): Y.Doc {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("default");
  for (const line of lines) {
    const [text, attrs] = typeof line === "string" ? [line, null] : line;
    const p = new Y.XmlElement("paragraph");
    if (attrs) p.setAttribute("collapsed", true as unknown as string);
    p.insert(0, [new Y.XmlText(text)]);
    frag.insert(frag.length, [p]);
  }
  return doc;
}

function makeEditor(doc: Y.Doc, mode: "edit" | "suggest" = "edit") {
  const docState = { get: (key: string) => (key === "mode" ? mode : undefined) };
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [Document, BlockParagraph, Text, Collaboration.configure({ document: doc }), BulletEditing.configure({ docState }), Folding.configure({ docState })],
  });
  editors.push(editor);
  return editor;
}

function starts(editor: Editor): number[] {
  const result: number[] = [];
  editor.state.doc.forEach((_n, pos) => result.push(pos + 1));
  return result;
}

function caret(editor: Editor, line: number, offset: number) {
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, starts(editor)[line] + offset)));
}

function caretAt(editor: Editor): [number, number] {
  const { $head } = editor.state.selection;
  return [$head.index(0), $head.parentOffset];
}

function press(editor: Editor, key: string, opts: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...opts });
  return editor.view.someProp("handleKeyDown", (f) => f(editor.view, event)) ?? false;
}

// TipTap's "Mod" is Cmd on a Mac and Ctrl elsewhere; jsdom is not a Mac
const mod = { ctrlKey: true };

const folded = (doc: Y.Doc) => (doc.getXmlFragment("default").toArray() as Y.XmlElement[]).map((p) => p.getAttribute("collapsed") ?? null);
const texts = (doc: Y.Doc) => (doc.getXmlFragment("default").toArray() as Y.XmlElement[]).map((p) => (p.get(0) as Y.XmlText | undefined)?.toString() ?? "");
const hiddenInDom = (editor: Editor) => [...editor.view.dom.querySelectorAll("p")].map((p) => p.classList.contains("fold-hidden"));

const PAGE = ["- parent", "\t- child", "\t\t- grandchild", "- sibling"];

describe("folding in the editor", () => {
  it("Mod+↑ folds the caret's line into the page; Mod+↓ unfolds it", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    caret(editor, 0, 4);
    expect(press(editor, "ArrowUp", mod)).toBe(true);
    expect(folded(doc)).toEqual([true, null, null, null]);
    expect(hiddenInDom(editor)).toEqual([false, true, true, false]);
    expect(editor.view.dom.querySelector("p")?.classList.contains("is-folded")).toBe(true);

    expect(press(editor, "ArrowDown", mod)).toBe(true);
    expect(folded(doc)).toEqual([null, null, null, null]);
    expect(hiddenInDom(editor)).toEqual([false, false, false, false]);
  });

  it("leaves Mod+↑ / Mod+↓ to the browser on a line with nothing to fold or unfold", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    caret(editor, 3, 2);
    expect(press(editor, "ArrowUp", mod)).toBe(false);
    expect(press(editor, "ArrowDown", mod)).toBe(false);
    expect(folded(doc)).toEqual([null, null, null, null]);
  });

  it("shows an arrow on lines with children that folds and unfolds on click", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    const arrows = () => [...editor.view.dom.querySelectorAll<HTMLElement>(".fold-toggle")];
    expect(arrows().map((a) => a.getAttribute("aria-expanded"))).toEqual(["true", "true"]);
    arrows()[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(folded(doc)).toEqual([true, null, null, null]);
    expect(arrows().map((a) => [a.getAttribute("aria-expanded"), a.getAttribute("aria-label")])).toEqual([["false", "Unfold"]]);
    arrows()[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(folded(doc)).toEqual([null, null, null, null]);
  });

  it("does not fold in a read-only editor", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    editor.setEditable(false);
    caret(editor, 0, 4);
    expect(press(editor, "ArrowUp", mod)).toBe(false);
    editor.view.dom.querySelector(".fold-toggle")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(folded(doc)).toEqual([null, null, null, null]);
  });

  it("keeps folds out of undo", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    caret(editor, 3, 9);
    editor.commands.insertContent("!");
    caret(editor, 0, 4);
    press(editor, "ArrowUp", mod);
    editor.commands.undo();
    expect(texts(doc)[3]).toBe("- sibling");
    expect(folded(doc)[0]).toBe(true);
  });

  it("moves the caret past folded children, the way it was going", () => {
    const doc = docWith([["- parent", { collapsed: true }], "\t- child", "- sibling"]);
    const editor = makeEditor(doc);
    caret(editor, 0, 8);
    caret(editor, 1, 0); // e.g. ArrowDown from the end of "parent"
    expect(caretAt(editor)).toEqual([2, 0]);
    caret(editor, 1, 3); // e.g. ArrowUp from "sibling"
    expect(caretAt(editor)).toEqual([0, 8]);
  });

  it("moves the caret to the folded line when a fold hides it, and stays folded", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    caret(editor, 2, 5);
    editor.view.dom.querySelector<HTMLElement>(".fold-toggle")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    expect(folded(doc)[0]).toBe(true);
    expect(caretAt(editor)).toEqual([0, 8]);
  });

  it("moves the caret, without unfolding, when another tab folds the block it is in", () => {
    const doc = docWith(PAGE);
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
    doc.on("update", (u: Uint8Array, origin: unknown) => origin !== "remote" && Y.applyUpdate(other, u, "remote"));
    other.on("update", (u: Uint8Array, origin: unknown) => origin !== "remote" && Y.applyUpdate(doc, u, "remote"));
    const editor = makeEditor(doc);
    caret(editor, 1, 4);
    (other.getXmlFragment("default").get(0) as Y.XmlElement).setAttribute("collapsed", true as unknown as string);
    expect(folded(doc)[0]).toBe(true);
    expect(folded(other)[0]).toBe(true);
    expect(caretAt(editor)).toEqual([0, 8]);
  });

  it("unfolds a block when this tab's edit leaves the caret inside it", () => {
    // Tab on the line after a folded block makes it a hidden child
    const doc = docWith([["- parent", { collapsed: true }], "\t- child", "- moved in"]);
    const editor = makeEditor(doc);
    caret(editor, 2, 4);
    press(editor, "Tab");
    expect(texts(doc)[2]).toBe("\t- moved in");
    expect(folded(doc)[0]).toBeNull();
    expect(caretAt(editor)[0]).toBe(2);
    expect(hiddenInDom(editor)).toEqual([false, false, false]);
  });

  it("Enter at the end of a folded line adds a sibling after its hidden children", () => {
    const doc = docWith([["\t- parent", { collapsed: true }], "\t\t- child", "\t\t\t- grandchild", "- after"]);
    const editor = makeEditor(doc);
    caret(editor, 0, 9);
    press(editor, "Enter");
    expect(texts(doc)).toEqual(["\t- parent", "\t\t- child", "\t\t\t- grandchild", "\t- ", "- after"]);
    expect(caretAt(editor)).toEqual([3, 3]);
    expect(folded(doc)).toEqual([true, null, null, null, null]);
  });

  it("Enter elsewhere on a folded line is the normal bullet Enter", () => {
    const doc = docWith([["- parent", { collapsed: true }], "\t- child"]);
    const editor = makeEditor(doc);
    caret(editor, 0, 2);
    press(editor, "Enter");
    expect(texts(doc)).toEqual(["- ", "- parent", "\t- child"]);
  });

  it("pasted lines arrive unfolded", () => {
    const doc = docWith(["- target"]);
    const editor = makeEditor(doc);
    caret(editor, 0, 8);
    editor.commands.insertContent('<p>first</p><p collapsed="true">- pasted</p><p>\t- child</p><p>last</p>');
    expect(texts(doc)).toContain("- pasted");
    expect(folded(doc).every((f) => f === null)).toBe(true);
  });
});
