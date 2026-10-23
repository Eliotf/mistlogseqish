import { isValidDocumentId } from "~/shared/constants";

/**
 * Page identity. Every page and journal day is one DocumentAgent, named by
 * its page ID. Pages use Mist's random 8-character IDs; journals use a fixed
 * ID derived from the date, so any day can be found or linked without a
 * lookup. See PRD 6.1 and docs/technical-architecture.md.
 */

const JOURNAL_PREFIX = "journal-";
const JOURNAL_RE = /^journal-(\d{4})-(\d{2})-(\d{2})$/;

/** Journal ID for a calendar date given as YYYY-MM-DD, e.g. "journal-2026-10-22". */
export function journalId(date: string): string {
  if (parseJournalDate(JOURNAL_PREFIX + date) === null) {
    throw new Error(`Invalid journal date: ${date}`);
  }
  return JOURNAL_PREFIX + date;
}

/** The YYYY-MM-DD date of a journal ID, or null if it is not a real date. */
export function parseJournalDate(id: string): string | null {
  const m = JOURNAL_RE.exec(id);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Round-trip through UTC to reject dates like 2026-02-30
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) {
    return null;
  }
  return `${m[1]}-${m[2]}-${m[3]}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return n + (["th", "st", "nd", "rd"][n % 10] ?? "th");
}

/** A journal's title in Logseq's default format (MMM do, yyyy), e.g. "Oct 22nd, 2026". */
export function journalTitle(date: string): string {
  const parsed = parseJournalDate(JOURNAL_PREFIX + date);
  if (parsed === null) throw new Error(`Invalid journal date: ${date}`);
  const [y, m, d] = parsed.split("-").map(Number);
  return `${MONTHS[m - 1]} ${ordinal(d)}, ${y}`;
}

export function isJournalId(id: string): boolean {
  return parseJournalDate(id) !== null;
}

/** True for any ID a link may point at: a random page ID or a journal ID. */
export function isPageId(id: string): boolean {
  return isValidDocumentId(id) || isJournalId(id);
}
