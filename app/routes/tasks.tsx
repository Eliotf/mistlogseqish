import { useEffect } from "react";
import { useRevalidator } from "react-router";
import type { Route } from "./+types/tasks";
import { APP_DISPLAY_NAME } from "~/shared/constants";
import { workspaceIndex } from "~/lib/document-loader.server";
import { OPEN_STATES } from "~/lib/tasks";
import AppHeader from "~/components/AppHeader";
import TasksView from "~/components/TasksView";

/** How many done tasks the view shows, most recently changed pages first. */
export const DONE_LIMIT = 50;

/** /tasks: open tasks from every page and journal, and recent done ones, from the workspace index. */
export async function loader({ context }: Route.LoaderArgs) {
  try {
    const index = await workspaceIndex(context);
    const [open, done, status] = await Promise.all([index.tasks([...OPEN_STATES]), index.tasks(["DONE"]), index.indexStatus()]);
    const recent = [...done].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, DONE_LIMIT);
    return { open, done: recent, pending: status.pending, loadFailed: false };
  } catch (err) {
    console.error("Loading tasks failed", err);
    return { open: [], done: [], pending: 0, loadFailed: true };
  }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: `Tasks · ${APP_DISPLAY_NAME}` }];
}

export default function Tasks({ loaderData }: Route.ComponentProps) {
  // Fetched again when the tab is shown, never polled
  const { revalidate } = useRevalidator();
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void revalidate();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [revalidate]);

  return (
    <div className="flex h-screen flex-col">
      <AppHeader />
      <main className="flex-1 overflow-y-auto">
        <TasksView open={loaderData.open} done={loaderData.done} pending={loaderData.pending} loadFailed={loaderData.loadFailed} />
      </main>
    </div>
  );
}
