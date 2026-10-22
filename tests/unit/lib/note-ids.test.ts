import { describe, it, expect } from "vitest";
import { journalId, parseJournalDate, isJournalId, isPageId } from "~/lib/note-ids";
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
