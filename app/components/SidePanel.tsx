import { useCallback, useEffect } from "react";
import { Link, useFetcher, useLocation, useNavigate } from "react-router";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider } from "~/lib/DocumentContext";
import { TASKS_PANEL_ID, useHasSidePanel, useSidePanel } from "~/lib/side-panel";
import TasksView from "~/components/TasksView";
import type { loader as tasksLoader } from "~/routes/tasks";
import { linkHref, type LinkTarget } from "~/lib/page-titles";
import { useLinkTarget } from "~/lib/useLinkTarget";
import { journalTitle, parseJournalDate } from "~/lib/note-ids";
import { UNTITLED } from "~/lib/page-title";
import ConnectedEditor from "~/components/ConnectedEditor";
import { zoomHref } from "~/lib/zoom";
import { useModKeyLabel } from "~/lib/mod-key";
import { RIGHT_PANEL_SIZE } from "~/lib/panel-width";
import ResizeHandle from "~/components/ResizeHandle";

export const SIDE_PANEL_ID = "side-panel";

function titleFor(pageId: string, target: LinkTarget | undefined): string {
  const date = parseJournalDate(pageId);
  if (date) return journalTitle(date);
  if (!target) return "…";
  return target.missing ? "Missing page" : target.title || UNTITLED;
}

/**
 * The side panel (PRD F18): pages opened with Cmd/Ctrl+click, newest on top,
 * each a live editor. A right-hand column on wide screens (taking the
 * comments column's place on a page), resized by its left edge; a
 * full-screen sheet on phones.
 */
export default function SidePanel() {
  const panel = useSidePanel();
  const { pathname } = useLocation();
  const mod = useModKeyLabel();
  if (!panel.shown) return null;
  // On a page, hiding the panel brings its comments back
  const onPage = /^\/(docs|page|journal)\//.test(pathname);

  return (
    <aside
      id={SIDE_PANEL_ID}
      aria-label="Side panel"
      className="fixed inset-0 z-40 flex flex-col bg-paper lg:relative lg:inset-auto lg:z-auto lg:h-dvh lg:w-[min(var(--right-panel-width,28rem),60vw)] lg:shrink-0 lg:border-l lg:border-border"
    >
      <ResizeHandle size={RIGHT_PANEL_SIZE} label="Resize the side panel" controls={SIDE_PANEL_ID} className="absolute inset-y-0 -left-1 hidden lg:block" />
      <div className="flex shrink-0 items-stretch border-b border-border text-sm">
        <button type="button" onClick={() => panel.setShown(false)} className="px-3 py-2 text-muted hover:text-ink lg:hidden">
          ← Back
        </button>
        <span className="flex grow items-center px-3 py-2 uppercase tracking-wider text-muted">Side panel</span>
        <button
          type="button"
          onClick={() => panel.setShown(false)}
          title="Hide the side panel (t r)"
          className="hidden border-l border-border px-3 uppercase tracking-wider text-muted hover:text-ink lg:block"
        >
          {onPage ? "Comments" : "Hide"}
        </button>
        <button
          type="button"
          onClick={panel.closeAll}
          aria-label="Close all pages in the side panel"
          title="Close all"
          className="border-l border-border px-3 text-muted hover:text-ink"
        >
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {panel.pages.length === 0 && (
          <p className="px-6 py-4 text-sm text-muted">Nothing here yet. {mod}+click a link, a search result or Tasks to open it here.</p>
        )}
        {panel.pages.map((pageId) => (pageId === TASKS_PANEL_ID ? <SideTasks key={pageId} /> : <SidePage key={pageId} pageId={pageId} />))}
      </div>
    </aside>
  );
}

/** The header button for the side panel, as the sidebar has on the left (`t r`). Nothing outside SidePanelProvider. */
export function SidePanelButton() {
  const panel = useSidePanel();
  const hasPanel = useHasSidePanel();
  if (!hasPanel) return null;
  const label = panel.shown ? "Hide side panel" : "Show side panel";
  return (
    <button
      type="button"
      onClick={panel.toggle}
      aria-label={label}
      title={`${label} (t r)`}
      aria-expanded={panel.shown}
      aria-controls={SIDE_PANEL_ID}
      className="flex shrink-0 cursor-pointer items-center self-stretch border-l border-border px-3 text-muted transition-colors hover:bg-border hover:text-ink"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75">
        <rect x="3.5" y="4.5" width="17" height="15" />
        <path d="M14.5 4.5v15" />
      </svg>
    </button>
  );
}

/**
 * The Tasks list (PRD F6) in the panel, from the Tasks view's own loader.
 * Fetched when opened, when the tab is shown again, when the main view moves
 * to another kind of screen (the fetcher's `load` changes) and with ↻; never polled.
 */
function SideTasks() {
  const panel = useSidePanel();
  const { data, state, load } = useFetcher<typeof tasksLoader>();
  useEffect(() => {
    void load("/tasks");
    const onVisible = () => {
      if (document.visibilityState === "visible") void load("/tasks");
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  return (
    <section aria-label="Tasks" className="border-b border-border pb-4">
      <div className="flex items-baseline gap-2 px-6 pt-4">
        <Link to="/tasks" className="grow truncate text-lg font-semibold text-ink hover:underline" title="Open in the main view">
          Tasks
        </Link>
        <button
          type="button"
          onClick={() => void load("/tasks")}
          disabled={state === "loading"}
          aria-label="Refresh tasks"
          title="Refresh"
          className="px-1 text-muted hover:text-ink disabled:opacity-50"
        >
          ↻
        </button>
        <button type="button" onClick={() => panel.close(TASKS_PANEL_ID)} aria-label="Close Tasks" className="px-1 text-muted hover:text-ink">
          ✕
        </button>
      </div>
      {data ? (
        <TasksView open={data.open} done={data.done} pending={data.pending} loadFailed={data.loadFailed} inPanel />
      ) : (
        <p className="px-6 pt-2 text-sm text-muted">Loading tasks…</p>
      )}
    </section>
  );
}

function SidePage({ pageId }: { pageId: string }) {
  const panel = useSidePanel();
  const yjs = useYjsEditor(pageId);
  const target = useLinkTarget(pageId);
  const title = titleFor(pageId, target);
  // A bullet click opens the page in the main view, zoomed into that block
  const navigate = useNavigate();
  const href = linkHref(pageId, target);
  const onZoom = useCallback((blockId: string | null) => navigate(zoomHref(href, blockId)), [navigate, href]);

  return (
    <section aria-label={title} className="border-b border-border pb-4">
      <div className="flex items-baseline gap-2 px-6 pt-4">
        <Link to={href} className="grow truncate text-lg font-semibold text-ink hover:underline" title="Open in the main view">
          {title}
        </Link>
        <button type="button" onClick={() => panel.close(pageId)} aria-label={`Close ${title}`} className="px-1 text-muted hover:text-ink">
          ✕
        </button>
      </div>
      <DocumentProvider docId={pageId} createdAt={null} yjs={yjs}>
        <ConnectedEditor onZoom={onZoom} />
      </DocumentProvider>
    </section>
  );
}
