// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, renderHook, cleanup, fireEvent, act, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import AppShell from "~/components/AppShell";
import AppHeader from "~/components/AppHeader";
import {
  LeftSidebarProvider,
  MAX_RECENT_PAGES,
  RECENT_STORAGE_KEY,
  SIDEBAR_HEAD_SCRIPT,
  SIDEBAR_STORAGE_KEY,
  fetchIndexStatus,
  useLeftSidebar,
  useRecordVisit,
  withVisited,
  type IndexStatus,
} from "~/lib/left-sidebar";
import { useSidePanel } from "~/lib/side-panel";
import type { LinkTarget } from "~/lib/page-titles";

const TITLES: Record<string, LinkTarget> = {
  recent01: { title: "Reading list", kind: "page", slug: "reading-list", empty: false, missing: false },
  recent02: { title: "", kind: "page", slug: null, empty: true, missing: false },
  gone0001: { title: "", kind: "page", slug: null, empty: false, missing: true },
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-left-sidebar");
  fetchMock = vi.fn(async (url: string) => {
    if (url.startsWith("/api/index/status")) return Response.json({ pending: 0 });
    if (url.startsWith("/api/search")) return Response.json({ titles: [], text: [], pending: 0 });
    const ids = decodeURIComponent(url.split("ids=")[1] ?? "").split(",");
    return Response.json({ pages: Object.fromEntries(ids.filter((id) => TITLES[id]).map((id) => [id, TITLES[id]])) });
  });
  vi.stubGlobal("fetch", fetchMock);
  // A wide screen without touch, unless a test says otherwise
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("min-width"), addEventListener() {}, removeEventListener() {} }));
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  await new Promise((r) => setTimeout(r, 0));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Make the screen a phone's (narrower than the sidebar's breakpoint). */
function asPhone() {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: !query.includes("min-width"), addEventListener() {}, removeEventListener() {} }));
}

const noStatus = async (): Promise<IndexStatus> => ({ pending: 0 });

/** Where the app is, and what the side panel is doing, as text the tests can read. */
function Probe() {
  const { pathname } = useLocation();
  const panel = useSidePanel();
  return createElement("p", { "data-testid": "probe" }, `${pathname} panel:${panel.shown}`);
}

function Screen() {
  return createElement("div", null, createElement(AppHeader), createElement(Probe), createElement("input", { "aria-label": "Field" }));
}

function renderApp({ at = "/", fetchStatus = noStatus }: { at?: string; fetchStatus?: () => Promise<IndexStatus> } = {}) {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: [at] },
      createElement(AppShell, { fetchStatus }, createElement(Routes, null, createElement(Route, { path: "*", element: createElement(Screen) }))),
    ),
  );
}

const key = (k: string, target: EventTarget = document.body) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });
const sidebar = () => screen.queryByRole("navigation", { name: "Sidebar" });

describe("withVisited", () => {
  it("puts the page on top, without duplicates, keeping at most the cap", () => {
    expect(withVisited(["b", "a"], "a")).toEqual(["a", "b"]);
    const full = Array.from({ length: MAX_RECENT_PAGES }, (_, i) => `p${i}`);
    expect(withVisited(full, "new")).toEqual(["new", ...full.slice(0, MAX_RECENT_PAGES - 1)]);
  });
});

