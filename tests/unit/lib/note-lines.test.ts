/**
 * Converting documents into parser lines, and the wikilink mark's round trip
 * through Yjs. The round-trip tests use y-tiptap's converters, the same code
 * the live editor uses to sync ProseMirror with Yjs.
 */
import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { prosemirrorToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from "@tiptap/y-tiptap";
import { linesFromYjs, linesFromProseMirror } from "~/lib/note-lines";
import { parseNote } from "~/lib/note-parser";
import { WIKILINK_MARK, wikilinkMarkSpec, isWikilinkAttrs } from "~/lib/wikilink";

const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", toDOM: () => ["p", 0] as const },
    text: { inline: true },
  },
  marks: {
    [WIKILINK_MARK]: wikilinkMarkSpec,
    criticHighlight: { inclusive: false, attrs: { threadId: { default: null } } },
    criticAddition: { inclusive: false },
  },
});

/** Build a doc from lines of [text, marks] runs. */
function pmDoc(lines: Array<Array<[string, Array<[string, Record<string, unknown>?]>?]>>): ProseMirrorNode {
  return schema.node(
    "doc",
    null,
    lines.map((runs) =>
      schema.node(
        "paragraph",
        null,
        runs.map(([text, marks = []]) => schema.text(text, marks.map(([name, attrs]) => schema.mark(name, attrs)))),
      ),
    ),
  );
}

function toYjs(doc: ProseMirrorNode): Y.XmlFragment {
  const ydoc = new Y.Doc();
  const frag = ydoc.getXmlFragment("default");
  prosemirrorToYXmlFragment(doc, frag);
  return frag;
}

const SAMPLE = pmDoc([
  [["- TODO read "], ["Mistlog", [[WIKILINK_MARK, { pageId: "abcd1234" }]]], [" #reading"]],
  [["\t- see "], ["Oct 22nd, 2026", [[WIKILINK_MARK, { pageId: "journal-2026-10-22" }]]]],
  [],
  [["plain "], ["highlighted", [["criticHighlight", { threadId: "t1" }]]]],
]);

describe("wikilink mark", () => {
  it("defaults pageId to null and validates attrs", () => {
    expect(schema.marks[WIKILINK_MARK].create().attrs).toEqual({ pageId: null });
    expect(isWikilinkAttrs({ pageId: "abcd1234" })).toBe(true);
    expect(isWikilinkAttrs({ pageId: null })).toBe(false);
    expect(isWikilinkAttrs(null)).toBe(false);
    expect(isWikilinkAttrs("abcd1234")).toBe(false);
  });

  it("is not inclusive, so typing at a link's edge does not extend it", () => {
    expect(schema.marks[WIKILINK_MARK].spec.inclusive).toBe(false);
  });

  it("renders and parses its DOM form", () => {
    const mark = schema.marks[WIKILINK_MARK].create({ pageId: "abcd1234" });
    const out = wikilinkMarkSpec.toDOM!(mark, true) as [string, Record<string, string>, number];
    expect(out[1]["data-page-id"]).toBe("abcd1234");
    const el = { getAttribute: (name: string) => (name === "data-page-id" ? "abcd1234" : null) };
    const rule = wikilinkMarkSpec.parseDOM![0] as { getAttrs: (dom: typeof el) => unknown };
    expect(rule.getAttrs(el)).toEqual({ pageId: "abcd1234" });
  });

  it("keeps its pageId through a ProseMirror -> Yjs -> ProseMirror round trip", () => {
    const back = yXmlFragmentToProseMirrorRootNode(toYjs(SAMPLE), schema);
    expect(back.eq(SAMPLE)).toBe(true);
    const marks: string[] = [];
    back.descendants((n) => {
      n.marks.forEach((m) => m.type.name === WIKILINK_MARK && marks.push(m.attrs.pageId as string));
    });
    expect(marks).toEqual(["abcd1234", "journal-2026-10-22"]);
  });

  it("survives syncing to a second Yjs client", () => {
    const a = new Y.Doc();
    prosemirrorToYXmlFragment(SAMPLE, a.getXmlFragment("default"));
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(yXmlFragmentToProseMirrorRootNode(b.getXmlFragment("default"), schema).eq(SAMPLE)).toBe(true);
  });
});

