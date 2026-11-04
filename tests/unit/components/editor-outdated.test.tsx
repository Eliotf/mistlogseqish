// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { render, cleanup, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { Editor as TiptapEditor } from "@tiptap/core";
import Editor from "~/components/Editor";

function yjs(outdated: boolean, deleted = false) {
  const doc = new Y.Doc();
  return {
    doc,
    awareness: new Awareness(doc),
    socket: null,
    synced: true,
    outdated,
    deleted,
    user: { name: "Test", color: "#000", colorLight: "#ccc" },
    mode: "edit" as const,
    setMode: () => {},
    docState: doc.getMap<string>("docState"),
    isOnboarding: false,
  } as unknown as Parameters<typeof Editor>[0]["yjs"];
}

describe("Editor when this tab's code is outdated", () => {
  afterEach(cleanup);

  it.each([
    [false, true],
    [true, false],
  ])("outdated=%s leaves it editable=%s", async (outdated, editable) => {
    let editor: TiptapEditor | null = null;
    render(createElement(Editor, { yjs: yjs(outdated), onEditorReady: (e: TiptapEditor) => (editor = e) }));
    await waitFor(() => expect(editor).not.toBeNull());
    await waitFor(() => expect(editor!.isEditable).toBe(editable));
  });
});

describe("Editor on a deleted page", () => {
  afterEach(cleanup);

  it("stops taking edits", async () => {
    let editor: TiptapEditor | null = null;
    render(createElement(Editor, { yjs: yjs(false, true), onEditorReady: (e: TiptapEditor) => (editor = e) }));
    await waitFor(() => expect(editor).not.toBeNull());
    await waitFor(() => expect(editor!.isEditable).toBe(false));
  });
});

describe("Editor and the active editor (phone toolbar)", () => {
  afterEach(cleanup);

  it("registers itself while it has focus, and clears itself on blur and when it goes away", async () => {
    const { activeEditor } = await import("~/lib/active-editor");
    let editor: TiptapEditor | null = null;
    const view = render(createElement(Editor, { yjs: yjs(false), onEditorReady: (e: TiptapEditor) => (editor = e) }));
    await waitFor(() => expect(editor).not.toBeNull());
    editor!.emit("focus", { editor: editor!, event: new FocusEvent("focus"), transaction: editor!.state.tr });
    expect(activeEditor.get()?.editor).toBe(editor);
    expect(activeEditor.get()?.suggesting()).toBe(false);
    editor!.emit("blur", { editor: editor!, event: new FocusEvent("blur"), transaction: editor!.state.tr });
    expect(activeEditor.get()).toBeNull();
    editor!.emit("focus", { editor: editor!, event: new FocusEvent("focus"), transaction: editor!.state.tr });
    view.unmount();
    expect(activeEditor.get()).toBeNull();
  });
});
