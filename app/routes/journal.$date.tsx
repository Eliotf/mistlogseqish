import { data } from "react-router";
import type { Route } from "./+types/journal.$date";
import { loadJournal } from "~/lib/document-loader.server";
import { journalId, parseJournalDate } from "~/lib/note-ids";
import { pagePath } from "~/lib/slug";
import { isOfflineError, savedJournalDays } from "~/lib/offline";

/**
 * /journal/YYYY-MM-DD: one day's journal. Any real date can be opened; the
 * journal is only created (saved, indexed) when someone first writes in it.
 * The page itself is the same screen as /docs/<id>.
 */
export async function loader({ params, context }: Route.LoaderArgs) {
  if (parseJournalDate(`journal-${params.date}`) === null) {
    throw data(null, { status: 404 });
  }
  const id = journalId(params.date);
  const doc = await loadJournal(context, id);
  return { ...doc, path: pagePath(id, null) };
}

/** Offline (PRD F14): the day from its copy in this browser, if there is one. */
export async function clientLoader({ params, serverLoader }: Route.ClientLoaderArgs) {
  try {
    return await serverLoader();
  } catch (err) {
    if (!isOfflineError(err) || parseJournalDate(`journal-${params.date}`) === null) throw err;
    const id = journalId(params.date);
    const saved = (await savedJournalDays()).includes(params.date);
    return { id, createdAt: null, exists: saved, path: pagePath(id, null) };
  }
}

export { default, meta } from "./docs.$id";
