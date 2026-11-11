import { parseJournalDate } from "./note-ids";

/**
 * Fuzzy dates (PRD 6.2, F20): a phrase such as "tomorrow", "next fri",
 * "in 2 weeks" or "oct 31" names a day, worked out from today (YYYY-MM-DD
 * in the browser's time zone; see localDate). All arithmetic is on calendar
 * dates, so daylight-saving changes never move a day.
 *
 * - Weeks run Monday to Sunday (owner's choice, 2026-11-11). "this friday"
 *   is the Friday of the current week, even if it has passed; "next friday"
 *   is the following week's and "last friday" the previous week's. "friday"
 *   alone is the coming Friday (never today).
 * - "in N months" keeps the day of the month, or the month's last day if it
 *   is shorter (Jan 31 + 1 month is Feb 28th).
 * - "oct 31" or "31 oct" is this year's, or next year's once it has passed.
 */

// In week order: weeks start on Monday
const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

/** Phrases longer than this are never dates (the `@` list closes). */
export const MAX_DATE_PHRASE = 24;

/** Suggestions offered at most. */
export const MAX_DATE_SUGGESTIONS = 6;

type Ymd = { y: number; m: number; d: number };

function parse(date: string): Ymd {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d };
}

/** YYYY-MM-DD for a year, month (1-12, may overflow) and day (may overflow), normalised through UTC. */
function format(y: number, m: number, d: number): string {
  const at = new Date(Date.UTC(y, m - 1, d));
  return `${String(at.getUTCFullYear()).padStart(4, "0")}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-${String(at.getUTCDate()).padStart(2, "0")}`;
}

function addDays(date: string, n: number): string {
  const { y, m, d } = parse(date);
  return format(y, m, d + n);
}

function addMonths(date: string, n: number): string {
  const { y, m, d } = parse(date);
  const lastDay = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return format(y, m + n, Math.min(d, lastDay));
}

/** Day of the week, Monday 0 to Sunday 6. */
function weekday(date: string): number {
  const { y, m, d } = parse(date);
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/** A month from its name or a prefix of at least three letters ("oct", "octob"). */
function monthIndex(name: string): number {
  return name.length >= 3 ? MONTHS.findIndex((month) => month.startsWith(name)) : -1;
}

function dayIndex(name: string): number {
  return name.length >= 3 ? DAYS.findIndex((day) => day.startsWith(name)) : -1;
}

/** A phrase as compared: lower case, single spaces, trimmed. */
function normalise(phrase: string): string {
  return phrase.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The YYYY-MM-DD date a phrase names, counted from `today`, or null if it names none. */
export function resolvePhrase(phrase: string, today: string): string | null {
  const p = normalise(phrase);
  if (!p || p.length > MAX_DATE_PHRASE || parseJournalDate(`journal-${today}`) === null) return null;
  if (p === "today") return today;
  if (p === "tomorrow") return addDays(today, 1);
  if (p === "yesterday") return addDays(today, -1);
  let m = /^in (\d{1,3}) (day|days|week|weeks|month|months)$/.exec(p);
  if (m) {
    const n = Number(m[1]);
    if (m[2].startsWith("day")) return addDays(today, n);
    if (m[2].startsWith("week")) return addDays(today, 7 * n);
    return addMonths(today, n);
  }
  m = /^(?:(next|last|this) )?([a-z]+)$/.exec(p);
  if (m && dayIndex(m[2]) >= 0) {
    const target = dayIndex(m[2]);
    const current = weekday(today);
    // Without a word: the coming one. With one: that day in this, the next or the last calendar week
    if (!m[1]) return addDays(today, (target - current + 7) % 7 || 7);
    const thisWeek = addDays(today, target - current);
    return m[1] === "this" ? thisWeek : addDays(thisWeek, m[1] === "next" ? 7 : -7);
  }
  let month = -1;
  let day = 0;
  if ((m = /^([a-z]+) (\d{1,2})(?:st|nd|rd|th)?$/.exec(p))) {
    month = monthIndex(m[1]);
    day = Number(m[2]);
  } else if ((m = /^(\d{1,2})(?:st|nd|rd|th)? ([a-z]+)$/.exec(p))) {
    month = monthIndex(m[2]);
    day = Number(m[1]);
  }
  if (month < 0 || day < 1 || day > 31) return null;
  const { y } = parse(today);
  // Feb 29th only in a leap year: a date that doesn't exist this year is tried next year, then given up
  for (const year of [y, y + 1, y + 2, y + 3, y + 4]) {
    const date = format(year, month + 1, day);
    if (parse(date).m !== month + 1) continue;
    if (date >= today || year > y) return date;
  }
  return null;
}

export interface DateSuggestion {
  /** The phrase as offered ("next friday"). */
  phrase: string;
  /** The day it names, YYYY-MM-DD. */
  date: string;
}

/**
 * Dates to offer for what has been typed (`@next f`, or inside `[[...]]`):
 * the phrase itself if it names a day, then phrases it begins, at most
 * MAX_DATE_SUGGESTIONS, one per day ("fri" and "next friday" are the same
 * day: the first is kept). With nothing typed, a few common ones.
 */
export function dateSuggestions(query: string, today: string): DateSuggestion[] {
  const q = normalise(query);
  if (q.length > MAX_DATE_PHRASE) return [];
  const candidates = q ? phrasesFor(q).filter((phrase) => phrase.startsWith(q)) : ["today", "tomorrow", "yesterday", "next monday", "in 1 week"];
  const out: DateSuggestion[] = [];
  const seen = new Set<string>();
  for (const phrase of [q, ...candidates]) {
    if (!phrase || out.length >= MAX_DATE_SUGGESTIONS) continue;
    const date = resolvePhrase(phrase, today);
    if (!date || seen.has(date)) continue;
    seen.add(date);
    out.push({ phrase, date });
  }
  return out;
}

/** Every phrase worth offering for a query: fixed words, weekdays, "in N ..." and "month day". */
function phrasesFor(q: string): string[] {
  const phrases = ["today", "tomorrow", "yesterday"];
  for (const day of DAYS) phrases.push(`next ${day}`, `last ${day}`, day);
  const number = /\d+/.exec(q)?.[0];
  for (const n of number ? [number] : ["1", "2", "3"]) {
    for (const unit of ["day", "week", "month"]) phrases.push(`in ${n} ${unit}${n === "1" ? "" : "s"}`);
  }
  const md = /^([a-z]{3,9}) ?(\d{0,2})$/.exec(q);
  if (md && monthIndex(md[1]) >= 0 && md[2]) phrases.push(`${MONTHS[monthIndex(md[1])].slice(0, 3)} ${md[2]}`);
  return phrases;
}
