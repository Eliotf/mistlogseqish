// @vitest-environment jsdom
/**
 * Zooming into a block in the real editor with Yjs underneath (PRD F40).
 * Keys go through ProseMirror's handleKeyDown, like a real keypress.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as Y from "yjs";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import Collaboration from "@tiptap/extension-collaboration";
import { TextSelection } from "@tiptap/pm/state";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { BlockParagraph } from "~/lib/block-id-editing";
import { BulletEditing } from "~/lib/bullet-editing";
import { Folding } from "~/lib/folding-editing";
import { BlockMoving } from "~/lib/block-moving";
import { BlockSelection, BlockSelectionStart, selectedLines } from "~/lib/block-selection";
import { Zoom, ZOOM_EVENT, setZoom, zoomOf, type ZoomDetail } from "~/lib/zoom-editing";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Lines get IDs 1, 2, 3... in order; `folded` lines get collapsed: true. */
function docWith(lines: string[], folded: number[] = []): Y.Doc {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("default");
  lines.forEach((text, i) => {
    const p = new Y.XmlElement("paragraph");
    p.setAttribute("blockId", id(i + 1));
    if (folded.includes(i)) p.setAttribute("collapsed", true as unknown as string);
    p.insert(0, [new Y.XmlText(text)]);
    frag.insert(frag.length, [p]);
  });
  return doc;
}

function makeEditor(doc: Y.Doc, zoom: string | null = null) {
  const docState = { get: (key: string) => (key === "mode" ? "edit" : undefined) };
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      Document,
      BlockParagraph,
      Text,
      Collaboration.configure({ document: doc }),
      BulletEditing.configure({ docState }),
      Folding.configure({ docState }),
      BlockMoving.configure({ docState }),
      BlockSelection.configure({ docState }),
      BlockSelectionStart,
      Zoom,
    ],
  });
  editors.push(editor);
  editor.view.dispatch(setZoom(editor.state, zoom));
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

/** The zoom requests the editor sends while `fn` runs. */
function zoomRequests(editor: Editor, fn: () => void): Array<string | null> {
  const seen: Array<string | null> = [];
  const listen = (e: Event) => seen.push((e as CustomEvent<ZoomDetail>).detail.blockId);
  editor.view.dom.addEventListener(ZOOM_EVENT, listen);
  fn();
  editor.view.dom.removeEventListener(ZOOM_EVENT, listen);
  return seen;
}

const texts = (doc: Y.Doc) => (doc.getXmlFragment("default").toArray() as Y.XmlElement[]).map((p) => (p.get(0) as Y.XmlText | undefined)?.toString() ?? "");
const shown = (editor: Editor) => [...editor.view.dom.querySelectorAll("p")].map((p, i) => (p.classList.contains("zoom-hidden") || p.classList.contains("fold-hidden") ? null : i)).filter((i) => i !== null);

// Zooming into "b" (ID 4) shows lines 3..5
const PAGE = ["- a", "\t- a1", "\t- a2", "\t- b", "\t\t- b1", "\t\t- b2", "\t- c", "- d"];
const B = id(4);

