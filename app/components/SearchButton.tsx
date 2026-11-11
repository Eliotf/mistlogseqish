import { useSearchBox } from "~/lib/search-box";
import { useModKeyLabel } from "~/lib/mod-key";

/** Header button: open the search box (PRD F13). Nothing outside SearchBoxProvider. */
export default function SearchButton() {
  const search = useSearchBox();
  const mod = useModKeyLabel();
  if (!search) return null;
  const shortcut = `${mod}+K`;
  return (
    <button
      type="button"
      onClick={search.open}
      title={`Search (${shortcut})`}
      aria-keyshortcuts={mod === "⌘" ? "Meta+K" : "Control+K"}
      className="flex h-full cursor-pointer items-center gap-1.5 px-2 text-xs uppercase tracking-wider transition-colors hover:bg-border sm:px-3 sm:text-sm"
    >
      {/* A magnifier on phones, where the header is short of room */}
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 sm:hidden" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="6.5" />
        <path d="M20 20l-4.2-4.2" />
      </svg>
      <span className="sr-only sm:not-sr-only">Search</span>
      <kbd aria-hidden="true" className="hidden font-[inherit] text-[11px] normal-case tracking-normal text-muted md:inline">
        {mod === "⌘" ? "⌘K" : "Ctrl K"}
      </kbd>
    </button>
  );
}
