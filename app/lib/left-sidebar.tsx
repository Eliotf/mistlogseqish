import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

/**
 * The left sidebar (PRD F8) and, on phones, the same contents as a slide-in
 * menu (F17), as in the prototype. Whether the sidebar is shown and the
 * pages recently opened are remembered per browser (viewer conveniences, so
 * storage that fails just means they aren't remembered).
 */

/** Pages listed under Recent, most recently opened first (the prototype's 8). */
export const MAX_RECENT_PAGES = 8;
export const SIDEBAR_STORAGE_KEY = "mistlog-left-sidebar";
export const RECENT_STORAGE_KEY = "mistlog-recent-pages";
/** At this width and wider the sidebar is a column; narrower, it is the phone menu. */
export const DESKTOP_QUERY = "(min-width: 768px)";

/**
 * Run in the page head before anything is drawn, so a sidebar closed in
 * this browser doesn't flash open while the app loads (see app.css).
 */
export const SIDEBAR_HEAD_SCRIPT = `(function(){try{if(localStorage.getItem('${SIDEBAR_STORAGE_KEY}')==='closed')document.documentElement.setAttribute('data-left-sidebar','closed')}catch(e){}})()`;

export interface LeftSidebar {
  /** Whether the desktop sidebar is showing. */
  shown: boolean;
  toggle(): void;
  /** Whether the phone menu is open. */
  menuOpen: boolean;
  /** Open the phone menu; closing it puts the focus back where it was. */
  openMenu(): void;
  closeMenu(): void;
  /** `t l`: the sidebar on a wide screen, the menu on a phone. */
  toggleFromKey(): void;
  /** Page IDs opened recently, newest first. */
  recent: string[];
  /** Note that a page or journal day was opened. */
  visited(pageId: string): void;
}

/** The recent list after opening a page: on top, no duplicates, capped. */
export function withVisited(recent: string[], pageId: string): string[] {
  return [pageId, ...recent.filter((p) => p !== pageId)].slice(0, MAX_RECENT_PAGES);
}

interface Stored {
  shown: boolean;
  recent: string[];
}

const SERVER_STATE: Stored = { shown: true, recent: [] };

function readStored(): Stored {
  let shown = true;
  let recent: string[] = [];
  try {
    shown = localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "closed";
  } catch {
    // Blocked storage: shown, as on a first visit
  }
  try {
    const raw = JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) ?? "[]") as unknown;
    if (Array.isArray(raw)) recent = raw.filter((p): p is string => typeof p === "string").slice(0, MAX_RECENT_PAGES);
  } catch {
    // Blocked storage or rubbish in it: nothing recent
  }
  return { shown, recent };
}

/** The sidebar's remembered state, read on first use and saved on every change. */
class SidebarStore {
  private state: Stored | null = null;
  private listeners = new Set<() => void>();

  get = (): Stored => (this.state ??= readStored());

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  setShown(shown: boolean): void {
    this.state = { ...this.get(), shown };
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, shown ? "open" : "closed");
    } catch {
      // Not remembered, but it still works
    }
    // The head script's marker would otherwise keep the sidebar hidden
    document.documentElement.setAttribute("data-left-sidebar", shown ? "open" : "closed");
    this.emit();
  }

  visited(pageId: string): void {
    const current = this.get();
    if (current.recent[0] === pageId) return;
    this.state = { ...current, recent: withVisited(current.recent, pageId) };
    try {
      localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(this.state.recent));
    } catch {
      // Not remembered, but it still works
    }
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

const SidebarContext = createContext<LeftSidebar | null>(null);

/** The sidebar's controls, or null outside LeftSidebarProvider (tests, error pages). */
export function useLeftSidebar(): LeftSidebar | null {
  return useContext(SidebarContext);
}

function isDesktop(): boolean {
  return typeof window.matchMedia !== "function" || window.matchMedia(DESKTOP_QUERY).matches;
}

function subscribeDesktop(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(DESKTOP_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether the screen is wide enough for the sidebar column. True on the server (CSS hides it on phones). */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribeDesktop, isDesktop, () => true);
}

export function LeftSidebarProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new SidebarStore());
  // The server knows nothing of this browser, so it draws the sidebar shown
  const { shown, recent } = useSyncExternalStore(store.subscribe, store.get, () => SERVER_STATE);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuShown = useRef(false);
  const returnTo = useRef<HTMLElement | null>(null);

  const toggle = useCallback(() => store.setShown(!store.get().shown), [store]);

  const openMenu = useCallback(() => {
    if (menuShown.current) return;
    menuShown.current = true;
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setMenuOpen(true);
  }, []);

  const closeMenu = useCallback(() => {
    if (!menuShown.current) return;
    menuShown.current = false;
    setMenuOpen(false);
    const el = returnTo.current;
    returnTo.current = null;
    // At once, so whatever opens next (the search box) knows where focus goes back to
    if (el?.isConnected) el.focus();
  }, []);

  const toggleFromKey = useCallback(() => {
    if (isDesktop()) toggle();
    else if (menuShown.current) closeMenu();
    else openMenu();
  }, [toggle, openMenu, closeMenu]);

  const visited = useCallback((pageId: string) => store.visited(pageId), [store]);

  // Wider than a phone, there is no menu to keep open
  useEffect(
    () =>
      subscribeDesktop(() => {
        if (isDesktop()) closeMenu();
      }),
    [closeMenu],
  );

  const value = useMemo(
    () => ({ shown, toggle, menuOpen, openMenu, closeMenu, toggleFromKey, recent, visited }),
    [shown, toggle, menuOpen, openMenu, closeMenu, toggleFromKey, recent, visited],
  );
  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

/** Add this page or journal day to the sidebar's Recent list. */
export function useRecordVisit(pageId: string): void {
  const visited = useLeftSidebar()?.visited;
  useEffect(() => {
    visited?.(pageId);
  }, [visited, pageId]);
}

/** What GET /api/index/status returns. */
export interface IndexStatus {
  /** Pages the index is still catching up on (a rebuild); results may be missing until then. */
  pending: number;
}

export async function fetchIndexStatus(): Promise<IndexStatus> {
  const res = await fetch("/api/index/status");
  if (!res.ok) throw new Error(`index status: ${res.status}`);
  return (await res.json()) as IndexStatus;
}

/**
 * The index status line's count. Asked once when the sidebar appears and
 * when the tab is shown again; while the index is catching up, asked again
 * on each move to another screen. Never on a timer (AGENTS.md).
 */
export function useIndexStatus(location: string, fetchStatus: () => Promise<IndexStatus> = fetchIndexStatus): number {
  const [pending, setPending] = useState(0);
  const asked = useRef(false);
  const last = useRef(0);

  const ask = useCallback(() => {
    asked.current = true;
    fetchStatus().then(
      (status) => {
        last.current = status.pending;
        setPending(status.pending);
      },
      (err: unknown) => console.error("Loading the index status failed", err),
    );
  }, [fetchStatus]);

  useEffect(() => {
    if (!asked.current || last.current > 0) ask();
  }, [location, ask]);

  useEffect(() => {
    const onShow = () => {
      if (document.visibilityState === "visible") ask();
    };
    document.addEventListener("visibilitychange", onShow);
    return () => document.removeEventListener("visibilitychange", onShow);
  }, [ask]);

  return pending;
}
