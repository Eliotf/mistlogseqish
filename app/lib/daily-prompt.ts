import { parseJournalDate } from "./note-ids";

/**
 * The line each journal day starts with (owner, 2026-11-23): a question
 * with a 10 minute Pomodoro timer (F22). It is written into a day once, the
 * first time the day is opened, by DocumentAgent.addDailyPrompt, so two
 * devices opening the same day never write it twice, and a deleted one
 * stays deleted. Only days from today on get it; past days (and imported
 * ones) are left as they are. Shared by the browser and the server; keep it
 * free of editor and server code.
 */

export const DAILY_PROMPT_LINE = "- What are you thinking about {{POMO 10}}";

/** Whether a journal day should get the line: today or later, in the browser's time zone. */
export function wantsDailyPrompt(date: string, today: string): boolean {
  return parseJournalDate(`journal-${date}`) !== null && date >= today;
}

/**
 * The server can't know the browser's "today" (it runs on UTC), so it only
 * refuses days clearly in the past everywhere: before yesterday in UTC.
 */
export function isTooOldForPrompt(date: string, now: Date): boolean {
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  return date < yesterday;
}

export type DailyPromptResult = { ok: true; added: boolean } | { ok: false; code: "invalid" | "deleted" };

const ASKED_PREFIX = "mistlog:daily-prompt:";

interface AskOptions {
  fetch?: typeof fetch;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Ask the server to give this day its line, once per day from this browser
 * (the server decides whether it is already there). Offline or on a server
 * error it is asked again next time. Never throws.
 */
export async function askForDailyPrompt(date: string, { fetch: fetchFn = fetch, storage = safeStorage() }: AskOptions = {}): Promise<boolean> {
  try {
    if (storage?.getItem(ASKED_PREFIX + date)) return false;
    const res = await fetchFn("/api/journals/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date }),
    });
    if (!res.ok) return false;
    storage?.setItem(ASKED_PREFIX + date, "1");
    return true;
  } catch {
    return false;
  }
}