describe("linesFromProseMirror", () => {
  it("returns one line per paragraph with text and mark ranges", () => {
    const lines = linesFromProseMirror(SAMPLE);
    expect(lines.map((l) => l.text)).toEqual(["- TODO read Mistlog #reading", "\t- see Oct 22nd, 2026", "", "plain highlighted"]);
    expect(lines[0].marks).toEqual([{ type: WIKILINK_MARK, from: 12, to: 19, attrs: { pageId: "abcd1234" } }]);
    expect(lines[3].marks).toEqual([{ type: "criticHighlight", from: 6, to: 17, attrs: { threadId: "t1" } }]);
  });
});

describe("linesFromYjs", () => {
  it("matches linesFromProseMirror for the same document", () => {
    expect(linesFromYjs(toYjs(SAMPLE))).toEqual(linesFromProseMirror(SAMPLE));
  });

  it("gives the parser the same result on server and client", () => {
    expect(parseNote(linesFromYjs(toYjs(SAMPLE)))).toEqual(parseNote(linesFromProseMirror(SAMPLE)));
    expect(parseNote(linesFromYjs(toYjs(SAMPLE)))).toMatchObject({
      links: [
        { pageId: "abcd1234", line: 0 },
        { pageId: "journal-2026-10-22", line: 1 },
      ],
      tags: [{ name: "reading", key: "reading", line: 0 }],
      tasks: [{ line: 0, state: "TODO", indent: 0, text: "read Mistlog #reading" }],
    });
  });

  it("reads marks written the way DocumentAgent seeds content", () => {
    // agents/document.ts formats Y.XmlText directly when importing a document
    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment("default");
    const para = new Y.XmlElement("paragraph");
    const text = new Y.XmlText("See Mistlog now");
    para.insert(0, [text]);
    frag.insert(0, [para]);
    text.format(4, 7, { [WIKILINK_MARK]: { pageId: "abcd1234" } });
    text.format(0, 3, { criticAddition: {} });
    expect(linesFromYjs(frag)).toEqual([
      {
        text: "See Mistlog now",
        marks: [
          { type: "criticAddition", from: 0, to: 3, attrs: {} },
          { type: WIKILINK_MARK, from: 4, to: 11, attrs: { pageId: "abcd1234" } },
        ],
      },
    ]);
  });

  it("strips y-tiptap's hash suffix from overlapping mark names", () => {
    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment("default");
    const para = new Y.XmlElement("paragraph");
    const text = new Y.XmlText("note");
    para.insert(0, [text]);
    frag.insert(0, [para]);
    text.format(0, 4, { "comment--AbC1+/9=": { id: "c1" } });
    expect(linesFromYjs(frag)[0].marks).toEqual([{ type: "comment", from: 0, to: 4, attrs: { id: "c1" } }]);
  });

  it("splits a link into runs where another mark starts inside it", () => {
    const doc = pmDoc([
      [
        ["Mist", [[WIKILINK_MARK, { pageId: "abcd1234" }]]],
        ["log", [[WIKILINK_MARK, { pageId: "abcd1234" }], ["criticAddition", {}]]],
      ],
    ]);
    const lines = linesFromYjs(toYjs(doc));
    expect(lines[0].marks.filter((m) => m.type === WIKILINK_MARK)).toHaveLength(2);
    expect(parseNote(lines).links).toEqual([{ pageId: "abcd1234", line: 0 }]);
  });

  it("reads a top-level text node and skips embeds", () => {
    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment("default");
    const text = new Y.XmlText("loose");
    frag.insert(0, [text]);
    text.insertEmbed(5, { image: "x" });
    expect(linesFromYjs(frag)).toEqual([{ text: "loose", marks: [] }]);
  });

  it("flattens nested elements into their top-level line", () => {
    const ydoc = new Y.Doc();
    const frag = ydoc.getXmlFragment("default");
    const outer = new Y.XmlElement("paragraph");
    const inner = new Y.XmlElement("span");
    inner.insert(0, [new Y.XmlText("inner")]);
    outer.insert(0, [new Y.XmlText("outer "), inner]);
    frag.insert(0, [outer]);
    expect(linesFromYjs(frag)).toEqual([{ text: "outer inner", marks: [] }]);
  });

  it("returns no lines for an empty fragment", () => {
    expect(linesFromYjs(new Y.Doc().getXmlFragment("default"))).toEqual([]);
  });
});
