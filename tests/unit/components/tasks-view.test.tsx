// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { createElement, useEffect, type ReactNode } from "react";
import { render, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import TasksView from "~/components/TasksView";
import { SidePanelProvider, useSidePanel } from "~/lib/side-panel";
import { pageTitles } from "~/lib/page-titles";
import type { TaskItem } from "~/lib/tasks";

const BLOCK = "00000000-0000-4000-8000-000000000001";

const task = (over: Partial<TaskItem>): TaskItem => ({
  pageId: "abcd1234",
  pageTitle: "Mistlog",
  pageKind: "page",
  updatedAt: 1,
  state: "TODO",
  priority: null,
  blockId: null,
  line: { line: 0, text: "- TODO a task", links: [] },
  ...over,
});

/** What the spy last saw, recorded after render. */
const seen: { where: string; panel: string[] } = { where: "", panel: [] };
function Spy() {
  const location = useLocation();
  const panel = useSidePanel();
  useEffect(() => {
    seen.where = location.pathname + location.search;
    seen.panel = panel.pages;
  });
  return null;
}

function show(props: Partial<Parameters<typeof TasksView>[0]>) {
  const view = createElement("div", null, createElement(Spy), createElement(TasksView, { open: [], done: [], loadFailed: false, ...props }));
  const tree = createElement(MemoryRouter, { initialEntries: ["/tasks"] }, createElement(SidePanelProvider, null, createElement(Routes, null, createElement(Route, { path: "*", element: view }))));
  return render(tree as ReactNode as never);
}

describe("TasksView", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("lists open tasks as one list: NOW, DOING, TODO, LATER, each labelled with its page", () => {
    show({
      open: [
        task({ state: "TODO", line: { line: 0, text: "- TODO write", links: [] } }),
        task({ state: "LATER", line: { line: 1, text: "- LATER someday", links: [] } }),
        task({ state: "NOW", pageId: "journal-2026-11-03", pageTitle: "", line: { line: 0, text: "NOW ship", links: [] } }),
        task({ state: "DOING", line: { line: 2, text: "- DOING build", links: [] } }),
      ],
    });
    const sections = screen.getAllByRole("region");
    expect(sections.map((s) => within(s).getByRole("heading").textContent)).toEqual(["NOW · 1", "DOING · 1", "TODO · 1", "LATER · 1"]);
    expect(within(sections[0]).getByRole("link", { name: "Nov 3rd, 2026" })).toBeTruthy();
    expect(within(sections[2]).getByRole("link", { name: "Mistlog" })).toBeTruthy();
  });

  it("shows a task's links with their pages' current titles, inside the one task link", () => {
    pageTitles().prime("efgh5678", { title: "Holiday trip", kind: "page", slug: "holiday-trip", empty: false, missing: false });
    show({ open: [task({ line: { line: 0, text: "- TODO book [[Holiday]]", links: [{ from: 14, to: 21, pageId: "efgh5678" }] } })] });
    const link = screen.getByTitle("Open Mistlog at this task");
    expect(link.textContent).toBe("TODO book [[Holiday trip]]");
    expect(link.querySelectorAll("a")).toHaveLength(0);
    expect(link.querySelector(".task-kw.task-todo")?.textContent).toBe("TODO");
  });

  it("opens a task's page zoomed into its line, or the whole page when it has no block ID yet", () => {
    show({ open: [task({ blockId: BLOCK }), task({ pageId: "journal-2026-11-03", pageTitle: "", line: { line: 3, text: "TODO old", links: [] } })] });
    const [zoomed, old] = screen.getAllByTitle(/at this task/);
    expect(zoomed.getAttribute("href")).toBe(`/docs/abcd1234?block=${BLOCK}`);
    expect(old.getAttribute("href")).toBe("/journal/2026-11-03");
    fireEvent.click(zoomed);
    expect(seen.where).toBe(`/docs/abcd1234?block=${BLOCK}`);
  });

  it("Cmd/Ctrl+click opens the task's page in the side panel", () => {
    show({ open: [task({ blockId: BLOCK })] });
    fireEvent.click(screen.getByTitle("Open Mistlog at this task"), { metaKey: true });
    expect(seen.panel).toEqual(["abcd1234"]);
    expect(seen.where).toBe("/tasks");
  });

  it("starts a task's sub-bullets folded, and shows them under it, outside the task's own link, when unfolded", () => {
    const children = [
      { line: 1, text: "\t- book train", links: [] },
      { line: 2, text: "\t\t- check times", links: [] },
    ];
    show({ open: [task({ line: { line: 0, text: "- TODO plan trip", links: [], children } })] });
    expect(screen.queryByRole("list", { name: "Nested lines" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Unfold" }));
    const nested = screen.getByRole("list", { name: "Nested lines" });
    expect([...nested.querySelectorAll("li")].map((li) => li.textContent)).toEqual(["•book train", "•check times"]);
    expect(nested.closest("a")).toBeNull();
  });

  it("shows no nested list or fold arrow for a task with nothing under it", () => {
    show({ open: [task({})] });
    expect(screen.queryByRole("list", { name: "Nested lines" })).toBeNull();
    expect(screen.queryByRole("button", { name: /fold/i })).toBeNull();
  });

  it("unfolds and folds a task's sub-bullets with its arrow, one task at a time", () => {
    const children = [{ line: 1, text: "\t- book train", links: [] }];
    show({ open: [task({ line: { line: 0, text: "- TODO plan trip", links: [], children } }), task({ pageId: "eeee5555", line: { line: 0, text: "- TODO pack", links: [], children: [{ line: 1, text: "\t- bags", links: [] }] } })] });
    const [first] = screen.getAllByRole("button", { name: "Unfold" });
    expect(first.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(first.getAttribute("aria-label")).toBe("Fold");
    expect(screen.getByText("book train")).toBeTruthy();
    expect(screen.queryByText("bags")).toBeNull();
    // Unfolding never opens the task's page
    expect(seen.where).toBe("/tasks");
    fireEvent.click(first);
    expect(screen.queryByText("book train")).toBeNull();
  });

  it("keeps recently done tasks behind a Done toggle", () => {
    show({ done: [task({ state: "DONE", line: { line: 0, text: "- DONE shipped", links: [] } })] });
    const summary = screen.getByText("Done · 1");
    expect(summary.closest("details")?.open).toBe(false);
    expect(screen.getByTitle("Open Mistlog at this task").className).toContain("line-through");
  });

  it("says while the index is still catching up, and not otherwise", () => {
    show({ pending: 3 });
    expect(screen.getByRole("status").textContent).toContain("Updating the index: 3 pages to go");
    cleanup();
    show({ pending: 0 });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says when there are no open tasks, or when they couldn't load", () => {
    show({});
    expect(screen.getByText(/No open tasks/)).toBeTruthy();
    cleanup();
    show({ loadFailed: true });
    expect(screen.getByRole("alert").textContent).toContain("Couldn't load tasks");
    expect(screen.queryByText(/No open tasks/)).toBeNull();
  });
});
