import { useEffect, useRef, useState } from "react";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider } from "~/lib/DocumentContext";
import { journalId, journalTitle, weekdayOf } from "~/lib/note-ids";
import JournalHeading from "~/components/JournalHeading";
import ConnectedEditor from "~/components/ConnectedEditor";
import DayBar from "~/components/DayBar";

/** How far ahead of the screen a day connects, so it is live before you reach it. */
export const CONNECT_MARGIN = "1200px 0px";

interface JournalDayProps {
  date: string;
  /** Whether this day already has notes. */
  exists: boolean;
  /** Connect straight away (the top of the feed) instead of when scrolled near. */
  eager: boolean;
}

/**
 * One day in the journal feed: a live editor for that day's journal.
 * It connects when it comes near the screen and then stays connected,
 * so scrolling back is instant. Until then it shows a light placeholder.
 */
export default function JournalDay({ date, exists, eager }: JournalDayProps) {
  const ref = useRef<HTMLElement>(null);
  const [live, setLive] = useState(eager);

  useEffect(() => {
    const el = ref.current;
    if (live || !el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setLive(true);
      },
      { rootMargin: CONNECT_MARGIN },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [live]);

  return (
    <article ref={ref} aria-label={journalTitle(date)} className="min-h-40 border-b border-border pb-6 last:border-b-0">
      {live ? <LiveDay date={date} exists={exists} /> : <DayPlaceholder date={date} />}
    </article>
  );
}

function LiveDay({ date, exists }: { date: string; exists: boolean }) {
  const id = journalId(date);
  const yjs = useYjsEditor(id);
  const path = `/journal/${date}`;
  return (
    <DocumentProvider docId={id} createdAt={null} yjs={yjs}>
      <JournalHeading doc={yjs.doc} pageId={id} exists={exists} href={path} synced={yjs.synced} setsTitle={false} level={2} />
      <DayBar path={path} />
      <ConnectedEditor />
    </DocumentProvider>
  );
}

function DayPlaceholder({ date }: { date: string }) {
  return (
    <div className="px-6 pt-6" aria-busy="true">
      <div className="flex max-w-[65ch] flex-wrap items-baseline gap-x-3">
        <h2 className="text-[1.75rem] font-semibold leading-tight text-ink">{journalTitle(date)}</h2>
        <span className="font-mono text-sm text-muted">{weekdayOf(date)}</span>
      </div>
      <div className="mt-6 space-y-3" aria-hidden="true">
        <div className="h-4 w-2/3 bg-border" />
        <div className="h-4 w-1/2 bg-border" />
      </div>
    </div>
  );
}
