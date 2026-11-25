// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, Fragment } from "react";
import { render, cleanup, fireEvent, screen, act } from "@testing-library/react";
import ResizeHandle from "~/components/ResizeHandle";
import { BIG_KEY_STEP, KEY_STEP, LEFT_SIDEBAR_SIZE as LEFT, RIGHT_PANEL_SIZE as RIGHT, type PanelSize } from "~/lib/panel-width";

const DEFAULT_PX = 300;
const css = (name: string) => document.documentElement.style.getPropertyValue(name);

/** jsdom draws nothing, so the panel is as wide as its CSS variable says, or the default. */
function layOut(size: PanelSize) {
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement) {
      if (this.id !== "panel") return 0;
      const set = css(size.cssVar);
      return set ? parseFloat(set) : DEFAULT_PX;
    },
  });
}

function show(size: PanelSize) {
  layOut(size);
  render(
    createElement(
      Fragment,
      null,
      createElement("div", { id: "panel" }),
      createElement(ResizeHandle, { size, label: "Resize it", controls: "panel", className: "" }),
    ),
  );
  return screen.getByRole("separator", { name: "Resize it" });
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("style");
  document.documentElement.className = "";
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 2000 });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, "offsetWidth");
});

describe("ResizeHandle", () => {
  it("widens the left sidebar as its edge is dragged right, and remembers it when let go", () => {
    const handle = show(LEFT);
    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 1 });
    expect(document.documentElement.classList.contains("resizing-panel")).toBe(true);
    fireEvent.pointerMove(handle, { clientX: 340, pointerId: 1 });
    expect(css(LEFT.cssVar)).toBe("340px");
    // Not remembered until let go
    expect(localStorage.getItem(LEFT.storageKey)).toBeNull();
    fireEvent.pointerMove(handle, { clientX: 360, pointerId: 1 });
    fireEvent.pointerUp(handle, { clientX: 360, pointerId: 1 });
    expect(localStorage.getItem(LEFT.storageKey)).toBe("360");
    expect(handle.getAttribute("aria-valuenow")).toBe("360");
    expect(document.documentElement.classList.contains("resizing-panel")).toBe(false);
    // Moving after letting go changes nothing
    fireEvent.pointerMove(handle, { clientX: 500, pointerId: 1 });
    expect(css(LEFT.cssVar)).toBe("360px");
  });

  it("widens the right panel as its edge is dragged left, no further than the widest", () => {
    const handle = show(RIGHT);
    fireEvent.pointerDown(handle, { button: 0, clientX: 1000, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 900, pointerId: 1 });
    expect(css(RIGHT.cssVar)).toBe("400px");
    fireEvent.pointerMove(handle, { clientX: -2000, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(localStorage.getItem(RIGHT.storageKey)).toBe(String(RIGHT.max));
  });

  it("ignores other mouse buttons, and a click without a drag remembers nothing", () => {
    const handle = show(LEFT);
    fireEvent.pointerDown(handle, { button: 2, clientX: 300, pointerId: 1 });
    fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 });
    expect(css(LEFT.cssVar)).toBe("");
    fireEvent.pointerDown(handle, { button: 0, clientX: 300, pointerId: 1 });
    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(localStorage.getItem(LEFT.storageKey)).toBeNull();
  });

  it("resizes from the keyboard: arrows, Shift+arrows, Home and End", () => {
    const handle = show(RIGHT);
    act(() => handle.focus());
    expect(handle.getAttribute("aria-valuenow")).toBe(String(DEFAULT_PX));
    fireEvent.keyDown(handle, { key: "ArrowLeft" });
    expect(css(RIGHT.cssVar)).toBe(`${DEFAULT_PX + KEY_STEP}px`);
    expect(localStorage.getItem(RIGHT.storageKey)).toBe(String(DEFAULT_PX + KEY_STEP));
    fireEvent.keyDown(handle, { key: "ArrowLeft", shiftKey: true });
    expect(css(RIGHT.cssVar)).toBe(`${DEFAULT_PX + KEY_STEP + BIG_KEY_STEP}px`);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(css(RIGHT.cssVar)).toBe(`${DEFAULT_PX + BIG_KEY_STEP}px`);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(handle.getAttribute("aria-valuenow")).toBe(String(RIGHT.min));
    fireEvent.keyDown(handle, { key: "End" });
    expect(handle.getAttribute("aria-valuenow")).toBe(String(RIGHT.max));
  });

  it("leaves other keys alone", () => {
    const handle = show(LEFT);
    const event = new KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    handle.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(css(LEFT.cssVar)).toBe("");
  });

  it("puts the default width back with a double-click or Enter", () => {
    const handle = show(LEFT);
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(localStorage.getItem(LEFT.storageKey)).not.toBeNull();
    fireEvent.doubleClick(handle);
    expect(css(LEFT.cssVar)).toBe("");
    expect(localStorage.getItem(LEFT.storageKey)).toBeNull();
    expect(handle.getAttribute("aria-valuenow")).toBe(String(DEFAULT_PX));
    fireEvent.keyDown(handle, { key: "ArrowRight" });
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(localStorage.getItem(LEFT.storageKey)).toBeNull();
  });

  it("is a focusable vertical separator naming what it resizes", () => {
    const handle = show(LEFT);
    expect(handle.getAttribute("aria-orientation")).toBe("vertical");
    expect(handle.getAttribute("aria-controls")).toBe("panel");
    expect(handle.tabIndex).toBe(0);
  });
});
