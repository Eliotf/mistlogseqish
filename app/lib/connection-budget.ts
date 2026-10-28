import { useEffect } from "react";
import type { Awareness } from "y-protocols/awareness";
import type { Editor } from "@tiptap/core";

/**
 * Keeping Durable Objects asleep (docs/technical-architecture.md, "Durable
 * Object usage"). Every message a browser sends wakes that page's Durable
 * Object for about 10 seconds of billed time. Two browser-side sources of
 * idle traffic are switched off here.
 */

/** How long a tab must stay hidden before its connections close. */
export const HIDDEN_DISCONNECT_MS = 5 * 60 * 1000;

/**
 * Whether this editor should announce presence (its user and cursor). Only
 * the editor you are in, in a visible tab: y-protocols resends a present
 * state every 15 seconds, which would wake the page's Durable Object.
 */
export function shouldBePresent(focused: boolean, visible: boolean): boolean {
  return focused && visible;
}

/**
 * Announce presence only while the editor is focused and the tab visible;
 * otherwise clear it, which also removes this cursor for collaborators.
 */
export function usePresenceWhileFocused(editor: Editor | null, awareness: Awareness, user: Record<string, unknown>): void {
  useEffect(() => {
    if (!editor) return;
    const update = () => {
      const present = shouldBePresent(editor.isFocused, document.visibilityState === "visible");
      // setLocalStateField is a no-op on a cleared state, so set the whole state
      if (present && awareness.getLocalState() === null) awareness.setLocalState({ user });
      if (!present && awareness.getLocalState() !== null) awareness.setLocalState(null);
    };
    update();
    editor.on("focus", update);
    editor.on("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      editor.off("focus", update);
      editor.off("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [editor, awareness, user]);
}

/** The part of PartySocket this needs. */
interface ClosableSocket {
  close(code?: number, reason?: string): void;
  reconnect(code?: number, reason?: string): void;
}

/**
 * Close the connection when the tab has been hidden for `delayMs`, and
 * reconnect when it is shown again. On reconnect the server's sync messages
 * bring the page up to date, so nothing is lost.
 */
export function useDisconnectWhenHidden(socket: ClosableSocket | null, delayMs = HIDDEN_DISCONNECT_MS): void {
  useEffect(() => {
    if (!socket) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let closedByUs = false;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        timer ??= setTimeout(() => {
          timer = null;
          closedByUs = true;
          socket.close(1000, "Tab hidden");
        }, delayMs);
      } else {
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
        if (closedByUs) {
          closedByUs = false;
          socket.reconnect();
        }
      }
    };
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (timer !== null) clearTimeout(timer);
    };
  }, [socket, delayMs]);
}
