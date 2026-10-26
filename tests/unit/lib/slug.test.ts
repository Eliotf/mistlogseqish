import { describe, it, expect } from "vitest";
import { slugify, pagePath, MAX_SLUG_LENGTH } from "~/lib/slug";

describe("slugify", () => {
  it.each([
    ["Meeting Notes", "meeting-notes"],
    ["  Spaced   out  ", "spaced-out"],
    ["Q3 / 2026: plan!", "q3-2026-plan"],
    ["Café plans", "café-plans"],
    ["日本 メモ", "日本-メモ"],
    ["C++", "c"],
    ["already-a-slug", "already-a-slug"],
    ["under_score", "under-score"],
    ["Emoji 🚀 launch", "emoji-launch"],
  ])("turns %j into %j", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });

  it.each(["", "   ", "!!!", "🚀🚀", "--"])("gives an empty slug for %j", (title) => {
    expect(slugify(title)).toBe("");
  });

  it("treats composed and decomposed accents the same", () => {
    expect(slugify("Café")).toBe(slugify("Café"));
  });

  it("caps length, cutting at a word boundary", () => {
    const title = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const slug = slugify(title);
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    expect(slug.endsWith("-")).toBe(false);
    expect(title.toLowerCase().replace(/ /g, "-").startsWith(slug)).toBe(true);
  });

  it("caps a single long word without splitting a character", () => {
    const slug = slugify("𠀀".repeat(100));
    expect(Array.from(slug)).toHaveLength(MAX_SLUG_LENGTH);
    expect(slug).toBe("𠀀".repeat(MAX_SLUG_LENGTH));
  });
});

describe("pagePath", () => {
  it("uses the slug when there is one, encoded", () => {
    expect(pagePath("abcd1234", "meeting-notes")).toBe("/page/meeting-notes");
    expect(pagePath("abcd1234", "café")).toBe("/page/caf%C3%A9");
  });

  it("uses the journal address for journals, whatever the slug", () => {
    expect(pagePath("journal-2026-10-26", null)).toBe("/journal/2026-10-26");
    expect(pagePath("journal-2026-10-26", "ignored")).toBe("/journal/2026-10-26");
  });

  it("falls back to the permanent address", () => {
    expect(pagePath("abcd1234", null)).toBe("/docs/abcd1234");
  });
});