describe("zooming in the editor", () => {
  it("shows only the zoomed block and its children; null shows the whole page", () => {
    const editor = makeEditor(docWith(PAGE), B);
    expect(shown(editor)).toEqual([3, 4, 5]);
    expect(editor.view.dom.classList.contains("is-zoomed")).toBe(true);
    // Drawn flush left: the zoomed block's own indent (one tab) takes no space
    expect([...editor.view.dom.querySelectorAll(".zoom-indent")].map((e) => e.textContent)).toEqual(["\t", "\t", "\t"]);
    // ...and wrapped lines hang that much less (app.css, .md-line)
    expect([...editor.view.dom.querySelectorAll("p")].map((p) => p.style.getPropertyValue("--zoom-base"))).toEqual(["", "", "", "1", "1", "1", "", ""]);
    editor.view.dispatch(setZoom(editor.state, null));
    expect([...editor.view.dom.querySelectorAll("p")].some((p) => p.style.getPropertyValue("--zoom-base"))).toBe(false);
    expect(shown(editor)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("shows a folded block's children when zoomed into it, without its fold arrow", () => {
    const editor = makeEditor(docWith(PAGE, [3]), B);
    expect(shown(editor)).toEqual([3, 4, 5]);
    expect(editor.view.dom.querySelectorAll("p:not(.zoom-hidden) .fold-toggle").length).toBe(0);
  });

  it("still applies folds inside the zoomed block", () => {
    const editor = makeEditor(docWith(["- a", "\t- a1", "\t\t- a1x", "\t- a2"], [1]), id(1));
    expect(shown(editor)).toEqual([0, 1, 3]);
  });

  it("allows edits inside the block", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc, B);
    caret(editor, 4, 6);
    editor.commands.insertContent("!");
    caret(editor, 5, 6);
    press(editor, "Enter");
    expect(texts(doc).slice(3, 7)).toEqual(["\t- b", "\t\t- b1!", "\t\t- b2", "\t\t- "]);
    expect(shown(editor)).toEqual([3, 4, 5, 6]);
  });

  it("refuses edits that would reach outside the block", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc, B);
    caret(editor, 3, 0); // Backspace at the very start joins into the hidden line above
    editor.commands.joinBackward();
    caret(editor, 4, 4); // Shift+Tab would put b1 level with b, so out of it
    press(editor, "Tab", { shiftKey: true });
    caret(editor, 3, 3); // moving the zoomed block itself
    press(editor, "ArrowUp", { altKey: true, shiftKey: true });
    caret(editor, 5, 6); // plain lines pasted at the end fall outside it
    editor.commands.insertContent("<p>x</p><p>y</p>");
    caret(editor, 3, 2); // Enter before the zoomed line's text adds a line above it
    press(editor, "Enter");
    caret(editor, 5, 6); // Delete at the very end pulls in the hidden line below
    editor.commands.joinForward();
    // Taking the zoomed line's ID away
    editor.view.dispatch(editor.state.tr.setNodeAttribute(starts(editor)[3] - 1, "blockId", id(99)));
    expect(texts(doc)).toEqual(PAGE);
    expect(zoomOf(editor.state)?.root).toBe(B);
  });

  it("refuses deleting the zoomed block", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc, B);
    caret(editor, 3, 3);
    press(editor, "Escape");
    expect(selectedLines(editor.state)).toEqual({ from: 3, to: 6 });
    press(editor, "Backspace");
    expect(texts(doc)).toEqual(PAGE);
  });

  it("Enter at the end of the zoomed line adds its first child, even when it has none", () => {
    const doc = docWith(["- a", "- leaf", "- c"]);
    const editor = makeEditor(doc, id(2));
    caret(editor, 1, 6);
    press(editor, "Enter");
    expect(texts(doc)).toEqual(["- a", "- leaf", "\t- ", "- c"]);
    expect(caretAt(editor)).toEqual([2, 3]);
    expect(shown(editor)).toEqual([1, 2]);
  });

  it("always applies other tabs' edits, even outside the block", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc, B);
    const tr = editor.state.tr.insertText("!", starts(editor)[0] + 3);
    editor.view.dispatch(tr.setMeta(ySyncPluginKey, { isChangeOrigin: true }));
    expect(texts(doc)[0]).toBe("- a!");
  });

  it("keeps the caret inside the block", () => {
    const editor = makeEditor(docWith(PAGE), B);
    caret(editor, 1, 2);
    expect(caretAt(editor)).toEqual([3, 0]);
    caret(editor, 7, 1);
    expect(caretAt(editor)).toEqual([5, 6]);
  });

  it("Shift+↑/↓ never select lines outside the block", () => {
    const editor = makeEditor(docWith(PAGE), B);
    caret(editor, 3, 3);
    press(editor, "Escape");
    press(editor, "ArrowUp", { shiftKey: true });
    press(editor, "ArrowDown", { shiftKey: true });
    expect(selectedLines(editor.state)).toEqual({ from: 3, to: 6 });
  });

  it("shows the whole page if the zoomed block disappears", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc, B);
    const s = starts(editor);
    const tr = editor.state.tr.delete(s[3] - 1, s[6] - 1);
    editor.view.dispatch(tr.setMeta(ySyncPluginKey, { isChangeOrigin: true }));
    expect(zoomOf(editor.state)).toBeNull();
    expect(shown(editor)).toEqual([0, 1, 2, 3, 4]);
  });

  it("Mod+. asks to zoom into the caret's block; Mod+, asks to zoom out one level", () => {
    const editor = makeEditor(docWith(PAGE), B);
    caret(editor, 4, 3);
    expect(zoomRequests(editor, () => press(editor, ".", { ctrlKey: true }))).toEqual([id(5)]);
    expect(zoomRequests(editor, () => press(editor, ",", { ctrlKey: true }))).toEqual([id(1)]);
    const top = makeEditor(docWith(PAGE), id(1));
    expect(zoomRequests(top, () => press(top, ",", { ctrlKey: true }))).toEqual([null]);
    const whole = makeEditor(docWith(PAGE));
    expect(press(whole, ",", { ctrlKey: true })).toBe(false);
  });

  it("a click on a bullet asks to zoom into its block", () => {
    const editor = makeEditor(docWith(PAGE));
    const handle = editor.view.dom.querySelectorAll<HTMLElement>(".bullet-handle")[3];
    expect(zoomRequests(editor, () => handle.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })))).toEqual([B]);
  });
});
