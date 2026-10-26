import { useCallback, useEffect, useSyncExternalStore } from "react";
import type * as Y from "yjs";
import { journalTitle, localDate, parseJournalDate, weekdayOf } from "~/lib/note-ids";
import { linesFromYjs } from "~/lib/note-lines";
import { APP_DISPLAY_NAME } from "~/shared/constants";

interface JournalHeadingProps {
  doc: Y.Doc;
  pageId: string;
  /** Whether the journal was already created when the page loaded. */
  exists: boolean;
}

const noSubscription = () => () => {};

/**
 * A journal day's heading: its date title (not editable), the weekday or
 * "Today", and until someone writes in it, a note that it is not saved yet.
 * "Today" is decided in the browser, in the user's time zone; the server
 * renders the weekday, which is the same everywhere.
 */
export default function JournalHeading({ doc, pageId, exists }: JournalHeadingProps) {
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
    document.title = `${title} · ${APP_DISPLAY_NAME}`;
  }, [title]);

  return (
    <div className="px-6 pt-6">
      <div className="flex max-w-[65ch] flex-wrap items-baseline gap-x-3">
        <h1 className="text-[1.75rem] font-semibold leading-tight text-ink">{title}</h1>
        <span className="font-mono text-sm text-muted">{isToday ? "Today" : weekdayOf(date)}</span>
      </div>
      {!written && (
        <p className="mt-2 font-mono text-xs text-muted">
          Not saved yet. {isToday ? "Today's journal" : "This day's journal"} is created when you start typing.
        </p>
      )}
    </div>
  );
}
