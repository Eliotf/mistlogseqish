// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as Y from "yjs";
import { Editor, type Extensions } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Collaboration from "@tiptap/extension-collaboration";
import { CriticAddition, CriticDeletion, CriticComment, CriticHighlight } from "~/lib/critic-marks";
import { Wikilink, TAP_MAX_MS, linkSpans, clipboardText, pastedRanges, OPEN_LINK_EVENT, type TitleSource } from "~/lib/wikilink-editing";
import type { LinkPage, LinkTarget } from "~/lib/page-titles";
import { linesFromYjs } from "~/lib/note-lines";
import { parseNote } from "~/lib/note-parser";

const BOOKS = "abcd1234";
const NOVELS = "efgh5678";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
  vi.useRealTimers();
});

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
    prime: (id, t) => set(id, t),
    update: (id, t) => {
      set(id, t);
      listeners.forEach((l) => l());
    },
  };
  return store;
}

type Run = string | [string, string] | [string, string, "added"];

/** A Yjs document whose lines are runs of text; [text, pageId] is marked as a link. */
function yDoc(lines: Run[][]): Y.Doc {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("default");
  for (const runs of lines) {
    const t = new Y.XmlText();
    let at = 0;
    for (const run of runs) {
      const [text, pageId, added] = typeof run === "string" ? [run, null, undefined] : run;
      t.insert(at, text, { wikilink: pageId ? { pageId } : null, criticAddition: added ? {} : null });
      at += text.length;
    }
    const p = new Y.XmlElement("paragraph");
    p.insert(0, [t]);
    frag.insert(frag.length, [p]);
  }
  return doc;
}

interface SetupOptions {
  titles?: ReturnType<typeof fakeTitles>;
  mode?: "edit" | "suggest";
  pages?: LinkPage[];
  linkPage?: (title: string) => Promise<LinkPage | null>;
  extensions?: Extensions;
}

function setup(lines: Run[][], opts: SetupOptions = {}) {
  const doc = yDoc(lines);
  const titles = opts.titles ?? fakeTitles();
  const onOpen = vi.fn();
  const search = vi.fn(async (_q: string) => opts.pages ?? []);
  const linkPage = vi.fn(opts.linkPage ?? (async (title: string): Promise<LinkPage | null> => ({ pageId: "newpage1", title, kind: "page", slug: null, empty: true })));
  const docState = { get: (k: string) => (k === "mode" ? (opts.mode ?? "edit") : undefined) };
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: opts.extensions ?? [
      Document,
      Paragraph,
      Text,
      CriticAddition,
      CriticDeletion,
      CriticComment,
      CriticHighlight,
      Collaboration.configure({ document: doc }),
      Wikilink.configure({ titles, docState, onOpen, search, linkPage }),
    ],
  });
  editors.push(editor);
  // The editor is in use: links react to the cursor only while it is focused
  editor.view.dom.dispatchEvent(new FocusEvent("focus"));
  return { doc, editor, titles, onOpen, search, linkPage };
}

const text = (doc: Y.Doc) => linesFromYjs(doc.getXmlFragment("default")).map((l) => l.text);
const links = (doc: Y.Doc) => parseNote(linesFromYjs(doc.getXmlFragment("default"))).links.map((l) => l.pageId);
const caret = (editor: Editor, pos: number) => editor.commands.setTextSelection(pos);
const press = (editor: Editor, key: string, mods: KeyboardEventInit = {}) =>
  editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key, cancelable: true, ...mods })));