describe("the sidebar on a wide screen", () => {
  it("holds Journals, Today, All pages, Tasks, Search and New page", () => {
    renderApp({ at: "/tasks" });
    const nav = within(sidebar()!);
    expect(nav.getByRole("link", { name: "Journals" }).getAttribute("href")).toBe("/");
    expect(nav.getByRole("link", { name: "All pages" }).getAttribute("href")).toBe("/pages");
    expect(nav.getByRole("link", { name: "Tasks" }).getAttribute("href")).toBe("/tasks");
    expect(nav.getByRole("link", { name: "Tasks" }).getAttribute("aria-current")).toBe("page");
    expect(nav.getByRole("link", { name: "Journals" }).getAttribute("aria-current")).toBeNull();
    expect(nav.getByRole("button", { name: "Today" })).toBeTruthy();
    expect(nav.getByRole("button", { name: "New page" })).toBeTruthy();
    expect(nav.getByText("t l · t r toggle panels")).toBeTruthy();
    expect(nav.getByRole("button", { name: /Search/ }).querySelector("kbd")?.textContent).toBe("Ctrl K");
  });

  it("opens the search box from Search", async () => {
    renderApp();
    fireEvent.click(within(sidebar()!).getByRole("button", { name: /Search/ }));
    expect(await screen.findByRole("dialog", { name: "Search" })).toBeTruthy();
  });

  it("opens today's journal from Today", async () => {
    renderApp();
    fireEvent.click(within(sidebar()!).getByRole("button", { name: "Today" }));
    expect(screen.getByTestId("probe").textContent).toMatch(/^\/journal\/\d{4}-\d{2}-\d{2} /);
    await act(async () => {});
  });

  it("is shown and hidden with the header's button", () => {
    renderApp();
    const button = screen.getByRole("button", { name: "Hide sidebar" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-controls")).toBe(sidebar()!.id);
    fireEvent.click(button);
    expect(sidebar()).toBeNull();
    const show = screen.getByRole("button", { name: "Show sidebar" });
    expect(show.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(show);
    expect(sidebar()).toBeTruthy();
  });

  it("is shown and hidden with t l", () => {
    renderApp();
    key("t");
    key("l");
    expect(sidebar()).toBeNull();
    key("t");
    key("l");
    expect(sidebar()).toBeTruthy();
  });

  it("ignores t l while typing in a field or an editor, and l alone", () => {
    renderApp();
    const field = screen.getByRole("textbox", { name: "Field" });
    key("t", field);
    key("l", field);
    const editable = document.createElement("div");
    Object.defineProperty(editable, "isContentEditable", { value: true });
    document.body.appendChild(editable);
    key("t", editable);
    key("l", editable);
    key("l");
    expect(sidebar()).toBeTruthy();
    editable.remove();
  });

  it("leaves t r to the side panel", () => {
    renderApp();
    expect(screen.getByTestId("probe").textContent).toContain("panel:true");
    key("t");
    key("r");
    expect(screen.getByTestId("probe").textContent).toContain("panel:false");
    expect(sidebar()).toBeTruthy();
  });

  it("remembers being hidden in this browser", () => {
    const first = renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("closed");
    expect(document.documentElement.getAttribute("data-left-sidebar")).toBe("closed");
    first.unmount();
    renderApp();
    expect(sidebar()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe("open");
    // The head script's marker no longer hides it
    expect(document.documentElement.getAttribute("data-left-sidebar")).toBe("open");
  });

  it("still works when storage is blocked", () => {
    // Only the sidebar's own keys: the theme selector's storage is outside this feature
    const getItem = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, k: string) {
      if (k.startsWith("mistlog-")) throw new Error("blocked");
      return getItem.call(this, k);
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    renderApp();
    expect(sidebar()).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(sidebar()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show sidebar" }));
    expect(sidebar()).toBeTruthy();
  });

  it("has a head script that hides a closed sidebar before the app loads, and survives blocked storage", () => {
    const run = () => new Function(SIDEBAR_HEAD_SCRIPT)();
    run();
    expect(document.documentElement.getAttribute("data-left-sidebar")).toBeNull();
    localStorage.setItem(SIDEBAR_STORAGE_KEY, "closed");
    run();
    expect(document.documentElement.getAttribute("data-left-sidebar")).toBe("closed");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(run).not.toThrow();
  });
});

describe("Recent", () => {
  it("lists pages opened recently, by their current title, without deleted ones", async () => {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(["recent01", "gone0001", "journal-2026-11-10", "recent02"]));
    renderApp({ at: "/page/reading-list" });
    const recent = within(screen.getByRole("region", { name: "Recent" }));
    const reading = await recent.findByRole("link", { name: "Reading list" });
    expect(reading.getAttribute("href")).toBe("/page/reading-list");
    expect(reading.getAttribute("aria-current")).toBe("page");
    expect(recent.getByRole("link", { name: "Nov 10th, 2026" }).getAttribute("href")).toBe("/journal/2026-11-10");
    expect((await recent.findByRole("link", { name: "Untitled" })).getAttribute("href")).toBe("/docs/recent02");
    await waitFor(() => expect(recent.getAllByRole("link")).toHaveLength(3));
  });

  it("lists the page on screen even before the index knows it (a page just created)", async () => {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(["gone0001"]));
    renderApp({ at: "/docs/gone0001" });
    const recent = within(screen.getByRole("region", { name: "Recent" }));
    expect((await recent.findByRole("link", { name: "Untitled" })).getAttribute("aria-current")).toBe("page");
  });

  it("says where recent pages will appear when there are none", () => {
    renderApp();
    expect(screen.getByText("Pages you open appear here.")).toBeTruthy();
  });

  it("records each page opened, newest first, and remembers it", () => {
    function Visit({ id }: { id: string }) {
      useRecordVisit(id);
      return null;
    }
    const wrapper = ({ children }: { children: React.ReactNode }) => createElement(LeftSidebarProvider, null, children);
    const { result, rerender } = renderHook(({ id }) => {
      useRecordVisit(id);
      return useLeftSidebar();
    }, { wrapper, initialProps: { id: "aaaa1111" } });
    rerender({ id: "bbbb2222" });
    rerender({ id: "aaaa1111" });
    expect(result.current?.recent).toEqual(["aaaa1111", "bbbb2222"]);
    expect(JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY)!)).toEqual(["aaaa1111", "bbbb2222"]);
    // Outside the provider (tests, error pages) it does nothing
    expect(() => render(createElement(Visit, { id: "cccc3333" }))).not.toThrow();
  });

  it("ignores rubbish in storage and survives storage that throws on save", () => {
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(["ok000001", 7, null]));
    const wrapper = ({ children }: { children: React.ReactNode }) => createElement(LeftSidebarProvider, null, children);
    const { result } = renderHook(() => useLeftSidebar(), { wrapper });
    expect(result.current?.recent).toEqual(["ok000001"]);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    act(() => result.current?.visited("new00001"));
    expect(result.current?.recent).toEqual(["new00001", "ok000001"]);
  });

  it("starts empty when storage holds something unreadable", () => {
    localStorage.setItem(RECENT_STORAGE_KEY, "{not json");
    const wrapper = ({ children }: { children: React.ReactNode }) => createElement(LeftSidebarProvider, null, children);
    const { result } = renderHook(() => useLeftSidebar(), { wrapper });
    expect(result.current?.recent).toEqual([]);
  });
});

