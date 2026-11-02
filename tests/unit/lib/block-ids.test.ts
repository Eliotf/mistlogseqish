import { describe, it, expect } from "vitest";
import * as Y from "yjs";
import { assignBlockIds, isBlockId, linesNeedingIds, newBlockId } from "~/lib/block-ids";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

describe("isBlockId / newBlockId", () => {
  it("accepts UUIDs only", () => {
    expect(isBlockId(newBlockId())).toBe(true);
    expect(isBlockId(A)).toBe(true);
    for (const bad of [undefined, null, "", "abc", 42, A.toUpperCase(), `${A} `]) expect(isBlockId(bad)).toBe(false);
  });

  it("makes a different ID each time", () => {
    expect(newBlockId()).not.toBe(newBlockId());
  });
});

describe("linesNeedingIds", () => {
  const all = (n: number) => Array<boolean>(n).fill(true);

  it("labels lines with no ID or an invalid one", () => {
    expect(linesNeedingIds([A, undefined, "junk", null, B], all(5))).toEqual([1, 2, 3]);
  });

  it("among equals, the first keeps a duplicated ID", () => {
    expect(linesNeedingIds([A, B, A, A], all(4))).toEqual([2, 3]);
  });

  it("never changes a line that is not eligible, even a duplicate or one with no ID", () => {
    expect(linesNeedingIds([A, A, undefined], [false, false, false])).toEqual([]);
  });

  it("a new line that copied an existing line's ID gets its own, wherever it is", () => {
    // Splitting a line copies its attributes to the lower half
    expect(linesNeedingIds([A, A], [false, true])).toEqual([1]);
    // ...and if the new half ends up above, the existing line still keeps it
    expect(linesNeedingIds([A, A], [true, false])).toEqual([0]);
  });

  it("leaves a moved line (new position, unique ID) alone", () => {
    expect(linesNeedingIds([B, A], [true, false])).toEqual([]);
  });
});

describe("assignBlockIds", () => {
  function fragmentWith(attrs: Array<string | undefined>) {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("default");
    for (const id of attrs) {
      const p = new Y.XmlElement("paragraph");
      if (id) p.setAttribute("blockId", id);
      frag.insert(frag.length, [p]);
    }
    return { doc, frag, ids: () => (frag.toArray() as Y.XmlElement[]).map((p) => p.getAttribute("blockId")) };
  }

  it("labels every line without an ID and keeps the ones that have one", () => {
    const { frag, ids } = fragmentWith([A, undefined, undefined]);
    expect(assignBlockIds(frag)).toBe(2);
    const [first, second, third] = ids();
    expect(first).toBe(A);
    expect(isBlockId(second) && isBlockId(third) && second !== third).toBe(true);
  });

  it("relabels the later copies of a duplicated ID", () => {
    const { frag, ids } = fragmentWith([A, A]);
    assignBlockIds(frag);
    expect(ids()[0]).toBe(A);
    expect(ids()[1]).not.toBe(A);
  });

  it("writes nothing when every line has a unique ID, so running it twice is harmless", () => {
    const { doc, frag } = fragmentWith([undefined, undefined]);
    assignBlockIds(frag);
    let updates = 0;
    doc.on("update", () => updates++);
    doc.transact(() => expect(assignBlockIds(frag)).toBe(0));
    expect(updates).toBe(0);
  });

  it("skips loose text at the top level", () => {
    const doc = new Y.Doc();
    const frag = doc.getXmlFragment("default");
    frag.insert(0, [new Y.XmlText("loose")]);
    expect(assignBlockIds(frag)).toBe(0);
  });
});
