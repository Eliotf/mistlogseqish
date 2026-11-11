// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createElement } from "react";
import { render, cleanup, screen, act, fireEvent } from "@testing-library/react";
import type { Editor } from "@tiptap/core";

const { run } = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("~/lib/phone-actions", async (importOriginal) => ({ ...(await importOriginal<typeof import("~/lib/phone-actions")>()), runPhoneAction: run }));

import PhoneToolbar from "~/components/PhoneToolbar";
import { activeEditor } from "~/lib/active-editor";

const editor = {} as Editor;

/** A fake visual viewport: the keyboard covers the bottom `keyboard` pixels of an 800px window. */
function viewport(keyboard: number) {
  const target = new EventTarget() as EventTarget & { height: number; offsetTop: number };
  target.height = 800 - keyboard;
  target.offsetTop = 0;
  return target;
}

function touchScreen(touch: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: touch && query === "(pointer: coarse)", addEventListener: () => {}, removeEventListener: () => {} }));
}

describe("PhoneToolbar", () => {
  beforeEach(() => {
    run.mockReset();
    vi.stubGlobal("innerHeight", 800);
  });
  afterEach(() => {
    cleanup();
    activeEditor.clear(editor);
    vi.unstubAllGlobals();
  });

  it("shows only while an editor has focus on a touch screen", () => {
    touchScreen(true);
    render(createElement(PhoneToolbar));
    expect(screen.queryByRole("toolbar")).toBeNull();
    act(() => activeEditor.set({ editor, suggesting: () => false }));
    expect(screen.getByRole("toolbar", { name: "Editing controls" })).toBeTruthy();
    act(() => activeEditor.clear(editor));
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("does not show with a mouse", () => {
    touchScreen(false);
    activeEditor.set({ editor, suggesting: () => false });
    render(createElement(PhoneToolbar));
    expect(screen.queryByRole("toolbar")).toBeNull();
  });

  it("acts on pointer down without taking focus, so the keyboard stays open", () => {
    touchScreen(true);
    activeEditor.set({ editor, suggesting: () => false });
    render(createElement(PhoneToolbar));
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Outdent", "Indent", "Task", "Link", "Date", "Up", "Down", "Fold", "Done"]);
    expect(buttons.every((b) => b.tabIndex === -1)).toBe(true);
    const down = fireEvent.pointerDown(screen.getByRole("button", { name: "Indent" }));
    expect(down).toBe(false); // default prevented: focus stays in the editor
    expect(run).toHaveBeenCalledWith(editor, "indent", false);
  });

  it("greys out outline changes in suggest mode", () => {
    touchScreen(true);
    activeEditor.set({ editor, suggesting: () => true });
    render(createElement(PhoneToolbar));
    const disabled = screen.getAllByRole("button").filter((b) => b.getAttribute("aria-disabled") === "true");
    expect(disabled.map((b) => b.getAttribute("aria-label"))).toEqual(["Outdent", "Indent", "Task", "Up", "Down", "Fold"]);
  });

  it("sits just above the on-screen keyboard, and follows it", () => {
    touchScreen(true);
    const vv = viewport(300);
    vi.stubGlobal("visualViewport", vv);
    activeEditor.set({ editor, suggesting: () => false });
    render(createElement(PhoneToolbar));
    expect(screen.getByRole("toolbar").style.bottom).toBe("300px");
    act(() => {
      vv.height = 800;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(screen.getByRole("toolbar").style.bottom).toBe("0px");
  });
});
