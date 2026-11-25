// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import SidePanel, { SidePanelButton, SIDE_PANEL_ID } from "~/components/SidePanel";
import AppHeader from "~/components/AppHeader";
import { SidePanelProvider, useSidePanel } from "~/lib/side-panel";
import { RIGHT_PANEL_SIZE } from "~/lib/panel-width";

// A page in the panel is a live editor, which would try to reach a server
vi.mock("~/lib/useYjsEditor", () => ({ useYjsEditor: () => ({}) }));
vi.mock("~/lib/DocumentContext", () => ({ DocumentProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("~/components/ConnectedEditor", () => ({ default: () => null }));

/** Opens a page in the panel, as Cmd/Ctrl+click on a link would. */
function OpenPage() {
  const panel = useSidePanel();
  return createElement("button", { type: "button", onClick: () => panel.open("abcd1234") }, "Open a page");
}

function show(...children: ReactNode[]) {
  return render(createElement(SidePanelProvider, null, createElement(MemoryRouter, null, ...children)));
}

const panel = () => screen.queryByRole("complementary", { name: "Side panel" });

describe("the side panel button", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ pages: {} })));
  });
  afterEach(async () => {
    cleanup();
    await new Promise((r) => setTimeout(r, 0));
    vi.unstubAllGlobals();
  });

  it("is in the app header, next to the theme", () => {
    show(createElement(AppHeader));
    const button = screen.getByRole("button", { name: "Show side panel" });
    expect(button.previousElementSibling?.getAttribute("aria-label")).toBe("Theme");
  });

  it("shows an empty panel that says how to fill it, and hides it again", () => {
    show(createElement(SidePanelButton), createElement(SidePanel));
    expect(panel()).toBeNull();
    const button = screen.getByRole("button", { name: "Show side panel" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(button.getAttribute("aria-controls")).toBe(SIDE_PANEL_ID);
    fireEvent.click(button);
    expect(panel()?.id).toBe(SIDE_PANEL_ID);
    expect(screen.getByText(/Nothing here yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Hide side panel" }));
    expect(panel()).toBeNull();
    expect(screen.getByRole("button", { name: "Show side panel" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("hides and shows a panel with pages in it, keeping them", () => {
    show(createElement(OpenPage), createElement(SidePanelButton), createElement(SidePanel));
    fireEvent.click(screen.getByRole("button", { name: "Open a page" }));
    expect(screen.getByRole("button", { name: "Hide side panel" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Hide side panel" }));
    expect(panel()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show side panel" }));
    expect(screen.queryByText(/Nothing here yet/)).toBeNull();
    expect(screen.getByRole("region", { name: "…" })).toBeTruthy();
  });

  it("closing the last page hides the panel", () => {
    show(createElement(OpenPage), createElement(SidePanelButton), createElement(SidePanel));
    fireEvent.click(screen.getByRole("button", { name: "Open a page" }));
    fireEvent.click(screen.getByRole("button", { name: "Close …" }));
    expect(panel()).toBeNull();
    expect(screen.getByRole("button", { name: "Show side panel" })).toBeTruthy();
  });

  it("has an edge to resize it", () => {
    show(createElement(SidePanelButton), createElement(SidePanel));
    fireEvent.click(screen.getByRole("button", { name: "Show side panel" }));
    const handle = screen.getByRole("separator", { name: "Resize the side panel" });
    expect(handle.getAttribute("aria-controls")).toBe(SIDE_PANEL_ID);
    fireEvent.keyDown(handle, { key: "Home" });
    expect(localStorage.getItem(RIGHT_PANEL_SIZE.storageKey)).toBe(String(RIGHT_PANEL_SIZE.min));
  });

  it("shows nothing outside the provider", () => {
    render(createElement(SidePanelButton));
    expect(screen.queryByRole("button", { name: /side panel/ })).toBeNull();
  });
});
