import { describe, it, expect } from "vitest";
import { journalId, journalTitle, parseJournalDate, isJournalId, isJournalTitle, isPageId } from "~/lib/note-ids";
import { generateDocumentId } from "~/shared/constants";

describe("journalId", () => {
  it("builds an ID from a date", () => {
    expect(journalId("2026-10-22")).toBe("journal-2026-10-22");
  });

  it.each(["2026-2-3", "2026-02-30", "26-10-22", "", "2026-13-01"])("rejects %j", (date) => {
    expect(() => journalId(date)).toThrow("Invalid journal date");
  });
});

describe("parseJournalDate", () => {
  it("returns the date of a journal ID", () => {
    expect(parseJournalDate("journal-2026-10-22")).toBe("2026-10-22");
  });

  it("accepts a leap day in a leap year", () => {
    expect(parseJournalDate("journal-2028-02-29")).toBe("2028-02-29");
  });

  it.each([
    "journal-2026-02-29",
    "journal-2026-04-31",
    "journal-2026-00-10",
    "journal-2026-10-22-extra",
    "Journal-2026-10-22",
    "2026-10-22",
    "abcd1234",
  ])("returns null for %j", (id) => {
    expect(parseJournalDate(id)).toBeNull();
  });
});

describe("journalTitle", () => {
  it.each([
    ["2026-10-22", "Oct 22nd, 2026"],
    ["2026-11-01", "Nov 1st, 2026"],
    ["2026-11-03", "Nov 3rd, 2026"],
    ["2026-01-11", "Jan 11th, 2026"],
    ["2026-01-12", "Jan 12th, 2026"],
    ["2026-01-13", "Jan 13th, 2026"],
    ["2026-12-21", "Dec 21st, 2026"],
    ["2026-05-24", "May 24th, 2026"],
    ["2026-03-30", "Mar 30th, 2026"],
  ])("formats %s as %s", (date, title) => {
    expect(journalTitle(date)).toBe(title);
  });

  it("rejects an invalid date", () => {
    expect(() => journalTitle("2026-02-30")).toThrow("Invalid journal date");
  });
});

describe("isJournalTitle", () => {
  it.each(["Oct 26th, 2026", "oct 26th, 2026", "OCT 26TH, 2026", "  Jan 1st, 2030 ", "Feb 29th, 2028", "Oct 26st, 2026"])(
    "recognises %j",
    (title) => {
      expect(isJournalTitle(title)).toBe(true);
    },
  );

  it.each(["Oct 26, 2026", "October 26th, 2026", "Feb 29th, 2026", "Oct 32nd, 2026", "Foo 1st, 2026", "Oct 26th 2026", "Meeting notes"])(
    "does not treat %j as a journal title",
    (title) => {
      expect(isJournalTitle(title)).toBe(false);
    },
  );

  it("matches every title journalTitle produces", () => {
    for (const date of ["2026-01-01", "2026-02-02", "2026-03-03", "2026-04-11", "2026-12-31"]) {
      expect(isJournalTitle(journalTitle(date))).toBe(true);
    }
  });
});

describe("isJournalId and isPageId", () => {
  it("accepts journal IDs", () => {
    expect(isJournalId("journal-2026-10-22")).toBe(true);
    expect(isPageId("journal-2026-10-22")).toBe(true);
  });

  it("accepts Mist's random document IDs as page IDs", () => {
    const id = generateDocumentId();
    expect(isJournalId(id)).toBe(false);
    expect(isPageId(id)).toBe(true);
  });

  it.each(["", "ABCD1234", "abc", "abcd12345", "page title", "journal-2026-02-30"])("rejects %j", (id) => {
    expect(isPageId(id)).toBe(false);
  });
});