/** Type as the browser does: through handleTextInput first, else as plain insertion. */
function type(editor: Editor, chars: string) {
  for (const ch of chars) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, from, to, ch, () => editor.state.tr.insertText(ch, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
}
const settle = () => new Promise((r) => setTimeout(r, 0));
/** What a reader sees: the text without the hidden copy. */
function visible(editor: Editor): string {
  const copy = editor.view.dom.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[aria-hidden=true]").forEach((n) => n.remove());
  return copy.textContent ?? "";
}

// "see " is positions 1-4; "[[" is 5-6; the title starts at 7
const SEE_LINK: Run[][] = [["see [[", ["Reading list", BOOKS], "]] here"]];
const FROM = 5;
const INNER = 7;
const INNER_END = INNER + "Reading list".length;
const TO = INNER_END + 2;

describe("the wikilink mark", () => {
  it("is stored in Yjs as the formatting the shared parser reads", () => {
    const { doc } = setup(SEE_LINK);
    const ytext = doc.getXmlFragment("default").get(0).get(0) as Y.XmlText;
    expect(ytext.toDelta()).toEqual([{ insert: "see [[" }, { insert: "Reading list", attributes: { wikilink: { pageId: BOOKS } } }, { insert: "]] here" }]);
    expect(links(doc)).toEqual([BOOKS]);
  });

  it("is why older tabs are refused: an editor without it deletes the line", () => {
    // y-tiptap removes text it cannot turn into the editor's schema, and the
    // removal syncs to everyone (see DOC_FORMAT_VERSION and the Worker's check)
    const doc = yDoc(SEE_LINK);
    const old = new Editor({ element: document.createElement("div"), extensions: [Document, Paragraph, Text, Collaboration.configure({ document: doc })] });
    editors.push(old);
    expect(text(doc)).toEqual([""]);
  });
});

describe("linkSpans", () => {
  it("finds [[...]] and the page whose mark covers the whole title", () => {
    const { editor } = setup(SEE_LINK);
    expect(linkSpans(editor.state.doc)).toEqual([{ kind: "link", bracketed: true, from: FROM, to: TO, innerFrom: INNER, innerTo: INNER_END, inner: "Reading list", pageId: BOOKS }]);
  });

  it("treats a title split by another mark as one link", () => {
    const { editor } = setup([["[[", ["Read", BOOKS], ["ing", BOOKS, "added"], "]]"]]);
    expect(linkSpans(editor.state.doc)[0]).toMatchObject({ inner: "Reading", pageId: BOOKS });
  });

  it("has no page when the title is only partly marked, or not at all", () => {
    const { editor } = setup([["[[", ["Read", BOOKS], "ing]] and [[plain]]"]]);
    expect(linkSpans(editor.state.doc).map((s) => s.pageId)).toEqual([null, null]);
  });
});

describe("showing links", () => {
  it("shows [[Title]] with faint brackets, and asks for current titles", () => {
    const { editor, titles } = setup(SEE_LINK);
    caret(editor, 1);
    expect(visible(editor)).toBe("see [[Reading list]] here");
    expect(editor.view.dom.querySelectorAll(".wikilink-bracket")).toHaveLength(2);
    expect(titles.requested).toContain(BOOKS);
  });

  it("shows the current title over a stale copy, hidden from screen readers too", () => {
    const { editor } = setup(SEE_LINK, { titles: fakeTitles({ [BOOKS]: { title: "Books" } }) });
    caret(editor, 1);
    expect(visible(editor)).toBe("see [[Books]] here");
    expect(editor.view.dom.querySelector(".wikilink-stale")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("redraws when titles arrive or change", () => {
    const { editor, titles } = setup(SEE_LINK);
    caret(editor, 1);
    titles.update(BOOKS, { title: "Books" });
    expect(visible(editor)).toBe("see [[Books]] here");
    titles.update(BOOKS, { title: "Novels" });
    expect(visible(editor)).toBe("see [[Novels]] here");
  });

  it.each([
    ["a missing page, dashed", { missing: true }, "wikilink-missing"],
    ["an empty page", { title: "Reading list", empty: true }, "wikilink-empty"],
    ["a journal", { title: "Reading list", kind: "journal" as const }, "wikilink-journal"],
  ])("styles %s", (_name, target, cls) => {
    const { editor } = setup(SEE_LINK, { titles: fakeTitles({ [BOOKS]: target }) });
    caret(editor, 1);
    expect(editor.view.dom.querySelector(`.${cls}`)).not.toBeNull();
  });

  it("shows [[text]] that is not linked yet as dashed", () => {
    const { editor } = setup([["x [[Holiday]]"]]);
    caret(editor, 1);
    expect(editor.view.dom.querySelector(".wikilink-pending")?.textContent).toBe("Holiday");
  });
});

describe("with the cursor in a link", () => {
  it("is plain text to edit", () => {
    const { editor } = setup(SEE_LINK);
    caret(editor, INNER + 3);
    expect(editor.view.dom.querySelector(".wikilink-editing")).not.toBeNull();
    expect(editor.view.dom.querySelector(".wikilink-bracket")).toBeNull();
  });

  it("counts from just inside [[ to just inside ]], not the edges outside", () => {
    const { editor } = setup(SEE_LINK);
    const seen = [FROM, FROM + 1, TO - 1, TO].map((pos) => {
      caret(editor, pos);
      return !!editor.view.dom.querySelector(".wikilink-editing");
    });
    expect(seen).toEqual([false, true, true, false]);
  });

  it("is only plain text while the editor is focused", () => {
    const { editor } = setup(SEE_LINK);
    caret(editor, INNER + 3);
    editor.view.dom.dispatchEvent(new FocusEvent("blur"));
    expect(editor.view.dom.querySelector(".wikilink-editing")).toBeNull();
  });

  it("updates a renamed link's stored title when the cursor enters it, outside undo history", () => {
    const { doc, editor } = setup(SEE_LINK, { titles: fakeTitles({ [BOOKS]: { title: "Books" } }) });
    caret(editor, INNER + 3);
    expect(text(doc)).toEqual(["see [[Books]] here"]);
    expect(links(doc)).toEqual([BOOKS]);
    expect(editor.state.selection.head).toBe(INNER + 3);
    editor.commands.undo();
    expect(text(doc)).toEqual(["see [[Books]] here"]);
  });

  it("never rewrites a link just because the page is open", () => {
    const { doc, editor } = setup(SEE_LINK, { titles: fakeTitles({ [BOOKS]: { title: "Books" } }) });
    caret(editor, 1);
    caret(editor, TO + 2);
    expect(text(doc)).toEqual(["see [[Reading list]] here"]);
  });

  it("does not rewrite or relink in suggest mode", async () => {
    const { doc, editor, linkPage } = setup(SEE_LINK, { mode: "suggest", titles: fakeTitles({ [BOOKS]: { title: "Books" } }) });
    caret(editor, INNER + 3);
    expect(text(doc)).toEqual(["see [[Reading list]] here"]);
    editor.view.dispatch(editor.state.tr.insertText("x", INNER + 3));
    caret(editor, 1);
    await settle();
    expect(linkPage).not.toHaveBeenCalled();
  });
});

describe("when the cursor leaves a link", () => {
  it("keeps the link when the title was not changed", async () => {
    const { doc, editor, linkPage } = setup(SEE_LINK);
    caret(editor, INNER + 3);
    caret(editor, 1);
    await settle();
    expect(links(doc)).toEqual([BOOKS]);
    expect(linkPage).not.toHaveBeenCalled();
  });

  it("keeps the page when only the case of its title changed", async () => {
    const { doc, editor, linkPage } = setup([["[[", ["Books", BOOKS], "]]"]], { titles: fakeTitles({ [BOOKS]: { title: "Books" } }) });
    caret(editor, 4);
    editor.view.dispatch(editor.state.tr.insertText("b", 3, 4));
    caret(editor, 1);
    await settle();
    expect(text(doc)).toEqual(["[[books]]"]);
    expect(links(doc)).toEqual([BOOKS]);
    expect(linkPage).not.toHaveBeenCalled();
  });

  it("links to whatever page the edited title names, creating it if need be", async () => {
    const { doc, editor, linkPage } = setup(SEE_LINK, { titles: fakeTitles({ [BOOKS]: { title: "Reading list" } }) });
    caret(editor, INNER_END);
    type(editor, " 2");
    caret(editor, 1);
    await settle();
    expect(linkPage).toHaveBeenCalledWith("Reading list 2");
    expect(links(doc)).toEqual(["newpage1"]);
  });

  it("links typed [[text]] once you type ] to step out", async () => {
    const { doc, editor, linkPage } = setup([["x"]], { linkPage: async (title) => ({ pageId: NOVELS, title, kind: "page", slug: "novels", empty: false }) });
    caret(editor, 2);
    type(editor, " [[Novels");
    expect(text(doc)).toEqual(["x [[Novels]]"]);
    type(editor, "]");
    expect(text(doc)).toEqual(["x [[Novels]]"]);
    expect(editor.state.selection.head).toBe(editor.state.doc.content.size - 1);
    await settle();
    expect(linkPage).toHaveBeenCalledWith("Novels");
    expect(links(doc)).toEqual([NOVELS]);
  });

  it("asks once for the same title in two links, and links both", async () => {
    let answer: (page: LinkPage) => void = () => {};
    const { doc, editor, linkPage } = setup([["[[Holiday]] and [[holiday]] x"]], { linkPage: () => new Promise((r) => (answer = r)) });
    caret(editor, 4);
    caret(editor, 20);
    caret(editor, 30);
    answer({ pageId: "newpage1", title: "Holiday", kind: "page", slug: null, empty: true });
    await settle();
    expect(linkPage).toHaveBeenCalledTimes(1);
    // (the parser reports a page once per line, so check the links themselves)
    expect(linkSpans(editor.state.doc).map((sp) => sp.pageId)).toEqual(["newpage1", "newpage1"]);
    expect(links(doc)).toEqual(["newpage1"]);
  });

  it("links journal dates without asking the server", async () => {
    const { doc, editor, linkPage } = setup([["[[oct 28th, 2026]] x"]]);
    caret(editor, 4);
    caret(editor, 21);
    await settle();
    expect(linkPage).not.toHaveBeenCalled();
    expect(links(doc)).toEqual(["journal-2026-10-28"]);
  });

  it("stays unlinked and dashed if the page can't be had (offline)", async () => {
    const { doc, editor } = setup([["[[Holiday]] x"]], { linkPage: async () => null });
    caret(editor, 4);
    caret(editor, 14);
    await settle();
    expect(links(doc)).toEqual([]);
    expect(editor.view.dom.querySelector(".wikilink-pending")).not.toBeNull();
  });

  it("is no longer a link once a bracket is deleted, keeping the text", async () => {
    const { doc, editor } = setup(SEE_LINK);
    caret(editor, TO - 1);
    editor.view.dispatch(editor.state.tr.delete(TO - 1, TO));
    caret(editor, 1);
    await settle();
    expect(text(doc)).toEqual(["see [[Reading list] here"]);
    expect(links(doc)).toEqual([]);
  });

  it("unlinks a link whose title is left as only spaces", async () => {
    const { doc, editor } = setup([["see [[", ["  ", BOOKS], "]] here"]]);
    caret(editor, INNER + 1);
    caret(editor, 1);
    await settle();
    expect(text(doc)).toEqual(["see [[  ]] here"]);
    expect(links(doc)).toEqual([]);
  });

  it("unlinks an emptied link", async () => {
    const { doc, editor } = setup(SEE_LINK);
    caret(editor, INNER);
    editor.view.dispatch(editor.state.tr.delete(INNER, INNER_END));
    caret(editor, 1);
    await settle();
    expect(text(doc)).toEqual(["see [[]] here"]);
    expect(links(doc)).toEqual([]);
  });

  it("settles when the editor loses focus", async () => {
    const { doc, editor, linkPage } = setup([["[[Holiday]]"]]);
    caret(editor, 4);
    editor.view.dom.dispatchEvent(new FocusEvent("blur"));
    await settle();
    expect(linkPage).toHaveBeenCalledWith("Holiday");
    expect(links(doc)).toEqual(["newpage1"]);
  });

  it("does not link the [[text]] you are still editing when an answer arrives", async () => {
    let answer: (page: LinkPage) => void = () => {};
    const { editor } = setup([["[[Holiday]] [[Holiday]]"]], { linkPage: () => new Promise((r) => (answer = r)) });
    caret(editor, 4);
    caret(editor, 16);
    answer({ pageId: "newpage1", title: "Holiday", kind: "page", slug: null, empty: true });
    await settle();
    expect(linkSpans(editor.state.doc).map((s) => s.pageId)).toEqual(["newpage1", null]);
  });
});

describe("typing [[", () => {
  it("adds the closing ]] with the cursor between", () => {
    const { doc, editor } = setup([["go "]]);
    caret(editor, 4);
    type(editor, "[[");
    expect(text(doc)).toEqual(["go [[]]"]);
    expect(editor.state.selection.head).toBe(6);
  });

  it("does not add a second ]] where one follows", () => {
    const { doc, editor } = setup([["[]]"]]);
    caret(editor, 2);
    type(editor, "[");
    expect(text(doc)).toEqual(["[[]]"]);
  });

  it("Backspace in an empty [[]] removes all four brackets", () => {
    const { doc, editor } = setup([["go [[]]"]]);
    caret(editor, 6);
    expect(press(editor, "Backspace")).toBe(true);
    expect(text(doc)).toEqual(["go "]);
  });

  it("suggests titles as you type, and Enter links the chosen page", async () => {
    vi.useFakeTimers();
    const pages: LinkPage[] = [{ pageId: NOVELS, title: "Novels", kind: "page", slug: "novels", empty: false }];
    const { doc, editor, search } = setup([[""]], { pages });
    caret(editor, 1);
    type(editor, "[[nov");
    await vi.advanceTimersByTimeAsync(200);
    expect(search).toHaveBeenLastCalledWith("nov");
    const options = [...document.querySelectorAll(".link-suggest [role=option]")].map((o) => o.textContent);
    expect(options).toEqual(["Novels", "New page: nov"]);
    expect(press(editor, "Enter")).toBe(true);
    expect(text(doc)).toEqual(["[[Novels]]"]);
    expect(links(doc)).toEqual([NOVELS]);
    expect(editor.state.selection.head).toBe(editor.state.doc.content.size - 1);
  });

  it("moves through suggestions with the arrow keys and closes them with Escape", async () => {
    vi.useFakeTimers();
    const pages: LinkPage[] = [
      { pageId: BOOKS, title: "Books", kind: "page", slug: null, empty: false },
      { pageId: NOVELS, title: "Novels", kind: "page", slug: null, empty: false },
    ];
    const { doc, editor } = setup([[""]], { pages });
    caret(editor, 1);
    type(editor, "[[o");
    await vi.advanceTimersByTimeAsync(200);
    press(editor, "ArrowDown");
    expect(document.querySelector(".link-suggest [aria-selected=true]")?.textContent).toBe("Novels");
    expect(press(editor, "Escape")).toBe(true);
    expect((document.querySelector(".link-suggest") as HTMLElement).hidden).toBe(true);
    expect(text(doc)).toEqual(["[[o]]"]);
  });
});

describe("pasting", () => {
  // jsdom has no ClipboardEvent, which ProseMirror's paste helpers create
  beforeEach(() => vi.stubGlobal("ClipboardEvent", class extends Event {}));
  afterEach(() => vi.unstubAllGlobals());

  it("links pasted [[Title]] text at once: journals locally, other titles through the server", async () => {
    const { doc, editor, linkPage } = setup([["x"]]);
    caret(editor, 2);
    editor.view.pasteText(" see [[Holiday]] on [[oct 28th, 2026]]");
    await settle();
    expect(linkPage).toHaveBeenCalledTimes(1);
    expect(linkPage).toHaveBeenCalledWith("Holiday");
    expect(linkSpans(editor.state.doc).map((sp) => sp.pageId)).toEqual(["newpage1", "journal-2026-10-28"]);
    expect(text(doc)).toEqual(["x see [[Holiday]] on [[oct 28th, 2026]]"]);
  });

  it("asks once for a title pasted many times", async () => {
    const { editor, linkPage } = setup([[""]]);
    caret(editor, 1);
    editor.view.pasteText("[[Holiday]] [[holiday]] [[Holiday]]");
    await settle();
    expect(linkPage).toHaveBeenCalledTimes(1);
    expect(linkSpans(editor.state.doc).map((sp) => sp.pageId)).toEqual(["newpage1", "newpage1", "newpage1"]);
  });

  it("keeps the page of a link copied from Mistlog, looking nothing up", async () => {
    const { editor, linkPage } = setup([[""]]);
    caret(editor, 1);
    editor.view.pasteHTML(`<p>see [[<span class="wikilink" data-page-id="${BOOKS}">Books</span>]]</p>`);
    await settle();
    expect(linkPage).not.toHaveBeenCalled();
    expect(linkSpans(editor.state.doc).map((sp) => [sp.inner, sp.pageId])).toEqual([["Books", BOOKS]]);
  });

  it("leaves unlinked [[text]] outside what was pasted alone", async () => {
    const { editor, linkPage } = setup([["[[Old]] "]]);
    caret(editor, 9);
    editor.view.pasteText("[[New]]");
    await settle();
    expect(linkPage.mock.calls.map((c) => c[0])).toEqual(["New"]);
  });

  it("treats dropped text like pasted text, and typing as neither", async () => {
    const { editor, linkPage } = setup([["x"]]);
    const typed = editor.state.tr.insertText("[[Typed]]", 2);
    expect(pastedRanges([typed])).toEqual([]);
    const dropped = editor.state.tr.insertText(" [[Dropped]]", 2).setMeta("uiEvent", "drop");
    expect(pastedRanges([dropped])).toEqual([[2, 14]]);
    editor.view.dispatch(dropped);
    await settle();
    expect(linkPage).toHaveBeenCalledWith("Dropped");
  });

  it("does nothing in suggest mode", async () => {
    const { editor, linkPage } = setup([[""]], { mode: "suggest" });
    caret(editor, 1);
    editor.view.pasteText("[[Holiday]]");
    await settle();
    expect(linkPage).not.toHaveBeenCalled();
  });

  it("stays unlinked and dashed if the page can't be had", async () => {
    const { editor } = setup([["x"]], { linkPage: async () => null });
    caret(editor, 2);
    editor.view.pasteText(" [[Holiday]]");
    await settle();
    expect(linkSpans(editor.state.doc)[0].pageId).toBeNull();
    expect(editor.view.dom.querySelector(".wikilink-pending")).not.toBeNull();
  });
});

describe("opening links", () => {
  it("opens the page on click, using its readable address, without moving the cursor", () => {
    const { editor, onOpen } = setup(SEE_LINK, { titles: fakeTitles({ [BOOKS]: { title: "Reading list", slug: "reading-list" } }) });
    caret(editor, 1);
    const el = editor.view.dom.querySelector(".wikilink")!;
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    el.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onOpen).toHaveBeenCalledWith("/page/reading-list", BOOKS, editor.view, false);
  });

  it.each([["Cmd", { metaKey: true }], ["Ctrl", { ctrlKey: true }]])("asks for the side panel on %s+click", (_name, mods) => {
    const { editor, onOpen } = setup(SEE_LINK);
    caret(editor, 1);
    editor.view.dom.querySelector(".wikilink")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ...mods }));
    expect(onOpen).toHaveBeenCalledWith(`/docs/${BOOKS}`, BOOKS, editor.view, true);
  });

  it("lets a click inside a link you are editing place the cursor", () => {
    const { editor, onOpen } = setup(SEE_LINK);
    caret(editor, INNER + 2);
    // A real click lands on the innermost element holding the title's text
    const walker = document.createTreeWalker(editor.view.dom, NodeFilter.SHOW_TEXT);
    let titleText: Node | null = null;
    while (walker.nextNode()) if (walker.currentNode.textContent === "Reading list") titleText = walker.currentNode;
    const target = titleText!.parentElement!;
    expect(target.closest("[data-page-id]")).not.toBeNull();
    // Ask our handler directly: letting mousedown through to ProseMirror would
    // need layout (elementFromPoint), which jsdom does not have
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    Object.defineProperty(down, "target", { value: target });
    const handled = editor.view.someProp("handleDOMEvents", (handlers) => handlers.mousedown?.(editor.view, down));
    expect(handled).toBeFalsy();
    expect(down.defaultPrevented).toBe(false);
    target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  describe("on a touch screen", () => {
    /** A touch event as our handler sees it (jsdom has no Touch), sent straight to the handler. */
    function touch(editor: Editor, type: "touchstart" | "touchend", target: Element, at: number, x = 10, y = 10) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      const point = [{ clientX: x, clientY: y }];
      Object.defineProperties(event, { target: { value: target }, timeStamp: { value: at }, touches: { value: type === "touchstart" ? point : [] }, changedTouches: { value: point } });
      const handled = editor.view.someProp("handleDOMEvents", (h) => h[type]?.(editor.view, event as TouchEvent));
      return { handled, prevented: event.defaultPrevented };
    }

    it("opens a link on a quick tap, so the caret never lands in it", () => {
      const { editor, onOpen } = setup(SEE_LINK, { titles: fakeTitles({ [BOOKS]: { title: "Reading list", slug: "reading-list" } }) });
      const el = editor.view.dom.querySelector(".wikilink")!;
      touch(editor, "touchstart", el, 100);
      expect(touch(editor, "touchend", el, 250, 13, 12)).toEqual({ handled: true, prevented: true });
      expect(onOpen).toHaveBeenCalledWith("/page/reading-list", BOOKS, editor.view, false);
    });

    it("leaves a scroll, a long press (to edit the link) and a tap on another link to the browser", () => {
      const { editor, onOpen } = setup(SEE_LINK);
      const el = editor.view.dom.querySelector(".wikilink")!;
      touch(editor, "touchstart", el, 100);
      expect(touch(editor, "touchend", el, 200, 10, 40).prevented).toBe(false);
      touch(editor, "touchstart", el, 100);
      expect(touch(editor, "touchend", el, 100 + TAP_MAX_MS + 1).prevented).toBe(false);
      touch(editor, "touchstart", el, 100);
      expect(touch(editor, "touchend", editor.view.dom, 150).prevented).toBe(false);
      // A touchend with no touchstart on a link before it
      expect(touch(editor, "touchend", el, 150).prevented).toBe(false);
      expect(onOpen).not.toHaveBeenCalled();
    });

    it("after a long press, lets the mouse events a browser sends place the caret instead of opening", () => {
      const { editor, onOpen } = setup(SEE_LINK);
      const el = editor.view.dom.querySelector(".wikilink")!;
      touch(editor, "touchstart", el, 100);
      touch(editor, "touchend", el, 100 + TAP_MAX_MS + 100);
      const mouse = (type: string, at: number) => {
        const event = new MouseEvent(type, { bubbles: true, cancelable: true });
        Object.defineProperties(event, { target: { value: el }, timeStamp: { value: at } });
        return editor.view.someProp("handleDOMEvents", (h) => (h as Record<string, (v: unknown, e: Event) => boolean>)[type]?.(editor.view, event));
      };
      expect(mouse("mousedown", 800)).toBeFalsy();
      expect(mouse("click", 810)).toBeFalsy();
      expect(onOpen).not.toHaveBeenCalled();
      // Much later, a click opens it again
      expect(mouse("click", 5000)).toBe(true);
      expect(onOpen).toHaveBeenCalledTimes(1);
    });

    it("lets a tap inside a link you are editing place the cursor", () => {
      const { editor, onOpen } = setup(SEE_LINK);
      caret(editor, INNER + 2);
      const target = editor.view.dom.querySelector(".wikilink-editing") ?? editor.view.dom;
      touch(editor, "touchstart", target, 100);
      expect(touch(editor, "touchend", target, 150).prevented).toBe(false);
      expect(onOpen).not.toHaveBeenCalled();
    });
  });

  it("opens the link the cursor is in or just after with Alt+Enter", () => {
    const { editor, onOpen } = setup([["[[", ["Oct 28th, 2026", "journal-2026-10-28"], "]] notes"]]);
    caret(editor, 19);
    expect(press(editor, "Enter", { altKey: true })).toBe(true);
    expect(onOpen).toHaveBeenCalledWith("/journal/2026-10-28", "journal-2026-10-28", editor.view, false);
    expect(press(editor, "Enter", { altKey: true, shiftKey: true })).toBe(true);
    expect(onOpen).toHaveBeenLastCalledWith("/journal/2026-10-28", "journal-2026-10-28", editor.view, true);
  });

  it("by default asks the page around the editor to open it", () => {
    const doc = yDoc(SEE_LINK);
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({ element, extensions: [Document, Paragraph, Text, Collaboration.configure({ document: doc }), Wikilink.configure({ titles: fakeTitles() })] });
    editors.push(editor);
    const opened: unknown[] = [];
    element.addEventListener(OPEN_LINK_EVENT, (e) => {
      e.preventDefault();
      opened.push((e as CustomEvent).detail);
    });
    editor.view.dom.querySelector("[data-page-id]")!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
    expect(opened).toEqual([{ href: `/docs/${BOOKS}`, pageId: BOOKS, side: true }]);
  });
});

describe("copying as plain text", () => {
  it("writes each link's current title between its brackets", () => {
    const titles = fakeTitles({ [BOOKS]: { title: "Books" } });
    const { editor } = setup([...SEE_LINK, ["next"]], { titles });
    const { doc } = editor.state;
    expect(clipboardText(doc.slice(1, 1 + "see [[Reading list]] here".length), titles)).toBe("see [[Books]] here");
    expect(clipboardText(doc.slice(0, doc.content.size), titles)).toBe("see [[Books]] here\n\nnext");
  });

  it("writes a split link once, and the stored copy for missing pages", () => {
    const titles = fakeTitles({ [NOVELS]: { missing: true } });
    const { editor } = setup([["[[", ["Read", BOOKS], ["ing", BOOKS, "added"], "]] [[", ["Old", NOVELS], "]]"]], { titles });
    const { doc } = editor.state;
    expect(clipboardText(doc.slice(0, doc.content.size), titles)).toBe("[[Reading]] [[Old]]");
  });
});

describe("tags (F45)", () => {
  const page = (pageId: string, title: string): LinkPage => ({ pageId, title, kind: "page", slug: null, empty: false });

  it("finds #tags and #[[multi word]] tags as tags, and their brackets are not a separate link", () => {
    const { editor } = setup([["see #books, #[[Reading list]] and [[Novels]] `#code` #42 a#b # heading"]]);
    expect(linkSpans(editor.state.doc).map((s) => [s.kind, s.bracketed, s.inner])).toEqual([
      ["tag", false, "books"], // the comma ends it
      ["tag", true, "Reading list"],
      ["link", true, "Novels"],
    ]);
  });

  it("links a typed #tag when you move on, creating its page if need be", async () => {
    const { doc, editor, linkPage } = setup([["x"]], { linkPage: async (title) => page(NOVELS, title) });
    caret(editor, 2);
    type(editor, " #novels");
    expect(linkPage).not.toHaveBeenCalled(); // still typing it
    type(editor, " ");
    await settle();
    expect(linkPage).toHaveBeenCalledWith("novels");
    expect(text(doc)).toEqual(["x #novels "]);
    expect(links(doc)).toEqual([NOVELS]);
  });

  it("suggests pages as you type a tag, and choosing one writes it as #name or #[[name]], then a space", async () => {
    vi.useFakeTimers();
    const pages = [page(NOVELS, "Novels"), page(BOOKS, "Reading list")];
    const { doc, editor, search } = setup([[""]], { pages });
    caret(editor, 1);
    type(editor, "#no");
    await vi.advanceTimersByTimeAsync(200);
    expect(search).toHaveBeenLastCalledWith("no");
    expect([...document.querySelectorAll(".link-suggest [role=option]")].map((o) => o.textContent)).toEqual(["Novels", "Reading list", "New page: no"]);
    press(editor, "Enter");
    expect(text(doc)).toEqual(["#Novels "]);
    expect(links(doc)).toEqual([NOVELS]);
    expect(editor.state.selection.head).toBe(editor.state.doc.content.size - 1);
    type(editor, "#re");
    await vi.advanceTimersByTimeAsync(200);
    press(editor, "ArrowDown");
    press(editor, "Enter");
    expect(text(doc)).toEqual(["#Novels #[[Reading list]] "]);
    expect(links(doc)).toEqual([NOVELS, BOOKS]);
  });

  it("suggests from the first letter of a new tag", async () => {
    vi.useFakeTimers();
    const { editor, search } = setup([[""]], { pages: [page(NOVELS, "Novels")] });
    caret(editor, 1);
    type(editor, "#n");
    await vi.advanceTimersByTimeAsync(200);
    expect(search).toHaveBeenLastCalledWith("n");
    expect([...document.querySelectorAll(".link-suggest:not([hidden]) [role=option]")].map((o) => o.textContent)).toContain("Novels");
  });

  it("shows a tag's current title, styled as a tag", () => {
    const { editor } = setup([["see #", ["books", BOOKS], " here"]], { titles: fakeTitles({ [BOOKS]: { title: "Bookshelf" } }) });
    expect(editor.view.dom.querySelector(".wikilink-shown")?.textContent).toBe("Bookshelf");
    expect(editor.view.dom.querySelector(".wikilink-shown")?.classList.contains("tag")).toBe(true);
    expect(editor.view.dom.querySelector(".wikilink-bracket.tag")?.textContent).toBe("#");
  });

  it("rewrites a plain #tag as #[[...]] when your cursor enters it after its page gained a space", () => {
    const { doc, editor } = setup([["see #", ["books", BOOKS], " here"]], { titles: fakeTitles({ [BOOKS]: { title: "Reading list" } }) });
    caret(editor, 7);
    expect(text(doc)).toEqual(["see #[[Reading list]] here"]);
    expect(links(doc)).toEqual([BOOKS]);
  });

  it("copies a plain #tag to a page now titled with spaces as #[[...]]", () => {
    const { editor } = setup([["see #", ["books", BOOKS], " here"]], { titles: fakeTitles({ [BOOKS]: { title: "Reading list" } }) });
    expect(clipboardText(editor.state.doc.slice(0, editor.state.doc.content.size), fakeTitles({ [BOOKS]: { title: "Reading list" } }))).toBe("see #[[Reading list]] here");
  });

  it("counts as a link to its page in the index (so it shows in linked references)", () => {
    const { doc } = setup([["see #", ["books", BOOKS], " and #[[", ["Reading list", NOVELS], "]]"]]);
    expect(links(doc)).toEqual([BOOKS, NOVELS]);
    expect(parseNote(linesFromYjs(doc.getXmlFragment("default"))).tags.map((t) => t.name)).toEqual(["books", "Reading list"]);
  });

  describe("pasted", () => {
    beforeEach(() => vi.stubGlobal("ClipboardEvent", class extends Event {}));
    afterEach(() => vi.unstubAllGlobals());

    it("links pasted #tags and #[[tags]] at once, by the same rules as [[links]]", async () => {
      const { doc, editor, linkPage } = setup([["x"]]);
      caret(editor, 2);
      editor.view.pasteText(" #garden and #[[Reading list]] and #[[oct 28th, 2026]]");
      await settle();
      expect(linkPage.mock.calls.map((c) => c[0]).sort()).toEqual(["Reading list", "garden"]);
      expect(linkSpans(editor.state.doc).map((s) => [s.kind, s.pageId])).toEqual([
        ["tag", "newpage1"],
        ["tag", "newpage1"],
        ["tag", "journal-2026-10-28"],
      ]);
      expect(text(doc)).toEqual(["x #garden and #[[Reading list]] and #[[oct 28th, 2026]]"]);
    });
  });
});
