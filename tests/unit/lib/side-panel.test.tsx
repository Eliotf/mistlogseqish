// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useEffect, type ReactNode } from "react";
import { renderHook, act, render, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { SidePanelProvider, useSidePanel, useHasSidePanel, useToggleShortcut, withOpened, MAX_SIDE_PAGES, CHORD_MS } from "~/lib/side-panel";

const wrapper = ({ children }: { children: ReactNode }) => createElement(SidePanelProvider, null, children);

beforeEach(() => {
  localStorage.clear();
  // The panel asks for page titles; jsdom has no server to ask
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ pages: {} })));
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await new Promise((r) => setTimeout(r, 0));
  vi.unstubAllGlobals();
});

describe("withOpened", () => {
  it("puts the page on top, without duplicates, keeping at most the cap", () => {
    expect(withOpened(["b", "a"], "a")).toEqual(["a", "b"]);
    const full = Array.from({ length: MAX_SIDE_PAGES }, (_, i) => `p${i}`);
    expect(withOpened(full, "new")).toEqual(["new", ...full.slice(0, MAX_SIDE_PAGES - 1)]);
  });
});

describe("SidePanelProvider", () => {
  it("opens, closes and shows pages", () => {
    const { result } = renderHook(() => useSidePanel(), { wrapper });
    act(() => result.current.open("a"));
    act(() => result.current.open("b"));
    expect(result.current.pages).toEqual(["b", "a"]);
    expect(result.current.shown).toBe(true);
    act(() => result.current.close("b"));
    expect(result.current.pages).toEqual(["a"]);
    act(() => result.current.toggle());
    expect(result.current.shown).toBe(false);
    act(() => result.current.open("c"));
    expect(result.current.shown).toBe(true);
    act(() => result.current.closeAll());
    expect(result.current.pages).toEqual([]);
  });

  it("remembers the panel in this browser", () => {
    const first = renderHook(() => useSidePanel(), { wrapper });
    act(() => first.result.current.open("a"));
    first.unmount();
    const again = renderHook(() => useSidePanel(), { wrapper });
    expect(again.result.current.pages).toEqual(["a"]);
  });

  it("still works when storage is blocked or holds rubbish", () => {
    localStorage.setItem("mistlog-side-panel", "{not json");
    const { result } = renderHook(() => useSidePanel(), { wrapper });
    expect(result.current.pages).toEqual([]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    act(() => result.current.open("a"));
    expect(result.current.pages).toEqual(["a"]);
    vi.restoreAllMocks();
  });

  it("is a harmless no-op outside a provider", () => {
    const { result } = renderHook(() => ({ panel: useSidePanel(), has: useHasSidePanel() }));
    expect(result.current.has).toBe(false);
    act(() => result.current.panel.open("a"));
    expect(result.current.panel.pages).toEqual([]);
  });
});

describe("t r", () => {
  const key = (k: string, target: EventTarget = document.body) => target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));

  it("toggles the panel when r follows t", () => {
    const toggle = vi.fn();
    renderHook(() => useToggleShortcut(toggle));
    key("t");
    key("r");
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("ignores r alone, a slow r, and other keys between", () => {
    vi.useFakeTimers();
    const toggle = vi.fn();
    renderHook(() => useToggleShortcut(toggle));
    key("r");
    key("t");
    key("x");
    key("r");
    key("t");
    vi.advanceTimersByTime(CHORD_MS + 1);
    key("r");
    expect(toggle).not.toHaveBeenCalled();
  });

  it("never fires while typing in an editor or field", () => {
    const toggle = vi.fn();
    renderHook(() => useToggleShortcut(toggle));
    const input = document.createElement("input");
    document.body.appendChild(input);
    key("t", input);
    key("r", input);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.appendChild(editable);
    key("t", editable);
    key("r", editable);
    expect(toggle).not.toHaveBeenCalled();
  });
});

describe("the panel's controls", () => {
  it("hides with the header button and closes everything with ✕", async () => {
    vi.doMock("~/lib/useYjsEditor", () => ({ useYjsEditor: () => ({}) }));
    vi.doMock("~/components/ConnectedEditor", () => ({ default: () => createElement("div", { "data-testid": "editor" }) }));
    vi.doMock("~/lib/DocumentContext", () => ({ DocumentProvider: ({ children }: { children: ReactNode }) => children }));
    const { default: SidePanel } = await import("~/components/SidePanel");
    const seen: { panel: ReturnType<typeof useSidePanel> | null } = { panel: null };
    function Grab() {
      const panel = useSidePanel();
      useEffect(() => {
        seen.panel = panel;
      });
      return null;
    }
    const ui = render(
      createElement(MemoryRouter, { initialEntries: ["/docs/abcd1234"] }, createElement(SidePanelProvider, null, createElement(Grab), createElement(SidePanel))),
    );
    act(() => seen.panel!.open("journal-2026-10-28"));
    expect(ui.getByRole("complementary", { name: "Side panel" })).toBeTruthy();
    expect(ui.getByRole("link", { name: "Oct 28th, 2026" }).getAttribute("href")).toBe("/journal/2026-10-28");
    // On a page, hiding the panel is how you get back to comments
    fireEvent.click(ui.getByRole("button", { name: "Comments" }));
    expect(ui.queryByRole("complementary", { name: "Side panel" })).toBeNull();
    act(() => seen.panel!.setShown(true));
    fireEvent.click(ui.getByRole("button", { name: "Close Oct 28th, 2026" }));
    expect(seen.panel!.pages).toEqual([]);
    vi.doUnmock("~/lib/useYjsEditor");
    vi.doUnmock("~/components/ConnectedEditor");
    vi.doUnmock("~/lib/DocumentContext");
  });
});
