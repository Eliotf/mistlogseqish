// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import * as Y from "yjs";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import Collaboration from "@tiptap/extension-collaboration";
import { Wikilink, type TitleSource } from "~/lib/wikilink-editing";
import { DateTrigger } from "~/lib/date-trigger";
import { runPhoneAction } from "~/lib/phone-actions";
import type { LinkPage } from "~/lib/page-titles";
import { linesFromYjs } from "~/lib/note-lines";
import { parseNote } from "~/lib/note-parser";

// A Tuesday
const TODAY = "2026-10-20";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
  document.querySelectorAll(".link-suggest").forEach((el) => el.remove());
  vi.useRealTimers();
});

function setup(line = "", opts: { mode?: "edit" | "suggest"; pages?: LinkPage[] } = {}) {
  const doc = new Y.Doc();
  const t = new Y.XmlText();
  t.insert(0, line);
  const p = new Y.XmlElement("paragraph");
  p.insert(0, [t]);
  doc.getXmlFragment("default").insert(0, [p]);
  const requested: string[] = [];
  const titles: TitleSource = { get: () => undefined, request: (ids) => requested.push(...ids), subscribe: () => () => {} };
  const docState = { get: (k: string) => (k === "mode" ? (opts.mode ?? "edit") : undefined) };
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: [
      Document,
      Paragraph,
      Text,
      Collaboration.configure({ document: doc }),
      Wikilink.configure({ titles, docState, onOpen: vi.fn(), search: async () => opts.pages ?? [], linkPage: async () => null, today: () => TODAY }),
      DateTrigger.configure({ docState, today: () => TODAY }),
    ],
  });
  editors.push(editor);
  editor.view.dom.dispatchEvent(new FocusEvent("focus"));
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  return { doc, editor, requested };
}

