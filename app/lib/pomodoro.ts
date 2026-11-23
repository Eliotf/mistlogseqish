/**
 * Pomodoro timers written in page text (PRD F22, 6.4): `{{POMO}}` for a
 * 25 minute focus round, `{{POMO 10}}` for 10 minutes (Roam's `{{[[POMO]]}}`
 * and `{{POMO: 10}}` work too). The text stays as written, so export is
 * unchanged; pomodoro-editing.ts shows the timer.
 *
 * A timer runs focus, break, focus, ...: breaks are 5 minutes, and 15 after
 * every fourth focus round. It keeps the time a round ends, never a count,
 * so it survives a reload or a tab put to sleep. Pure: the caller passes
 * the time.
 */

export interface PomoRef {
  /** Offsets of the whole `{{POMO ...}}` in the line's text. */
  from: number;
  to: number;
  /** Focus round length. */
  minutes: number;
}

export const DEFAULT_FOCUS_MINUTES = 25;
export const SHORT_BREAK_MINUTES = 5;
export const LONG_BREAK_MINUTES = 15;
/** A long break follows every this many focus rounds. */
export const ROUNDS_BEFORE_LONG_BREAK = 4;
const MAX_MINUTES = 180;

const POMO_REGEX = /\{\{\s*(?:\[\[)?POMO(?:\]\])?(?:\s*:?\s*(\d{1,3}))?\s*\}\}/gi;

/** Every timer written in `text`, in order. */
export function findPomos(text: string): PomoRef[] {
  const found: PomoRef[] = [];
  POMO_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = POMO_REGEX.exec(text)) !== null) {
    const minutes = match[1] ? Number(match[1]) : DEFAULT_FOCUS_MINUTES;
    found.push({ from: match.index, to: match.index + match[0].length, minutes: Math.min(MAX_MINUTES, Math.max(1, minutes)) });
  }
  return found;
}

export interface PomoTimer {
  phase: "focus" | "break";
  /** Focus rounds finished. */
  rounds: number;
  /** When the current round ends, while running; null while stopped or paused. */
  endsAt: number | null;
  /** Time left in the round while stopped or paused. */
  leftMs: number;
}

const MINUTE = 60_000;

function breakMs(rounds: number): number {
  return (rounds % ROUNDS_BEFORE_LONG_BREAK === 0 ? LONG_BREAK_MINUTES : SHORT_BREAK_MINUTES) * MINUTE;
}

/** A timer that hasn't started: a full focus round. */
export function newTimer(minutes: number): PomoTimer {
  return { phase: "focus", rounds: 0, endsAt: null, leftMs: minutes * MINUTE };
}

export function isRunning(timer: PomoTimer): boolean {
  return timer.endsAt !== null;
}

/** Time left in the current round, never below zero. */
export function timeLeft(timer: PomoTimer, now: number): number {
  return timer.endsAt === null ? timer.leftMs : Math.max(0, timer.endsAt - now);
}

/** Start, or carry on after a pause. */
export function start(timer: PomoTimer, now: number): PomoTimer {
  return isRunning(timer) ? timer : { ...timer, endsAt: now + timer.leftMs };
}

export function pause(timer: PomoTimer, now: number): PomoTimer {
  return isRunning(timer) ? { ...timer, endsAt: null, leftMs: timeLeft(timer, now) } : timer;
}

export function toggle(timer: PomoTimer, now: number): PomoTimer {
  return isRunning(timer) ? pause(timer, now) : start(timer, now);
}

/**
 * If the running round has ended, the next one, stopped and ready to start
 * (focus ends into a break, a break into focus); otherwise null. A round
 * that ended while the page was closed moves on the same way.
 */
export function finishRound(timer: PomoTimer, now: number, minutes: number): PomoTimer | null {
  if (timer.endsAt === null || timer.endsAt > now) return null;
  if (timer.phase === "focus") {
    const rounds = timer.rounds + 1;
    return { phase: "break", rounds, endsAt: null, leftMs: breakMs(rounds) };
  }
  return { phase: "focus", rounds: timer.rounds, endsAt: null, leftMs: minutes * MINUTE };
}

/** `mm:ss`, rounded up so a round shows 0:00 only when it has ended. */
export function formatTimeLeft(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Whether a stored value is a timer (it comes from this browser's storage, which may hold anything). */
export function isPomoTimer(value: unknown): value is PomoTimer {
  if (!value || typeof value !== "object") return false;
  const t = value as Record<string, unknown>;
  return (
    (t.phase === "focus" || t.phase === "break") &&
    typeof t.rounds === "number" &&
    Number.isFinite(t.rounds) &&
    (t.endsAt === null || (typeof t.endsAt === "number" && Number.isFinite(t.endsAt))) &&
    typeof t.leftMs === "number" &&
    Number.isFinite(t.leftMs) &&
    t.leftMs >= 0
  );
}
