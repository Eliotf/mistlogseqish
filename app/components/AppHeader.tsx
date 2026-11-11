import type { ReactNode } from "react";
import { Link } from "react-router";
import { APP_DISPLAY_NAME } from "~/shared/constants";
import SearchButton from "~/components/SearchButton";
import ThemeSelector from "~/components/ThemeSelector";
import ShortcutsButton from "~/components/ShortcutsButton";
import { SidebarButtons } from "~/components/LeftSidebar";
import { useLeftSidebar } from "~/lib/left-sidebar";

/**
 * The bar across the top of every Mistlog screen. Page-specific items go in
 * children. Journals, Today, All pages, Tasks and New page live in the left
 * sidebar (PRD F8) and, on phones, the menu behind ☰ (F17). Tasks and Pages
 * are in the bar too.
 */
export default function AppHeader({ children }: { children?: ReactNode }) {
  const sidebar = useLeftSidebar();
  return (
    <header className="flex items-stretch overflow-x-auto scrollbar-none border-b border-border">
      <SidebarButtons />
      <Link
        to="/"
        className="flex shrink-0 items-center bg-ink px-2 py-2 text-xs font-medium text-paper sm:px-4 sm:text-base transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
      >
        {APP_DISPLAY_NAME}
      </Link>
      {/* Phones have no Cmd/Ctrl+K, so Search stays in reach; wider, it is in the sidebar while that shows */}
      <div className={`shrink-0 border-r border-border empty:hidden ${sidebar?.shown ? "md:hidden" : ""}`}>
        <SearchButton />
      </div>
      {/* Also in the sidebar; kept in the bar at the owner's request (2026-11-11) */}
      <Link
        to="/tasks"
        className="flex shrink-0 items-center border-r border-border px-2 text-xs uppercase tracking-wider transition-colors hover:bg-border sm:px-3 sm:text-sm"
      >
        Tasks
      </Link>
      <Link
        to="/pages"
        className="flex shrink-0 items-center border-r border-border px-2 text-xs uppercase tracking-wider transition-colors hover:bg-border sm:px-3 sm:text-sm"
      >
        Pages
      </Link>
      {children ?? <div className="grow" />}
      {/* On a phone, a page's own controls (connection, Share) need the room */}
      <div className={`shrink-0 items-center border-l border-border ${children ? "hidden sm:flex" : "flex"}`}>
        <ShortcutsButton />
        <ThemeSelector />
      </div>
    </header>
  );
}
