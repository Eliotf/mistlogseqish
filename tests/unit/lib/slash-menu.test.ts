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
import { SlashMenu } from "~/lib/slash-menu";
import { headingEdit, matchCommands, SLASH_COMMANDS } from "~/lib/slash-commands";
import { linesFromYjs } from "~/lib/note-lines";

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
  document.querySelectorAll(".link-suggest").forEach((el) => el.remove());
  vi.useRealTimers();
});

function setup(line = "", opts: { mode?: "edit" | "suggest" } = {}) {
  const doc = new Y.Doc();
  const t = new Y.XmlText();
  t.insert(0, line);
  const p = new Y.XmlElement("paragraph");
  p.insert(0, [t]);
  doc.getXmlFragment("default").insert(0, [p]);
  const titles: TitleSource = { get: () => undefined, request: () => {}, subscribe: () => () => {} };
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
      Wikilink.configure({ titles, docState, onOpen: vi.fn(), search: async () => [], linkPage: async () => null, today: () => "2026-10-20" }),
      DateTrigger.configure({ docState, today: () => "2026-10-20" }),
      SlashMenu.configure({ docState }),
    ],
  });
  editors.push(editor);
  editor.view.dom.dispatchEvent(new FocusEvent("focus"));
  editor.commands.setTextSelection(editor.state.doc.content.size - 1);
  return { doc, editor };
}

const text = (doc: Y.Doc) => linesFromYjs(doc.getXmlFragment("default")).map((l) => l.text);
const press = (editor: Editor, key: string) => editor.view.someProp("handleKeyDown", (f) => f(editor.view, new KeyboardEvent("keydown", { key, cancelable: true }))) ?? false;
function type(editor: Editor, chars: string) {
  for (const ch of chars) {
    const { from, to } = editor.state.selection;
    const handled = editor.view.someProp("handleTextInput", (f) => f(editor.view, from, to, ch, () => editor.state.tr.insertText(ch, from, to)));
    if (!handled) editor.view.dispatch(editor.state.tr.insertText(ch, from, to));
  }
}
const menu = (label = "Commands") => document.querySelector<HTMLElement>(`.link-suggest[aria-label="${label}"]:not([hidden])`);
const options = (label?: string) => [...(menu(label)?.querySelectorAll("[role=option]") ?? [])].map((o) => o.firstChild?.textContent);

describe("matchCommands", () => {
  it("lists every command for a bare /, and narrows by label first, then other words", () => {
    expect(matchCommands("")).toHaveLength(SLASH_COMMANDS.length);
    expect(matchCommands("la").map((c) => c.id)).toEqual(["LATER"]);
    expect(matchCommands("Do").map((c) => c.id)).toEqual(["DOING", "DONE", "TODO"]);
    expect(matchCommands("head").map((c) => c.id)).toEqual(["heading-1", "heading-2", "heading-3"]);
    expect(matchCommands("heading 2").map((c) => c.id)).toEqual(["heading-2"]);
    expect(matchCommands("h2").map((c) => c.id)).toEqual(["heading-2"]);
    expect(matchCommands("task").map((c) => c.id)).toEqual(["TODO", "DOING", "LATER", "NOW", "DONE"]);
    expect(matchCommands("tom").map((c) => c.id)).toEqual(["date"]);
    expect(matchCommands("zzz")).toEqual([]);
  });
});

describe("headingEdit", () => {
  const apply = (text: string, level: number | null) => {
    const e = headingEdit(0, text, level);
    return text.slice(0, e.from) + e.text + text.slice(e.to);
  };

  it("puts #s after the bullet, replacing a heading the line has, or removes it", () => {
    expect(apply("- notes", 2)).toBe("- ## notes");
    expect(apply("\t\t- notes", 1)).toBe("\t\t- # notes");
    expect(apply("- ### notes", 1)).toBe("- # notes");
    expect(apply("- ## notes", null)).toBe("- notes");
    expect(apply("plain", 3)).toBe("### plain");
    expect(apply("-", 2)).toBe("- ## ");
    expect(apply("- #tag stays", 2)).toBe("- ## #tag stays");
    // A task stays a task: the heading goes after its keyword
    expect(apply("- LATER plans", 2)).toBe("- LATER ## plans");
    expect(apply("\t- TODO # old", 3)).toBe("\t- TODO ### old");
    expect(apply("- DONE ## x", null)).toBe("- DONE x");
  });
});

