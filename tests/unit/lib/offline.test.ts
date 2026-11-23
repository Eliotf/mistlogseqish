// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { render, cleanup, act } from "@testing-library/react";
import * as Y from "yjs";
import { isOfflineError, keepRecentDays, savedJournalDays } from "~/lib/offline";
import { base64ToBytes, bytesToBase64, KEEP_DAYS_EVERY_MS, MAX_KEPT_DAYS } from "~/lib/offline-days";
import { cacheName } from "~/lib/local-cache";
import OfflineNotice from "~/components/OfflineNotice";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const stateOf = (text: string) => {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  return bytesToBase64(Y.encodeStateAsUpdate(doc));
};

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return { getItem: (k: string) => items.get(k) ?? null, setItem: (k: string, v: string) => void items.set(k, v), items };
}

describe("base64 for Yjs updates", () => {
  it("round-trips any bytes, including a long page", () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => (i * 31) % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });
});

describe("keepRecentDays", () => {
  const ok = (states: Record<string, string | null>) => vi.fn(async () => Response.json({ states }));

  it("asks once for the recent days and saves those with notes", async () => {
    const fetch = ok({ "2026-11-12": stateOf("today"), "2026-11-11": null });
    const saved: Array<[string, string]> = [];
    const save = async (date: string, update: Uint8Array) => {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, update);
      saved.push([date, doc.getText("t").toString()]);
    };
    const storage = memoryStorage();
    expect(await keepRecentDays(["2026-11-12", "2026-11-11"], { fetch, now: 10, storage, save })).toBe(1);
    expect(saved).toEqual([["2026-11-12", "today"]]);
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ dates: ["2026-11-12", "2026-11-11"] });
    expect(storage.items.get("mistlog:kept-days-at")).toBe("10");
  });

  it("asks for at most MAX_KEPT_DAYS, at most once an hour, and never offline", async () => {
    const days = Array.from({ length: MAX_KEPT_DAYS + 4 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    const fetch = ok({});
    const storage = memoryStorage();
    await keepRecentDays(days, { fetch, now: 1000, storage, save: async () => {} });
    expect((JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as { dates: string[] }).dates).toHaveLength(MAX_KEPT_DAYS);
    await keepRecentDays(days, { fetch, now: 1000 + KEEP_DAYS_EVERY_MS - 1, storage, save: async () => {} });
    expect(fetch).toHaveBeenCalledTimes(1);
    await keepRecentDays(days, { fetch, now: 1000 + KEEP_DAYS_EVERY_MS, storage, save: async () => {} });
    expect(fetch).toHaveBeenCalledTimes(2);

    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(await keepRecentDays(days, { fetch, now: 1e12, storage, save: async () => {} })).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("saves nothing, and tries again next time, when the server refuses", async () => {
    const storage = memoryStorage();
    const fetch = vi.fn(async () => new Response("down", { status: 503 }));
    expect(await keepRecentDays(["2026-11-12"], { fetch, now: 5, storage, save: async () => {} })).toBe(0);
    expect(storage.items.size).toBe(0);
  });
});

describe("savedJournalDays", () => {
  it("lists the journal days kept in this browser, newest first, from their copies' names", async () => {
    const names = [cacheName("journal-2026-11-10"), cacheName("journal-2026-11-12"), cacheName("abcd1234"), "mistlog:v1:journal-2026-11-11", "other", cacheName("journal-2026-02-30")];
    vi.stubGlobal("indexedDB", { databases: async () => names.map((name) => ({ name })) });
    expect(await savedJournalDays()).toEqual(["2026-11-12", "2026-11-10"]);
  });

  it("is empty where the browser can't list them", async () => {
    vi.stubGlobal("indexedDB", {});
    expect(await savedJournalDays()).toEqual([]);
    vi.stubGlobal("indexedDB", { databases: async () => Promise.reject(new Error("blocked")) });
    expect(await savedJournalDays()).toEqual([]);
  });
});

describe("isOfflineError", () => {
  it("tells a failed connection from an answer the server gave", () => {
    expect(isOfflineError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isOfflineError(new Response(null, { status: 404 }))).toBe(false);
    expect(isOfflineError({ status: 404, statusText: "Not Found", data: null })).toBe(false);
  });
});

describe("OfflineNotice", () => {
  it("shows only while the browser is offline", () => {
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { queryByRole } = render(createElement(OfflineNotice));
    expect(queryByRole("status")).toBeNull();
    online.mockReturnValue(false);
    act(() => void window.dispatchEvent(new Event("offline")));
    expect(queryByRole("status")?.textContent).toContain("Offline: showing the copy on this device");
    online.mockReturnValue(true);
    act(() => void window.dispatchEvent(new Event("online")));
    expect(queryByRole("status")).toBeNull();
  });

  it("floats over the screen and lets taps through, so it never pushes a full-height screen down", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { getByRole } = render(createElement(OfflineNotice));
    expect(getByRole("status").className).toMatch(/(^| )fixed( |$)/);
    expect(getByRole("status").className).toContain("pointer-events-none");
  });
});
