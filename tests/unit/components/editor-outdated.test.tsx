// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement } from "react";
import { render, cleanup, waitFor } from "@testing-library/react";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { Editor as TiptapEditor } from "@tiptap/core";
import Editor from "~/components/Editor";

function yjs(outdated: boolean) {
  const doc = new Y.Doc();
  return {
    doc,
    awareness: new Awareness(doc),
    socket: null,
    synced: true,
    outdated,
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
