import { useEffect, useRef, type KeyboardEvent } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { useLeftSidebar, useIndexStatus, type IndexStatus } from "~/lib/left-sidebar";
import { useSearchBox } from "~/lib/search-box";
import { useModKeyLabel } from "~/lib/mod-key";
import { useLinkTarget } from "~/lib/useLinkTarget";
import { linkHref } from "~/lib/page-titles";
import { journalTitle, parseJournalDate } from "~/lib/note-ids";
import { UNTITLED } from "~/lib/page-title";
import { APP_DISPLAY_NAME } from "~/shared/constants";
import TodayButton from "~/components/TodayButton";
import NewPageButton from "~/components/NewPageButton";

export const SIDEBAR_ID = "left-sidebar";

const ROW =
  "flex w-full items-center gap-2 px-4 py-1.5 text-left text-sm text-ink transition-colors hover:bg-border aria-[current=page]:font-semibold aria-[current=page]:shadow-[inset_3px_0_0_var(--color-chartreuse)]";

interface ContentsProps {
  /** In the phone menu: choosing anything closes it first. */
  onChoose?: () => void;
  fetchStatus?: () => Promise<IndexStatus>;
}

/**
 * What the sidebar holds, on a wide screen and in the phone menu alike (PRD
 * F8, as in the prototype): where to go, Search and New page, recently
 * opened pages, and a status line while the index is catching up.
 */
export function SidebarContents({ onChoose, fetchStatus }: ContentsProps) {
  const sidebar = useLeftSidebar();
  const search = useSearchBox();
  const mod = useModKeyLabel();
  const { pathname } = useLocation();
  const pending = useIndexStatus(pathname, fetchStatus);
  const recent = sidebar?.recent ?? [];

  const openSearch = () => {
    // Close the menu first, so the search box gives the focus back to the menu button
    onChoose?.();
    search?.open();
  };

  return (
    <>
      <div className="border-b border-border py-2">
        <ul>
          <li>
            <NavLink to="/" end onClick={onChoose} className={ROW}>
              Journals
            </NavLink>
          </li>
          <li>
            <TodayButton className={ROW} />
          </li>
          <li>
            <NavLink to="/pages" end onClick={onChoose} className={ROW}>
              All pages
            </NavLink>
          </li>
          <li>
            <NavLink to="/tasks" end onClick={onChoose} className={ROW}>
              Tasks
            </NavLink>
          </li>
          {search && (
            <li>
              <button type="button" onClick={openSearch} aria-keyshortcuts={mod === "⌘" ? "Meta+K" : "Control+K"} className={ROW}>
                Search
                {/* Phones have no keyboard shortcut to show */}
                {!onChoose && (
                  <kbd aria-hidden="true" className="ml-auto font-[inherit] text-[11px] text-muted">
                    {mod === "⌘" ? "⌘K" : "Ctrl K"}
                  </kbd>
                )}
              </button>
            </li>
          )}
          <li>
            <NewPageButton className={ROW} />
          </li>
        </ul>
      </div>
      <section aria-labelledby="sidebar-recent" className="flex-1 py-3">
        <h2 id="sidebar-recent" className="px-4 pb-1.5 text-[11px] uppercase tracking-wider text-muted">
          Recent
        </h2>
        {recent.length === 0 ? (
          <p className="px-4 text-sm text-muted">Pages you open appear here.</p>
        ) : (
          <ul>
            {recent.map((pageId) => (
              <RecentPage key={pageId} pageId={pageId} pathname={pathname} onChoose={onChoose} />
            ))}
          </ul>
        )}
      </section>
      <div className="grid gap-2 border-t border-border px-4 py-2.5 empty:hidden">
        {pending > 0 && (
          <p role="status" className="text-[11px] uppercase tracking-wider text-muted">
            Updating the index · {pending} {pending === 1 ? "page" : "pages"} to go
          </p>
        )}
        {!onChoose && <p className="text-[11px] text-muted">t l · t r toggle panels</p>}
      </div>
    </>
  );
}

