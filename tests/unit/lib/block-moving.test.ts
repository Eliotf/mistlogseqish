// @vitest-environment jsdom
/**
 * Moving blocks in the real editor with Yjs underneath, as in the app (PRD F38).
 * Keys go through ProseMirror's handleKeyDown, like a real keypress. jsdom
 * has no layout, so drag tests stand in for posAtCoords.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as Y from "yjs";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import Collaboration from "@tiptap/extension-collaboration";
import { TextSelection } from "@tiptap/pm/state";
import { Slice } from "@tiptap/pm/model";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { BlockParagraph } from "~/lib/block-id-editing";
import { BulletEditing } from "~/lib/bullet-editing";
import { Folding } from "~/lib/folding-editing";
import { BlockMoving, blockMovingKey } from "~/lib/block-moving";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** Lines get IDs 1, 2, 3... in order (unless `labelled` is false); `folded` lines get collapsed: true. */
function docWith(lines: string[], folded: number[] = [], labelled = true): Y.Doc {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("default");
  lines.forEach((text, i) => {
    const p = new Y.XmlElement("paragraph");
    if (labelled) p.setAttribute("blockId", id(i + 1));
    if (folded.includes(i)) p.setAttribute("collapsed", true as unknown as string);
    p.insert(0, [new Y.XmlText(text)]);
    frag.insert(frag.length, [p]);
  });
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
      Folding.configure({ docState }),
      BlockMoving.configure({ docState }),
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

const altShift = { altKey: true, shiftKey: true };
const paragraphs = (doc: Y.Doc) => doc.getXmlFragment("default").toArray() as Y.XmlElement[];
const texts = (doc: Y.Doc) => paragraphs(doc).map((p) => (p.get(0) as Y.XmlText | undefined)?.toString() ?? "");
const ids = (doc: Y.Doc) => paragraphs(doc).map((p) => p.getAttribute("blockId"));
const folds = (doc: Y.Doc) => paragraphs(doc).map((p) => p.getAttribute("collapsed") ?? null);

const PAGE = ["- a", "\t- a1", "- b", "\t- b1", "\t\t- b1x", "- c"];

describe("moving blocks with Alt+Shift+↑/↓", () => {
  it("moves the caret's block, children, IDs and all, keeping the caret in place", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    caret(editor, 2, 3);
    expect(press(editor, "ArrowUp", altShift)).toBe(true);
    expect(texts(doc)).toEqual(["- b", "\t- b1", "\t\t- b1x", "- a", "\t- a1", "- c"]);
    expect(ids(doc)).toEqual([id(3), id(4), id(5), id(1), id(2), id(6)]);
    expect(caretAt(editor)).toEqual([0, 3]);

    press(editor, "ArrowDown", altShift);
    press(editor, "ArrowDown", altShift);
    expect(texts(doc)).toEqual(["- a", "\t- a1", "- c", "- b", "\t- b1", "\t\t- b1x"]);
    expect(caretAt(editor)).toEqual([3, 3]);
  });

  it("moves past a folded block's hidden children, and a folded block keeps its fold", () => {
    const doc = docWith(PAGE, [2]);
    const editor = makeEditor(doc);
    caret(editor, 0, 3);
    press(editor, "ArrowDown", altShift);
    expect(texts(doc)).toEqual(["- b", "\t- b1", "\t\t- b1x", "- a", "\t- a1", "- c"]);
    expect(folds(doc)).toEqual([true, null, null, null, null, null]);
    expect(caretAt(editor)).toEqual([3, 3]);
  });

  it("keeps the key but moves nothing at the first or last block of a level", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    caret(editor, 1, 2); // the only child of "a"
    expect(press(editor, "ArrowUp", altShift)).toBe(true);
    expect(press(editor, "ArrowDown", altShift)).toBe(true);
    expect(texts(doc)).toEqual(PAGE);
  });

  it("undoes a move in one step", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    caret(editor, 5, 1);
    press(editor, "ArrowUp", altShift);
    editor.commands.undo();
    expect(texts(doc)).toEqual(PAGE);
    expect(ids(doc)).toEqual(PAGE.map((_l, i) => id(i + 1)));
  });

  it("does not move in suggest mode or a read-only editor", () => {
    const suggesting = docWith(PAGE);
    const a = makeEditor(suggesting, "suggest");
    caret(a, 2, 3);
    press(a, "ArrowUp", altShift);
    expect(texts(suggesting)).toEqual(PAGE);

    const readOnly = docWith(PAGE);
    const b = makeEditor(readOnly);
    caret(b, 2, 3);
    b.setEditable(false);
    press(b, "ArrowUp", altShift);
    expect(texts(readOnly)).toEqual(PAGE);
  });
});

