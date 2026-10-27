// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { installIntersectionObserver } from "../../helpers/intersection";

vi.mock("~/components/JournalDay", () => ({
  default: ({ date, exists, eager }: { date: string; exists: boolean; eager: boolean }) =>
    createElement("article", { "data-testid": "day", "data-date": date, "data-exists": String(exists), "data-eager": String(eager) }),
}));

import JournalFeed, { FEED_PAGE_SIZE } from "~/components/JournalFeed";

const days = (container: HTMLElement) =>
  [...container.querySelectorAll("[data-testid=day]")].map((d) => ({
    date: d.getAttribute("data-date"),
    exists: d.getAttribute("data-exists") === "true",
    eager: d.getAttribute("data-eager") === "true",
  }));

function range(from: number, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `2026-10-${String(from - i).padStart(2, "0")}`);
}

describe("JournalFeed", () => {
  let io: ReturnType<typeof installIntersectionObserver>;
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date(2026, 9, 27, 9, 0), toFake: ["Date"] });
    io = installIntersectionObserver();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("puts today first, then earlier days newest first, hiding future days", () => {
    const { container } = render(
      createElement(JournalFeed, { initialDays: ["2026-11-02", "2026-10-25", "2026-10-20"], loadFailed: false }),
    );
    expect(days(container).map((d) => d.date)).toEqual(["2026-10-27", "2026-10-25", "2026-10-20"]);
  });

  it("shows today even when nobody has written in it, marked as not existing", () => {
    const { container } = render(createElement(JournalFeed, { initialDays: ["2026-10-20"], loadFailed: false }));
    expect(days(container)[0]).toMatchObject({ date: "2026-10-27", exists: false });
  });

  it("marks today as existing when it has notes, without listing it twice", () => {
    const { container } = render(createElement(JournalFeed, { initialDays: ["2026-10-27", "2026-10-26"], loadFailed: false }));
    expect(days(container)).toEqual([
      { date: "2026-10-27", exists: true, eager: true },
      { date: "2026-10-26", exists: true, eager: true },
    ]);
  });

  it("connects the first three days straight away and the rest when scrolled near", () => {
    const { container } = render(createElement(JournalFeed, { initialDays: range(26, 5), loadFailed: false }));
    expect(days(container).map((d) => d.eager)).toEqual([true, true, true, false, false, false]);
  });

  it("loads older days when the bottom comes near the screen", async () => {
    const fetchOlder = vi.fn(async () => range(19, FEED_PAGE_SIZE));
    const { container, getByText } = render(
      createElement(JournalFeed, { initialDays: range(26, FEED_PAGE_SIZE), loadFailed: false, fetchOlder }),
    );
    await act(async () => io.scrollNear(getByText("Show older days").parentElement!));
    expect(fetchOlder).toHaveBeenCalledWith("2026-10-20");
    expect(days(container)).toHaveLength(1 + 2 * FEED_PAGE_SIZE);
  });

  it("loads older days from the button, for keyboard users", async () => {
    const fetchOlder = vi.fn(async () => ["2026-10-01"]);
    const { container, getByRole, findByText } = render(
      createElement(JournalFeed, { initialDays: range(26, FEED_PAGE_SIZE), loadFailed: false, fetchOlder }),
    );
    fireEvent.click(getByRole("button", { name: "Show older days" }));
    expect(await findByText("No earlier days.")).toBeTruthy();
    expect(days(container).at(-1)?.date).toBe("2026-10-01");
  });

  it("says there are no earlier days when the first load was short", () => {
    const { getByText, queryByRole } = render(createElement(JournalFeed, { initialDays: range(26, 3), loadFailed: false }));
    expect(getByText("No earlier days.")).toBeTruthy();
    expect(queryByRole("button", { name: "Show older days" })).toBeNull();
  });

  it("does not add a day twice", async () => {
    const fetchOlder = vi.fn(async () => ["2026-10-20", "2026-10-19"]);
    const { container, getByRole } = render(
      createElement(JournalFeed, { initialDays: range(26, FEED_PAGE_SIZE), loadFailed: false, fetchOlder }),
    );
    fireEvent.click(getByRole("button", { name: "Show older days" }));
    await waitFor(() => expect(days(container).at(-1)?.date).toBe("2026-10-19"));
    expect(days(container).filter((d) => d.date === "2026-10-20")).toHaveLength(1);
  });

  it("offers to try again when loading older days fails", async () => {
    const fetchOlder = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(["2026-10-01"]);
    const { getByRole, findByRole, findByText } = render(
      createElement(JournalFeed, { initialDays: range(26, FEED_PAGE_SIZE), loadFailed: false, fetchOlder }),
    );
    fireEvent.click(getByRole("button", { name: "Show older days" }));
    expect((await findByRole("alert")).textContent).toContain("Couldn't load earlier days.");
    fireEvent.click(getByRole("button", { name: "Try again" }));
    expect(await findByText("No earlier days.")).toBeTruthy();
  });

  it("still shows today when the server could not reach the index, and can retry", async () => {
    const fetchOlder = vi.fn(async () => ["2026-10-25"]);
    const { container, getByRole, findByText } = render(
      createElement(JournalFeed, { initialDays: [], loadFailed: true, fetchOlder }),
    );
    expect(days(container).map((d) => d.date)).toEqual(["2026-10-27"]);
    expect(getByRole("alert").textContent).toContain("Couldn't load earlier days.");
    fireEvent.click(getByRole("button", { name: "Try again" }));
    expect(await findByText("No earlier days.")).toBeTruthy();
    expect(fetchOlder).toHaveBeenCalledWith(null);
    expect(days(container).map((d) => d.date)).toEqual(["2026-10-27", "2026-10-25"]);
  });

  it("has one top-level heading for the whole feed", () => {
    const { getAllByRole } = render(createElement(JournalFeed, { initialDays: [], loadFailed: false }));
    expect(getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Journals"]);
  });
});
