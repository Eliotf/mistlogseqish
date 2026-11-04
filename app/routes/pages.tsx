import type { Route } from "./+types/pages";
import { APP_DISPLAY_NAME } from "~/shared/constants";
import { workspaceIndex } from "~/lib/document-loader.server";
import AppHeader from "~/components/AppHeader";
import AllPagesView from "~/components/AllPagesView";

/** /pages: every page (and, on request, journal day) in the workspace index (PRD F21). */
export async function loader({ context }: Route.LoaderArgs) {
  try {
    const index = await workspaceIndex(context);
    return { pages: await index.allPages(), loadFailed: false };
  } catch (err) {
    console.error("Loading all pages failed", err);
    return { pages: [], loadFailed: true };
  }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: `All pages · ${APP_DISPLAY_NAME}` }];
}

export default function AllPages({ loaderData }: Route.ComponentProps) {
  return (
    <div className="flex h-screen flex-col">
      <AppHeader />
      <main className="flex-1 overflow-y-auto">
        <AllPagesView pages={loaderData.pages} loadFailed={loaderData.loadFailed} />
      </main>
    </div>
  );
}
