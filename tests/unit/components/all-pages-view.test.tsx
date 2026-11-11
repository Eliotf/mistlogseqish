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

describe("AllPagesView, deleting several pages", () => {
  afterEach(cleanup);

  const tick = (title: string) => fireEvent.click(screen.getByRole("checkbox", { name: `Select ${title}` }));
  const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLInputElement;
  const selectAll = () => box("Select all shown pages");
  const confirm = () => fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: /^Delete \d+ page/ }));

  it("deletes the ticked pages after one confirmation naming them", async () => {
    const deletePage = show();
    expect(screen.queryByRole("button", { name: /^Delete \d+ page/ })).toBeNull();
    tick("Garden");
    tick("Untitled");
    expect(selectAll().indeterminate).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 pages" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog.textContent).toContain("Delete 2 pages? Links to them will show as missing.");
    expect(dialog.textContent).toContain("“Garden” and “Untitled”");
    expect(deletePage).not.toHaveBeenCalled();
    confirm();
    await waitFor(() => expect(titles()).toEqual(["Books"]));
    expect(deletePage).toHaveBeenCalledTimes(2);
    expect(deletePage).toHaveBeenCalledWith("aaaa0001");
    expect(deletePage).toHaveBeenCalledWith("aaaa0003");
    expect(pageTitles().get("aaaa0003")?.missing).toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete \d+ page/ })).toBeNull();
  });

  it("keeps the pages that failed, ticked, and says which", async () => {
    const deletePage = vi.fn(async (pageId: string) => (pageId === "aaaa0002" ? { ok: false as const, code: "failed" as const } : { ok: true as const, title: "x" }));
    show({ deletePage });
    tick("Books");
    tick("Garden");
    fireEvent.click(screen.getByRole("button", { name: "Delete 2 pages" }));
    confirm();
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't delete 1 page: “Books”"));
    expect(titles()).toEqual(["Books", "Untitled"]);
    expect(box("Select Books").checked).toBe(true);
    expect(screen.getByRole("button", { name: "Delete 1 page" })).toBeTruthy();
    expect(pageTitles().get("aaaa0002")?.missing).not.toBe(true);
  });

  it("counts a page someone else already deleted as gone", async () => {
    show({ deletePage: vi.fn(async () => ({ ok: false as const, code: "missing" as const })) });
    tick("Books");
    fireEvent.click(screen.getByRole("button", { name: "Delete 1 page" }));
    confirm();
    await waitFor(() => expect(titles()).toEqual(["Garden", "Untitled"]));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("gives journal days no tick box, and leaves them out of select all", async () => {
    const deletePage = show();
    fireEvent.click(screen.getByLabelText("Include journal days"));
    const day = screen.getByRole("link", { name: "Nov 4th, 2026" }).closest("tr")!;
    expect(within(day).queryByRole("checkbox")).toBeNull();
    fireEvent.click(selectAll());
    fireEvent.click(screen.getByRole("button", { name: "Delete 3 pages" }));
    confirm();
    await waitFor(() => expect(titles()).toEqual(["Nov 4th, 2026"]));
    expect(deletePage).not.toHaveBeenCalledWith("journal-2026-11-04");
    expect(selectAll().disabled).toBe(true);
  });

  it("selects all rows the filter shows, and deletes only ticked rows still shown", async () => {
    const deletePage = show({ pages: [...PAGES, row("aaaa0004", "Garden shed")] });
    const filter = (value: string) => fireEvent.change(screen.getByLabelText("Filter pages by title"), { target: { value } });
    filter("garden");
    fireEvent.click(selectAll());
    expect(selectAll().checked).toBe(true);
    filter("");
    // Two of four ticked
    expect(selectAll().checked).toBe(false);
    expect(selectAll().indeterminate).toBe(true);
    expect(box("Select Books").checked).toBe(false);
    expect(screen.getByRole("button", { name: "Delete 2 pages" })).toBeTruthy();
    filter("shed");
    fireEvent.click(screen.getByRole("button", { name: "Delete 1 page" }));
    expect(screen.getByRole("alertdialog").textContent).toContain("“Garden shed”");
    confirm();
    await waitFor(() => expect(deletePage).toHaveBeenCalledTimes(1));
    expect(deletePage).toHaveBeenCalledWith("aaaa0004");
    // Select all when every shown row is ticked unticks them
    filter("");
    fireEvent.click(selectAll());
    expect(selectAll().checked).toBe(true);
    fireEvent.click(selectAll());
    expect(screen.getAllByRole("checkbox").filter((b) => (b as HTMLInputElement).checked)).toEqual([]);
  });

  it("selects rows beyond the first screenful", () => {
    show({ pages: Array.from({ length: PAGE_STEP + 5 }, (_, i) => row(`bbbb${String(i).padStart(4, "0")}`, `Page ${i}`)) });
    fireEvent.click(selectAll());
    expect(screen.getByText(`Delete ${PAGE_STEP + 5} pages`)).toBeTruthy();
  });

  it("names the first several titles, then how many more", () => {
    show({ pages: Array.from({ length: 11 }, (_, i) => row(`bbbb${String(i).padStart(4, "0")}`, `Page ${String(i).padStart(2, "0")}`)) });
    fireEvent.click(selectAll());
    fireEvent.click(screen.getByRole("button", { name: "Delete 11 pages" }));
    expect(screen.getByRole("alertdialog").textContent).toMatch(/“Page \d\d” and 3 more/);
  });

  it("works from the keyboard: native tick boxes, focus on Cancel, Escape closes", async () => {
    const deletePage = show();
    // Real tick boxes, so Space toggles them in the browser
    expect(box("Select Garden").type).toBe("checkbox");
    tick("Garden");
    fireEvent.click(screen.getByRole("button", { name: "Delete 1 page" }));
    const dialog = screen.getByRole("alertdialog");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Cancel" }));
    // Ticks are frozen while it is open, so it deletes what it names
    expect(box("Select Books").disabled).toBe(true);
    expect(selectAll().disabled).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Delete 1 page" })));
    expect(deletePage).not.toHaveBeenCalled();
    expect(box("Select Garden").checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.queryByRole("button", { name: "Delete 1 page" })).toBeNull();
  });

  it("can't be cancelled while deleting, and shows progress", async () => {
    let finish: (value: { ok: true; title: string }) => void = () => {};
    show({ deletePage: vi.fn(() => new Promise<{ ok: true; title: string }>((resolve) => (finish = resolve))) });
    tick("Books");
    fireEvent.click(screen.getByRole("button", { name: "Delete 1 page" }));
    confirm();
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: "Deleting 0 of 1…" })).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect((within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    finish({ ok: true, title: "Books" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(titles()).toEqual(["Garden", "Untitled"]);
  });

  it("unticks a page deleted on its own", async () => {
    show();
    tick("Garden");
    tick("Books");
    const garden = screen.getByRole("link", { name: "Garden" }).closest("tr")!;
    fireEvent.click(within(garden).getByRole("button", { name: "Delete Garden" }));
    fireEvent.click(within(garden).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Delete 1 page" })).toBeTruthy());
  });
});
