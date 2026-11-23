import { finishRound, isPomoTimer, isRunning, newTimer, type PomoTimer } from "./pomodoro";

/**
 * The state of each Pomodoro timer on screen (PRD F22), kept on this device
 * only (owner, 2026-11-23: no syncing between devices), in localStorage so
 * it survives a reload. A timer is named by its line's block ID and its
 * place in the line. While any timer on screen runs, one browser timer
 * ticks each second to update them and to end rounds; it stops when none
 * runs. A round that ends chimes; one that ended while the page was closed
 * moves on quietly. Browser only: nothing here runs at module load.
 */

const STORAGE_PREFIX = "mistlog:pomo:";
const TICK_MS = 1000;
/** A round that ended longer ago than this (the page was asleep) moves on without a chime. */
const CHIME_WITHIN_MS = 60_000;

export function timerKey(blockId: string, index: number): string {
  return `${blockId}:${index}`;
}

interface Entry {
  timer: PomoTimer;
  minutes: number;
  listeners: Set<() => void>;
}

const entries = new Map<string, Entry>();
let ticker: ReturnType<typeof setInterval> | null = null;
let audio: AudioContext | null = null;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function load(key: string, minutes: number): PomoTimer {
  try {
    const raw = storage()?.getItem(STORAGE_PREFIX + key);
    const value: unknown = raw ? JSON.parse(raw) : null;
    if (isPomoTimer(value)) return value;
  } catch {
    // Unreadable: start afresh
  }
  return newTimer(minutes);
}

function save(key: string, timer: PomoTimer | null): void {
  try {
    if (timer) storage()?.setItem(STORAGE_PREFIX + key, JSON.stringify(timer));
    else storage()?.removeItem(STORAGE_PREFIX + key);
  } catch {
    // Storage full or blocked: the timer still runs until the page closes
  }
}

function entry(key: string, minutes: number): Entry {
  let found = entries.get(key);
  if (!found) {
    found = { timer: load(key, minutes), minutes, listeners: new Set() };
    entries.set(key, found);
  }
  return found;
}

function sameTimer(a: PomoTimer, b: PomoTimer): boolean {
  return a.phase === b.phase && a.rounds === b.rounds && a.endsAt === b.endsAt && a.leftMs === b.leftMs;
}

function notify(found: Entry): void {
  for (const listener of found.listeners) listener();
}

/** A short two-note chime, made in the browser (no sound file). Quiet where audio isn't allowed. */
function chime(): void {
  if (!audio) return;
  try {
    const at = audio.currentTime;
    for (const [i, frequency] of [880, 660].entries()) {
      const tone = audio.createOscillator();
      const gain = audio.createGain();
      tone.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at + i * 0.25);
      gain.gain.exponentialRampToValueAtTime(0.3, at + i * 0.25 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + i * 0.25 + 0.6);
      tone.connect(gain).connect(audio.destination);
      tone.start(at + i * 0.25);
      tone.stop(at + i * 0.25 + 0.65);
    }
  } catch {
    // No sound, but the round still moves on
  }
}

/**
 * Let the chime play later. Browsers (iOS especially) only allow sound that
 * a press started, so this runs on the start button or shortcut.
 */
function allowSound(): void {
  try {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    audio ??= new Context();
    void audio.resume();
  } catch {
    audio = null;
  }
}

/** End the rounds that are over, chiming for those that just ended. */
export function tick(now = Date.now()): void {
  for (const [key, found] of entries) {
    const ended = found.timer.endsAt;
    const next = finishRound(found.timer, now, found.minutes);
    if (!next) continue;
    found.timer = next;
    save(key, next);
    if (ended !== null && now - ended < CHIME_WITHIN_MS) chime();
  }
  for (const found of entries.values()) notify(found);
  updateTicker();
}

function updateTicker(): void {
  const running = [...entries.values()].some((found) => found.listeners.size > 0 && isRunning(found.timer));
  if (running && !ticker) ticker = setInterval(() => tick(), TICK_MS);
  if (!running && ticker) {
    clearInterval(ticker);
    ticker = null;
  }
}

export const pomodoroStore = {
  get(key: string, minutes: number): PomoTimer {
    return entry(key, minutes).timer;
  },

  /** Follow a timer; returns the function that stops following it. */
  subscribe(key: string, minutes: number, listener: () => void): () => void {
    const found = entry(key, minutes);
    // The length was edited (`{{POMO 10}}` to 15): a round not yet begun takes the new length
    if (found.minutes !== minutes && sameTimer(found.timer, newTimer(found.minutes))) found.timer = newTimer(minutes);
    found.minutes = minutes;
    found.listeners.add(listener);
    // A round that ended while the page was closed moves on now
    tick();
    return () => {
      found.listeners.delete(listener);
      updateTicker();
    };
  },

  /** Change a timer (start, pause) from a press: also lets its chime play. */
  update(key: string, minutes: number, change: (timer: PomoTimer, now: number) => PomoTimer, now = Date.now()): void {
    allowSound();
    const found = entry(key, minutes);
    found.timer = change(found.timer, now);
    save(key, found.timer);
    notify(found);
    updateTicker();
  },

  /** Back to a full, stopped focus round, and forget it. */
  reset(key: string, minutes: number): void {
    const found = entry(key, minutes);
    found.timer = newTimer(minutes);
    save(key, null);
    notify(found);
    updateTicker();
  },
};

/** For tests: whether the once-a-second tick is running. */
export function pomodoroTicking(): boolean {
  return ticker !== null;
}

/** For tests: forget every timer and stop ticking. */
export function resetPomodoroStore(): void {
  entries.clear();
  if (ticker) clearInterval(ticker);
  ticker = null;
  audio = null;
}