describe("the index status line", () => {
  it("shows while the index is catching up and asks again on moving, but not once it is done", async () => {
    let pending = 3;
    const fetchStatus = vi.fn(async () => ({ pending }));
    function Go() {
      const navigate = useNavigate();
      return createElement("button", { type: "button", onClick: () => navigate("/tasks") }, "Go");
    }
    function GoSomewhere() {
      const navigate = useNavigate();
      return createElement("button", { type: "button", onClick: () => navigate("/pages") }, "Go pages");
    }
    render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/"] },
        createElement(AppShell, { fetchStatus }, createElement(Go), createElement(GoSomewhere)),
      ),
    );
    expect(await screen.findByText("Updating the index · 3 pages to go")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("3 pages");
    pending = 1;
    fireEvent.click(screen.getByRole("button", { name: "Go pages" }));
    expect(await screen.findByText("Updating the index · 1 page to go")).toBeTruthy();
    expect(fetchStatus).toHaveBeenCalledTimes(2);
    pending = 0;
    fireEvent.click(screen.getByRole("button", { name: "Go" }));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    // Done: moving again asks nothing
    fireEvent.click(screen.getByRole("button", { name: "Go pages" }));
    await act(async () => {});
    expect(fetchStatus).toHaveBeenCalledTimes(3);
    // Coming back to the tab asks again
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fetchStatus).toHaveBeenCalledTimes(4);
  });

  it("shows nothing when the status can't be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchStatus = vi.fn(async (): Promise<IndexStatus> => {
      throw new Error("offline");
    });
    renderApp({ fetchStatus });
    await waitFor(() => expect(fetchStatus).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("reads GET /api/index/status by default", async () => {
    fetchMock.mockImplementationOnce(async () => Response.json({ pending: 2 }));
    expect(await fetchIndexStatus()).toEqual({ pending: 2 });
    expect(fetchMock).toHaveBeenCalledWith("/api/index/status");
    fetchMock.mockImplementationOnce(async () => new Response("", { status: 503 }));
    await expect(fetchIndexStatus()).rejects.toThrow("index status: 503");
  });
});

