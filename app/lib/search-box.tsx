import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { modKeyLabel } from "./mod-key";

/**
 * The search box (PRD F13), opened from the header or with Cmd/Ctrl+K from
 * anywhere, including while typing in a page, as in the prototype. Closing
 * it puts the focus back where it was.
 */

export interface SearchBoxControl {
  isOpen: boolean;
  open(): void;
  close(): void;
}

const SearchBoxContext = createContext<SearchBoxControl | null>(null);

/** The search box's controls, or null outside SearchBoxProvider (tests, error pages). */
export function useSearchBox(): SearchBoxControl | null {
  return useContext(SearchBoxContext);
}

/** Whether a key event is the search shortcut: Cmd+K on a Mac, Ctrl+K elsewhere. */
export function isSearchShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">): boolean {
  const mod = modKeyLabel() === "⌘" ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return mod && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "k";
}

export function SearchBoxProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const shown = useRef(false);
  const returnTo = useRef<HTMLElement | null>(null);

  const open = useCallback(() => {
    if (shown.current) return;
    shown.current = true;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    if (!shown.current) return;
    shown.current = false;
    setOpen(false);
    const el = returnTo.current;
    returnTo.current = null;
    // After React has removed the box, so the focus isn't taken back by it
    if (el) queueMicrotask(() => el.isConnected && el.focus());
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event)) return;
      event.preventDefault();
      open();
    };
    // Capture, so an editor's own key handling never sees it first
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);
  return <SearchBoxContext.Provider value={value}>{children}</SearchBoxContext.Provider>;
}
