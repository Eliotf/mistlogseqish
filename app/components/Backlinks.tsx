import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { lineSegments, type BacklinkGroup, type BacklinkLine } from "~/lib/backlink-lines";
import { linkHref } from "~/lib/page-titles";
import { useLinkTarget } from "~/lib/useLinkTarget";
import { useOpenLink } from "~/lib/side-panel";

/** Linked references for a page, from GET /api/pages/backlinks. */
export async function fetchBacklinks(pageId: string): Promise<BacklinkGroup[]> {
  const res = await fetch(`/api/pages/backlinks?id=${encodeURIComponent(pageId)}`);
  if (!res.ok) throw new Error(`backlinks: ${res.status}`);
  return ((await res.json()) as { groups: BacklinkGroup[] }).groups;
}

type Load = { state: "loading" } | { state: "failed" } | { state: "ready"; groups: BacklinkGroup[] };

/**
 * Linked references below a page (PRD F4): the pages that link here, most
 * recently updated first, each with its linking lines as read-only
 * snapshots from the index. Fetched on open and again when the tab is
 * shown, never polled. Click a page or link to open it; Cmd/Ctrl+click opens
 * it in the side panel.
 */
export default function Backlinks({ pageId, load = fetchBacklinks }: { pageId: string; load?: (pageId: string) => Promise<BacklinkGroup[]> }) {
  const [result, setResult] = useState<Load>({ state: "loading" });

  const refresh = useCallback(() => {
    load(pageId).then(
      (groups) => setResult({ state: "ready", groups }),
      // Keep what we showed if a refresh fails; say so only if there's nothing
      () => setResult((prev) => (prev.state === "ready" ? prev : { state: "failed" })),
    );
  }, [pageId, load]);

  useEffect(() => {
    refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  const count = result.state === "ready" ? result.groups.reduce((n, g) => n + g.lines.length, 0) : null;

  return (
    <section aria-label="Linked references" className="mx-6 mb-10 mt-8 max-w-[65ch] border-t border-border pt-4">
      <h2 className="mb-3 text-sm uppercase tracking-wider text-muted">
        Linked references{count !== null ? ` · ${count}` : ""}
      </h2>
      {result.state === "failed" && <p className="text-sm text-muted">Couldn't load linked references. They'll load when you come back to this tab.</p>}
      {result.state === "ready" && result.groups.length === 0 && (
        <p className="text-sm text-muted">No pages link here yet. Type [[ on another page to link it.</p>
      )}
      {result.state === "ready" &&
        result.groups.map((group) => (
          <div key={group.pageId} className="mb-4">
            <PageLink pageId={group.pageId} href={linkHref(group.pageId, { title: group.title, kind: group.kind, slug: group.slug, empty: false, missing: false })} className="font-semibold text-ink hover:underline">
              {group.title}
            </PageLink>
            <ul className="mt-1 space-y-1 border-l border-border pl-3">
              {group.lines.map((line) => (
                <li key={line.line} className="text-ink">
                  <Line line={line} />
                </li>
              ))}
            </ul>
          </div>
        ))}
    </section>
  );
}

function PageLink({ pageId, href, className, children }: { pageId: string; href: string; className: string; children: React.ReactNode }) {
  const openLink = useOpenLink();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    openLink(href, { pageId, side: event.metaKey || event.ctrlKey });
  };
  return (
    <a href={href} onClick={onClick} className={className}>
      {children}
    </a>
  );
}

function Line({ line }: { line: BacklinkLine }) {
  return (
    <>
      {lineSegments(line).map((segment, i) =>
        segment.kind === "text" ? (
          <span key={i}>{segment.text}</span>
        ) : segment.kind === "bracket" ? (
          <span key={i} className="text-muted opacity-60">
            {segment.text}
          </span>
        ) : (
          <LinkedTitle key={i} pageId={segment.pageId} stored={segment.text} />
        ),
      )}
    </>
  );
}

/** A link inside a reference: its current title, opening the page. */
function LinkedTitle({ pageId, stored }: { pageId: string; stored: string }) {
  const target = useLinkTarget(pageId);
  const title = target && !target.missing ? target.title : stored;
  return (
    <PageLink
      pageId={pageId}
      href={linkHref(pageId, target)}
      className={`underline decoration-2 underline-offset-[3px] ${target?.missing ? "text-muted decoration-dashed decoration-muted" : "decoration-chartreuse"}`}
    >
      {title}
    </PageLink>
  );
}
