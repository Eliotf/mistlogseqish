import { useCallback, useMemo, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import { linesFromYjs } from "~/lib/note-lines";
import { journalTitle, parseJournalDate } from "~/lib/note-ids";
import { zoomCrumbs, type Crumb } from "~/lib/zoom";

interface ZoomCrumbsProps {
  doc: Y.Doc;
  docId: string;
  /** The zoomed block's ID. */
  zoom: string;
  /** Whether the document has finished its first sync; until then a missing block is just not loaded yet. */
  synced: boolean;
  onZoom: (blockId: string | null) => void;
}

function pageTitle(doc: Y.Doc, docId: string): string {
  const date = parseJournalDate(docId);
  if (date) return journalTitle(date);
  const title = doc.getMap<unknown>("meta").get("title");
  return typeof title === "string" && title ? title : "Untitled";
}

/**
 * The breadcrumb above a zoomed block (PRD F40): the page, the blocks the
 * zoomed block is nested under, then the block itself. Each earlier crumb
 * zooms out to it. Follows the live document, so it changes as the lines do.
 * If the block has gone (deleted, or moved to another page), it says so and
 * offers the whole page.
 */
export default function ZoomCrumbs({ doc, docId, zoom, synced, onZoom }: ZoomCrumbsProps) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      doc.on("update", onChange);
      return () => doc.off("update", onChange);
    },
    [doc],
  );
  // A string snapshot, so React sees no change while the crumbs stay the same
  const snapshot = useSyncExternalStore(
    subscribe,
    () => JSON.stringify(zoomCrumbs(linesFromYjs(doc.getXmlFragment("default")), zoom, pageTitle(doc, docId))),
    () => "null",
  );
  const crumbs = useMemo(() => JSON.parse(snapshot) as Crumb[] | null, [snapshot]);

  if (!crumbs) {
    if (!synced) return null;
    return (
      <p role="status" className="mx-6 mt-2 max-w-[65ch] text-sm text-muted">
        That block is no longer on this page.{" "}
        <button type="button" onClick={() => onZoom(null)} className="underline hover:text-ink">
          Show the whole page
        </button>
      </p>
    );
  }

  return (
    <nav aria-label="Zoomed into a block" className="mx-6 mt-2 flex max-w-[65ch] flex-wrap items-center gap-1 text-sm text-muted">
      {crumbs.map((crumb, i) => {
        const last = i === crumbs.length - 1;
        return (
          <span key={`${i}-${crumb.blockId ?? "page"}`} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden="true">›</span>}
            {last ? (
              <span aria-current="location" className="text-ink">
                {crumb.text}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onZoom(crumb.blockId)}
                title={crumb.blockId ? "Zoom out to this block" : "Zoom out to the whole page"}
                className="hover:text-ink hover:underline"
              >
                {crumb.text}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}
