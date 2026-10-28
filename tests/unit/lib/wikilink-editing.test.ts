// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import * as Y from "yjs";
import { Editor, type Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Collaboration from "@tiptap/extension-collaboration";
import { CriticAddition, CriticDeletion, CriticComment, CriticHighlight } from "~/lib/critic-marks";
import { Wikilink, linkRanges, clipboardText, OPEN_LINK_EVENT, type TitleSource } from "~/lib/wikilink-editing";
import type { LinkTarget } from "~/lib/page-titles";
import { linesFromYjs } from "~/lib/note-lines";
import { parseNote } from "~/lib/note-parser";

const BOOKS = "abcd1234";

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

/** A title store the test controls. */
function fakeTitles(initial: Record<string, Partial<LinkTarget>> = {}) {
  const targets = new Map<string, LinkTarget>();
  const listeners = new Set<() => void>();
  const set = (id: string, t: Partial<LinkTarget>) => targets.set(id, { title: "", kind: "page", slug: null, empty: false, missing: false, ...t });
  Object.entries(initial).forEach(([id, t]) => set(id, t));
  const store: TitleSource & { requested: string[]; update: (id: string, t: Partial<LinkTarget>) => void } = {
    requested: [],
    get: (id) => targets.get(id),
    request: (ids) => store.requested.push(...ids),
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    update: (id, t) => {
      set(id, t);
      listeners.forEach((l) => l());
    },
  };
  return store;
}

type Run = string | [string, string] | [string, string, "added"];

/** A Yjs document whose lines are runs of text; [text, pageId] is a link. */
function yDoc(lines: Run[][]): Y.Doc {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("default");
  for (const runs of lines) {
    const t = new Y.XmlText();
    let at = 0;
    for (const run of runs) {
      const [text, pageId, added] = typeof run === "string" ? [run, null, undefined] : run;
      t.insert(at, text, { wikilink: pageId ? { pageId } : null, ...(added ? { criticAddition: {} } : { criticAddition: null }) });
      at += text.length;
    }
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [t]);
    frag.insert(frag.length, [p]);
  }
  return doc;
}

function setup(lines: Run[][], opts: { titles?: ReturnType<typeof fakeTitles>; mode?: "edit" | "suggest"; extensions?: Extensions } = {}) {
  const doc = yDoc(lines);
  const titles = opts.titles ?? fakeTitles();
  const onOpen = vi.fn();
  const docState = { get: (k: string) => (k === "mode" ? (opts.mode ?? "edit") : undefined) };
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: opts.extensions ?? [Document, Paragraph, Text, CriticAddition, CriticDeletion, CriticComment, CriticHighlight, Collaboration.configure({ document: doc }), Wikilink.configure({ titles, docState, onOpen })],
  });
  editors.push(editor);
  return { doc, editor, titles, onOpen };
}

const text = (doc: Y.Doc) => linesFromYjs(doc.getXmlFragment("default")).map((l) => l.text);
const caret = (editor: Editor, pos: number, anchor = pos) => editor.commands.setTextSelection({ from: anchor, to: pos });
const press = (editor: Editor, key: string, mods: { shiftKey?: boolean; altKey?: boolean } = {}) =>
  editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key, cancelable: true, ...mods })));
const shown = (editor: Editor) => editor.view.dom.querySelector(".wikilink-shown");
/** What a reader sees: the line's text without the hidden copy. */
function visible(editor: Editor): string {
  const copy = editor.view.dom.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[aria-hidden=true]").forEach((n) => n.remove());
  return copy.textContent ?? "";
}

// "see " is positions 1-4, so a link right after it starts at 5
const SEE_LINK = [["see ", ["Reading list", BOOKS], " here"]] as Run[][];
const START = 5;
const END = START + "Reading list".length;

describe("the wikilink mark", () => {
  it("is stored in Yjs as the formatting the shared parser reads", () => {
    const { doc, editor } = setup([["see Books here"]]);
    editor.chain().setTextSelection({ from: 5, to: 10 }).setMark("wikilink", { pageId: BOOKS }).run();
    const ytext = doc.getXmlFragment("default").get(0).get(0) as Y.XmlText;
    expect(ytext.toDelta()).toEqual([{ insert: "see " }, { insert: "Books", attributes: { wikilink: { pageId: BOOKS } } }, { insert: " here" }]);
    expect(parseNote(linesFromYjs(doc.getXmlFragment("default"))).links).toEqual([{ pageId: BOOKS, line: 0 }]);
  });

  it("is why older tabs are refused: an editor without it deletes the line", () => {
    // y-tiptap removes text it cannot turn into the editor's schema, and the
    // removal syncs to everyone (see DOC_FORMAT_VERSION and the Worker's check)
    const doc = yDoc(SEE_LINK);
    const old = new Editor({ element: document.createElement("div"), extensions: [Document, Paragraph, Text, Collaboration.configure({ document: doc })] });
    editors.push(old);
    expect(text(doc)).toEqual([""]);
  });

  it("does not grow when you type at its end", () => {
    const { doc, editor } = setup(SEE_LINK);
    caret(editor, END);
    editor.view.dispatch(editor.state.tr.insertText("!"));
    expect(text(doc)).toEqual(["see Reading list! here"]);
    expect(linkRanges(editor.state.doc)[0]).toMatchObject({ from: START, to: END });
  });
});

