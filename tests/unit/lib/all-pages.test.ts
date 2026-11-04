import { describe, it, expect } from "vitest";
import { filterPages, nextSort, sortPages, type AllPagesRow } from "~/lib/all-pages";

const row = (pageId: string, title: string, over: Partial<AllPagesRow> = {}): AllPagesRow => ({
  pageId, kind: "page", title, slug: null, hasContent: true, updatedAt: 0, backlinks: 0, ...over,
});

const rows = [
  row("aaaa0001", "Garden", { backlinks: 3, updatedAt: 10 }),
  row("aaaa0002", "books", { backlinks: 3, updatedAt: 30 }),
  row("aaaa0003", "Café notes", { backlinks: 1, updatedAt: 20 }),
  row("journal-2026-11-04", "Nov 4th, 2026", { kind: "journal", updatedAt: 40 }),
];

describe("All pages", () => {
  it("filters by title ignoring case, and leaves journal days out unless asked", () => {
    expect(filterPages(rows, "", false).map((r) => r.title)).toEqual(["Garden", "books", "Café notes"]);
    expect(filterPages(rows, "CAF", false).map((r) => r.title)).toEqual(["Café notes"]);
    expect(filterPages(rows, "nov", true).map((r) => r.title)).toEqual(["Nov 4th, 2026"]);
    expect(filterPages(rows, "nov", false)).toEqual([]);
  });

  it("sorts by title, backlinks or last edited, with ties by title", () => {
    expect(sortPages(rows, "title", "asc").map((r) => r.title)).toEqual(["books", "Café notes", "Garden", "Nov 4th, 2026"]);
    expect(sortPages(rows, "backlinks", "desc").map((r) => r.title)).toEqual(["books", "Garden", "Café notes", "Nov 4th, 2026"]);
    expect(sortPages(rows, "updated", "desc").map((r) => r.updatedAt)).toEqual([40, 30, 20, 10]);
    expect(sortPages(rows, "updated", "asc").map((r) => r.updatedAt)).toEqual([10, 20, 30, 40]);
  });

  it("puts untitled pages after titled ones when sorting by title", () => {
    const withUntitled = [row("aaaa0009", ""), ...rows];
    expect(sortPages(withUntitled, "title", "asc").map((r) => r.title)).toEqual(["books", "Café notes", "Garden", "Nov 4th, 2026", ""]);
  });

  it("flips a column's direction, and starts a new column with the most useful first", () => {
    expect(nextSort({ key: "updated", dir: "desc" }, "updated")).toEqual({ key: "updated", dir: "asc" });
    expect(nextSort({ key: "updated", dir: "desc" }, "title")).toEqual({ key: "title", dir: "asc" });
    expect(nextSort({ key: "title", dir: "asc" }, "backlinks")).toEqual({ key: "backlinks", dir: "desc" });
  });
});
