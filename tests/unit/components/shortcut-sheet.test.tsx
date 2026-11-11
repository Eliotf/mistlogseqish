// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, useEffect, type ReactNode } from "react";
import { render, cleanup, fireEvent, screen, act, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Paragraph from "@tiptap/extension-paragraph";
import Text from "@tiptap/extension-text";
import ShortcutSheet from "~/components/ShortcutSheet";
import ShortcutsButton from "~/components/ShortcutsButton";
import AppHeader from "~/components/AppHeader";
import { ShortcutSheetProvider } from "~/lib/shortcut-sheet";
import { allShortcuts, keyLabel, GO_CHORD_MS, SHORTCUT_GROUPS } from "~/lib/shortcuts";

/** Where the router is, recorded after render. */
const seen = { where: "", renders: 0 };
function Spy() {
  const location = useLocation();
  useEffect(() => {
    seen.where = location.pathname;
    seen.renders++;
  });
  return null;
}

function show(start = "/tasks") {
  const view = createElement(
    "div",
    null,
    createElement(Spy),
    createElement("input", { "aria-label": "Field" }),
    createElement("textarea", { "aria-label": "Notes" }),
    createElement("div", { contentEditable: true, suppressContentEditableWarning: true, "aria-label": "Editable", role: "textbox" }),
    createElement("button", { type: "button" }, "Elsewhere"),
    createElement(ShortcutsButton),
    createElement(ShortcutSheet),
  );
  const tree = createElement(
    MemoryRouter,
    { initialEntries: [start] },
    createElement(ShortcutSheetProvider, null, createElement(Routes, null, createElement(Route, { path: "*", element: view }))),
  );
  render(tree as ReactNode as never);
}

const sheet = () => screen.queryByRole("dialog", { name: "Keyboard shortcuts" });
const closeButton = () => screen.getByRole("button", { name: "Close keyboard shortcuts" });
const elsewhere = () => screen.getByRole("button", { name: "Elsewhere" });
const press = (target: Element | Window, key: string, over: Record<string, unknown> = {}) => fireEvent.keyDown(target, { key, ...over });
/** Lets the focus go back, which happens after React has removed the sheet. */
const settle = () => act(async () => await Promise.resolve());

const editors: Editor[] = [];

afterEach(() => {
  cleanup();
  editors.splice(0).forEach((e) => e.destroy());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("the shortcut sheet (F43)", () => {
  it("opens with ? (Shift+/ on most layouts), focusing its close button", () => {
    show();
    elsewhere().focus();
    expect(sheet()).toBeNull();
    press(elsewhere(), "?", { shiftKey: true, code: "Slash" });
    expect(sheet()).toBeTruthy();
    expect(sheet()?.getAttribute("aria-modal")).toBe("true");
    expect(document.activeElement).toBe(closeButton());
  });

  it("opens with ? typed without Shift, as on layouts that have it, and not with Shift+/ giving another character", () => {
    show();
    press(window, "/", { shiftKey: true, code: "Slash" });
    expect(sheet()).toBeNull();
    press(window, "?", { code: "Minus" });
    expect(sheet()).toBeTruthy();
  });

  it("is not opened by ? typed in an input, a text area or editable content", () => {
    show();
    for (const name of ["Field", "Notes", "Editable"]) {
      const target = screen.getByRole("textbox", { name });
      target.focus();
      press(target, "?", { shiftKey: true });
      expect(sheet(), name).toBeNull();
    }
  });

  it("is not opened by ? typed in the page editor", () => {
    show();
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({ element, extensions: [Document, Paragraph, Text], content: "<p>Why</p>" });
    editors.push(editor);
    editor.commands.focus("end");
    press(editor.view.dom, "?", { shiftKey: true });
    expect(sheet()).toBeNull();
  });

  it("is not opened with Cmd, Ctrl or Alt held", () => {
    show();
    press(window, "?", { shiftKey: true, metaKey: true });
    press(window, "?", { shiftKey: true, ctrlKey: true });
    press(window, "?", { shiftKey: true, altKey: true });
    expect(sheet()).toBeNull();
  });

  it("opens from the header's Keyboard shortcuts button and puts the focus back on it", async () => {
    show();
    const button = screen.getByRole("button", { name: "Keyboard shortcuts" });
    button.focus();
    fireEvent.click(button);
    expect(sheet()).toBeTruthy();
    fireEvent.click(closeButton());
    expect(sheet()).toBeNull();
    await settle();
    expect(document.activeElement).toBe(button);
  });

  it("closes on Escape and puts the focus back where it was", async () => {
    show();
    elsewhere().focus();
    press(elsewhere(), "?");
    expect(sheet()).toBeTruthy();
    press(closeButton(), "Escape");
    expect(sheet()).toBeNull();
    await settle();
    expect(document.activeElement).toBe(elsewhere());
  });

  it("closes on Escape even when the focus has left it", () => {
    show();
    press(window, "?");
    press(document.body, "Escape");
    expect(sheet()).toBeNull();
  });

  it("closes on a click outside, but not on a click inside", async () => {
    show();
    elsewhere().focus();
    press(elsewhere(), "?");
    fireEvent.mouseDown(sheet()!);
    expect(sheet()).toBeTruthy();
    const backdrop = sheet()!.previousElementSibling!;
    fireEvent.mouseDown(backdrop);
    expect(sheet()).toBeNull();
    await settle();
    expect(document.activeElement).toBe(elsewhere());
  });

  it("keeps the focus inside while open (Tab and Shift+Tab wrap round)", () => {
    show();
    press(window, "?");
    const list = screen.getByRole("region", { name: "Shortcuts" });
    expect(document.activeElement).toBe(closeButton());
    // Tab from the last item goes back to the first; Shift+Tab from the first to the last
    list.focus();
    expect(press(list, "Tab")).toBe(false);
    expect(document.activeElement).toBe(closeButton());
    expect(press(closeButton(), "Tab", { shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(list);
    // Between items, the browser moves the focus as usual
    closeButton().focus();
    expect(press(closeButton(), "Tab")).toBe(true);
    // If the focus has got out, Tab brings it back in
    elsewhere().focus();
    expect(press(elsewhere(), "Tab")).toBe(false);
    expect(document.activeElement).toBe(closeButton());
    elsewhere().focus();
    expect(press(elsewhere(), "Tab", { shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(list);
  });

  it("opens once: ? again while open changes nothing", () => {
    show();
    press(window, "?");
    press(closeButton(), "?");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });

  it("renders every entry in the list, grouped, with Mod shown for this platform", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    show();
    press(window, "?");
    const dialog = sheet()!;
    for (const group of SHORTCUT_GROUPS) {
      const section = within(dialog).getByRole("region", { name: group.title });
      expect(within(section).getByRole("heading", { name: group.title })).toBeTruthy();
      expect(section.querySelectorAll("dt")).toHaveLength(group.shortcuts.length);
    }
    const rows = dialog.querySelectorAll("dt[data-shortcut]");
    expect([...rows].map((dt) => dt.getAttribute("data-shortcut"))).toEqual(allShortcuts().map((s) => s.id));
    for (const shortcut of allShortcuts()) {
      const dt = dialog.querySelector(`dt[data-shortcut="${shortcut.id}"]`)!;
      expect([...dt.querySelectorAll("kbd")].map((k) => k.textContent)).toEqual(shortcut.keys.map((k) => keyLabel(k, "⌘")));
      expect(dt.nextElementSibling?.textContent).toBe(shortcut.action);
    }
    expect(within(dialog).getByText("⌘+K")).toBeTruthy();
  });

  it("shows Ctrl for Mod elsewhere", () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    show();
    press(window, "?");
    expect(within(sheet()!).getByText("Ctrl+K")).toBeTruthy();
    expect(within(sheet()!).queryByText("⌘+K")).toBeNull();
  });

  it("puts the button in the app header", () => {
    render(
      createElement(MemoryRouter, null, createElement(ShortcutSheetProvider, null, createElement(AppHeader), createElement(ShortcutSheet))) as ReactNode as never,
    );
    fireEvent.click(screen.getByRole("button", { name: "Keyboard shortcuts" }));
    expect(sheet()).toBeTruthy();
  });

  it("shows no button outside the provider", () => {
    render(createElement(ShortcutsButton));
    expect(screen.queryByRole("button", { name: "Keyboard shortcuts" })).toBeNull();
  });
});

describe("go-to shortcuts (F43)", () => {
  it("g j goes to the journals and g a to All pages, through the router", () => {
    show();
    expect(seen.where).toBe("/tasks");
    const before = seen.renders;
    press(window, "g");
    press(window, "j");
    expect(seen.where).toBe("/");
    press(elsewhere(), "g");
    press(elsewhere(), "a");
    expect(seen.where).toBe("/pages");
    // The same tree stayed mounted: no full page load
    expect(seen.renders).toBeGreaterThan(before);
    expect(elsewhere().isConnected).toBe(true);
  });

  it("needs the second key within about a second", () => {
    vi.useFakeTimers();
    show();
    press(window, "g");
    vi.advanceTimersByTime(GO_CHORD_MS + 50);
    press(window, "j");
    expect(seen.where).toBe("/tasks");
    press(window, "g");
    vi.advanceTimersByTime(GO_CHORD_MS - 100);
    press(window, "a");
    expect(seen.where).toBe("/pages");
  });

  it("doesn't fire with a modifier held", () => {
    show();
    for (const mod of ["metaKey", "ctrlKey", "altKey"]) {
      press(window, "g");
      press(window, "j", { [mod]: true });
      press(window, "g", { [mod]: true });
      press(window, "a");
    }
    expect(seen.where).toBe("/tasks");
  });

  it("is ignored while typing in an input, a text area or editable content", () => {
    show();
    for (const name of ["Field", "Notes", "Editable"]) {
      const target = screen.getByRole("textbox", { name });
      press(target, "g");
      press(target, "j");
      press(window, "g");
      press(target, "a");
    }
    expect(seen.where).toBe("/tasks");
  });

  it("is cancelled by an unrelated second key", () => {
    show();
    press(window, "g");
    press(window, "x");
    press(window, "j");
    expect(seen.where).toBe("/tasks");
  });

  it("does nothing while the sheet is open", () => {
    show();
    press(window, "?");
    press(closeButton(), "g");
    press(closeButton(), "j");
    expect(seen.where).toBe("/tasks");
    expect(sheet()).toBeTruthy();
  });

  it("leaves keys another handler has already used alone", () => {
    show();
    const used = (e: KeyboardEvent) => e.preventDefault();
    elsewhere().addEventListener("keydown", used);
    press(elsewhere(), "?");
    expect(sheet()).toBeNull();
    press(elsewhere(), "g");
    press(window, "j");
    expect(seen.where).toBe("/tasks");
  });
});
