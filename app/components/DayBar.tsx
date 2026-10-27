import { Link } from "react-router";
import { useDocument } from "~/lib/DocumentContext";
import ConnectionStatus from "~/components/ConnectionStatus";
import ShareButton from "~/components/ShareButton";

/**
 * Compact Mist controls for one day in the journal feed: edit or suggest,
 * connection, share, and a link to the day's own page, where comments,
 * threads and accepting suggestions live.
 */
export default function DayBar({ path }: { path: string }) {
  const { mode, toggleMode } = useDocument();
  const pick = (wanted: "edit" | "suggest") => () => {
    if (mode !== wanted) toggleMode();
  };
  const segment = (active: boolean) =>
    `px-2 py-1 transition-colors ${active ? "bg-ink text-paper" : "text-muted hover:text-ink"}`;

  return (
    <div className="mx-6 mt-2 flex w-max max-w-[calc(100%-3rem)] flex-wrap items-stretch border border-border text-xs">
      <div role="group" aria-label="Editing mode" className="flex">
        <button type="button" aria-pressed={mode === "edit"} onClick={pick("edit")} className={segment(mode === "edit")}>
          Edit
        </button>
        <button type="button" aria-pressed={mode === "suggest"} onClick={pick("suggest")} className={segment(mode === "suggest")}>
          Suggest
        </button>
      </div>
      <div className="flex items-center border-l border-border px-2">
        <ConnectionStatus />
      </div>
      <div className="border-l border-border">
        <ShareButton url={path} />
      </div>
      <Link to={path} className="flex items-center border-l border-border px-2 text-muted hover:text-ink">
        Open day
      </Link>
    </div>
  );
}
