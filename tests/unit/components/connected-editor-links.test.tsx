// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, useEffect, type ReactNode } from "react";
import { render, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";

type OpenLink = (href: string, link: { pageId: string; side: boolean }) => void;
const { captured } = vi.hoisted(() => ({ captured: { openLink: null as OpenLink | null } }));
vi.mock("~/components/Editor", () => ({
  default: ({ onOpenLink }: { onOpenLink: OpenLink }) => {
    captured.openLink = onOpenLink;
    return null;
  },
}));
vi.mock("~/components/Preview", () => ({ default: () => null }));
vi.mock("~/lib/DocumentContext", () => ({ useDocument: () => ({ showPreview: false }) }));

import ConnectedEditor from "~/components/ConnectedEditor";
import { SidePanelProvider, useSidePanel } from "~/lib/side-panel";
import { pageTitles } from "~/lib/page-titles";

/** What the spy last saw, recorded after render. */
const seen: { panel: ReturnType<typeof useSidePanel> | null; path: string } = { panel: null, path: "" };
function Spy() {
  const panel = useSidePanel();
  const path = useLocation().pathname;
  useEffect(() => {
    seen.panel = panel;
    seen.path = path;
  });
  return null;
}

function renderWith(withPanel: boolean) {
  const inner = createElement(Routes, null, createElement(Route, { path: "*", element: createElement("div", null, createElement(Spy), createElement(ConnectedEditor)) }));
  const tree = createElement(MemoryRouter, { initialEntries: ["/"] }, withPanel ? createElement(SidePanelProvider, null, inner) : inner);
  return render(tree as ReactNode as never);
}

describe("ConnectedEditor opening links", () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it("opens Cmd/Ctrl+clicked links in the side panel, and others in the main view", () => {
    renderWith(true);
    act(() => captured.openLink!("/page/books", { pageId: "abcd1234", side: true }));
    expect(seen.panel!.pages).toEqual(["abcd1234"]);
    expect(seen.path).toBe("/");
    act(() => captured.openLink!("/page/books", { pageId: "abcd1234", side: false }));
    expect(seen.path).toBe("/page/books");
  });

  it("navigates instead when the page is missing", () => {
    renderWith(true);
    pageTitles().prime("gone1234", { title: "", kind: "page", slug: null, empty: false, missing: true });
    act(() => captured.openLink!("/docs/gone1234", { pageId: "gone1234", side: true }));
    expect(seen.panel!.pages).toEqual([]);
    expect(seen.path).toBe("/docs/gone1234");
  });

  it("navigates when there is no side panel", () => {
    renderWith(false);
    act(() => captured.openLink!("/page/books", { pageId: "abcd1234", side: true }));
    expect(seen.path).toBe("/page/books");
  });
});
