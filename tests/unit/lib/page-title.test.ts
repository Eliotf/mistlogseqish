import { describe, it, expect } from "vitest";
import { normalizeTitle, MAX_TITLE_LENGTH } from "~/lib/page-title";

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

  it("allows single brackets", () => {
    expect(normalizeTitle("[draft] notes]").ok).toBe(true);
  });
});
