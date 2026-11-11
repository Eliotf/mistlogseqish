// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, useEffect, type ReactNode } from "react";
import { render, cleanup, fireEvent, screen, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import SearchBox from "~/components/SearchBox";
import SearchButton from "~/components/SearchButton";
import AppHeader from "~/components/AppHeader";
import { SearchBoxProvider } from "~/lib/search-box";
import { SidePanelProvider, useSidePanel } from "~/lib/side-panel";
import { SNIPPET_END, SNIPPET_START, type SearchResults } from "~/lib/search";
import type { LinkPage } from "~/lib/page-titles";

const RECENT: SearchResults = {
  titles: [
    { pageId: "journal-2026-11-11", title: "Nov 11th, 2026", kind: "journal", slug: null },
    { pageId: "abcd1234", title: "Books", kind: "page", slug: "books" },
  ],
  text: [],
  pending: 0,
};

const FOUND: SearchResults = {
  titles: [{ pageId: "abcd1234", title: "Books", kind: "page", slug: "books" }],
  text: [
    { pageId: "efgh5678", title: "Reading", kind: "page", slug: "reading", snippet: `- good ${SNIPPET_START}books${SNIPPET_END}\n- more` },
    { pageId: "ijkl9012", title: "", kind: "page", slug: null, snippet: `${SNIPPET_START}book${SNIPPET_END} club` },
  ],
  pending: 3,
};

/** What the spy last saw, recorded after render. */
const seen: { where: string; panel: string[] } = { where: "", panel: [] };
function Spy() {
  const location = useLocation();
  const panel = useSidePanel();
  useEffect(() => {
    seen.where = location.pathname;
    seen.panel = panel.pages;
  });
  return null;
}

function show(opts: { search?: (q: string, signal: AbortSignal) => Promise<SearchResults>; create?: (title: string) => Promise<LinkPage | null> } = {}) {
  const search = vi.fn(opts.search ?? (async (q: string) => (q ? FOUND : RECENT)));
  const create = vi.fn(opts.create ?? (async () => null));
  const view = createElement(
    "div",
    null,
    createElement(Spy),
    createElement("textarea", { "aria-label": "Editor" }),
    createElement(SearchButton),
    createElement(SearchBox, { search, create }),
  );
  const tree = createElement(
    MemoryRouter,
    { initialEntries: ["/"] },
    createElement(SidePanelProvider, null, createElement(SearchBoxProvider, null, createElement(Routes, null, createElement(Route, { path: "*", element: view })))),
  );
  render(tree as ReactNode as never);
  return { search, create };
}

const input = () => screen.getByRole("combobox", { name: "Search" });
const options = () => screen.queryAllByRole("option");
const selected = () => options().find((o) => o.getAttribute("aria-selected") === "true");
const press = (key: string, over: Record<string, unknown> = {}) => fireEvent.keyDown(input(), { key, ...over });

async function typeQuery(q: string) {
  fireEvent.change(input(), { target: { value: q } });
  await waitFor(() => expect(screen.getByText("In pages")).toBeTruthy());
}

describe("SearchBox (F13)", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("opens with Ctrl+K from anywhere, even while typing, listing recent pages", async () => {
    show();
    const editor = screen.getByRole("textbox", { name: "Editor" });
    editor.focus();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.keyDown(editor, { key: "k", ctrlKey: true });
    expect(screen.getByRole("dialog", { name: "Search" })).toBeTruthy();
    expect(document.activeElement).toBe(input());
    await waitFor(() => expect(options().map((o) => o.textContent)).toEqual(["Nov 11th, 2026Journal", "Books"]));
    expect(screen.getByText("Recent pages")).toBeTruthy();
  });

  it("opens from the header button", () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("shows title matches, then text matches with the words highlighted, then a create row", async () => {
    const { search } = show();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await typeQuery("boo");
    expect(search).toHaveBeenLastCalledWith("boo", expect.any(AbortSignal));
    expect(screen.getByText("Titles")).toBeTruthy();
    expect(options().map((o) => o.textContent)).toEqual(["Books", "Reading- good books - more", "Untitledbook club", "Create page “boo”"]);
    expect([...document.querySelectorAll("mark")].map((m) => m.textContent)).toEqual(["books", "book"]);
    expect(screen.getByRole("status").textContent).toContain("3 pages to go");
  });

  it("moves through the results with the arrow keys, wrapping round", async () => {
    show();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await typeQuery("boo");
    expect(selected()?.textContent).toBe("Books");
    press("ArrowDown");
    expect(selected()?.textContent).toContain("Reading");
    expect(input().getAttribute("aria-activedescendant")).toBe(selected()?.id);
    press("ArrowUp");
    press("ArrowUp");
    expect(selected()?.textContent).toBe("Create page “boo”");
    press("ArrowDown");
    expect(selected()?.textContent).toBe("Books");
  });

  it("opens the chosen page with Enter and closes", async () => {
    show();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await typeQuery("boo");
    press("ArrowDown");
    press("Enter");
    expect(seen.where).toBe("/page/reading");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a page with no slug at its /docs address", async () => {
    show();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await typeQuery("boo");
    press("ArrowDown");
    press("ArrowDown");
    press("Enter");
    expect(seen.where).toBe("/docs/ijkl9012");
  });

  it("opens in the side panel with Ctrl+Enter or Ctrl+click", async () => {
    show();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await typeQuery("boo");
    press("Enter", { ctrlKey: true });
    expect(seen.panel).toEqual(["abcd1234"]);
    expect(seen.where).toBe("/");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await typeQuery("boo");
    fireEvent.mouseDown(options()[1], { ctrlKey: true });
    expect(seen.panel).toEqual(["efgh5678", "abcd1234"]);
  });

  it("opens a clicked result", async () => {
    show();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await typeQuery("boo");
    fireEvent.mouseDown(options()[0]);
    expect(seen.where).toBe("/page/books");
  });

  it("closes with Escape or a click outside, putting the focus back", async () => {
    show();
    const editor = screen.getByRole("textbox", { name: "Editor" });
    editor.focus();
    fireEvent.keyDown(editor, { key: "k", ctrlKey: true });
    press("Escape");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(editor));
    fireEvent.keyDown(editor, { key: "k", ctrlKey: true });
    fireEvent.mouseDown(document.querySelector('[aria-hidden="true"].fixed')!);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps the focus in the box on Tab, and ignores a second Ctrl+K", async () => {
    show();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await typeQuery("boo");
    expect(press("Tab")).toBe(false);
    fireEvent.keyDown(input(), { key: "k", ctrlKey: true });
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect((input() as HTMLInputElement).value).toBe("boo");
  });

  it("creates a page from the last row and opens it", async () => {
    const created: LinkPage = { pageId: "mnop3456", title: "boo", kind: "page", slug: "boo", empty: true };
    const { create } = show({ create: async () => created });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await typeQuery("boo");
    press("ArrowUp");
    press("Enter");
    await waitFor(() => expect(seen.where).toBe("/page/boo"));
    expect(create).toHaveBeenCalledWith("boo");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says when a page couldn't be created, and stays open", async () => {
    show({ create: async () => null });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await typeQuery("boo");
    press("ArrowUp");
    press("Enter");
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't create “boo”"));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("says when search fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    show({ search: async () => Promise.reject(new Error("down")) });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't search"));
  });

  it("says when nothing matches", async () => {
    show({ search: async () => ({ titles: [], text: [], pending: 0 }) });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(screen.getByText("No pages yet.")).toBeTruthy());
    fireEvent.change(input(), { target: { value: "[[" } });
    await waitFor(() => expect(screen.getByText("No pages match.")).toBeTruthy());
    // Arrow keys and Enter do nothing with no rows
    press("ArrowDown");
    press("Enter");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("abandons a search the user has typed past", async () => {
    const signals: AbortSignal[] = [];
    show({
      search: (q, signal) => {
        signals.push(signal);
        return new Promise((resolve) => setTimeout(() => resolve(q ? FOUND : RECENT), 50));
      },
    });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => expect(signals).toHaveLength(1));
    fireEvent.change(input(), { target: { value: "bo" } });
    await waitFor(() => expect(signals).toHaveLength(2));
    fireEvent.change(input(), { target: { value: "boo" } });
    await waitFor(() => expect(signals).toHaveLength(3));
    expect(signals[1].aborted).toBe(true);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 80));
    });
    expect(signals[2].aborted).toBe(false);
    expect(screen.getByText("In pages")).toBeTruthy();
  });

  it("is in the app header, and the header does without it outside the provider", () => {
    const withBox = createElement(MemoryRouter, null, createElement(SearchBoxProvider, null, createElement(AppHeader)));
    const { unmount } = render(withBox as ReactNode as never);
    expect(screen.getByRole("button", { name: "Search" }).getAttribute("title")).toBe("Search (Ctrl+K)");
    unmount();
    render(createElement(MemoryRouter, null, createElement(AppHeader)) as ReactNode as never);
    expect(screen.queryByRole("button", { name: "Search" })).toBeNull();
  });
});
