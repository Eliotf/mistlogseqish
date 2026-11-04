import { describe, it, expect, vi } from "vitest";
import type { Editor } from "@tiptap/core";
import { activeEditor } from "~/lib/active-editor";

const fake = () => ({}) as Editor;

describe("activeEditor", () => {
  it("tells listeners when the focused editor changes, and only then", () => {
    const listener = vi.fn();
    const stop = activeEditor.subscribe(listener);
    const a = fake();
    const b = fake();
    activeEditor.set({ editor: a, suggesting: () => false });
    activeEditor.set({ editor: a, suggesting: () => false });
    expect(listener).toHaveBeenCalledTimes(1);
    activeEditor.set({ editor: b, suggesting: () => false });
    // A late blur from the editor that lost focus must not clear the new one
    activeEditor.clear(a);
    expect(activeEditor.get()?.editor).toBe(b);
    activeEditor.clear(b);
    expect(activeEditor.get()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
    activeEditor.set({ editor: a, suggesting: () => false });
    expect(listener).toHaveBeenCalledTimes(3);
    activeEditor.clear(a);
  });
});