describe("the phone menu", () => {
  it("is closed until ☰ opens it, with the sidebar's contents and the focus inside", () => {
    asPhone();
    renderApp();
    // No sidebar column on a phone
    expect(sidebar()).toBeNull();
    const button = screen.getByRole("button", { name: "Open menu" });
    button.focus();
    fireEvent.click(button);
    const menu = screen.getByRole("dialog", { name: "Menu" });
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const nav = within(within(menu).getByRole("navigation", { name: "Sidebar" }));
    expect(nav.getByRole("link", { name: "Journals" })).toBeTruthy();
    expect(nav.getByRole("link", { name: "All pages" })).toBeTruthy();
    expect(nav.getByRole("link", { name: "Tasks" })).toBeTruthy();
    expect(nav.getByRole("button", { name: "New page" })).toBeTruthy();
    // The desktop hint has no place on a phone
    expect(nav.queryByText("t l · t r toggle panels")).toBeNull();
    expect(nav.getByRole("button", { name: "Search" }).querySelector("kbd")).toBeNull();
    expect(document.activeElement).toBe(within(menu).getByRole("button", { name: "Close menu" }));
  });

  it("keeps the focus inside while open", () => {
    asPhone();
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const menu = screen.getByRole("dialog", { name: "Menu" });
    const close = within(menu).getByRole("button", { name: "Close menu" });
    const last = within(menu).getByRole("button", { name: "New page" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    // Tab between the first and last is left to the browser
    const journals = within(menu).getByRole("link", { name: "Journals" });
    journals.focus();
    expect(fireEvent.keyDown(journals, { key: "Tab" })).toBe(true);
  });

  it("closes with Escape and gives the focus back to ☰", () => {
    asPhone();
    renderApp();
    const button = screen.getByRole("button", { name: "Open menu" });
    button.focus();
    fireEvent.click(button);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Menu" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
  });

  it("closes when tapping outside it, or with ✕", () => {
    asPhone();
    renderApp();
    const button = screen.getByRole("button", { name: "Open menu" });
    button.focus();
    fireEvent.click(button);
    fireEvent.click(screen.getByTestId("menu-scrim"));
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
  });

  it("closes on choosing a link, which opens", () => {
    asPhone();
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Menu" })).getByRole("link", { name: "Tasks" }));
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    expect(screen.getByTestId("probe").textContent).toContain("/tasks");
  });

  it("closes when Today moves to another screen", () => {
    asPhone();
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Menu" })).getByRole("button", { name: "Today" }));
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    expect(screen.getByTestId("probe").textContent).toMatch(/^\/journal\//);
  });

  it("hands over to the search box, which gives the focus back to ☰", async () => {
    asPhone();
    renderApp();
    const button = screen.getByRole("button", { name: "Open menu" });
    button.focus();
    fireEvent.click(button);
    fireEvent.click(within(screen.getByRole("dialog", { name: "Menu" })).getByRole("button", { name: /Search/ }));
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    const box = await screen.findByRole("dialog", { name: "Search" });
    fireEvent.keyDown(within(box).getByRole("combobox"), { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it("opens and closes with t l on a phone", () => {
    asPhone();
    renderApp();
    key("t");
    key("l");
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeTruthy();
    key("t");
    key("l");
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
  });

  it("closes if the screen widens to the sidebar's width", () => {
    let wide = false;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return query.includes("min-width") ? wide : false;
      },
      addEventListener: (_: string, l: () => void) => listeners.add(l),
      removeEventListener: (_: string, l: () => void) => listeners.delete(l),
    }));
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeTruthy();
    wide = true;
    act(() => listeners.forEach((l) => l()));
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
    expect(sidebar()).toBeTruthy();
  });
});

describe("outside the provider", () => {
  it("the header has no sidebar buttons", () => {
    render(createElement(MemoryRouter, null, createElement(AppHeader)));
    expect(screen.queryByRole("button", { name: "Open menu" })).toBeNull();
    expect(screen.queryByRole("button", { name: /sidebar/ })).toBeNull();
  });
});

describe("the header's Search button", () => {
  it("is left to the sidebar on a wide screen while it shows", () => {
    render(createElement(MemoryRouter, null, createElement(AppShell, { fetchStatus: noStatus }, createElement(AppHeader))));
    const headerSearch = within(screen.getByRole("banner")).getByRole("button", { name: "Search" });
    expect(headerSearch.parentElement?.className).toContain("md:hidden");
    fireEvent.click(screen.getByRole("button", { name: "Hide sidebar" }));
    expect(within(screen.getByRole("banner")).getByRole("button", { name: "Search" }).parentElement?.className).not.toContain("md:hidden");
  });
});
