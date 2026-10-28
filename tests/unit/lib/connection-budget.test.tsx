// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import {
  shouldBePresent,
  usePresenceWhileFocused,
  useDisconnectWhenHidden,
  HIDDEN_DISCONNECT_MS,
} from "~/lib/connection-budget";

let visibility: DocumentVisibilityState = "visible";
function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
});

/** Enough of a TipTap editor for the presence hook: focus state and focus/blur events. */
function fakeEditor() {
  const handlers: Record<string, Array<() => void>> = { focus: [], blur: [] };
  const editor = {
    isFocused: false,
    on: (event: string, fn: () => void) => handlers[event].push(fn),
    off: (event: string, fn: () => void) => (handlers[event] = handlers[event].filter((f) => f !== fn)),
    focus() {
      editor.isFocused = true;
      handlers.focus.forEach((f) => f());
    },
    blur() {
      editor.isFocused = false;
      handlers.blur.forEach((f) => f());
    },
  };
  return editor;
}

describe("shouldBePresent", () => {
  it("is present only when focused in a visible tab", () => {
    expect(shouldBePresent(true, true)).toBe(true);
    expect(shouldBePresent(true, false)).toBe(false);
    expect(shouldBePresent(false, true)).toBe(false);
  });
});

describe("usePresenceWhileFocused", () => {
  const user = { name: "Eliot", color: "#000" };
  afterEach(() => vi.useRealTimers());

  it("clears presence for an editor you are not in, and sets it when you click in", () => {
    const awareness = new Awareness(new Y.Doc());
    awareness.setLocalStateField("user", user); // as CollaborationCaret does on start
    const editor = fakeEditor();
    renderHook(() => usePresenceWhileFocused(editor as never, awareness, user));
    expect(awareness.getLocalState()).toBeNull();
    act(() => editor.focus());
    expect(awareness.getLocalState()).toEqual({ user });
    act(() => editor.blur());
    expect(awareness.getLocalState()).toBeNull();
    awareness.destroy();
  });

  it("clears presence when the tab is hidden, and restores it when shown while focused", () => {
    const awareness = new Awareness(new Y.Doc());
    const editor = fakeEditor();
    renderHook(() => usePresenceWhileFocused(editor as never, awareness, user));
    act(() => editor.focus());
    act(() => setVisibility("hidden"));
    expect(awareness.getLocalState()).toBeNull();
    act(() => setVisibility("visible"));
    expect(awareness.getLocalState()).toEqual({ user });
    awareness.destroy();
  });

  it("keeps presence cleared whenever the editor is not in use, so nothing is renewed", () => {
    // y-protocols renews (re-sends) a local state every 15 s only when it is not
    // null (node_modules/y-protocols/awareness.js, the _checkInterval callback).
    // Its clock is lib0's Date.now captured at import, so fake timers cannot drive
    // the renewal in a test; this checks the condition that prevents it instead.
    const awareness = new Awareness(new Y.Doc());
    awareness.setLocalStateField("user", user);
    const editor = fakeEditor();
    renderHook(() => usePresenceWhileFocused(editor as never, awareness, user));
    const states: unknown[] = [awareness.getLocalState()];
    act(() => editor.focus());
    act(() => editor.blur());
    states.push(awareness.getLocalState());
    act(() => setVisibility("hidden"));
    act(() => editor.focus()); // focused, but in a hidden tab
    states.push(awareness.getLocalState());
    expect(states).toEqual([null, null, null]);
    awareness.destroy();
  });
});

describe("useDisconnectWhenHidden", () => {
  let socket: { close: ReturnType<typeof vi.fn>; reconnect: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    socket = { close: vi.fn(), reconnect: vi.fn() };
  });
  afterEach(() => vi.useRealTimers());

  it("closes the connection after the tab has been hidden for 5 minutes", () => {
    renderHook(() => useDisconnectWhenHidden(socket));
    act(() => setVisibility("hidden"));
    vi.advanceTimersByTime(HIDDEN_DISCONNECT_MS - 1);
    expect(socket.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(socket.close).toHaveBeenCalledWith(1000, "Tab hidden");
  });

  it("reconnects when the tab is shown again", () => {
    renderHook(() => useDisconnectWhenHidden(socket));
    act(() => setVisibility("hidden"));
    vi.advanceTimersByTime(HIDDEN_DISCONNECT_MS);
    act(() => setVisibility("visible"));
    expect(socket.reconnect).toHaveBeenCalledTimes(1);
  });

  it("does nothing if you come back sooner", () => {
    renderHook(() => useDisconnectWhenHidden(socket));
    act(() => setVisibility("hidden"));
    vi.advanceTimersByTime(60_000);
    act(() => setVisibility("visible"));
    vi.advanceTimersByTime(HIDDEN_DISCONNECT_MS * 2);
    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.reconnect).not.toHaveBeenCalled();
  });

  it("does not reconnect a connection it did not close", () => {
    renderHook(() => useDisconnectWhenHidden(socket));
    act(() => setVisibility("visible"));
    expect(socket.reconnect).not.toHaveBeenCalled();
  });

  it("starts counting if the page loads already hidden, and cleans up on unmount", () => {
    visibility = "hidden";
    const { unmount } = renderHook(() => useDisconnectWhenHidden(socket));
    unmount();
    vi.advanceTimersByTime(HIDDEN_DISCONNECT_MS * 2);
    expect(socket.close).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
