import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Link } from "react-router";
import type * as Y from "yjs";
import { journalTitle, localDate, parseJournalDate, weekdayOf } from "~/lib/note-ids";
import { linesFromYjs } from "~/lib/note-lines";
import { APP_DISPLAY_NAME } from "~/shared/constants";

interface JournalHeadingProps {
  doc: Y.Doc;
  pageId: string;
  /** Whether the journal was already created when the page loaded. */
  exists: boolean;
  /** In the feed: link the date to the day's own page. */
  href?: string;
  /** Whether the document has finished its first sync; the note waits for it so a written day never flashes it. */
  synced?: boolean;
  /** Set the browser tab title (on a day's own page, not in the feed). */
  setsTitle?: boolean;
  /** Heading level: 1 on a day's own page, 2 inside the feed. */
  level?: 1 | 2;
}

const noSubscription = () => () => {};

/**
 * A journal day's heading: its date title (not editable), the weekday or
 * "Today", and until someone writes in it, a note that it is not saved yet.
 * "Today" is decided in the browser, in the user's time zone; the server
 * renders the weekday, which is the same everywhere.
 */
export default function JournalHeading({ doc, pageId, exists, href, synced = true, setsTitle = true, level = 1 }: JournalHeadingProps) {
  const Heading = level === 1 ? "h1" : "h2";
  const date = parseJournalDate(pageId) ?? "";
  const title = date ? journalTitle(date) : "";

  const isToday = useSyncExternalStore(
    noSubscription,
    () => localDate(new Date()) === date,
    () => false,
  );

  const subscribe = useCallback(
    (onChange: () => void) => {
      doc.on("update", onChange);
      return () => doc.off("update", onChange);
    },
    [doc],
  );
  const written = useSyncExternalStore(
    subscribe,
    () => exists || linesFromYjs(doc.getXmlFragment("default")).some((line) => line.text.trim() !== ""),
    () => exists,
  );

  useEffect(() => {
    if (setsTitle) document.title = `${title} · ${APP_DISPLAY_NAME}`;
  }, [title, setsTitle]);

  return (
    <div className="px-6 pt-6">
      <div className="flex max-w-[65ch] flex-wrap items-baseline gap-x-3">
        <Heading className="text-[1.75rem] font-semibold leading-tight text-ink">
          {href ? (
            <Link to={href} className="hover:underline hover:decoration-chartreuse hover:decoration-2 hover:underline-offset-4">
              {title}
            </Link>
          ) : (
            title
          )}
        </Heading>
        <span className="font-mono text-sm text-muted">{isToday ? "Today" : weekdayOf(date)}</span>
      </div>
      {synced && !written && (
        <p className="mt-2 font-mono text-xs text-muted">
          Not saved yet. {isToday ? "Today's journal" : "This day's journal"} is created when you start typing.
        </p>
      )}
    </div>
  );
}
