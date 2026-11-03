import type { MouseEvent, ReactNode } from "react";
import { lineSegments, type BacklinkLine } from "~/lib/backlink-lines";
import { parseLine } from "~/lib/note-parser";
import { linkHref } from "~/lib/page-titles";
import { useLinkTarget } from "~/lib/useLinkTarget";
import { useOpenLink } from "~/lib/side-panel";

/**
 * A stored line shown read-only, as in linked references (PRD F4) and the
 * Tasks view (F6): no indent or bullet, links with their pages' current
 * titles, faint `[[` `]]`, and a task keyword styled as in the editor.
 * With `plainLinks`, links are styled text rather than links of their own,
 * for a line that is itself one link.
 */
export default function ReferenceLine({ line, plainLinks = false }: { line: BacklinkLine; plainLinks?: boolean }) {
  const task = parseLine(line.text).task;
  return (
    <>
      {lineSegments(line).map((segment, i) =>
        segment.kind === "text" ? (
          i === 0 && task && segment.text.startsWith(task) ? (
            <span key={i}>
              <span className={`task-kw task-${task.toLowerCase()}`}>{task}</span>
              {segment.text.slice(task.length)}
            </span>
          ) : (
            <span key={i}>{segment.text}</span>
          )
        ) : segment.kind === "bracket" ? (
          <span key={i} className="text-muted opacity-60">
            {segment.text}
          </span>
        ) : (
          <LinkedTitle key={i} pageId={segment.pageId} stored={segment.text} plain={plainLinks} />
        ),
      )}
    </>
  );
}

/** A link to a page: opens it, or with Cmd/Ctrl+click opens it in the side panel. */
export function PageLink({ pageId, href, className, children }: { pageId: string; href: string; className: string; children: ReactNode }) {
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

/** A link inside a stored line: its current title. */
function LinkedTitle({ pageId, stored, plain }: { pageId: string; stored: string; plain: boolean }) {
  const target = useLinkTarget(pageId);
  const title = target && !target.missing ? target.title : stored;
  const className = `underline decoration-2 underline-offset-[3px] ${target?.missing ? "text-muted decoration-dashed decoration-muted" : "decoration-chartreuse"}`;
  if (plain) return <span className={className}>{title}</span>;
  return (
    <PageLink pageId={pageId} href={linkHref(pageId, target)} className={className}>
      {title}
    </PageLink>
  );
}