describe("dragging a bullet", () => {
  /** A drag event; jsdom has no DragEvent or DataTransfer. */
  function dragEvent(type: string) {
    const data = new Map<string, string>();
    const event = new Event(type, { bubbles: true, cancelable: true }) as DragEvent;
    Object.defineProperty(event, "dataTransfer", {
      value: { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", setDragImage: () => {}, effectAllowed: "" },
    });
    return event;
  }

  function handles(editor: Editor) {
    return [...editor.view.dom.querySelectorAll<HTMLElement>(".bullet-handle")];
  }

  /** Drop over line `target`, standing in for the browser's hit test. */
  function dropOn(editor: Editor, target: number) {
    editor.view.posAtCoords = () => ({ pos: starts(editor)[target], inside: starts(editor)[target] - 1 });
    const event = dragEvent("dragover");
    editor.view.someProp("handleDOMEvents", (h) => h.dragover?.(editor.view, event));
    const dropLine = blockMovingKey.getState(editor.state)?.dropLine;
    const drop = dragEvent("drop");
    const handled = editor.view.someProp("handleDrop", (f) => f(editor.view, drop, Slice.empty, false));
    return { dropLine, handled, prevented: event.defaultPrevented && drop.defaultPrevented };
  }

  it("has a drag handle on every bullet line only", () => {
    const doc = docWith(["- bullet", "plain", "\t- nested"]);
    const editor = makeEditor(doc);
    expect(handles(editor).map((h) => h.draggable)).toEqual([true, true]);
  });

  it("drops a block above the line it lands on, at that line's level, showing where while dragging", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    handles(editor)[2].dispatchEvent(dragEvent("dragstart")); // "- b"
    const { dropLine, handled, prevented } = dropOn(editor, 1); // above "\t- a1"
    expect([dropLine, handled, prevented]).toEqual([1, true, true]);
    expect(texts(doc)).toEqual(["- a", "\t- b", "\t\t- b1", "\t\t\t- b1x", "\t- a1", "- c"]);
    expect(ids(doc)).toEqual([id(1), id(3), id(4), id(5), id(2), id(6)]);
    expect(blockMovingKey.getState(editor.state)?.dropLine).toBeNull();
  });

  it("moves the block that was picked up, even if another tab adds lines during the drag", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    handles(editor)[2].dispatchEvent(dragEvent("dragstart")); // "- b"
    const tr = editor.state.tr.insert(0, editor.schema.nodes.paragraph.create({ blockId: id(99) }, editor.schema.text("- from elsewhere")));
    editor.view.dispatch(tr.setMeta(ySyncPluginKey, { isChangeOrigin: true }));
    dropOn(editor, 6); // above "- c", now line 6
    expect(texts(doc)).toEqual(["- from elsewhere", "- a", "\t- a1", "- b", "\t- b1", "\t\t- b1x", "- c"]);
    dropOn(editor, 6); // no drag in progress: nothing more happens
    expect(texts(doc)[3]).toBe("- b");
  });

  it("does nothing when a block is dropped on its own children", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    handles(editor)[2].dispatchEvent(dragEvent("dragstart"));
    expect(dropOn(editor, 4).handled).toBe(true);
    expect(texts(doc)).toEqual(PAGE);
  });

  it("ignores a drop on another editor, changing neither", () => {
    // Unlabelled lines, so the dragged block could only be found by its line number
    const docA = docWith(PAGE, [], false);
    const docB = docWith(["- other", "- page", "- here"], [], false);
    const a = makeEditor(docA);
    const b = makeEditor(docB);
    handles(a)[0].dispatchEvent(dragEvent("dragstart"));
    const { dropLine, handled } = dropOn(b, 2);
    expect([dropLine ?? null, handled]).toEqual([null, true]);
    expect(texts(docA)).toEqual(PAGE);
    expect(texts(docB)).toEqual(["- other", "- page", "- here"]);
  });

  it("cannot start a drag in a read-only editor", () => {
    const doc = docWith(PAGE);
    const editor = makeEditor(doc);
    editor.setEditable(false);
    const start = dragEvent("dragstart");
    handles(editor)[2].dispatchEvent(start);
    expect(start.defaultPrevented).toBe(true);
    dropOn(editor, 0);
    expect(texts(doc)).toEqual(PAGE);
  });
});