describe("the / menu (F44)", () => {
  it("opens on / at the start of a line, narrows as you type, and sets a task keyword", () => {
    const { doc, editor } = setup("- buy milk");
    editor.commands.setTextSelection(3);
    type(editor, "/");
    expect(options()).toHaveLength(SLASH_COMMANDS.length);
    type(editor, "lat");
    expect(options()).toEqual(["LATER"]);
    expect(press(editor, "Enter")).toBe(true);
    expect(text(doc)).toEqual(["- LATER buy milk"]);
    expect(menu()).toBeNull();
  });

  it("replaces a task keyword the line has, and undoes in one go", () => {
    const { doc, editor } = setup("- TODO call ");
    type(editor, "/now");
    press(editor, "Enter");
    expect(text(doc)).toEqual(["- NOW call "]);
    // Yjs groups edits made close together, so this also takes back the typed "/now"; never half a command
    editor.commands.undo();
    expect(text(doc)).toEqual(["- TODO call "]);
  });

  it("makes headings, choosing with the arrow keys", () => {
    const { doc, editor } = setup("- Plans ");
    type(editor, "/head");
    press(editor, "ArrowDown");
    expect(menu()!.querySelector("[aria-selected=true]")?.firstChild?.textContent).toBe("Heading 2");
    press(editor, "Tab");
    expect(text(doc)).toEqual(["- ## Plans "]);
  });

  it("opens a link, whose own suggestions then show, and the date list", async () => {
    vi.useFakeTimers();
    const { doc, editor } = setup("see ");
    type(editor, "/link");
    press(editor, "Enter");
    expect(text(doc)).toEqual(["see [[]]"]);
    expect(editor.state.selection.head).toBe(7);

    const dated = setup("due ");
    type(dated.editor, "/date");
    press(dated.editor, "Enter");
    expect(text(dated.doc)).toEqual(["due @"]);
    expect(options("Link to a date")[0]).toBe("Oct 20th, 2026");
    type(dated.editor, "tomorrow");
    press(dated.editor, "Enter");
    expect(text(dated.doc)).toEqual(["due [[Oct 21st, 2026]]"]);
  });

  it("stays plain text mid-word, after / and a space, in a link, and in suggest mode", () => {
    const { doc, editor } = setup("and");
    type(editor, "/or");
    expect(menu()).toBeNull();
    type(editor, " / x");
    expect(menu()).toBeNull();
    type(editor, " [[a ");
    type(editor, "/b");
    expect(menu()).toBeNull();
    expect(text(doc)).toEqual(["and/or / x [[a /b]]"]);

    const suggesting = setup("", { mode: "suggest" });
    type(suggesting.editor, "/to");
    expect(menu()).toBeNull();
  });

  it("closes with Escape and leaves the text; says when nothing matches", () => {
    const { doc, editor } = setup();
    type(editor, "/zz");
    expect(menu()!.textContent).toBe("No command matches “zz”.");
    expect(press(editor, "Escape")).toBe(true);
    expect(menu()).toBeNull();
    type(editor, "z");
    expect(menu()).toBeNull();
    expect(text(doc)).toEqual(["/zzz"]);
  });

  it("closes when the editor loses focus or the text gets long", () => {
    const { editor } = setup();
    type(editor, "/to");
    editor.view.dom.dispatchEvent(new FocusEvent("blur"));
    expect(menu()).toBeNull();
    type(editor, " /");
    type(editor, "x".repeat(21));
    expect(menu()).toBeNull();
  });
});
