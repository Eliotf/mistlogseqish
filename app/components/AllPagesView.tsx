import { useMemo, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { filterPages, nextSort, sortPages, type AllPagesRow, type SortDir, type SortKey } from "~/lib/all-pages";
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
 * links to it stay and show as missing. Journal days can't be deleted yet.
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

  const shown = useMemo(() => sortPages(filterPages(rows, query, journals), sort.key, sort.dir), [rows, query, journals, sort]);

  const remove = async (row: AllPagesRow) => {
    setBusy(row.pageId);
    setError(null);
    const result = await deletePage(row.pageId);
    setBusy(null);
    setConfirming(null);
    if (result.ok || result.code === "missing") {
      setRows((current) => current.filter((r) => r.pageId !== row.pageId));
      // Links to it show as missing straight away
      pageTitles().prime(row.pageId, { title: "", kind: "page", slug: null, empty: false, missing: true });
    } else {
      setError(`Couldn't delete “${row.title || UNTITLED}”. Try again in a moment.`);
    }
  };

  return (
    <div className="mx-6 mb-10 mt-8 max-w-[65rem]">
      <h1 className="text-[1.75rem] font-semibold leading-tight text-ink">All pages</h1>
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
      {error && (
        <p role="alert" className="mt-4 text-sm text-coral">
          {error}
        </p>
      )}
      <table className="mt-4 w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wider text-muted">
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
