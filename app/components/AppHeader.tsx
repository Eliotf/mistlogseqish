import type { ReactNode } from "react";
import { Link } from "react-router";
import { APP_DISPLAY_NAME } from "~/shared/constants";
import TodayButton from "~/components/TodayButton";
import NewPageButton from "~/components/NewPageButton";
import SearchButton from "~/components/SearchButton";
import ThemeSelector from "~/components/ThemeSelector";
import ShortcutsButton from "~/components/ShortcutsButton";

/** The bar across the top of every Mistlog screen. Page-specific items go in children. */
export default function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex items-stretch overflow-x-auto scrollbar-none border-b border-border">
      <Link
        to="/"
        className="flex shrink-0 items-center bg-ink px-2 py-2 text-xs font-medium text-paper sm:px-4 sm:text-base transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
      >
        {APP_DISPLAY_NAME}
      </Link>
      <div className="shrink-0 border-r border-border">
        <TodayButton />
      </div>
      <div className="shrink-0 border-r border-border empty:hidden">
        <SearchButton />
      </div>
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
      <div className="shrink-0 border-r border-border">
        <NewPageButton />
      </div>
      {children ?? <div className="grow" />}
      {/* On a phone, a page's own controls (connection, Share) need the room */}
      <div className={`shrink-0 items-center border-l border-border ${children ? "hidden sm:flex" : "flex"}`}>
        <ShortcutsButton />
        <ThemeSelector />
      </div>
    </header>
  );
}
