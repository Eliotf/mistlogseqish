import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * The side panel (PRD F18, chunk 2.5d): pages opened beside the main view
 * with Cmd/Ctrl+click, as in Roam. Newest on top; opening a page already
 * there moves it to the top. Each page is a live editor, so the list is
 * capped. The list is remembered per browser (a viewer convenience).
 */

/** Most pages the panel holds; each is a live connection. */
export const MAX_SIDE_PAGES = 10;
const STORAGE_KEY = "mistlog-side-panel";

export interface SidePanel {
  pages: string[];
  /** Whether the panel is showing (it can be hidden with pages in it). */
  shown: boolean;
  open(pageId: string): void;
  close(pageId: string): void;
  closeAll(): void;
  setShown(shown: boolean): void;
  toggle(): void;
}

/** A page's place in the list after opening it: top, no duplicates, capped. */
export function withOpened(pages: string[], pageId: string): string[] {
  return [pageId, ...pages.filter((p) => p !== pageId)].slice(0, MAX_SIDE_PAGES);
}

const noPanel: SidePanel = {
  pages: [],
  shown: false,
  open: () => {},
  close: () => {},
  closeAll: () => {},
  setShown: () => {},
  toggle: () => {},
};

const SidePanelContext = createContext<SidePanel>(noPanel);

/** The side panel, or a no-op one outside SidePanelProvider (tests, error pages). */
export function useSidePanel(): SidePanel {
  return useContext(SidePanelContext);
}

/** Whether a provider is present, so links can fall back to navigating. */
export function useHasSidePanel(): boolean {
  return useContext(SidePanelContext) !== noPanel;
}

interface PanelState {
  pages: string[];
  shown: boolean;
}

const EMPTY: PanelState = { pages: [], shown: true };

function readStored(): PanelState {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { pages?: unknown; shown?: unknown } | null;
    const pages = Array.isArray(raw?.pages) ? raw.pages.filter((p): p is string => typeof p === "string").slice(0, MAX_SIDE_PAGES) : [];
    return { pages, shown: raw?.shown !== false };
  } catch {
    return EMPTY;
  }
}

/** The panel's state, read from this browser's storage on first use and saved on every change. */
class PanelStore {
  private state: PanelState | null = null;
  private listeners = new Set<() => void>();

  get = (): PanelState => (this.state ??= readStored());

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(change: (state: PanelState) => PanelState): void {
    this.state = change(this.get());
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // Private browsing or blocked storage: the panel just isn't remembered
    }
    this.listeners.forEach((l) => l());
  }
}

export function SidePanelProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new PanelStore());
  // The server knows nothing of this browser's panel, so it renders it empty
  const { pages, shown } = useSyncExternalStore(store.subscribe, store.get, () => EMPTY);

  const open = useCallback((pageId: string) => store.update((st) => ({ pages: withOpened(st.pages, pageId), shown: true })), [store]);
  const close = useCallback((pageId: string) => store.update((st) => ({ ...st, pages: st.pages.filter((p) => p !== pageId) })), [store]);
  const closeAll = useCallback(() => store.update((st) => ({ ...st, pages: [] })), [store]);
  const setShown = useCallback((next: boolean) => store.update((st) => ({ ...st, shown: next })), [store]);
  const toggle = useCallback(() => store.update((st) => ({ ...st, shown: !st.shown })), [store]);

  const value = useMemo(() => ({ pages, shown, open, close, closeAll, setShown, toggle }), [pages, shown, open, close, closeAll, setShown, toggle]);
  return <SidePanelContext.Provider value={value}>{children}</SidePanelContext.Provider>;
}

/** True if the key event is typing into a field or editor, where shortcuts must not fire. */
function isTyping(event: KeyboardEvent): boolean {
  const el = event.target as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
}

/** How long after `t` an `r` still counts as `t r`. */
export const CHORD_MS = 1000;

/** `t` then `r`, outside text fields: show or hide the side panel (PRD F8). */
export function useToggleShortcut(toggle: () => void): void {
  useEffect(() => {
    let tAt = 0;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event)) return;
      if (event.key === "t") {
        tAt = Date.now();
        return;
      }
      if (event.key === "r" && Date.now() - tAt <= CHORD_MS) {
        tAt = 0;
        event.preventDefault();
        toggle();
        return;
      }
      tAt = 0;
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);
}
