import { describe, it, expect } from "vitest";
import { normalizeTitle, titleKey, MAX_TITLE_LENGTH } from "~/lib/page-title";

describe("normalizeTitle", () => {
  it("trims and collapses whitespace", () => {
    expect(normalizeTitle("  Meeting \t notes\n2026  ")).toEqual({ ok: true, title: "Meeting notes 2026" });
  });

  it("keeps case, punctuation and other scripts", () => {
    expect(normalizeTitle("C++ / Café: 日本 #1")).toEqual({ ok: true, title: "C++ / Café: 日本 #1" });
  });

  it.each(["", "   ", "\n\t"])("rejects an empty title %j", (raw) => {
    expect(normalizeTitle(raw)).toEqual({ ok: false, reason: "A page needs a title." });
  });

  it("accepts a title at the length limit and rejects one over it", () => {
    expect(normalizeTitle("a".repeat(MAX_TITLE_LENGTH)).ok).toBe(true);
    expect(normalizeTitle("a".repeat(MAX_TITLE_LENGTH + 1))).toEqual({
      ok: false,
      reason: `Titles can be up to ${MAX_TITLE_LENGTH} characters.`,
    });
  });

  it("measures length after collapsing whitespace", () => {
    expect(normalizeTitle(" ".repeat(500) + "short").ok).toBe(true);
  });

  it.each(["[[Nested]]", "a [[b", "c ]] d"])("rejects link brackets in %j", (raw) => {
    expect(normalizeTitle(raw)).toEqual({ ok: false, reason: "Titles can't contain [[ or ]]." });
  });

  it("stores one Unicode form, so composed and decomposed accents match", () => {
    expect(normalizeTitle("Cafe\u0301")).toEqual({ ok: true, title: "Caf\u00e9" });
  });

  it.each([
    ["zero-width space", "Mist\u200Blog"],
    ["zero-width joiner", "Mist\u200Dlog"],
    ["byte order mark", "\uFEFFMistlog"],
    ["soft hyphen", "Mist\u00ADlog"],
    ["right-to-left override", "Mist\u202Elog"],
    ["word joiner", "Mist\u2060log"],
  ])("removes invisible characters (%s)", (_name, raw) => {
    expect(normalizeTitle(raw)).toEqual({ ok: true, title: "Mistlog" });
  });

  it("treats a title of only invisible characters as empty", () => {
    expect(normalizeTitle("\u200B\u200B")).toEqual({ ok: false, reason: "A page needs a title." });
  });

  it("allows single brackets", () => {
    expect(normalizeTitle("[draft] notes]").ok).toBe(true);
  });
});

describe("titleKey", () => {
  it("compares titles ignoring case, surrounding space and Unicode composition", () => {
    expect(titleKey("  Café ")).toBe(titleKey("cafe\u0301".replace("cafe\u0301", "Cafe\u0301")));
    expect(titleKey("Books")).toBe("books");
  });
});
