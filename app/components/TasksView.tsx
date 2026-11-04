import type { MouseEvent } from "react";
import { journalTitle, parseJournalDate } from "~/lib/note-ids";
import { UNTITLED } from "~/lib/page-title";
import { pagePath } from "~/lib/slug";
import { useOpenLink } from "~/lib/side-panel";
import { zoomHref } from "~/lib/zoom";
import { useModKeyLabel } from "~/lib/mod-key";
import { OPEN_STATES, type TaskItem } from "~/lib/tasks";
import ReferenceLine, { PageLink } from "~/components/ReferenceLine";

interface TasksViewProps {
  open: TaskItem[];
  done: TaskItem[];
  /** Pages the index is still catching up on (a rebuild); until then tasks may be missing. */
  pending?: number;
  loadFailed: boolean;
}

function pageName(task: TaskItem): string {
  const date = parseJournalDate(task.pageId);
  return date ? journalTitle(date) : task.pageTitle || UNTITLED;
}

/**
 * The Tasks view (PRD F6): one read-only list across all pages, NOW, DOING,
 * TODO then LATER (higher priority first in each), and recently done tasks.
 * Each task is shown like a linked reference, labelled with its page; it
 * opens its page zoomed into its line, where it is changed (Cmd/Ctrl+click
 * opens the page in the side panel). Tasks from pages not re-indexed since
 * block IDs open the whole page.
 */
export default function TasksView({ open, done, pending = 0, loadFailed }: TasksViewProps) {
  const MOD = useModKeyLabel();
  return (
    <div className="mx-6 mb-10 mt-8 max-w-[65ch]">
      <h1 className="text-[1.75rem] font-semibold leading-tight text-ink">Tasks</h1>
      <p className="mt-2 text-sm text-muted">Open a task to change it on its page. {MOD}+Enter cycles it.</p>
      {pending > 0 && (
        <p role="status" className="mt-4 text-sm text-muted">
          Updating the index: {pending} {pending === 1 ? "page" : "pages"} to go. Some tasks may be missing until it finishes.
        </p>
      )}
      {loadFailed && (
        <p role="alert" className="mt-4 text-sm text-muted">
          Couldn't load tasks. Try again in a moment.
        </p>
      )}
      {!loadFailed && open.length === 0 && <p className="mt-4 text-sm text-muted">No open tasks. Press {MOD}+Enter on any line to make one.</p>}
      {OPEN_STATES.map((state) => {
        const tasks = open.filter((t) => t.state === state);
        if (!tasks.length) return null;
        return (
          <section key={state} aria-label={`${state} tasks`} className="mt-6">
            <h2 className="mb-2 text-sm uppercase tracking-wider text-muted">
              {state} · {tasks.length}
            </h2>
            <ul className="space-y-1">
              {tasks.map((task) => (
                <TaskRow key={`${task.pageId}:${task.line.line}`} task={task} />
              ))}
            </ul>
          </section>
        );
      })}
      {done.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-sm uppercase tracking-wider text-muted">Done · {done.length}</summary>
          <ul className="mt-2 space-y-1">
            {done.map((task) => (
              <TaskRow key={`${task.pageId}:${task.line.line}`} task={task} done />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function TaskRow({ task, done = false }: { task: TaskItem; done?: boolean }) {
  const openLink = useOpenLink();
  const page = pagePath(task.pageId, null);
  const href = zoomHref(page, task.blockId);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    openLink(href, { pageId: task.pageId, side: event.metaKey || event.ctrlKey });
  };
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 border-l-2 border-border pl-3 hover:border-chartreuse">
      <a href={href} onClick={onClick} title={`Open ${pageName(task)} at this task`} className={`text-ink ${done ? "text-muted line-through" : ""}`}>
        <ReferenceLine line={task.line} plainLinks />
      </a>
      <PageLink pageId={task.pageId} href={page} className="text-xs text-muted hover:underline">
        {pageName(task)}
      </PageLink>
    </li>
  );
}
