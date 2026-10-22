import * as Y from "yjs";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { DocLine, LineMark } from "./note-parser";

/**
 * Convert a document into the parser's input: one DocLine per top-level
 * block (Mist's editor stores each line as a paragraph). The server reads
 * the Yjs fragment; the editor reads its ProseMirror doc. Both must produce
 * the same lines for the same document.
 *
 * Marks are reported as the runs the source stores them in, so one mark can
 * appear as several adjacent ranges when other marks start or stop inside it.
 */

// y-tiptap stores marks that may overlap as "name--<8-char hash>"
const HASHED_MARK_RE = /^(.*)--[a-zA-Z0-9+/=]{8}$/;

function markName(attrName: string): string {
  return HASHED_MARK_RE.exec(attrName)?.[1] ?? attrName;
}

interface DeltaOp {
  insert?: unknown;
  attributes?: Record<string, unknown>;
}

function appendYText(line: DocLine, ytext: Y.XmlText): void {
  for (const op of ytext.toDelta() as DeltaOp[]) {
    if (typeof op.insert !== "string") continue;
    const from = line.text.length;
    line.text += op.insert;
    for (const [name, value] of Object.entries(op.attributes ?? {})) {
      if (value === null || value === undefined) continue;
      const mark: LineMark = { type: markName(name), from, to: line.text.length };
      if (typeof value === "object") mark.attrs = value as Record<string, unknown>;
      line.marks.push(mark);
    }
  }
}

function appendYChildren(line: DocLine, el: Y.XmlElement): void {
  for (const child of el.toArray()) {
    if (child instanceof Y.XmlText) appendYText(line, child);
    else if (child instanceof Y.XmlElement) appendYChildren(line, child);
  }
}

export function linesFromYjs(fragment: Y.XmlFragment): DocLine[] {
  const lines: DocLine[] = [];
  for (const child of fragment.toArray()) {
    const line: DocLine = { text: "", marks: [] };
    if (child instanceof Y.XmlText) appendYText(line, child);
    else if (child instanceof Y.XmlElement) appendYChildren(line, child);
    lines.push(line);
  }
  return lines;
}

export function linesFromProseMirror(doc: ProseMirrorNode): DocLine[] {
  const lines: DocLine[] = [];
  doc.forEach((block) => {
    const line: DocLine = { text: "", marks: [] };
    block.descendants((node) => {
      if (!node.isText || !node.text) return true;
      const from = line.text.length;
      line.text += node.text;
      for (const mark of node.marks) {
        line.marks.push({ type: mark.type.name, from, to: line.text.length, attrs: { ...mark.attrs } });
      }
      return false;
    });
    lines.push(line);
  });
  return lines;
}
