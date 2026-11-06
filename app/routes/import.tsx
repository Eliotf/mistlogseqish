import type { Route } from "./+types/import";
import { APP_DISPLAY_NAME } from "~/shared/constants";
import { workspaceIndex } from "~/lib/document-loader.server";
import AppHeader from "~/components/AppHeader";
import ImportView from "~/components/ImportView";

/** The import not yet undone, if any. If the index can't be reached, the page says so and the server still refuses a second import. */
export async function loader({ context }: Route.LoaderArgs) {
  try {
    const index = await workspaceIndex(context);
    return { current: await index.currentImport(), loadFailed: false };
  } catch (err) {
    console.error("Loading the current import failed", err);
    return { current: null, loadFailed: true };
  }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: `Import from Logseq · ${APP_DISPLAY_NAME}` }];
}

/** /import: import a Logseq graph, and undo it (PRD F31). */
export default function Import({ loaderData }: Route.ComponentProps) {
  return (
    <div className="flex h-screen flex-col">
      <AppHeader />
      <main className="flex-1 overflow-y-auto">
        {loaderData.loadFailed && (
          <p role="alert" className="mx-6 mt-4 text-sm text-coral">
            Couldn't check for an earlier import. Try again in a moment.
          </p>
        )}
        <ImportView current={loaderData.current} />
      </main>
    </div>
  );
}
