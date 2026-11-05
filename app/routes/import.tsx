import type { Route } from "./+types/import";
import { APP_DISPLAY_NAME } from "~/shared/constants";
import AppHeader from "~/components/AppHeader";
import ImportView from "~/components/ImportView";

export function meta(_args: Route.MetaArgs) {
  return [{ title: `Import from Logseq · ${APP_DISPLAY_NAME}` }];
}

/** /import: import a Logseq graph (PRD F31). For now, the dry run. */
export default function Import() {
  return (
    <div className="flex h-screen flex-col">
      <AppHeader />
      <main className="flex-1 overflow-y-auto">
        <ImportView />
      </main>
    </div>
  );
}
