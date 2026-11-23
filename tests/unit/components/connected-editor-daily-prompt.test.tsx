// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const { state, ask } = vi.hoisted(() => ({ state: { docId: "" }, ask: vi.fn() }));
vi.mock("~/components/Editor", () => ({ default: () => null }));
vi.mock("~/components/Preview", () => ({ default: () => null }));
vi.mock("~/lib/DocumentContext", () => ({ useDocument: () => ({ showPreview: false, docId: state.docId }) }));
vi.mock("~/lib/daily-prompt", async (importOriginal) => ({ ...(await importOriginal<typeof import("~/lib/daily-prompt")>()), askForDailyPrompt: ask }));

import ConnectedEditor from "~/components/ConnectedEditor";

function show(docId: string) {
  state.docId = docId;
  return render(createElement(MemoryRouter, null, createElement(ConnectedEditor)) as ReactNode as never);
}

describe("ConnectedEditor and the daily line", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 23, 9, 0)); // the 23rd, in this browser's time zone
    ask.mockReset().mockResolvedValue(true);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("asks for it on today's journal and later days", () => {
    show("journal-2026-11-23");
    show("journal-2026-11-30");
    expect(ask.mock.calls.map((c) => c[0])).toEqual(["2026-11-23", "2026-11-30"]);
  });

  it("leaves past days and pages alone", () => {
    show("journal-2026-11-22");
    show("abcd1234");
    expect(ask).not.toHaveBeenCalled();
  });
});
