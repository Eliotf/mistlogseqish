import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { useNavigate } from "react-router";
import { fetchSearch, searchRows, snippetParts, type SearchResults, type SearchRow } from "~/lib/search";
import { useSearchBox } from "~/lib/search-box";
import { useOpenLink } from "~/lib/side-panel";
import { linkHref, linkPageForTitle, pageTitles, targetOf, type LinkPage } from "~/lib/page-titles";
import { useModKeyLabel } from "~/lib/mod-key";
import { UNTITLED } from "~/lib/page-title";
import { pagePath } from "~/lib/slug";

/** How long typing pauses before the query is sent. */
export const SEARCH_DEBOUNCE_MS = 120;

const NO_RESULTS: SearchResults = { titles: [], text: [], pending: 0 };

interface SearchBoxProps {
  search?: (query: string, signal: AbortSignal) => Promise<SearchResults>;
  create?: (title: string) => Promise<LinkPage | null>;
}

/** The search box, while it is open (see SearchBoxProvider). */
export default function SearchBox(props: SearchBoxProps) {
  const control = useSearchBox();
  if (!control?.isOpen) return null;
  return <SearchDialog {...props} onClose={control.close} />;
}

/** The heading a row is listed under; the create row has none. */
function groupOf(row: SearchRow, searching: boolean): string | null {
  if (row.kind === "create") return null;
  if (row.kind === "text") return "In pages";
  return searching ? "Titles" : "Recent pages";
}

function rowKey(row: SearchRow): string {
  if (row.kind === "title") return `t-${row.page.pageId}`;
  if (row.kind === "text") return `x-${row.hit.pageId}`;
  return "create";
}

/**
 * Search across pages (PRD F13), as in the prototype: titles first, then
 * pages whose text matches with the words highlighted, then a row to create
 * a page. ↑/↓ choose, Enter opens, Cmd/Ctrl+Enter opens in the side panel,
 * Esc closes.
 */
function SearchDialog({ search = fetchSearch, create = linkPageForTitle, onClose }: SearchBoxProps & { onClose: () => void }) {
  const navigate = useNavigate();
  const openLink = useOpenLink();
  const mod = useModKeyLabel();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  // Results with the query they answer, so the create row matches what is shown
  const [answer, setAnswer] = useState<{ query: string; results: SearchResults } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const loaded = useRef(false);
  const [active, setActive] = useState(0);

  useEffect(() => {
    input.current?.focus();
  }, []);

  useEffect(() => {
    const q = query.trim();
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        search(q, controller.signal).then(
          (results) => {
            loaded.current = true;
            setAnswer({ query: q, results });
            setError(null);
            setActive(0);
          },
          (err: unknown) => {
            if (controller.signal.aborted) return;
            console.error("Search failed", err);
            setError("Couldn't search your pages right now. Try again in a moment.");
          },
        );
      },
      // The first list (recent pages) loads at once
      loaded.current ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, search]);

  const rows = useMemo(() => (answer ? searchRows(answer.query, answer.results) : []), [answer]);
  const results = answer?.results ?? NO_RESULTS;
  const current = Math.min(active, Math.max(0, rows.length - 1));

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView?.({ block: "nearest" });
  }, [current, rows]);

  async function choose(row: SearchRow | undefined, side: boolean) {
    if (!row) return;
    if (row.kind !== "create") {
      const page = row.kind === "title" ? row.page : row.hit;
      onClose();
      openLink(pagePath(page.pageId, page.slug), { pageId: page.pageId, side });
      return;
    }
    if (creating) return;
    setCreating(true);
    const page = await create(row.title).catch(() => null);
    setCreating(false);
    if (!page) {
      setError(`Couldn't create “${row.title}”. Try again in a moment.`);
      return;
    }
    pageTitles().prime(page.pageId, targetOf(page));
    onClose();
    if (side) openLink(linkHref(page.pageId, targetOf(page)), { pageId: page.pageId, side });
    else navigate(linkHref(page.pageId, targetOf(page)));
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const side = event.metaKey || event.ctrlKey;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!rows.length) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((current + step + rows.length) % rows.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void choose(rows[current], side);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "Tab") {
      // The box is modal: the focus stays in it
      event.preventDefault();
    }
  }

  function onRowDown(event: MouseEvent, index: number) {
    // Keep the focus in the input; open on press, as the prototype does
    event.preventDefault();
    setActive(index);
    void choose(rows[index], event.metaKey || event.ctrlKey);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" aria-hidden="true" onMouseDown={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Search" className="fixed left-1/2 top-16 z-50 grid w-[min(560px,calc(100%-32px))] -translate-x-1/2 border border-ink bg-paper shadow-lg">
        <input
          ref={input}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search pages, or type a new title"
          aria-label="Search"
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={rows.length ? `${listId}-${current}` : undefined}
          className="border-b border-border bg-transparent px-3.5 py-3 text-base text-ink outline-none"
        />
        {results.pending > 0 && (
          <p role="status" className="mx-3.5 mt-2 text-xs text-muted">
            Updating the index: {results.pending} {results.pending === 1 ? "page" : "pages"} to go. Some results may be missing until it finishes.
          </p>
        )}
        {error && (
          <p role="alert" className="mx-3.5 mt-2 text-xs text-coral">
            {error}
          </p>
        )}
        <ul ref={list} id={listId} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto py-1">
          {rows.map((row, i) => {
            const heading = groupOf(row, !!answer?.query);
            const showHeading = heading !== null && (i === 0 || groupOf(rows[i - 1], !!answer?.query) !== heading);
            const selected = i === current;
            return [
              showHeading && (
                <li key={`h-${heading}`} role="presentation" className="px-3.5 pb-0.5 pt-2 text-[11px] uppercase tracking-wider text-muted">
                  {heading}
                </li>
              ),
              <li
                key={rowKey(row)}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={selected}
                onMouseDown={(e) => onRowDown(e, i)}
                className={`grid cursor-pointer gap-0.5 px-3.5 py-1.5 ${selected ? "bg-chartreuse text-[#1a1a1a]" : ""}`}
              >
                <RowContent row={row} selected={selected} />
              </li>,
            ];
          })}
          {answer && rows.length === 0 && <li className="px-3.5 py-1.5 text-sm text-muted">{answer.query ? "No pages match." : "No pages yet."}</li>}
        </ul>
        <div className="hidden border-t border-border px-3.5 py-1.5 text-[11px] text-muted sm:block">
          ↑↓ choose · Enter open · {mod}+Enter open in side panel · Esc close
        </div>
      </div>
    </>
  );
}

function RowContent({ row, selected }: { row: SearchRow; selected: boolean }) {
  const sub = selected ? "text-[#1a1a1a]" : "text-muted";
  if (row.kind === "create") {
    return <span className="font-medium">{row.journal ? `Open “${row.title}”` : `Create page “${row.title}”`}</span>;
  }
  if (row.kind === "title") {
    return (
      <>
        <span>{row.page.title || UNTITLED}</span>
        {row.page.kind === "journal" && <span className={`text-xs ${sub}`}>Journal</span>}
      </>
    );
  }
  return (
    <>
      <span>{row.hit.title || UNTITLED}</span>
      <span className={`overflow-hidden text-ellipsis whitespace-nowrap text-[13px] ${sub}`}>
        {snippetParts(row.hit.snippet).map((part, k) =>
          part.match ? (
            <mark key={k} className="bg-canary text-[#1a1a1a]">
              {part.text}
            </mark>
          ) : (
            <span key={k}>{part.text}</span>
          ),
        )}
      </span>
    </>
  );
}
