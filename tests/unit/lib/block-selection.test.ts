// @vitest-environment jsdom
/**
 * Selecting whole blocks in the real editor with Yjs underneath (PRD F39).
 * Keys go through ProseMirror's handleKeyDown, like a real keypress; copy and
 * cut call the plugin's handlers directly (jsdom has no ClipboardEvent).
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
import { Folding } from "~/lib/folding-editing";
import { BlockSelection, BlockSelectionStart, selectedLines } from "~/lib/block-selection";
import { Wikilink } from "~/lib/wikilink-editing";
import { detectContext } from "~/components/BubbleToolbar";
import { CriticAddition, CriticDeletion, CriticComment, CriticHighlight } from "~/lib/critic-marks";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

const PAGE_ID = "abcd1234";

function docWith(lines: string[], folded: number[] = []): Y.Doc {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("default");
  lines.forEach((text, i) => {
    const p = new Y.XmlElement("paragraph");
    if (folded.includes(i)) p.setAttribute("collapsed", true as unknown as string);
    p.insert(0, [new Y.XmlText(text)]);
    frag.insert(frag.length, [p]);
  });
  return doc;
}

function makeEditor(doc: Y.Doc, mode: "edit" | "suggest" = "edit") {
  const docState = { get: (key: string) => (key === "mode" ? mode : undefined) };
  const titles = { get: () => ({ title: "Holiday trip", kind: "page" as const, slug: "holiday", empty: false, missing: false }), request: () => {}, subscribe: () => () => {} };
  const search = async () => [{ pageId: PAGE_ID, title: "Holiday", kind: "page" as const, slug: "holiday", empty: false }];
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      Document,
      BlockParagraph,
      Text,
      CriticAddition,
      CriticDeletion,
      CriticComment,
      CriticHighlight,
      Collaboration.configure({ document: doc }),
      BulletEditing.configure({ docState }),
      Folding.configure({ docState }),
      Wikilink.configure({ titles, docState, search }),
      BlockSelection.configure({ docState }),
      BlockSelectionStart,
    ],
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

function clipboardEvent(type: "copy" | "cut") {
  const data = new Map<string, string>();
  const event = new Event(type, { cancelable: true }) as ClipboardEvent;
  Object.defineProperty(event, "clipboardData", {
    value: { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", clearData: () => data.clear() },
  });
  return { event, data };
}

function clip(editor: Editor, type: "copy" | "cut") {
  const { event, data } = clipboardEvent(type);
  const handled = editor.view.someProp("handleDOMEvents", (h) => h[type]?.(editor.view, event));
  return { handled, prevented: event.defaultPrevented, text: data.get("text/plain"), html: data.get("text/html") ?? "" };
}

const texts = (doc: Y.Doc) => (doc.getXmlFragment("default").toArray() as Y.XmlElement[]).map((p) => (p.get(0) as Y.XmlText | undefined)?.toString() ?? "");
const selected = (editor: Editor) => [...editor.view.dom.querySelectorAll("p")].map((p, i) => (p.classList.contains("block-selected") ? i : -1)).filter((i) => i >= 0);

const PAGE = ["- a", "\t- a1", "\t- a2", "- b", "\t- b1", "- c"];

describe("selecting blocks", () => {
  it("Esc selects the caret's block with its children, highlighted, caret hidden", () => {
    const editor = makeEditor(docWith(PAGE));
    caret(editor, 0, 2);
    expect(press(editor, "Escape")).toBe(true);
    expect(selectedLines(editor.state)).toEqual({ from: 0, to: 3 });
    expect(selected(editor)).toEqual([0, 1, 2]);
    expect(editor.view.dom.classList.contains("has-block-selection")).toBe(true);
  });

  it("Esc closes an open link suggestion list first; the next Esc selects", async () => {
    vi.useFakeTimers();
    const editor = makeEditor(docWith(["- see "]));
    editor.view.dom.dispatchEvent(new FocusEvent("focus"));
    caret(editor, 0, 6);
    for (const ch of "[[ho") {
      const { from, to } = editor.state.selection;
      const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, from, to, ch, () => editor.state.tr.insertText(ch, from, to)));
      if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
    }
    await vi.advanceTimersByTimeAsync(200);
    vi.useRealTimers();
    const list = () => document.querySelector<HTMLElement>(".link-suggest:not([hidden])");
    expect(list()).not.toBeNull();
    press(editor, "Escape");
    expect(list()).toBeNull();
    expect(selectedLines(editor.state)).toBeNull();
    press(editor, "Escape");
    expect(selectedLines(editor.state)).toEqual({ from: 0, to: 1 });
  });

  it("shows no text toolbar (Comment) over selected blocks", () => {
    // Regression: the text selection under the blocks showed Mist's Comment bubble
    const editor = makeEditor(docWith(PAGE));
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, starts(editor)[0], starts(editor)[0] + 3)));
    expect(detectContext(editor.state)).toEqual({ kind: "selection" });
    caret(editor, 0, 2);
    press(editor, "Escape");
    expect(editor.state.selection.empty).toBe(false);
    expect(detectContext(editor.state)).toBeNull();
  });

  it("Shift+↑/↓ grow the selection and ↑/↓ move it; Esc leaves it with the caret in the first block", () => {
    const editor = makeEditor(docWith(PAGE));
    caret(editor, 3, 3);
    press(editor, "Escape");
    press(editor, "ArrowDown", { shiftKey: true });
    expect(selectedLines(editor.state)).toEqual({ from: 3, to: 6 });
    press(editor, "ArrowUp", { shiftKey: true });
    expect(selectedLines(editor.state)).toEqual({ from: 2, to: 6 });
    press(editor, "ArrowUp");
    expect(selectedLines(editor.state)).toEqual({ from: 1, to: 2 });
    press(editor, "Shift", { shiftKey: true }); // pressing Shift or Cmd alone keeps it
    press(editor, "Meta", { metaKey: true });
    press(editor, "Control", { ctrlKey: true });
    expect(selectedLines(editor.state)).toEqual({ from: 1, to: 2 });
    press(editor, "Escape");
    expect(selectedLines(editor.state)).toBeNull();
    expect(caretAt(editor)).toEqual([1, 5]);
  });

  it("Enter goes back to editing the first selected block", () => {
    const editor = makeEditor(docWith(PAGE));
    caret(editor, 3, 0);
    press(editor, "Escape");
    press(editor, "Enter");
    expect(selectedLines(editor.state)).toBeNull();
    expect(caretAt(editor)).toEqual([3, 3]);
  });

  it("takes a folded block whole and skips its hidden lines", () => {
    const editor = makeEditor(docWith(PAGE, [0]));
    caret(editor, 3, 3);
    press(editor, "Escape");
    press(editor, "ArrowUp", { shiftKey: true });
    expect(selectedLines(editor.state)).toEqual({ from: 0, to: 5 });
  });

  it("Tab and Shift+Tab indent the selected blocks and keep them selected", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    caret(editor, 3, 3);
    press(editor, "Escape");
    press(editor, "Tab");
    expect(texts(doc)).toEqual(["- a", "\t- a1", "\t- a2", "\t- b", "\t\t- b1", "- c"]);
    expect(selectedLines(editor.state)).toEqual({ from: 3, to: 5 });
    press(editor, "Tab", { shiftKey: true });
    expect(texts(doc)).toEqual(PAGE);
  });

  it("Backspace removes the selected blocks in one undo step", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    caret(editor, 3, 3);
    press(editor, "Escape");
    press(editor, "ArrowDown", { shiftKey: true });
    press(editor, "Backspace");
    expect(texts(doc)).toEqual(["- a", "\t- a1", "\t- a2"]);
    expect(selectedLines(editor.state)).toBeNull();
    expect(caretAt(editor)).toEqual([2, 5]);
    editor.commands.undo();
    expect(texts(doc)).toEqual(PAGE);
  });

  it("Delete on every block leaves one empty line", () => {
    const doc = docWith(["- only", "\t- child"]);
    const editor = makeEditor(doc);
    caret(editor, 0, 2);
    press(editor, "Escape");
    press(editor, "Delete");
    expect(texts(doc)).toEqual([""]);
  });

  it("copies whole lines as Logseq text and as HTML that keeps links", () => {
    const doc = docWith(["- intro", "- see [[Holiday]]", "\t- child"]);
    const editor = makeEditor(doc);
    // Link "Holiday" to a page by ID, as the editor would
    const linkFrom = starts(editor)[1] + 8;
    editor.view.dispatch(editor.state.tr.addMark(linkFrom, linkFrom + 7, editor.schema.marks.wikilink.create({ pageId: PAGE_ID })));
    caret(editor, 1, 2);
    press(editor, "Escape");
    const { handled, prevented, text, html } = clip(editor, "copy");
    expect([handled, prevented]).toEqual([true, true]);
    // The link shows its page's current title, as everywhere else
    expect(text).toBe("- see [[Holiday trip]]\n\t- child");
    expect(html).toContain(`data-page-id="${PAGE_ID}"`);
    expect(doc.getXmlFragment("default").length).toBe(3);
    expect(selectedLines(editor.state)).toEqual({ from: 1, to: 3 });
  });

  it("cut copies and removes the blocks", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    caret(editor, 3, 3);
    press(editor, "Escape");
    expect(clip(editor, "cut").text).toBe("- b\n\t- b1");
    expect(texts(doc)).toEqual(["- a", "\t- a1", "\t- a2", "- c"]);
  });

  it("leaves normal copy alone when no blocks are selected", () => {
    const editor = makeEditor(docWith(PAGE));
    caret(editor, 0, 1);
    expect(clip(editor, "copy").handled).toBeFalsy();
  });

  it("never lets typing or pasting replace the selected blocks", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    caret(editor, 3, 3);
    press(editor, "Escape");
    expect(press(editor, "x")).toBe(true);
    expect(press(editor, " ")).toBe(true);
    const typed = editor.view.someProp("handleTextInput", (f) => f(editor.view, 0, 0, "x", () => editor.state.tr));
    const pasted = editor.view.someProp("handlePaste", (f) => f(editor.view, new Event("paste") as ClipboardEvent, editor.state.doc.slice(0, 3)));
    const input = new Event("beforeinput", { cancelable: true });
    editor.view.someProp("handleDOMEvents", (h) => h.beforeinput?.(editor.view, input as InputEvent));
    expect([typed, pasted, input.defaultPrevented]).toEqual([true, true, true]);
    expect(texts(doc)).toEqual(PAGE);
    expect(selectedLines(editor.state)).toEqual({ from: 3, to: 5 });
  });

  it("other Cmd/Ctrl shortcuts leave the selection and pass on", () => {
    const editor = makeEditor(docWith(PAGE));
    caret(editor, 3, 3);
    press(editor, "Escape");
    expect(press(editor, "k", { ctrlKey: true })).toBe(false);
    expect(selectedLines(editor.state)).toBeNull();
    expect(caretAt(editor)).toEqual([3, 3]);
  });

  it("undo works from a block selection", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    caret(editor, 5, 3);
    editor.commands.insertContent("!");
    press(editor, "Escape");
    expect(press(editor, "z", { ctrlKey: true })).toBe(true); // the undo keymap ran
    expect(selectedLines(editor.state)).toBeNull();
    expect(texts(doc)[5]).toBe("- c");
  });

  it("a click elsewhere leaves the selection", () => {
    const editor = makeEditor(docWith(PAGE));
    caret(editor, 0, 2);
    press(editor, "Escape");
    caret(editor, 5, 1); // what a click does
    expect(selectedLines(editor.state)).toBeNull();
    expect(editor.view.dom.classList.contains("has-block-selection")).toBe(false);
  });

  it("keeps the same blocks selected when another tab adds a line above", () => {
    const editor = makeEditor(docWith(PAGE));
    caret(editor, 3, 3);
    press(editor, "Escape");
    // Added right at the selection's edges: above its first line and below its last
    const above = starts(editor)[3] - 1;
    const tr = editor.state.tr.insert(above, editor.schema.nodes.paragraph.create(null, editor.schema.text("- remote above")));
    editor.view.dispatch(tr.setMeta(ySyncPluginKey, { isChangeOrigin: true }));
    const below = starts(editor)[6] - 1;
    const tr2 = editor.state.tr.insert(below, editor.schema.nodes.paragraph.create(null, editor.schema.text("- remote below")));
    editor.view.dispatch(tr2.setMeta(ySyncPluginKey, { isChangeOrigin: true }));
    expect(selectedLines(editor.state)).toEqual({ from: 4, to: 6 });
  });

  it.each(["suggest mode", "a read-only editor"])("in %s, selected blocks can be copied but not changed", (where) => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc, where === "suggest mode" ? "suggest" : "edit");
    caret(editor, 3, 3);
    press(editor, "Escape");
    if (where === "a read-only editor") editor.setEditable(false);
    press(editor, "Tab");
    press(editor, "Backspace");
    expect(clip(editor, "cut").text).toBe("- b\n\t- b1");
    expect(texts(doc)).toEqual(PAGE);
  });
});
