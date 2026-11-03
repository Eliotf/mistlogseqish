// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, cleanup, screen, fireEvent, act } from "@testing-library/react";
import * as Y from "yjs";
import ZoomCrumbs from "~/components/ZoomCrumbs";

afterEach(cleanup);

/** A page whose lines have IDs L0, L1, ...; returns the doc and its line elements. */
function page(lines: string[], title?: string) {
  const doc = new Y.Doc();
  if (title) doc.getMap("meta").set("title", title);
  const frag = doc.getXmlFragment("default");
  lines.forEach((text, i) => {
    const p = new Y.XmlElement("paragraph");
    p.setAttribute("blockId", `00000000-0000-4000-8000-00000000000${i}`);
    p.insert(0, [new Y.XmlText(text)]);
    frag.insert(frag.length, [p]);
  });
  return doc;
}
const lineId = (i: number) => `00000000-0000-4000-8000-00000000000${i}`;

function show(doc: Y.Doc, zoom: string, opts: { docId?: string; synced?: boolean } = {}) {
  const onZoom = vi.fn();
  render(createElement(ZoomCrumbs, { doc, docId: opts.docId ?? "abcd1234", zoom, synced: opts.synced ?? true, onZoom }) as ReactNode as never);
  return onZoom;
}

describe("ZoomCrumbs", () => {
  it("shows the page, the blocks above, then the zoomed block; earlier crumbs zoom out", () => {
    const onZoom = show(page(["- Plans", "\t- Garden", "\t\t- Tomatoes"], "Home"), lineId(2));
    const nav = screen.getByRole("navigation", { name: "Zoomed into a block" });
    expect(nav.textContent).toBe("Home›Plans›Garden›Tomatoes");
    expect(screen.getByText("Tomatoes").getAttribute("aria-current")).toBe("location");
    fireEvent.click(screen.getByRole("button", { name: "Plans" }));
    fireEvent.click(screen.getByRole("button", { name: "Home" }));
    expect(onZoom.mock.calls).toEqual([[lineId(0)], [null]]);
  });

  it("names a journal day by its date", () => {
    show(page(["- Morning"]), lineId(0), { docId: "journal-2026-11-03" });
    expect(screen.getByRole("button", { name: "Nov 3rd, 2026" })).toBeTruthy();
  });

  it("follows edits to the lines", () => {
    const doc = page(["- Plans", "\t- Garden"], "Home");
    show(doc, lineId(1));
    act(() => ((doc.getXmlFragment("default").get(0) as Y.XmlElement).get(0) as Y.XmlText).insert(7, " for 2027"));
    expect(screen.getByRole("button", { name: "Plans for 2027" })).toBeTruthy();
  });

  it("says when the zoomed block has gone, and offers the whole page, but only once loaded", () => {
    const doc = page(["- Plans"], "Home");
    show(doc, "00000000-0000-4000-8000-0000000000ff", { synced: false });
    expect(screen.queryByRole("status")).toBeNull();
    cleanup();
    const onZoom = show(doc, "00000000-0000-4000-8000-0000000000ff");
    expect(screen.getByRole("status").textContent).toContain("That block is no longer on this page.");
    fireEvent.click(screen.getByRole("button", { name: "Show the whole page" }));
    expect(onZoom).toHaveBeenCalledWith(null);
  });
});
