// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, cleanup, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import AllPagesView, { PAGE_STEP } from "~/components/AllPagesView";
import { pageTitles } from "~/lib/page-titles";
import type { AllPagesRow } from "~/lib/all-pages";

const row = (pageId: string, title: string, over: Partial<AllPagesRow> = {}): AllPagesRow => ({
  pageId, kind: "page", title, slug: null, hasContent: true, updatedAt: 0, backlinks: 0, ...over,
});

const PAGES = [
  row("aaaa0001", "Garden", { slug: "garden", backlinks: 3, updatedAt: Date.UTC(2026, 10, 1) }),
  row("aaaa0002", "Books", { slug: "books", backlinks: 5, updatedAt: Date.UTC(2026, 10, 3) }),
  row("aaaa0003", "", { updatedAt: Date.UTC(2026, 9, 1) }),
  row("journal-2026-11-04", "Nov 4th, 2026", { kind: "journal", updatedAt: Date.UTC(2026, 10, 4) }),
];

function show(props: Partial<Parameters<typeof AllPagesView>[0]> = {}) {
  const deletePage = props.deletePage ?? vi.fn(async () => ({ ok: true as const, title: "x" }));
  render(createElement(MemoryRouter, null, createElement(AllPagesView, { pages: PAGES, loadFailed: false, deletePage, ...props })) as ReactNode as never);
  return deletePage;
}

const titles = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getByRole("link").textContent);

describe("AllPagesView", () => {
  afterEach(cleanup);

  it("lists pages, most recently edited first, without journal days unless asked", () => {
    show();
    expect(titles()).toEqual(["Books", "Garden", "Untitled"]);
    expect(screen.getByRole("link", { name: "Books" }).getAttribute("href")).toBe("/page/books");
    expect(screen.getByRole("link", { name: "Untitled" }).getAttribute("href")).toBe("/docs/aaaa0003");
    fireEvent.click(screen.getByLabelText("Include journal days"));
    expect(titles()).toEqual(["Nov 4th, 2026", "Books", "Garden", "Untitled"]);
    expect(screen.getByRole("status").textContent).toBe("4 pages");
  });

  it("filters by title and sorts by any column, saying which", () => {
    show();
    fireEvent.change(screen.getByLabelText("Filter pages by title"), { target: { value: "GAR" } });
    expect(titles()).toEqual(["Garden"]);
    fireEvent.change(screen.getByLabelText("Filter pages by title"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: /^Title/ }));
    expect(titles()).toEqual(["Books", "Garden", "Untitled"]);
    expect(screen.getByRole("columnheader", { name: /Title/ }).getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(screen.getByRole("button", { name: /^Backlinks/ }));
    expect(titles()).toEqual(["Books", "Garden", "Untitled"]);
    fireEvent.click(screen.getByRole("button", { name: /^Backlinks/ }));
    expect(titles()).toEqual(["Untitled", "Garden", "Books"]);
  });

  it("deletes a page only after confirming, and shows its links as missing", async () => {
    const deletePage = show();
    const garden = screen.getByRole("link", { name: "Garden" }).closest("tr")!;
    fireEvent.click(within(garden).getByRole("button", { name: "Delete Garden" }));
    expect(deletePage).not.toHaveBeenCalled();
    fireEvent.click(within(garden).getByRole("button", { name: "Cancel" }));
    fireEvent.click(within(garden).getByRole("button", { name: "Delete Garden" }));
    fireEvent.click(within(garden).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(titles()).toEqual(["Books", "Untitled"]));
    expect(deletePage).toHaveBeenCalledWith("aaaa0001");
    expect(pageTitles().get("aaaa0001")?.missing).toBe(true);
  });

  it("keeps the page and says so when deleting fails", async () => {
    show({ deletePage: vi.fn(async () => ({ ok: false as const, code: "failed" as const })) });
    const books = screen.getByRole("link", { name: "Books" }).closest("tr")!;
    fireEvent.click(within(books).getByRole("button", { name: "Delete Books" }));
    fireEvent.click(within(books).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't delete “Books”"));
    expect(titles()).toContain("Books");
  });

  it("offers no delete for journal days", () => {
    show();
    fireEvent.click(screen.getByLabelText("Include journal days"));
    const day = screen.getByRole("link", { name: "Nov 4th, 2026" }).closest("tr")!;
    expect(within(day).queryByRole("button")).toBeNull();
  });

  it("shows the first rows of a big workspace, then all on request", () => {
    show({ pages: Array.from({ length: PAGE_STEP + 5 }, (_, i) => row(`bbbb${String(i).padStart(4, "0")}`, `Page ${i}`)) });
    // Counted directly: role queries over hundreds of rows are slow under coverage
    const rowCount = () => document.querySelectorAll("tbody tr").length;
    expect(rowCount()).toBe(PAGE_STEP);
    fireEvent.click(screen.getByText(`Show all ${PAGE_STEP + 5}`));
    expect(rowCount()).toBe(PAGE_STEP + 5);
  });
});