function RecentPage({ pageId, pathname, onChoose }: { pageId: string; pathname: string; onChoose?: () => void }) {
  const target = useLinkTarget(pageId);
  const href = linkHref(pageId, target);
  const current = decodeURIComponent(pathname) === decodeURIComponent(href);
  // A deleted page has nothing to open; the page on screen is listed even if the index hasn't caught up with it yet
  if (target?.missing && !current) return null;
  const date = parseJournalDate(pageId);
  const title = date ? journalTitle(date) : target ? target.title || UNTITLED : "…";
  return (
    <li>
      <Link
        to={href}
        onClick={onChoose}
        aria-current={current ? "page" : undefined}
        className={`${ROW} block truncate text-ink/80`}
      >
        {title}
      </Link>
    </li>
  );
}

/** The sidebar column on a wide screen, while it is shown (`t l`, or the header's button). */
export default function LeftSidebar({ fetchStatus }: { fetchStatus?: () => Promise<IndexStatus> }) {
  return (
    <nav id={SIDEBAR_ID} aria-label="Sidebar" className="left-sidebar hidden h-screen w-56 shrink-0 flex-col overflow-y-auto border-r border-border md:flex">
      <SidebarContents fetchStatus={fetchStatus} />
    </nav>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])';

/**
 * The phone menu (PRD F17): the sidebar's contents sliding in from the
 * left, from the header's ☰ button. Escape, tapping outside or choosing
 * anything closes it; the focus stays inside while it is open and goes back
 * to the button afterwards.
 */
export function PhoneMenu({ fetchStatus }: { fetchStatus?: () => Promise<IndexStatus> }) {
  const sidebar = useLeftSidebar();
  const panel = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  // The screen the menu was opened on; moving to another closes it (Today and New page move without a link)
  const openedOn = useRef<string | null>(null);
  const open = !!sidebar?.menuOpen;
  const close = sidebar?.closeMenu;

  useEffect(() => {
    if (!open) {
      openedOn.current = null;
    } else if (openedOn.current === null) {
      openedOn.current = pathname;
      panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    } else if (pathname !== openedOn.current) {
      close?.();
    }
  }, [open, pathname, close]);

  if (!open || !close) return null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close?.();
      return;
    }
    if (event.key !== "Tab" || !panel.current) return;
    const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const at = document.activeElement;
    if (event.shiftKey && (at === first || !panel.current.contains(at))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (at === last || !panel.current.contains(at))) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div className="md:hidden">
      <div className="fixed inset-0 z-50 bg-black/30" aria-hidden="true" data-testid="menu-scrim" onClick={close} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        onKeyDown={onKeyDown}
        className="fixed inset-y-0 left-0 z-50 flex w-[min(300px,84%)] flex-col overflow-y-auto border-r border-ink bg-paper"
      >
        <div className="flex shrink-0 items-stretch border-b border-border">
          <span className="flex grow items-center bg-ink px-4 py-2 text-sm font-medium text-paper">{APP_DISPLAY_NAME}</span>
          <button type="button" onClick={close} aria-label="Close menu" className="px-4 text-muted hover:text-ink">
            ✕
          </button>
        </div>
        <nav aria-label="Sidebar" className="flex flex-1 flex-col">
          <SidebarContents onChoose={close} fetchStatus={fetchStatus} />
        </nav>
      </div>
    </div>
  );
}

/**
 * The header's buttons for the sidebar: on a wide screen, show or hide it
 * (`t l`); on a phone, ☰ opens the menu. Nothing outside LeftSidebarProvider.
 */
export function SidebarButtons() {
  const sidebar = useLeftSidebar();
  if (!sidebar) return null;
  const label = sidebar.shown ? "Hide sidebar" : "Show sidebar";
  return (
    <>
      <button
        type="button"
        onClick={sidebar.toggle}
        aria-label={label}
        title={`${label} (t l)`}
        aria-expanded={sidebar.shown}
        aria-controls={SIDEBAR_ID}
        className="hidden shrink-0 items-center border-r border-border px-3 text-muted transition-colors hover:bg-border hover:text-ink md:flex"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
          <rect x="3.5" y="4.5" width="17" height="15" />
          <path d="M9.5 4.5v15" />
        </svg>
      </button>
      <button
        type="button"
        onClick={sidebar.openMenu}
        aria-label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={sidebar.menuOpen}
        className="flex shrink-0 items-center border-r border-border px-3 text-ink transition-colors hover:bg-border md:hidden"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
    </>
  );
}
