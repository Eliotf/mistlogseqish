import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { localDate } from "~/lib/note-ids";
import JournalDay from "~/components/JournalDay";

/** Days loaded per batch, on first load and on each "older days" load. */
export const FEED_PAGE_SIZE = 7;
/** Days at the top that connect straight away rather than when scrolled near. */
const EAGER_DAYS = 3;

const noSubscription = () => () => {};

interface JournalFeedProps {
  /** Days with notes, newest first, as loaded by the server (may include today or future days). */
  initialDays: string[];
  /** The server could not reach the index. */
  loadFailed: boolean;
  /** Fetch older days; injectable for tests. */
  fetchOlder?: (before: string | null) => Promise<string[]>;
}

export async function fetchOlderDays(before: string | null): Promise<string[]> {
  const params = new URLSearchParams({ limit: String(FEED_PAGE_SIZE) });
  if (before) params.set("before", before);
  const res = await fetch(`/api/journals?${params}`);
  if (!res.ok) throw new Error(`Loading days failed: ${res.status}`);
  return ((await res.json()) as { days: string[] }).days;
}

/**
 * The journal feed: today's journal on top, ready to type, then earlier days
 * with notes, newest first, loading more as you scroll (PRD F1). Every day
 * is a live editor. "Today" is decided in the browser's time zone, so the
 * server renders a placeholder in its place.
 */
export default function JournalFeed({ initialDays, loadFailed, fetchOlder = fetchOlderDays }: JournalFeedProps) {
  const today = useSyncExternalStore(noSubscription, () => localDate(new Date()), () => null);
  const [days, setDays] = useState(initialDays);
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">(
    loadFailed ? "error" : initialDays.length < FEED_PAGE_SIZE ? "done" : "idle",
  );
  const sentinel = useRef<HTMLDivElement>(null);

  const loadOlder = useCallback(async () => {
    if (status === "loading" || status === "done") return;
    setStatus("loading");
    try {
      const oldest = days.at(-1) ?? null;
      const more = await fetchOlder(oldest);
      setDays((current) => [...current, ...more.filter((d) => !current.includes(d))]);
      setStatus(more.length < FEED_PAGE_SIZE ? "done" : "idle");
    } catch {
      setStatus("error");
    }
  }, [days, status, fetchOlder]);

  // Load the next batch when the bottom of the feed comes near the screen
  useEffect(() => {
    const el = sentinel.current;
    if (!el || status !== "idle") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadOlder();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [status, loadOlder]);

  // Today is always first; the list shows only earlier days
  const earlier = today ? days.filter((d) => d < today) : days;

  return (
    <div className="pb-[33vh]">
      <h1 className="sr-only">Journals</h1>
      {today ? (
        <JournalDay key={today} date={today} exists={days.includes(today)} eager />
      ) : (
        <div className="min-h-40 border-b border-border" aria-hidden="true" />
      )}
      {earlier.map((date, i) => (
        <JournalDay key={date} date={date} exists eager={i < EAGER_DAYS - 1} />
      ))}
      <div ref={sentinel} className="px-6 py-8 font-mono text-sm text-muted">
        {status === "done" && <p>No earlier days.</p>}
        {status === "loading" && <p role="status">Loading earlier days…</p>}
        {status === "error" && (
          <p role="alert">
            Couldn't load earlier days.{" "}
            <button type="button" onClick={() => void loadOlder()} className="underline hover:text-ink">
              Try again
            </button>
          </p>
        )}
        {status === "idle" && (
          <button type="button" onClick={() => void loadOlder()} className="underline hover:text-ink">
            Show older days
          </button>
        )}
      </div>
    </div>
  );
}
