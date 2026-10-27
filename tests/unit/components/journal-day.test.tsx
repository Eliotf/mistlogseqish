// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import * as Y from "yjs";
import { installIntersectionObserver } from "../../helpers/intersection";

const { mockUseYjsEditor, mockToggleMode, mockMode, shareProps } = vi.hoisted(() => ({
  mockUseYjsEditor: vi.fn(),
  mockToggleMode: vi.fn(),
  mockMode: { value: "edit" as "edit" | "suggest" },
  shareProps: [] as Array<{ url?: string }>,
}));

vi.mock("~/lib/useYjsEditor", () => ({ useYjsEditor: mockUseYjsEditor }));
vi.mock("~/lib/DocumentContext", () => ({
  DocumentProvider: ({ children }: { children: ReactNode }) => children,
  useDocument: () => ({ mode: mockMode.value, toggleMode: mockToggleMode }),
}));
vi.mock("~/components/ConnectedEditor", () => ({ default: () => createElement("div", { "data-testid": "editor" }) }));
vi.mock("~/components/ConnectionStatus", () => ({ default: () => createElement("span", null, "Connected") }));
vi.mock("~/components/ShareButton", () => ({
  default: (props: { url?: string }) => {
    shareProps.push(props);
    return createElement("button", null, "Share");
  },
}));

import JournalDay, { CONNECT_MARGIN } from "~/components/JournalDay";

function renderDay(props: { date: string; exists: boolean; eager: boolean }) {
  return render(createElement(MemoryRouter, null, createElement(JournalDay, props)));
}

describe("JournalDay", () => {
  let io: ReturnType<typeof installIntersectionObserver>;
  beforeEach(() => {
    io = installIntersectionObserver();
    mockUseYjsEditor.mockReset().mockImplementation(() => ({ doc: new Y.Doc(), synced: true }));
    mockToggleMode.mockReset();
    mockMode.value = "edit";
    shareProps.length = 0;
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a light placeholder and does not connect until scrolled near", () => {
    const { getByRole, queryByTestId } = renderDay({ date: "2026-10-20", exists: true, eager: false });
    expect(getByRole("heading", { level: 2 }).textContent).toBe("Oct 20th, 2026");
    expect(queryByTestId("editor")).toBeNull();
    expect(mockUseYjsEditor).not.toHaveBeenCalled();
    expect(io.margins()).toEqual([CONNECT_MARGIN]);
  });

  it("connects when it comes near the screen, then stays connected", () => {
    const { getByRole, getByTestId } = renderDay({ date: "2026-10-20", exists: true, eager: false });
    act(() => io.scrollNear(getByRole("article")));
    expect(getByTestId("editor")).toBeTruthy();
    expect(mockUseYjsEditor).toHaveBeenCalledWith("journal-2026-10-20");
    expect(io.count()).toBe(0);
  });

  it("connects straight away when eager", () => {
    const { getByTestId } = renderDay({ date: "2026-10-27", exists: false, eager: true });
    expect(getByTestId("editor")).toBeTruthy();
    expect(io.count()).toBe(0);
  });

  it("links the date to the day's own page", () => {
    const { getByRole } = renderDay({ date: "2026-10-20", exists: true, eager: true });
    expect(getByRole("link", { name: "Oct 20th, 2026" }).getAttribute("href")).toBe("/journal/2026-10-20");
    expect(getByRole("link", { name: "Open day" }).getAttribute("href")).toBe("/journal/2026-10-20");
  });

  it("does not change the browser tab title", () => {
    document.title = "Journals · mistlogseqish";
    renderDay({ date: "2026-10-20", exists: true, eager: true });
    expect(document.title).toBe("Journals · mistlogseqish");
  });

  it("waits for the first sync before showing the not-saved note", () => {
    mockUseYjsEditor.mockImplementation(() => ({ doc: new Y.Doc(), synced: false }));
    const { queryByText } = renderDay({ date: "2026-10-20", exists: false, eager: true });
    expect(queryByText(/Not saved yet/)).toBeNull();
  });

  it("shares the day's own address", () => {
    renderDay({ date: "2026-10-20", exists: true, eager: true });
    expect(shareProps.at(-1)).toEqual({ url: "/journal/2026-10-20" });
  });

  it("switches between edit and suggest, only when changing", () => {
    const { getByRole } = renderDay({ date: "2026-10-20", exists: true, eager: true });
    expect(getByRole("button", { name: "Edit" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(getByRole("button", { name: "Edit" }));
    expect(mockToggleMode).not.toHaveBeenCalled();
    fireEvent.click(getByRole("button", { name: "Suggest" }));
    expect(mockToggleMode).toHaveBeenCalledTimes(1);
  });
});
