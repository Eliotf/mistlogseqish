import { describe, it, expect, vi, afterEach } from "vitest";
import { cacheName } from "~/lib/local-cache";

vi.mock("~/lib/document-loader.server", () => ({ workspaceIndex: vi.fn(), loadJournal: vi.fn() }));

import { clientLoader as feedLoader } from "~/routes/home";
import { clientLoader as dayLoader } from "~/routes/journal.$date";

const offline = () => Promise.reject(new TypeError("Failed to fetch"));
const saved = (...dates: string[]) => vi.stubGlobal("indexedDB", { databases: async () => dates.map((d) => ({ name: cacheName(`journal-${d}`) })) });

afterEach(() => vi.unstubAllGlobals());

describe("offline fallbacks for the journal (F14)", () => {
  it("the feed uses the server online, and the days kept in this browser offline", async () => {
    const online = { days: ["2026-11-12"], loadFailed: false };
    expect(await feedLoader({ serverLoader: async () => online } as never)).toBe(online);
    saved("2026-11-10", "2026-11-12");
    expect(await feedLoader({ serverLoader: offline } as never)).toEqual({ days: ["2026-11-12", "2026-11-10"], loadFailed: false });
  });

  it("a day opens from its copy offline, and shows as unwritten if there is none", async () => {
    saved("2026-11-12");
    expect(await dayLoader({ params: { date: "2026-11-12" }, serverLoader: offline } as never)).toEqual({ id: "journal-2026-11-12", createdAt: null, exists: true, path: "/journal/2026-11-12" });
    expect(await dayLoader({ params: { date: "2026-11-13" }, serverLoader: offline } as never)).toMatchObject({ exists: false });
  });

  it("still shows the server's answers: a 404 is not 'offline'", async () => {
    const notFound = new Response(null, { status: 404 });
    await expect(feedLoader({ serverLoader: () => Promise.reject(notFound) } as never)).rejects.toBe(notFound);
    await expect(dayLoader({ params: { date: "2026-11-12" }, serverLoader: () => Promise.reject(notFound) } as never)).rejects.toBe(notFound);
    await expect(dayLoader({ params: { date: "2026-02-30" }, serverLoader: offline } as never)).rejects.toThrow("Failed to fetch");
  });
});
