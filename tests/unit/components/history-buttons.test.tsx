// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, Link, useLocation } from "react-router";
import HistoryButtons from "~/components/HistoryButtons";
import { canGoBack, isStandaloneApp } from "~/lib/standalone";

function fakeWindow({ standalone, displayMode }: { standalone?: boolean; displayMode?: boolean }): Window {
  return {
    navigator: { standalone },
    matchMedia: (query: string) => ({ matches: query === "(display-mode: standalone)" && displayMode === true }),
  } as unknown as Window;
}

function Screen() {
  const location = useLocation();
  return createElement(
    "div",
    null,
    createElement(HistoryButtons),
    createElement("p", null, `at ${location.pathname}`),
    createElement(Link, { to: "/two" }, "go"),
  );
}

function renderButtons() {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: ["/one"] },
      createElement(Routes, null, createElement(Route, { path: "*", element: createElement(Screen) })),
    ),
  );
}

function standaloneDisplay(matches: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: matches && query === "(display-mode: standalone)" }));
}

describe("isStandaloneApp", () => {
  it("is true for an iPhone Home Screen app", () => {
    expect(isStandaloneApp(fakeWindow({ standalone: true }))).toBe(true);
  });

  it("is true for an installed app elsewhere", () => {
    expect(isStandaloneApp(fakeWindow({ displayMode: true }))).toBe(true);
  });

  it("is false in a browser tab", () => {
    expect(isStandaloneApp(fakeWindow({ standalone: false, displayMode: false }))).toBe(false);
  });
});

describe("canGoBack", () => {
  it("is false on the first page of the app's history", () => {
    expect(canGoBack({ idx: 0 })).toBe(false);
  });

  it("is true after moving", () => {
    expect(canGoBack({ idx: 2 })).toBe(true);
  });

  it("assumes there is a page when it can't tell", () => {
    expect(canGoBack(null)).toBe(true);
  });
});

describe("HistoryButtons", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows nothing in a browser tab, which has its own buttons", () => {
    standaloneDisplay(false);
    const { queryByRole } = renderButtons();
    expect(queryByRole("button", { name: "Back" })).toBeNull();
    expect(queryByRole("button", { name: "Forward" })).toBeNull();
  });

  it("goes back and forward when run from the Home Screen", () => {
    standaloneDisplay(true);
    const { getByRole, getByText } = renderButtons();
    fireEvent.click(getByText("go"));
    expect(getByText("at /two")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "Back" }));
    expect(getByText("at /one")).toBeTruthy();
    fireEvent.click(getByRole("button", { name: "Forward" }));
    expect(getByText("at /two")).toBeTruthy();
  });
});
