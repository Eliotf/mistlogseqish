// @vitest-environment jsdom
/**
 * Writing a Logseq import's lines into a Yjs document on the server, and
 * removing them again (PRD F31). The round-trip test opens the result in the
 * real editor, so lines the server writes are the lines the editor reads.
 */
import { describe, it, expect, afterEach } from "vitest";
import * as Y from "yjs";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import Collaboration from "@tiptap/extension-collaboration";
import { BlockParagraph } from "~/lib/block-id-editing";
import { Folding } from "~/lib/folding-editing";
import { Wikilink } from "~/lib/wikilink-editing";
import { linesFromProseMirror, linesFromYjs } from "~/lib/note-lines";
import { appendImportedLines, isImportedLines, removeImportedLines, type ImportedLine } from "~/lib/import-lines";

const ID_A = "6550c4d2-1111-4abc-8def-0123456789ab";
const ID_B = "6550c4d2-2222-4abc-8def-0123456789ab";
const PAGE = "abcd1234";

const line = (text: string, extra: Partial<ImportedLine> = {}): ImportedLine => ({ text, blockId: null, collapsed: false, links: [], ...extra });

function docWith(texts: string[], ids: string[] = []): Y.Doc {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("default");
  texts.forEach((text, i) => {
    const p = new Y.XmlElement("paragraph");
    if (ids[i]) p.setAttribute("blockId", ids[i]);
    p.insert(0, [new Y.XmlText(text)]);
    frag.insert(frag.length, [p]);
  });
  return doc;
}

const editors: Editor[] = [];
afterEach(() => {
  editors.splice(0).forEach((e) => e.destroy());
});

describe("appendImportedLines", () => {
  it("adds lines below what is there, with their IDs, folds and links, and returns the IDs it used", () => {
    const doc = docWith(["- mine"], [ID_B]);
    const frag = doc.getXmlFragment("default");
    let added: string[] = [];
    doc.transact(() => {
      added = appendImportedLines(frag, [
        line("- read [[Novels]] #books", { blockId: ID_A, collapsed: true, links: [{ from: 9, to: 15, pageId: PAGE }, { from: 19, to: 24, pageId: "journal-2026-11-04" }] }),
        line("\t- child"),
      ]);
    });
    const lines = linesFromYjs(frag);
    expect(lines.map((l) => l.text)).toEqual(["- mine", "- read [[Novels]] #books", "\t- child"]);
    expect(added[0]).toBe(ID_A);
    expect(lines[1].id).toBe(ID_A);
    expect(lines[2].id).toBe(added[1]);
    expect(lines[1].marks).toEqual([
      { type: "wikilink", from: 9, to: 15, attrs: { pageId: PAGE } },
      { type: "wikilink", from: 19, to: 24, attrs: { pageId: "journal-2026-11-04" } },
    ]);
    expect((frag.get(1) as Y.XmlElement).getAttribute("collapsed")).toBe(true);
    expect((frag.get(2) as Y.XmlElement).getAttribute("collapsed")).toBeUndefined();
  });

  it("gives a line a new ID when the document already uses its ID, or an earlier line does", () => {
    const doc = docWith(["- mine"], [ID_A]);
    const added = appendImportedLines(doc.getXmlFragment("default"), [line("- a", { blockId: ID_A }), line("- b", { blockId: ID_B }), line("- c", { blockId: ID_B })]);
    expect(added[0]).not.toBe(ID_A);
    expect(added[1]).toBe(ID_B);
    expect(added[2]).not.toBe(ID_B);
    expect(new Set([ID_A, ...added]).size).toBe(4);
  });

  it("writes lines the real editor reads back the same: text, links, IDs and folds", () => {
    const doc = docWith([]);
    appendImportedLines(doc.getXmlFragment("default"), [
      line("- see [[Books]] today", { blockId: ID_A, collapsed: true, links: [{ from: 8, to: 13, pageId: PAGE }] }),
      line("\t- child", { blockId: ID_B }),
      line(""),
    ]);
    const before = linesFromYjs(doc.getXmlFragment("default"));
    const editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, BlockParagraph, Text, Collaboration.configure({ document: doc }), Folding.configure({ docState: { get: () => undefined } }), Wikilink],
    });
    editors.push(editor);
    const read = linesFromProseMirror(editor.state.doc);
    expect(read.map((l) => [l.text, l.id])).toEqual(before.map((l) => [l.text, l.id]));
    expect(read[0].marks).toEqual([{ type: "wikilink", from: 8, to: 13, attrs: { pageId: PAGE } }]);
    expect(editor.state.doc.child(0).attrs.collapsed).toBe(true);
    // Opening it changed nothing in the document
    expect(linesFromYjs(doc.getXmlFragment("default"))).toEqual(before);
  });
});

describe("removeImportedLines", () => {
  it("removes exactly the lines with these IDs, wherever they are and whatever they say now", () => {
    const doc = docWith(["- mine", "- imported, edited since", "- also mine", "\t- imported"], ["", ID_A, "", ID_B]);
    const frag = doc.getXmlFragment("default");
    expect(removeImportedLines(frag, [ID_A, ID_B, "6550c4d2-3333-4abc-8def-0123456789ab"])).toBe(2);
    expect(linesFromYjs(frag).map((l) => l.text)).toEqual(["- mine", "- also mine"]);
    expect(removeImportedLines(frag, [ID_A])).toBe(0);
  });
});

describe("isImportedLines", () => {
  it("accepts well-formed lines", () => {
    expect(isImportedLines([line("- [[A]]", { blockId: ID_A, links: [{ from: 4, to: 5, pageId: PAGE }] })])).toBe(true);
    expect(isImportedLines([])).toBe(true);
  });

  it.each([
    ["not a list", "x"],
    ["a line break in the text", [line("a\nb")]],
    ["a bad block ID", [line("a", { blockId: "nope" })]],
    ["a missing fold", [{ text: "a", blockId: null, links: [] }]],
    ["a link outside the text", [line("ab", { links: [{ from: 1, to: 3, pageId: PAGE }] })]],
    ["an empty link", [line("ab", { links: [{ from: 1, to: 1, pageId: PAGE }] })]],
    ["overlapping links", [line("abcd", { links: [{ from: 0, to: 3, pageId: PAGE }, { from: 2, to: 4, pageId: PAGE }] })]],
    ["a bad page ID", [line("ab", { links: [{ from: 0, to: 1, pageId: "../x" }] })]],
  ])("refuses %s", (_name, value) => {
    expect(isImportedLines(value)).toBe(false);
  });
});
