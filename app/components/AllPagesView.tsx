import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { Link } from "react-router";
import { filterPages, nextSort, sortPages, type AllPagesRow, type SortDir, type SortKey } from "~/lib/all-pages";
import { deletePagesInBatches, describeTitles, pagesCount, selectableRows } from "~/lib/bulk-delete";
import { pageTitles } from "~/lib/page-titles";
import { UNTITLED, type DeletePageResult } from "~/lib/page-title";
import { pagePath } from "~/lib/slug";

/** Rows shown before "Show all", so a large workspace renders quickly. */
export const PAGE_STEP = 200;

export async function deletePageOnServer(pageId: string): Promise<DeletePageResult> {
  try {
    const res = await fetch("/api/pages/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId }),
    });
    return (await res.json()) as DeletePageResult;
  } catch {
    return { ok: false, code: "failed" };
  }
}

interface AllPagesViewProps {
  pages: AllPagesRow[];
  loadFailed: boolean;
  deletePage?: typeof deletePageOnServer;
}

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: "title", label: "Title" },
  { key: "backlinks", label: "Backlinks" },
  { key: "updated", label: "Last edited" },
];

const noSubscription = () => () => {};

/** When a page was last edited, in the browser's own locale and time zone (blank on the server, so hydration matches). */
function Edited({ at }: { at: number }) {
  const inBrowser = useSyncExternalStore(noSubscription, () => true, () => false);
  if (at <= 0) return <>—</>;
  return <>{inBrowser ? new Date(at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : ""}</>;
}

/**
 * All pages (PRD F21, section 6.3): every page, with how many pages link to
 * it and when it was last edited. Filter by title, sort by any column,
 * include journal days if wanted. A page can be deleted after confirming;
 * links to it stay and show as missing. Several can be ticked and deleted
 * together, after one confirmation. Journal days can't be deleted yet.
 */
export default function AllPagesView({ pages, loadFailed, deletePage = deletePageOnServer }: AllPagesViewProps) {
  const [rows, setRows] = useState(pages);
  const [query, setQuery] = useState("");
  const [journals, setJournals] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "updated", dir: "desc" });
  const [limit, setLimit] = useState(PAGE_STEP);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set());
  // The pages the open confirmation names (fixed when it opens), or null
  const [confirmingMany, setConfirmingMany] = useState<AllPagesRow[] | null>(null);
  // How many of a bulk delete have been answered, or null when none is running
  const [progress, setProgress] = useState<number | null>(null);
  const deleteManyButton = useRef<HTMLButtonElement>(null);
  const cancelManyButton = useRef<HTMLButtonElement>(null);
  const selectAllBox = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => sortPages(filterPages(rows, query, journals), sort.key, sort.dir), [rows, query, journals, sort]);
  // "Select all" covers every row the filter shows, not only the first PAGE_STEP
  const shownSelectable = useMemo(() => selectableRows(shown), [shown]);
  // Only ticked rows the filter shows count: a ticked page hidden by the filter is never deleted unseen
  const chosen = useMemo(() => shownSelectable.filter((row) => ticked.has(row.pageId)), [shownSelectable, ticked]);
  const allChosen = shownSelectable.length > 0 && chosen.length === shownSelectable.length;
  const deletingMany = progress !== null;
  // Ticks are frozen while a confirmation is open, so it deletes what it names
  const ticksLocked = confirmingMany !== null;

  useEffect(() => {
    if (selectAllBox.current) selectAllBox.current.indeterminate = chosen.length > 0 && !allChosen;
  }, [chosen.length, allChosen]);

  const confirmOpen = confirmingMany !== null;
  useEffect(() => {
    if (confirmOpen) cancelManyButton.current?.focus();
  }, [confirmOpen]);

  const toggle = (pageId: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });

  const toggleAll = () =>
    setTicked((current) => {
      const next = new Set(current);
      for (const row of shownSelectable) {
        if (allChosen) next.delete(row.pageId);
        else next.add(row.pageId);
      }
      return next;
    });

  // Back to the button that opened the confirmation once it is rendered again, or the select-all box if nothing is ticked
  const restoreFocus = () => setTimeout(() => (deleteManyButton.current ?? selectAllBox.current)?.focus(), 0);

  const cancelMany = () => {
    setConfirmingMany(null);
    restoreFocus();
  };

  const onConfirmKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !deletingMany) {
      e.preventDefault();
      cancelMany();
    }
  };

  const removeMany = async (targets: AllPagesRow[]) => {
    setError(null);
    setProgress(0);
    const { deleted, failed } = await deletePagesInBatches(targets.map((row) => row.pageId), deletePage, setProgress);
    setProgress(null);
    setConfirmingMany(null);
    const gone = new Set(deleted);
    setRows((current) => current.filter((r) => !gone.has(r.pageId)));
    // Failed ones stay ticked, so trying again is one click
    setTicked((current) => new Set([...current].filter((id) => !gone.has(id))));
    for (const pageId of deleted) pageTitles().prime(pageId, { title: "", kind: "page", slug: null, empty: false, missing: true });
    if (failed.length) {
      const failedTitles = targets.filter((row) => failed.includes(row.pageId)).map((row) => row.title);
      setError(`Couldn't delete ${pagesCount(failed.length)}: ${describeTitles(failedTitles)}. They are still ticked; try again in a moment.`);
    }
    restoreFocus();
  };

  const remove = async (row: AllPagesRow) => {
    setBusy(row.pageId);
    setError(null);
    const result = await deletePage(row.pageId);
    setBusy(null);
    setConfirming(null);
    if (result.ok || result.code === "missing") {
      setRows((current) => current.filter((r) => r.pageId !== row.pageId));
      setTicked((current) => new Set([...current].filter((id) => id !== row.pageId)));
      // Links to it show as missing straight away
      pageTitles().prime(row.pageId, { title: "", kind: "page", slug: null, empty: false, missing: true });
    } else {
      setError(`Couldn't delete “${row.title || UNTITLED}”. Try again in a moment.`);
    }
  };

  return (
    <div className="mx-6 mb-10 mt-8 max-w-[65rem]">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[1.75rem] font-semibold leading-tight text-ink">All pages</h1>
        <Link to="/import" className="text-sm text-muted underline hover:text-ink">
          Import from Logseq
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by title"
          aria-label="Filter pages by title"
          className="w-full max-w-xs border border-border bg-paper px-3 py-1.5 text-sm text-ink outline-none focus:border-ink"
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={journals} onChange={(e) => setJournals(e.target.checked)} />
          Include journal days
        </label>
        <span className="text-sm text-muted" role="status">
          {shown.length} {shown.length === 1 ? "page" : "pages"}
        </span>
      </div>
      {loadFailed && (
        <p role="alert" className="mt-4 text-sm text-muted">
          Couldn't load pages. Try again in a moment.
        </p>
      )}
      {chosen.length > 0 && !confirmingMany && (
        <div className="mt-4 flex flex-wrap items-baseline gap-4 text-sm">
          <button ref={deleteManyButton} type="button" onClick={() => setConfirmingMany(chosen)} className="text-coral hover:underline">
            Delete {pagesCount(chosen.length)}
          </button>
          <button type="button" onClick={() => setTicked(new Set())} className="text-muted hover:underline">
            Clear selection
          </button>
        </div>
      )}
      {confirmingMany && (
        <div
          role="alertdialog"
          aria-labelledby="delete-many-heading"
          aria-describedby="delete-many-titles"
          onKeyDown={onConfirmKeyDown}
          className="mt-4 border border-border bg-paper p-4 text-sm"
        >
          <p id="delete-many-heading" className="font-semibold text-ink">
            Delete {pagesCount(confirmingMany.length)}? Links to them will show as missing.
          </p>
          <p id="delete-many-titles" className="mt-1 text-muted">
            {describeTitles(confirmingMany.map((row) => row.title))}
          </p>
          <div className="mt-3 flex items-baseline gap-4">
            <button type="button" disabled={deletingMany} onClick={() => void removeMany(confirmingMany)} className="text-coral hover:underline disabled:opacity-60">
              {deletingMany ? `Deleting ${progress} of ${confirmingMany.length}…` : `Delete ${pagesCount(confirmingMany.length)}`}
            </button>
            <button ref={cancelManyButton} type="button" disabled={deletingMany} onClick={cancelMany} className="text-muted hover:underline disabled:opacity-60">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-4 text-sm text-coral">
          {error}
        </p>
      )}
      <table className="mt-4 w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wider text-muted">
            <th scope="col" className="w-6 py-2 pr-2 font-normal">
              <input
                ref={selectAllBox}
                type="checkbox"
                checked={allChosen}
                disabled={shownSelectable.length === 0 || ticksLocked}
                onChange={toggleAll}
                aria-label="Select all shown pages"
              />
            </th>
            {COLUMNS.map((col) => (
              <th
                key={col.key}
                scope="col"
                aria-sort={sort.key === col.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                className={`py-2 pr-4 font-normal ${col.key === "title" ? "" : "hidden sm:table-cell"}`}
              >
                <button type="button" onClick={() => setSort(nextSort(sort, col.key))} className="uppercase tracking-wider hover:text-ink">
                  {col.label}
                  {sort.key === col.key ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
                </button>
              </th>
            ))}
            <th scope="col" className="py-2 font-normal">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {shown.slice(0, limit).map((row) => {
            const title = row.title || UNTITLED;
            return (
              <tr key={row.pageId} className="border-b border-border align-baseline">
                <td className="py-2 pr-2">
                  {row.kind === "page" && (
                    <input type="checkbox" checked={ticked.has(row.pageId)} disabled={ticksLocked} onChange={() => toggle(row.pageId)} aria-label={`Select ${title}`} />
                  )}
                </td>
                <td className="py-2 pr-4">
                  <Link to={pagePath(row.pageId, row.slug)} className={`hover:underline ${row.title ? "text-ink" : "text-muted"}`}>
                    {title}
                  </Link>
                  {row.kind === "journal" && <span className="ml-2 text-xs text-muted">journal</span>}
                </td>
                <td className="hidden py-2 pr-4 text-muted sm:table-cell">{row.backlinks}</td>
                <td className="hidden py-2 pr-4 text-muted sm:table-cell">
                  <Edited at={row.updatedAt} />
                </td>
                <td className="py-2 text-right whitespace-nowrap">
                  {row.kind === "journal" ? null : confirming === row.pageId ? (
                    <span className="inline-flex items-baseline gap-2">
                      <span className="text-xs text-muted">Delete? Links to it will show as missing.</span>
                      <button type="button" disabled={busy === row.pageId} onClick={() => void remove(row)} className="text-coral hover:underline disabled:opacity-60">
                        Delete
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className="text-muted hover:underline">
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setConfirming(row.pageId)} aria-label={`Delete ${title}`} className="text-muted hover:text-coral">
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {shown.length > limit && (
        <button type="button" onClick={() => setLimit(shown.length)} className="mt-4 text-sm text-muted underline hover:text-ink">
          Show all {shown.length}
        </button>
      )}
      {!loadFailed && rows.length === 0 && <p className="mt-4 text-sm text-muted">No pages yet. Create one with New page.</p>}
    </div>
  );
}
