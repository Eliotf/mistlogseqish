import type { Route } from "./+types/import";
import { APP_DISPLAY_NAME } from "~/shared/constants";
import { workspaceIndex } from "~/lib/document-loader.server";
import AppHeader from "~/components/AppHeader";
import ImportView from "~/components/ImportView";

/** The imports not yet undone. If the index can't be reached, the page says so and the server still checks every step. */
export async function loader({ context }: Route.LoaderArgs) {
  try {
    const index = await workspaceIndex(context);
    return { imports: await index.listImports(), loadFailed: false };
  } catch (err) {
    console.error("Loading the imports failed", err);
    return { imports: [], loadFailed: true };
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
            Couldn't load your earlier imports. Try again in a moment.
          </p>
        )}
        <ImportView imports={loaderData.imports} />
      </main>
    </div>
  );
}
