import type { Route } from "./+types/home";
import { APP_DISPLAY_NAME } from "~/shared/constants";
import { workspaceIndex } from "~/lib/document-loader.server";
import AppHeader from "~/components/AppHeader";
import { useEffect } from "react";
import JournalFeed, { FEED_PAGE_SIZE } from "~/components/JournalFeed";
import { isOfflineError, keepRecentDays, savedJournalDays } from "~/lib/offline";

/** The home page is the journal feed (PRD F1). Mist's landing page and demo are gone; /new still works for scripts. */
export async function loader({ context }: Route.LoaderArgs) {
  try {
    const index = await workspaceIndex(context);
    const pages = await index.journals(FEED_PAGE_SIZE);
    return { days: pages.map((p) => p.journalDate).filter((d): d is string => d !== null), loadFailed: false };
  } catch (err) {
    // Today's journal still works without the index
    console.error("Loading the journal feed failed", err);
    return { days: [] as string[], loadFailed: true };
  }
}

/** Offline (PRD F14): the days kept in this browser instead. */
export async function clientLoader({ serverLoader }: Route.ClientLoaderArgs) {
  try {
    return await serverLoader();
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    return { days: (await savedJournalDays()).slice(0, FEED_PAGE_SIZE), loadFailed: false };
  }
}

export function meta(_args: Route.MetaArgs) {
  return [{ title: `Journals · ${APP_DISPLAY_NAME}` }];
}

export default function Home({ loaderData }: Route.ComponentProps) {
  // Keep the recent days with notes in this browser, to read them offline
  useEffect(() => {
    keepRecentDays(loaderData.days).catch((err: unknown) => console.warn("Couldn't keep recent days for offline use", err));
  }, [loaderData.days]);
  return (
    <div className="flex h-dvh flex-col">
      <AppHeader />
      <main className="flex-1 overflow-y-auto">
        <JournalFeed initialDays={loaderData.days} loadFailed={loaderData.loadFailed} />
      </main>
    </div>
  );
}
