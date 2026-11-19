// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useEffect } from "react";
import { render, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import Backlinks from "~/components/Backlinks";
import { SidePanelProvider, useSidePanel } from "~/lib/side-panel";
import { pageTitles } from "~/lib/page-titles";
import type { BacklinkGroup } from "~/lib/backlink-lines";

const seen: { path: string; panel: string[] } = { path: "", panel: [] };
function Spy() {
  const path = useLocation().pathname;
  const panel = useSidePanel();
  useEffect(() => {
    seen.path = path;
    seen.panel = panel.pages;
  });
  return null;
}

const groups: BacklinkGroup[] = [
  { pageId: "aaaa1111", title: "Plans", kind: "page", slug: "plans", lines: [{ line: 1, text: "- see [[Old name]] today", links: [{ from: 8, to: 16, pageId: "abcd1234" }] }] },
  { pageId: "journal-2026-10-30", title: "Oct 30th, 2026", kind: "journal", slug: null, lines: [{ line: 0, text: "[[Old name]]", links: [{ from: 2, to: 10, pageId: "abcd1234" }] }, { line: 3, text: "again [[Old name]]", links: [{ from: 8, to: 16, pageId: "abcd1234" }] }] },
];

function show(load: (id: string) => Promise<BacklinkGroup[]>) {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: ["/page/books"] },
      createElement(SidePanelProvider, null, createElement(Routes, null, createElement(Route, { path: "*", element: createElement("div", null, createElement(Spy), createElement(Backlinks, { pageId: "abcd1234", load })) }))),
    ),
  );
}

let visibility: DocumentVisibilityState = "visible";
beforeEach(() => {
  localStorage.clear();
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ pages: {} })));
});
afterEach(async () => {
  cleanup();
  await new Promise((r) => setTimeout(r, 0));
  vi.unstubAllGlobals();
});

describe("Backlinks", () => {
  it("lists linking pages and their lines, with a count", async () => {
    const ui = show(async () => groups);
    expect(await ui.findByText("Linked references · 3")).toBeTruthy();
    expect(ui.getByRole("link", { name: "Plans" }).getAttribute("href")).toBe("/page/plans");
    expect(ui.getByRole("link", { name: "Oct 30th, 2026" }).getAttribute("href")).toBe("/journal/2026-10-30");
    expect(ui.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["see [[Old name]] today", "[[Old name]]", "again [[Old name]]"]);
  });

  it("shows the lines nested under a linking line, open, indented by depth", async () => {
    const nested: BacklinkGroup[] = [
      {
        pageId: "aaaa1111",
        title: "Plans",
        kind: "page",
        slug: "plans",
        lines: [
          {
            line: 0,
            text: "- read [[Old name]]",
            links: [{ from: 9, to: 17, pageId: "abcd1234" }],
            children: [
              { line: 1, text: "\t- chapter one", links: [] },
              { line: 2, text: "\t\t- a note", links: [] },
            ],
            more: 2,
          },
        ],
      },
    ];
    const ui = show(async () => nested);
    const list = await ui.findByRole("list", { name: "Nested lines" });
    const items = [...list.querySelectorAll("li")];
    expect(items.map((li) => li.textContent)).toEqual(["•chapter one", "•a note", "2 more lines"]);
    expect(items[0].style.paddingLeft).toBe("0em");
    expect(items[1].style.paddingLeft).toBe("1.25em");
    expect(ui.getByText("Linked references · 1")).toBeTruthy();
  });

  it("folds a reference's nested lines with its arrow; references with none have no arrow", async () => {
    const nested: BacklinkGroup[] = [
      { pageId: "aaaa1111", title: "Plans", kind: "page", slug: "plans", lines: [{ line: 0, text: "- read [[Old name]]", links: [{ from: 9, to: 17, pageId: "abcd1234" }], children: [{ line: 1, text: "\t- chapter one", links: [] }] }, { line: 2, text: "- again [[Old name]]", links: [{ from: 10, to: 18, pageId: "abcd1234" }] }] },
    ];
    const ui = show(async () => nested);
    const fold = await ui.findByRole("button", { name: "Fold" });
    expect(ui.getAllByRole("button", { name: /fold/i })).toHaveLength(1);
    fireEvent.click(fold);
    expect(ui.queryByText("chapter one")).toBeNull();
    fireEvent.click(ui.getByRole("button", { name: "Unfold" }));
    expect(ui.getByText("chapter one")).toBeTruthy();
  });

  it("shows links in references with their current titles", async () => {
    pageTitles().prime("abcd1234", { title: "Books", kind: "page", slug: "books", empty: false, missing: false });
    const ui = show(async () => groups);
    await ui.findByText("Linked references · 3");
    expect(ui.getAllByRole("listitem")[0].textContent).toBe("see [[Books]] today");
  });

  it("opens a page on click, and in the side panel on Cmd/Ctrl+click", async () => {
    const ui = show(async () => groups);
    const plans = await ui.findByRole("link", { name: "Plans" });
    fireEvent.click(plans, { metaKey: true });
    await waitFor(() => expect(seen.panel).toEqual(["aaaa1111"]));
    expect(seen.path).toBe("/page/books");
    fireEvent.click(plans);
    await waitFor(() => expect(seen.path).toBe("/page/plans"));
  });

  it("says when nothing links here", async () => {
    const ui = show(async () => []);
    expect(await ui.findByText(/No pages link here yet/)).toBeTruthy();
    expect(ui.getByText("Linked references · 0")).toBeTruthy();
  });

  it("says when references can't be loaded, and keeps what it had on a failed refresh", async () => {
    const failing = show(async () => {
      throw new Error("down");
    });
    expect(await failing.findByText(/Couldn't load linked references/)).toBeTruthy();
    cleanup();

    let calls = 0;
    const ui = show(async () => {
      calls += 1;
      if (calls > 1) throw new Error("down");
      return groups;
    });
    await ui.findByText("Linked references · 3");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(calls).toBe(2));
    expect(ui.getByText("Linked references · 3")).toBeTruthy();
  });

  it("loads again when the tab is shown, not while it is hidden", async () => {
    const load = vi.fn(async () => groups);
    const ui = show(load);
    await ui.findByText("Linked references · 3");
    visibility = "hidden";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(load).toHaveBeenCalledTimes(1);
    visibility = "visible";
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  });
});