const text = (doc: Y.Doc) => linesFromYjs(doc.getXmlFragment("default")).map((l) => l.text);
const links = (doc: Y.Doc) => parseNote(linesFromYjs(doc.getXmlFragment("default"))).links.map((l) => l.pageId);
const press = (editor: Editor, key: string) => editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key, cancelable: true }))) ?? false;
function type(editor: Editor, chars: string) {
  for (const ch of chars) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, from, to, ch, () => editor.state.tr.insertText(ch, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
}
const list = () => document.querySelector<HTMLElement>('.link-suggest[aria-label="Link to a date"]');
const options = () => [...(list()?.querySelectorAll("[role=option]") ?? [])].map((o) => o.textContent);
const shown = () => !!list() && !list()!.hidden;

describe("@ dates (F20)", () => {
  it("links the chosen day's journal: @in 2 weeks from Oct 20th is Nov 3rd", () => {
    const { doc, editor, requested } = setup("meet ");
    type(editor, "@in 2 weeks");
    expect(options()).toEqual(["Nov 3rd, 2026in 2 weeks"]);
    expect(press(editor, "Enter")).toBe(true);
    expect(text(doc)).toEqual(["meet [[Nov 3rd, 2026]]"]);
    expect(links(doc)).toEqual(["journal-2026-11-03"]);
    expect(requested).toContain("journal-2026-11-03");
    // The cursor is after the link, and the list is gone
    expect(editor.state.selection.head).toBe(editor.state.doc.content.size - 1);
    expect(shown()).toBe(false);
  });

  it("opens at the start of a line, lists common days, and moves with the arrow keys", () => {
    const { doc, editor } = setup();
    type(editor, "@");
    expect(options().map((o) => o!.split(",")[0])).toEqual(["Oct 20th", "Oct 21st", "Oct 19th", "Oct 26th", "Oct 27th"]);
    press(editor, "ArrowDown");
    expect(list()!.querySelector("[aria-selected=true]")?.textContent).toBe("Oct 21st, 2026tomorrow");
    expect(press(editor, "Tab")).toBe(true);
    expect(text(doc)).toEqual(["[[Oct 21st, 2026]]"]);
  });

  it("completes a partial phrase", () => {
    const { doc, editor } = setup("call ");
    type(editor, "@next fr");
    expect(options()).toEqual(["Oct 30th, 2026next friday"]);
    press(editor, "Enter");
    expect(text(doc)).toEqual(["call [[Oct 30th, 2026]]"]);
  });

  it("stays plain text in an email address, and after @ and a space", () => {
    const { doc, editor } = setup("mail me");
    type(editor, "@home.org");
    expect(shown()).toBe(false);
    type(editor, " @ today");
    expect(shown()).toBe(false);
    expect(text(doc)).toEqual(["mail me@home.org @ today"]);
    expect(links(doc)).toEqual([]);
  });

  it("closes with Escape and leaves what was typed", () => {
    const { doc, editor } = setup();
    type(editor, "@tomorrow");
    expect(shown()).toBe(true);
    expect(press(editor, "Escape")).toBe(true);
    expect(shown()).toBe(false);
    // Closed for good: typing on doesn't reopen it
    type(editor, "s");
    expect(shown()).toBe(false);
    expect(text(doc)).toEqual(["@tomorrows"]);
  });

  it("says when nothing matches, and then leaves Enter to start a new line", () => {
    const { doc, editor } = setup();
    type(editor, "@soon");
    expect(shown()).toBe(true);
    expect(list()!.textContent).toBe("No date matches “soon”. Try “next fri” or “in 2 weeks”.");
    press(editor, "Enter");
    expect(links(doc)).toEqual([]);
    expect(text(doc)[0]).toBe("@soon");
    expect(shown()).toBe(false);
  });

  it("closes when the cursor leaves the phrase, the @ is deleted, the text gets long, or the editor loses focus", () => {
    const { editor } = setup("x ");
    type(editor, "@to");
    editor.commands.setTextSelection(1);
    expect(shown()).toBe(false);

    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    type(editor, " @to");
    expect(shown()).toBe(true);
    const at = editor.state.doc.textContent.lastIndexOf("@") + 1;
    editor.view.dispatch(editor.state.tr.delete(at, at + 1));
    expect(shown()).toBe(false);

    type(editor, " @");
    type(editor, "a".repeat(25));
    expect(shown()).toBe(false);

    type(editor, " @to");
    expect(shown()).toBe(true);
    editor.view.dom.dispatchEvent(new FocusEvent("blur"));
    expect(shown()).toBe(false);
  });

  it("does nothing inside a link or in suggest mode", () => {
    const { doc, editor } = setup();
    type(editor, "[[a ");
    type(editor, "@to");
    expect(shown()).toBe(false);
    expect(text(doc)).toEqual(["[[a @to]]"]);

    const suggesting = setup("", { mode: "suggest" });
    type(suggesting.editor, "@to");
    expect(shown()).toBe(false);
  });

  it("is what the phone toolbar's Date button types, with a space first after a word", () => {
    const { doc, editor } = setup("see");
    expect(runPhoneAction(editor, "date", false)).toBe(true);
    expect(shown()).toBe(true);
    type(editor, "tomorrow");
    press(editor, "Enter");
    expect(text(doc)).toEqual(["see [[Oct 21st, 2026]]"]);
    // In suggest mode too: adding a date isn't an outline change
    expect(runPhoneAction(editor, "date", true)).toBe(true);
  });
});

describe("dates in [[ ]] suggestions (F20)", () => {
  it("lists matching days below the pages, and choosing one links its journal", async () => {
    vi.useFakeTimers();
    const pages: LinkPage[] = [{ pageId: "abcd1234", title: "Next steps", kind: "page", slug: null, empty: false }];
    const { doc, editor, requested } = setup("", { pages });
    type(editor, "[[next f");
    await vi.advanceTimersByTimeAsync(200);
    const items = [...document.querySelectorAll('.link-suggest[aria-label="Link to page"] [role=option]')].map((o) => o.textContent);
    expect(items).toEqual(["Next steps", "Oct 30th, 2026next friday", "New page: next f"]);
    press(editor, "ArrowDown");
    expect(press(editor, "Enter")).toBe(true);
    expect(text(doc)).toEqual(["[[Oct 30th, 2026]]"]);
    expect(links(doc)).toEqual(["journal-2026-10-30"]);
    expect(requested).toContain("journal-2026-10-30");
  });

  it("doesn't list a day already among the pages, offers at most three, and none for tags", async () => {
    vi.useFakeTimers();
    const pages: LinkPage[] = [{ pageId: "journal-2026-10-21", title: "Oct 21st, 2026", kind: "journal", slug: null, empty: false }];
    const { editor } = setup("", { pages });
    type(editor, "[[t");
    await vi.advanceTimersByTimeAsync(200);
    const items = () => [...document.querySelectorAll('.link-suggest[aria-label="Link to page"]:not([hidden]) [role=option]')].map((o) => o.textContent);
    // "t": today, tomorrow (already listed as a page), tuesday, thursday...
    expect(items()).toEqual(["Oct 21st, 2026", "Oct 20th, 2026today", "Oct 27th, 2026tuesday", "Oct 22nd, 2026thursday", "New page: t"]);
    press(editor, "Escape");

    // Seven "last ..." days match; three are offered
    const many = setup("", { pages: [] });
    type(many.editor, "[[last");
    await vi.advanceTimersByTimeAsync(200);
    expect(items().filter((i) => i?.includes("2026"))).toHaveLength(3);
    press(many.editor, "Escape");

    const tag = setup("", { pages: [] });
    type(tag.editor, "#tomorrow");
    await vi.advanceTimersByTimeAsync(200);
    expect(items().some((i) => i?.includes("2026"))).toBe(false);
  });
});
