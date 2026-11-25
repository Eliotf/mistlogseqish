// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useEffect, type ReactNode } from "react";
import { render, cleanup, fireEvent, screen, within, act } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, Outlet, useLocation } from "react-router";
import SidePanel from "~/components/SidePanel";
import TasksLink from "~/components/TasksLink";
import { SidePanelProvider, TASKS_PANEL_ID, useSidePanel } from "~/lib/side-panel";
import type { TaskItem } from "~/lib/tasks";

// A page opened beside the list is a live editor, which would try to reach a server
vi.mock("~/lib/useYjsEditor", () => ({ useYjsEditor: () => ({}) }));
vi.mock("~/lib/DocumentContext", () => ({ DocumentProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("~/components/ConnectedEditor", () => ({ default: () => null }));

const task = (over: Partial<TaskItem>): TaskItem => ({
  pageId: "abcd1234",
  pageTitle: "Trip",
  pageKind: "page",
  updatedAt: 1,
  state: "TODO",
  priority: null,
  blockId: null,
  line: { line: 0, text: "- TODO book train", links: [] },
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

const loader = vi.fn();

function show() {
  const shell = createElement(
    "div",
    null,
    createElement(TasksLink, { className: "" }, "Tasks"),
    createElement(Outlet),
    createElement(SidePanel),
    createElement(Spy),
  );
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: shell,
        children: [
          { index: true, element: createElement("p", null, "Journals") },
          { path: "tasks", loader, element: createElement("p", null, "Tasks screen") },
          { path: "docs/:id", element: createElement("p", null, "A page") },
        ],
      },
    ],
    { initialEntries: ["/"] },
  );
  return render(createElement(SidePanelProvider, null, createElement(RouterProvider, { router })) as ReactNode as never);
}

/** The panel's link to Tasks, as opposed to the shell's. */
const panelTasks = () => within(screen.getByRole("region", { name: "Tasks" }));

describe("Tasks in the side panel", () => {
  beforeEach(() => {
    localStorage.clear();
    // Task links ask for page titles; jsdom has no server to ask
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ pages: {} })));
    loader.mockReset().mockReturnValue({ open: [task({})], done: [], pending: 0, loadFailed: false });
  });
  afterEach(async () => {
    cleanup();
    await new Promise((r) => setTimeout(r, 0));
    vi.unstubAllGlobals();
  });

  it("Cmd/Ctrl+click on Tasks puts the list in the side panel and stays where you are", async () => {
    show();
    fireEvent.click(screen.getByRole("link", { name: "Tasks" }), { metaKey: true });
    expect(await panelTasks().findByText(/book train/)).toBeTruthy();
    expect(seen.where).toBe("/");
    expect(seen.panel).toEqual([TASKS_PANEL_ID]);
    expect(loader).toHaveBeenCalledTimes(1);
    // The panel's heading names it, so the view's own heading isn't repeated
    expect(panelTasks().queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("Ctrl+click does the same", async () => {
    show();
    fireEvent.click(screen.getByRole("link", { name: "Tasks" }), { ctrlKey: true });
    expect(await panelTasks().findByText(/book train/)).toBeTruthy();
    expect(seen.where).toBe("/");
  });

  it("a plain click still goes to the Tasks screen", async () => {
    show();
    fireEvent.click(screen.getByRole("link", { name: "Tasks" }));
    expect(await screen.findByText("Tasks screen")).toBeTruthy();
    expect(seen.panel).toEqual([]);
  });

  it("a task in the panel opens its page in the main view, or with Cmd/Ctrl+click beside the list", async () => {
    show();
    fireEvent.click(screen.getByRole("link", { name: "Tasks" }), { metaKey: true });
    fireEvent.click(await screen.findByTitle("Open Trip at this task"), { metaKey: true });
    expect(seen.panel).toEqual(["abcd1234", TASKS_PANEL_ID]);
    fireEvent.click(screen.getByTitle("Open Trip at this task"));
    expect(await screen.findByText("A page")).toBeTruthy();
    expect(seen.where).toBe("/docs/abcd1234");
  });

  it("refreshes with ↻ and when the tab is shown again, and closes with ✕", async () => {
    show();
    fireEvent.click(screen.getByRole("link", { name: "Tasks" }), { metaKey: true });
    await panelTasks().findByText(/book train/);
    loader.mockReturnValue({ open: [task({ line: { line: 0, text: "- TODO pack bags", links: [] } })], done: [], pending: 0, loadFailed: false });
    fireEvent.click(screen.getByRole("button", { name: "Refresh tasks" }));
    expect(await panelTasks().findByText(/pack bags/)).toBeTruthy();
    expect(loader).toHaveBeenCalledTimes(2);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(loader).toHaveBeenCalledTimes(3);

    fireEvent.click(screen.getByRole("button", { name: "Close Tasks" }));
    expect(seen.panel).toEqual([]);
    expect(screen.queryByRole("region", { name: "Tasks" })).toBeNull();
  });

  it("says so when the tasks can't be loaded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    loader.mockReturnValue({ open: [], done: [], pending: 0, loadFailed: true });
    show();
    fireEvent.click(screen.getByRole("link", { name: "Tasks" }), { metaKey: true });
    expect(await panelTasks().findByRole("alert")).toBeTruthy();
    vi.restoreAllMocks();
  });
});
