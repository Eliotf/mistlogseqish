import { Link, useLocation } from "react-router";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider } from "~/lib/DocumentContext";
import { useSidePanel } from "~/lib/side-panel";
import { linkHref, type LinkTarget } from "~/lib/page-titles";
import { useLinkTarget } from "~/lib/useLinkTarget";
import { journalTitle, parseJournalDate } from "~/lib/note-ids";
import { UNTITLED } from "~/lib/page-title";
import ConnectedEditor from "~/components/ConnectedEditor";

function titleFor(pageId: string, target: LinkTarget | undefined): string {
  const date = parseJournalDate(pageId);
  if (date) return journalTitle(date);
  if (!target) return "…";
  return target.missing ? "Missing page" : target.title || UNTITLED;
}

/**
 * The side panel (PRD F18): pages opened with Cmd/Ctrl+click, newest on top,
 * each a live editor. A right-hand column on wide screens (taking the
 * comments column's place on a page), a full-screen sheet on phones.
 */
export default function SidePanel() {
  const panel = useSidePanel();
  const { pathname } = useLocation();
  if (!panel.shown || panel.pages.length === 0) return null;
  // On a page, hiding the panel brings its comments back
  const onPage = /^\/(docs|page|journal)\//.test(pathname);

  return (
    <aside
      aria-label="Side panel"
      className="fixed inset-0 z-40 flex flex-col bg-paper lg:static lg:z-auto lg:h-screen lg:w-[28rem] lg:shrink-0 lg:border-l lg:border-border"
    >
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
        {panel.pages.map((pageId) => (
          <SidePage key={pageId} pageId={pageId} />
        ))}
      </div>
    </aside>
  );
}

function SidePage({ pageId }: { pageId: string }) {
  const panel = useSidePanel();
  const yjs = useYjsEditor(pageId);
  const target = useLinkTarget(pageId);
  const title = titleFor(pageId, target);

  return (
    <section aria-label={title} className="border-b border-border pb-4">
      <div className="flex items-baseline gap-2 px-6 pt-4">
        <Link to={linkHref(pageId, target)} className="grow truncate text-lg font-semibold text-ink hover:underline" title="Open in the main view">
          {title}
        </Link>
        <button type="button" onClick={() => panel.close(pageId)} aria-label={`Close ${title}`} className="px-1 text-muted hover:text-ink">
          ✕
        </button>
      </div>
      <DocumentProvider docId={pageId} createdAt={null} yjs={yjs}>
        <ConnectedEditor />
      </DocumentProvider>
    </section>
  );
}