describe("linkRanges", () => {
  it("treats a link split by another mark as one link", () => {
    const { editor } = setup([["a ", ["Read", BOOKS], ["ing", BOOKS, "added"], [" list", BOOKS], " b"]]);
    expect(linkRanges(editor.state.doc)).toEqual([{ from: 3, to: 15, pageId: BOOKS, text: "Reading list" }]);
  });

  it("keeps two links next to each other apart", () => {
    const { editor } = setup([[["One", BOOKS], ["Two", "efgh5678"]]]);
    expect(linkRanges(editor.state.doc).map((r) => r.text)).toEqual(["One", "Two"]);
  });
});

describe("showing links", () => {
  it("shows the stored copy until titles load, and asks for them", () => {
    const { editor, titles } = setup(SEE_LINK);
    expect(visible(editor)).toBe("see Reading list here");
    expect(shown(editor)).toBeNull();
    expect(titles.requested).toContain(BOOKS);
  });

  it("shows the current title over a stale copy, hiding the copy from screen readers too", () => {
    const { editor } = setup(SEE_LINK, { titles: fakeTitles({ [BOOKS]: { title: "Books" } }) });
    expect(visible(editor)).toBe("see Books here");
    expect(shown(editor)?.getAttribute("data-page-id")).toBe(BOOKS);
    const hidden = editor.view.dom.querySelector(".wikilink-stale");
    expect(hidden?.textContent).toBe("Reading list");
    expect(hidden?.getAttribute("aria-hidden")).toBe("true");
  });

  it("shows the copy itself when it matches the title", () => {
    const { editor } = setup(SEE_LINK, { titles: fakeTitles({ [BOOKS]: { title: "Reading list" } }) });
    expect(shown(editor)).toBeNull();
    expect(editor.view.dom.querySelector(".wikilink-stale")).toBeNull();
    expect(visible(editor)).toBe("see Reading list here");
  });

  it("redraws when titles arrive or change", () => {
    const { editor, titles } = setup(SEE_LINK);
    titles.update(BOOKS, { title: "Books" });
    expect(visible(editor)).toBe("see Books here");
    titles.update(BOOKS, { title: "Novels" });
    expect(visible(editor)).toBe("see Novels here");
  });

  it.each([
    ["a missing page, dashed, showing the copy", { missing: true }, "wikilink-missing", "see Reading list here"],
    ["an empty page", { title: "Reading list", empty: true }, "wikilink-empty", "see Reading list here"],
    ["a journal", { title: "Oct 28th, 2026", kind: "journal" as const }, "wikilink-journal", "see Oct 28th, 2026 here"],
  ])("styles %s", (_name, target, cls, seen) => {
    const { editor } = setup(SEE_LINK, { titles: fakeTitles({ [BOOKS]: target }) });
    expect(editor.view.dom.querySelector(`.${cls}`)).not.toBeNull();
    expect(visible(editor)).toBe(seen);
  });

  it("does not draw a widget, or hide anything, for a missing page", () => {
    const { editor } = setup(SEE_LINK, { titles: fakeTitles({ [BOOKS]: { missing: true } }) });
    expect(shown(editor)).toBeNull();
    expect(editor.view.dom.querySelector(".wikilink-stale")).toBeNull();
  });
});

