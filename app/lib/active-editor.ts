import type { Editor as TiptapEditor } from "@tiptap/core";

/**
 * Which editor has focus, for controls that live outside it (the phone
 * keyboard toolbar, PRD F17). The editor in use registers itself on focus
 * and clears itself on blur. One store for the whole app: only one editor
 * can have focus at a time (a page, a feed day, or a side panel page).
 */

export interface ActiveEditor {
  editor: TiptapEditor;
  /** Whether the editor is in suggest mode, where outline changes are off. */
  suggesting: () => boolean;
}

let current: ActiveEditor | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const activeEditor = {
  get: (): ActiveEditor | null => current,
  set(next: ActiveEditor): void {
    if (current?.editor === next.editor) return;
    current = next;
    emit();
  },
  /** Clear, but only if `editor` is still the active one (focus may already have moved on). */
  clear(editor: TiptapEditor): void {
    if (current?.editor !== editor) return;
    current = null;
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
