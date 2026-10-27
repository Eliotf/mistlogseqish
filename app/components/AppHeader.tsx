import type { ReactNode } from "react";
import { Link } from "react-router";
import { APP_DISPLAY_NAME } from "~/shared/constants";
import TodayButton from "~/components/TodayButton";
import NewPageButton from "~/components/NewPageButton";
import ThemeSelector from "~/components/ThemeSelector";

/** The bar across the top of every Mistlog screen. Page-specific items go in children. */
export default function AppHeader({ children }: { children?: ReactNode }) {
  return (
    <header className="flex items-stretch overflow-x-auto scrollbar-none border-b border-border">
      <Link
        to="/"
        className="flex items-center bg-ink px-4 py-2 font-medium text-paper transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
      >
        {APP_DISPLAY_NAME}
      </Link>
      <div className="shrink-0 border-r border-border">
        <TodayButton />
      </div>
      <div className="shrink-0 border-r border-border">
        <NewPageButton />
      </div>
      {children ?? <div className="grow" />}
      <div className="flex shrink-0 items-center border-l border-border">
        <ThemeSelector />
      </div>
    </header>
  );
}
