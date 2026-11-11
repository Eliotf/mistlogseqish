import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { goChord, isSheetShortcut } from "./shortcuts";

/**
 * The keyboard shortcut sheet (PRD F43), opened with `?` outside text
 * fields or from the header, and the go-to shortcuts `g j` (journals) and
 * `g a` (All pages). Closing the sheet puts the focus back where it was.
 */

export interface ShortcutSheetControl {
  isOpen: boolean;
  open(): void;
  close(): void;
}

const ShortcutSheetContext = createContext<ShortcutSheetControl | null>(null);

/** The sheet's controls, or null outside ShortcutSheetProvider (tests, error pages). */
export function useShortcutSheet(): ShortcutSheetControl | null {
  return useContext(ShortcutSheetContext);
}

export function ShortcutSheetProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
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
    // After React has removed the sheet, so the focus isn't taken back by it
    if (el) queueMicrotask(() => el.isConnected && el.focus());
  }, []);

  useEffect(() => {
    const chord = goChord();
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (isSheetShortcut(event)) {
        event.preventDefault();
        open();
        return;
      }
      // The sheet is modal: nothing behind it reacts while it is open
      if (shown.current) return;
      const to = chord.next(event);
      if (to === null) return;
      event.preventDefault();
      navigate(to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, navigate]);

  const value = useMemo(() => ({ isOpen, open, close }), [isOpen, open, close]);
  return <ShortcutSheetContext.Provider value={value}>{children}</ShortcutSheetContext.Provider>;
}
