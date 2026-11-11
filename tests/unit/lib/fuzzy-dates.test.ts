import { describe, it, expect } from "vitest";
import { dateSuggestions, resolvePhrase, MAX_DATE_SUGGESTIONS } from "~/lib/fuzzy-dates";
import { journalTitle } from "~/lib/note-ids";

// A Tuesday
const TODAY = "2026-10-20";

describe("resolvePhrase", () => {
  it("knows today, tomorrow and yesterday, in any case and spacing", () => {
    expect(resolvePhrase("today", TODAY)).toBe("2026-10-20");
    expect(resolvePhrase("  Tomorrow ", TODAY)).toBe("2026-10-21");
    expect(resolvePhrase("YESTERDAY", TODAY)).toBe("2026-10-19");
  });

  it("counts days, weeks and months ahead (the PRD's example: in 2 weeks from Oct 20th is Nov 3rd)", () => {
    expect(journalTitle(resolvePhrase("in 2 weeks", TODAY)!)).toBe("Nov 3rd, 2026");
    expect(resolvePhrase("in 3 days", TODAY)).toBe("2026-10-23");
    expect(resolvePhrase("in 1 day", TODAY)).toBe("2026-10-21");
    expect(resolvePhrase("in  1   week", TODAY)).toBe("2026-10-27");
    expect(resolvePhrase("in 2 months", TODAY)).toBe("2026-12-20");
    expect(resolvePhrase("in 0 days", TODAY)).toBe(TODAY);
    expect(resolvePhrase("in 1000 days", TODAY)).toBeNull();
  });

  it("keeps a month's last day when the next month is shorter", () => {
    expect(resolvePhrase("in 1 month", "2026-01-31")).toBe("2026-02-28");
    expect(resolvePhrase("in 1 month", "2028-01-31")).toBe("2028-02-29");
    expect(resolvePhrase("in 3 months", "2026-11-30")).toBe("2027-02-28");
  });

  it("crosses month and year boundaries", () => {
    expect(resolvePhrase("tomorrow", "2026-12-31")).toBe("2027-01-01");
    expect(resolvePhrase("yesterday", "2027-01-01")).toBe("2026-12-31");
    expect(resolvePhrase("tomorrow", "2028-02-28")).toBe("2028-02-29");
    expect(resolvePhrase("in 1 week", "2026-12-28")).toBe("2027-01-04");
  });

  it("is not moved by daylight-saving changes (they happen on these days in the US and Europe)", () => {
    expect(resolvePhrase("tomorrow", "2026-03-07")).toBe("2026-03-08");
    expect(resolvePhrase("tomorrow", "2026-03-08")).toBe("2026-03-09");
    expect(resolvePhrase("in 1 week", "2026-03-25")).toBe("2026-04-01");
    expect(resolvePhrase("yesterday", "2026-10-26")).toBe("2026-10-25");
  });

  it("takes weekdays as the coming one (never today), and last as the one before", () => {
    expect(resolvePhrase("friday", TODAY)).toBe("2026-10-23");
    expect(resolvePhrase("next friday", TODAY)).toBe("2026-10-23");
    expect(resolvePhrase("this fri", TODAY)).toBe("2026-10-23");
    expect(resolvePhrase("next tue", TODAY)).toBe("2026-10-27");
    expect(resolvePhrase("tuesday", TODAY)).toBe("2026-10-27");
    expect(resolvePhrase("last tuesday", TODAY)).toBe("2026-10-13");
    expect(resolvePhrase("last monday", TODAY)).toBe("2026-10-19");
    expect(resolvePhrase("last wed", TODAY)).toBe("2026-10-14");
    expect(resolvePhrase("next sunday", "2026-12-30")).toBe("2027-01-03");
  });

  it("reads month and day either way round, this year or next once passed", () => {
    expect(resolvePhrase("oct 31", TODAY)).toBe("2026-10-31");
    expect(resolvePhrase("31st October", TODAY)).toBe("2026-10-31");
    expect(resolvePhrase("oct 20", TODAY)).toBe("2026-10-20");
    expect(resolvePhrase("oct 19", TODAY)).toBe("2027-10-19");
    expect(resolvePhrase("jan 3rd", TODAY)).toBe("2027-01-03");
    expect(resolvePhrase("Sept 2", TODAY)).toBe("2027-09-02");
  });

  it("finds Feb 29th in the next leap year, and refuses days that never exist", () => {
    expect(resolvePhrase("feb 29", TODAY)).toBe("2028-02-29");
    expect(resolvePhrase("feb 29", "2028-01-10")).toBe("2028-02-29");
    expect(resolvePhrase("feb 30", TODAY)).toBeNull();
    expect(resolvePhrase("apr 31", TODAY)).toBeNull();
    expect(resolvePhrase("oct 0", TODAY)).toBeNull();
    expect(resolvePhrase("oct 32", TODAY)).toBeNull();
  });

  it("names no day for anything else", () => {
    for (const phrase of ["", "  ", "fr", "next", "last week", "soon", "in two weeks", "in 2 fortnights", "ma 3", "octopus 3", "a".repeat(30)]) {
      expect(resolvePhrase(phrase, TODAY)).toBeNull();
    }
    expect(resolvePhrase("today", "not a date")).toBeNull();
    expect(resolvePhrase("today", "2026-02-30")).toBeNull();
  });
});

describe("dateSuggestions", () => {
  it("offers a few common days when nothing is typed", () => {
    expect(dateSuggestions("", TODAY).map((s) => s.phrase)).toEqual(["today", "tomorrow", "yesterday", "next monday", "in 1 week"]);
  });

  it("completes what has been typed, each day once", () => {
    expect(dateSuggestions("next f", TODAY)).toEqual([{ phrase: "next friday", date: "2026-10-23" }]);
    // "fri" names the day itself; "friday" is the same day, so it isn't listed again
    expect(dateSuggestions("fri", TODAY)).toEqual([{ phrase: "fri", date: "2026-10-23" }]);
    expect(dateSuggestions("to", TODAY).map((s) => s.phrase)).toEqual(["today", "tomorrow"]);
    expect(dateSuggestions("in 3", TODAY)).toEqual([
      { phrase: "in 3 days", date: "2026-10-23" },
      { phrase: "in 3 weeks", date: "2026-11-10" },
      { phrase: "in 3 months", date: "2027-01-20" },
    ]);
    expect(dateSuggestions("Oct 3", TODAY)).toEqual([{ phrase: "oct 3", date: "2027-10-03" }]);
    expect(dateSuggestions("in 2 weeks", TODAY)).toEqual([{ phrase: "in 2 weeks", date: "2026-11-03" }]);
  });

  it("offers at most a handful, and nothing for text that isn't a date", () => {
    expect(dateSuggestions("t", TODAY).length).toBeLessThanOrEqual(MAX_DATE_SUGGESTIONS);
    expect(dateSuggestions("l", TODAY).length).toBeLessThanOrEqual(MAX_DATE_SUGGESTIONS);
    expect(dateSuggestions("reading list", TODAY)).toEqual([]);
    expect(dateSuggestions("x".repeat(40), TODAY)).toEqual([]);
  });
});
