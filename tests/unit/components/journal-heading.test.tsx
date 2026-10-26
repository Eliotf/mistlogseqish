// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { render, act, cleanup, fireEvent } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import * as Y from "yjs";
import JournalHeading from "~/components/JournalHeading";
import TodayButton from "~/components/TodayButton";

function addText(doc: Y.Doc, text: string) {
  const para = new Y.XmlElement("paragraph");
  para.insert(0, [new Y.XmlText(text)]);
  doc.getXmlFragment("default").insert(0, [para]);
}

describe("JournalHeading", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the date title and weekday, not editable", () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 15, 12, 0), toFake: ["Date"] });
    const { getByRole, getByText, queryByRole } = render(
      createElement(JournalHeading, { doc: new Y.Doc(), pageId: "journal-2026-10-26", exists: true }),
    );
    expect(getByRole("heading", { level: 1 }).textContent).toBe("Oct 26th, 2026");
    expect(getByText("Monday")).toBeTruthy();
    expect(queryByRole("textbox")).toBeNull();
    expect(document.title).toBe("Oct 26th, 2026 · mistlogseqish");
  });

  it("says Today when the date is today in the browser's time zone", () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 26, 23, 30), toFake: ["Date"] });
    const { getByText } = render(createElement(JournalHeading, { doc: new Y.Doc(), pageId: "journal-2026-10-26", exists: true }));
    expect(getByText("Today")).toBeTruthy();
  });

  it("shows the not-saved note until the journal has text", () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 26, 9, 0), toFake: ["Date"] });
    const doc = new Y.Doc();
    const { queryByText } = render(createElement(JournalHeading, { doc, pageId: "journal-2026-10-26", exists: false }));
    expect(queryByText(/Not saved yet\. Today's journal is created when you start typing\./)).not.toBeNull();
    act(() => addText(doc, "   "));
    expect(queryByText(/Not saved yet/)).not.toBeNull();
    act(() => addText(doc, "first words"));
    expect(queryByText(/Not saved yet/)).toBeNull();
  });

  it("words the note for other days", () => {
    vi.useFakeTimers({ now: new Date(2026, 9, 26, 9, 0), toFake: ["Date"] });
    const { queryByText } = render(createElement(JournalHeading, { doc: new Y.Doc(), pageId: "journal-2026-10-20", exists: false }));
    expect(queryByText(/This day's journal is created when you start typing/)).not.toBeNull();
  });

  it("shows no note for a journal that already exists", () => {
    const { queryByText } = render(createElement(JournalHeading, { doc: new Y.Doc(), pageId: "journal-2026-10-20", exists: true }));
    expect(queryByText(/Not saved yet/)).toBeNull();
  });
});

describe("TodayButton", () => {
  afterEach(cleanup);

  function Opened() {
    return createElement("p", null, useLocation().pathname);
  }

  function renderAt(now: Date) {
    return render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/start"] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: "/start", element: createElement(TodayButton, { now: () => now }) }),
          createElement(Route, { path: "/journal/:date", element: createElement(Opened) }),
        ),
      ),
    );
  }

  it("opens today's journal using the browser's local date", async () => {
    const { getByRole, findByText } = renderAt(new Date(2026, 9, 26, 10, 0));
    fireEvent.click(getByRole("button", { name: "Today" }));
    expect(await findByText("/journal/2026-10-26")).toBeTruthy();
  });

  it("uses the local date late in the evening, not UTC", async () => {
    // 23:45 local on 26 Oct; in time zones ahead of UTC this is still the 26th locally
    const { getByRole, findByText } = renderAt(new Date(2026, 9, 26, 23, 45));
    fireEvent.click(getByRole("button", { name: "Today" }));
    expect(await findByText("/journal/2026-10-26")).toBeTruthy();
  });

  it("uses the real clock by default", async () => {
    vi.useFakeTimers({ now: new Date(2026, 11, 31, 18, 0), toFake: ["Date"] });
    const { getByRole, findByText } = render(
      createElement(
        MemoryRouter,
        { initialEntries: ["/start"] },
        createElement(
          Routes,
          null,
          createElement(Route, { path: "/start", element: createElement(TodayButton) }),
          createElement(Route, { path: "/journal/:date", element: createElement(Opened) }),
        ),
      ),
    );
    fireEvent.click(getByRole("button", { name: "Today" }));
    expect(await findByText("/journal/2026-12-31")).toBeTruthy();
    vi.useRealTimers();
  });

  it("rolls over at local midnight", async () => {
    const { getByRole, findByText } = renderAt(new Date(2026, 9, 27, 0, 5));
    fireEvent.click(getByRole("button", { name: "Today" }));
    expect(await findByText("/journal/2026-10-27")).toBeTruthy();
  });
});
