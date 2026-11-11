// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import AppHeader from "~/components/AppHeader";
import { LeftSidebarProvider } from "~/lib/left-sidebar";
import { shareLink } from "~/components/ShareButton";
import { fetchOlderDays } from "~/components/JournalFeed";

describe("AppHeader", () => {
  afterEach(cleanup);

  // Today and New page moved to the left sidebar, which is on every screen (F8, decision 2026-10-24); see left-sidebar.test.tsx
  it("links home and offers the sidebar and phone menu buttons on every screen", () => {
    const { getByRole } = render(createElement(MemoryRouter, null, createElement(LeftSidebarProvider, null, createElement(AppHeader))));
    expect(getByRole("link", { name: "mistlogseqish" }).getAttribute("href")).toBe("/");
    expect(getByRole("button", { name: "Hide sidebar" })).toBeTruthy();
    expect(getByRole("button", { name: "Open menu" })).toBeTruthy();
    expect(getByRole("link", { name: "Tasks" }).getAttribute("href")).toBe("/tasks");
    expect(getByRole("link", { name: "Pages" }).getAttribute("href")).toBe("/pages");
  });

  it("places page-specific items in the header", () => {
    const { getByText } = render(
      createElement(MemoryRouter, null, createElement(AppHeader, null, createElement("span", null, "/page/notes"))),
    );
    expect(getByText("/page/notes")).toBeTruthy();
  });
});

describe("shareLink", () => {
  const here = { href: "https://mist.example/", origin: "https://mist.example" };

  it("shares the given path on this site", () => {
    expect(shareLink("/journal/2026-10-27", here)).toBe("https://mist.example/journal/2026-10-27");
  });

  it("shares the current address when no path is given", () => {
    expect(shareLink(undefined, { href: "https://mist.example/page/notes", origin: "https://mist.example" })).toBe(
      "https://mist.example/page/notes",
    );
  });
});

describe("fetchOlderDays", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks for a page of days before a date", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ days: ["2026-10-01"] }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await fetchOlderDays("2026-10-02")).toEqual(["2026-10-01"]);
    expect(fetchMock).toHaveBeenCalledWith("/api/journals?limit=7&before=2026-10-02");
  });

  it("asks for the newest days when there is no date yet", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ days: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await fetchOlderDays(null);
    expect(fetchMock).toHaveBeenCalledWith("/api/journals?limit=7");
  });

  it("throws when the server fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })));
    await expect(fetchOlderDays(null)).rejects.toThrow("Loading days failed: 503");
  });
});