describe("a link is one unit", () => {
  it("moves a cursor placed inside a link to the nearer edge", () => {
    const { editor } = setup(SEE_LINK);
    caret(editor, START + 2);
    expect(editor.state.selection.head).toBe(START);
    caret(editor, END - 2);
    expect(editor.state.selection.head).toBe(END);
  });

  it("jumps over a link with the arrow keys", () => {
    const { editor } = setup(SEE_LINK);
    caret(editor, END);
    expect(press(editor, "ArrowLeft")).toBe(true);
    expect(editor.state.selection.head).toBe(START);
    expect(press(editor, "ArrowRight")).toBe(true);
    expect(editor.state.selection.head).toBe(END);
  });

  it("steps one character on leaving a link's edge", () => {
    const { editor } = setup(SEE_LINK);
    caret(editor, END);
    expect(press(editor, "ArrowRight")).toBe(true);
    expect(editor.state.selection.head).toBe(END + 1);
    caret(editor, START);
    expect(press(editor, "ArrowLeft")).toBe(true);
    expect(editor.state.selection.head).toBe(START - 1);
  });

  it("keeps an emoji after a link whole", () => {
    const { editor } = setup([[["Books", BOOKS], "😀!"]]);
    caret(editor, 6);
    press(editor, "ArrowRight");
    expect(editor.state.selection.head).toBe(8);
  });

  it("leaves arrow keys alone away from links", () => {
    const { editor } = setup(SEE_LINK);
    caret(editor, 2);
    expect(press(editor, "ArrowRight")).toBeFalsy();
  });

  it("selects a whole link with Shift and an arrow", () => {
    const { editor } = setup(SEE_LINK);
    caret(editor, END);
    press(editor, "ArrowLeft", { shiftKey: true });
    expect([editor.state.selection.from, editor.state.selection.to]).toEqual([START, END]);
  });

  it("deletes a whole link with Backspace after it or Delete before it", () => {
    const { doc, editor } = setup(SEE_LINK);
    caret(editor, END);
    expect(press(editor, "Backspace")).toBe(true);
    expect(text(doc)).toEqual(["see  here"]);
    const again = setup(SEE_LINK);
    caret(again.editor, START);
    expect(press(again.editor, "Delete")).toBe(true);
    expect(text(again.doc)).toEqual(["see  here"]);
  });

  it("leaves Backspace and Delete to suggest mode, which marks deletions instead", () => {
    // Removing a whole link is not a suggestion yet (as with bullets, F34)
    const { doc, editor } = setup(SEE_LINK, { mode: "suggest" });
    caret(editor, END);
    press(editor, "Backspace");
    expect(text(doc)).not.toEqual(["see  here"]);
    caret(editor, START);
    press(editor, "Delete");
    expect(text(doc)[0]).toContain("eading lis");
  });
});

describe("opening links", () => {
  it("opens the page on click, using its readable address", () => {
    const { editor, onOpen } = setup(SEE_LINK, { titles: fakeTitles({ [BOOKS]: { title: "Books", slug: "books" } }) });
    shown(editor)!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onOpen).toHaveBeenCalledWith("/page/books", BOOKS, editor.view);
  });

  it("opens the link before the cursor with Alt+Enter", () => {
    const { editor, onOpen } = setup([[["Oct 28th, 2026", "journal-2026-10-28"], " notes"]]);
    caret(editor, 15);
    expect(press(editor, "Enter", { altKey: true })).toBe(true);
    expect(onOpen).toHaveBeenCalledWith("/journal/2026-10-28", "journal-2026-10-28", editor.view);
  });

  it("does nothing on Alt+Enter away from links", () => {
    const { editor, onOpen } = setup(SEE_LINK);
    caret(editor, 2);
    expect(press(editor, "Enter", { altKey: true })).toBeFalsy();
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe("opening links by default", () => {
  it("asks the page around the editor to open it, which can take over", () => {
    const doc = yDoc(SEE_LINK);
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({ element, extensions: [Document, Paragraph, Text, Collaboration.configure({ document: doc }), Wikilink.configure({ titles: fakeTitles() })] });
    editors.push(editor);
    const opened: string[] = [];
    element.addEventListener(OPEN_LINK_EVENT, (e) => {
      e.preventDefault();
      opened.push((e as CustomEvent<{ href: string }>).detail.href);
    });
    editor.view.dom.querySelector("[data-page-id]")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(opened).toEqual([`/docs/${BOOKS}`]);
  });
});

describe("copying as plain text", () => {
  it("writes links as [[Current Title]], within a line or across lines", () => {
    const titles = fakeTitles({ [BOOKS]: { title: "Books" } });
    const { editor } = setup([...SEE_LINK, ["next"]], { titles });
    const { doc } = editor.state;
    expect(clipboardText(doc.slice(1, 1 + "see Reading list here".length), titles)).toBe("see [[Books]] here");
    expect(clipboardText(doc.slice(0, doc.content.size), titles)).toBe("see [[Books]] here\n\nnext");
  });

  it("writes a split link once, and falls back to the copy for missing pages", () => {
    const titles = fakeTitles({ "efgh5678": { missing: true } });
    const { editor } = setup([[["Read", BOOKS], ["ing", BOOKS, "added"], " ", ["Old", "efgh5678"]]], { titles });
    const { doc } = editor.state;
    expect(clipboardText(doc.slice(0, doc.content.size), titles)).toBe("[[Reading]] [[Old]]");
  });
});
