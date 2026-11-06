import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkspaceIndex } from "../../../agents/workspace-index";
import { memoryDb } from "../../helpers/sqlite";
import { IMPORT_BATCH, type ImportedLine } from "~/lib/import-lines";

const { mockGetAgentByName } = vi.hoisted(() => ({ mockGetAgentByName: vi.fn() }));
vi.mock("agents", () => ({ getAgentByName: mockGetAgentByName }));
vi.mock("~/lib/cloudflare.server", () => ({ getCloudflare: vi.fn().mockReturnValue({ env: { WorkspaceAgent: "workspace", DocumentAgent: "document" } }) }));

import { action } from "~/routes/api.import.$step";

/** A document as the route sees it: just what the import calls. */
interface FakeDoc {
  title: string | null;
  lines: Record<string, number>;
  deleted: boolean;
  calls: string[];
}

let index: WorkspaceIndex;
let docs: Map<string, FakeDoc>;
let indexDown: boolean;

function fakeDoc(pageId: string) {
  let doc = docs.get(pageId);
  if (!doc) {
    doc = { title: null, lines: {}, deleted: false, calls: [] };
    docs.set(pageId, doc);
  }
  const d = doc;
  return {
    async createWithTitle(title: string) {
      d.calls.push("create");
      const claim = index.claimTitle(pageId, title, 1);
      if (!claim.ok) return claim.reason === "taken" ? { ok: false, code: "taken", holder: claim.holder } : { ok: false, code: "invalid", reason: claim.reason };
      d.title = title;
      return { ok: true, pageId, title, slug: claim.slug };
    },
    async importLines(importId: string, lines: ImportedLine[]) {
      d.calls.push("import");
      if (d.deleted || (d.title === null && !pageId.startsWith("journal-"))) return { ok: false, code: "missing" };
      if (d.lines[importId] !== undefined) return { ok: true, added: 0 };
      d.lines[importId] = lines.length;
      return { ok: true, added: lines.length };
    },
    async undoImport(importId: string) {
      d.calls.push("undo");
      const removed = d.lines[importId] ?? 0;
      delete d.lines[importId];
      return { removed };
    },
    async deletePage() {
      d.calls.push("delete");
      if (d.title === null || d.deleted) return { ok: false, code: "missing" };
      d.deleted = true;
      index.deletePage(pageId, 2);
      return { ok: true, title: d.title };
    },
  };
}

/** The index as an RPC stub: every method async, like the real one. */
const indexStub = new Proxy(
  {},
  {
    // Not a promise itself: awaiting the stub must not find a `then`
    get: (_t, name: string) =>
      name === "then"
        ? undefined
        : async (...args: unknown[]) => {
            if (indexDown) throw new Error("index down");
            return (index as unknown as Record<string, (...a: unknown[]) => unknown>)[name](...args);
          },
  },
);

function post(step: string, body: unknown, init: { method?: string; contentType?: string } = {}) {
  const request = new Request(`https://mistlog.test/api/import/${step}`, {
    method: init.method ?? "POST",
    headers: { "Content-Type": init.contentType ?? "application/json" },
    body: init.method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return action({ request, context: {}, params: { step } } as never) as Promise<Response>;
}

const line = (text: string): ImportedLine => ({ text, blockId: null, collapsed: false, links: [] });

async function start(): Promise<string> {
  const res = await post("start", {});
  expect(res.status).toBe(201);
  return ((await res.json()) as { importId: string }).importId;
}

describe("POST /api/import/:step", () => {
  beforeEach(() => {
    index = new WorkspaceIndex(memoryDb());
    docs = new Map();
    indexDown = false;
    mockGetAgentByName.mockReset().mockImplementation(async (ns: string, name: string) => (ns === "workspace" ? indexStub : fakeDoc(name)));
  });

  it("refuses anything but JSON POSTs, unknown steps, and steps without an import ID", async () => {
    expect((await post("start", {}, { method: "GET" })).status).toBe(405);
    expect((await post("start", {}, { contentType: "text/plain" })).status).toBe(415);
    expect((await post("start", "{nope")).status).toBe(400);
    expect((await post("start", "[1]")).status).toBe(400);
    expect((await post("pages", { titles: [] })).status).toBe(400);
    expect((await post("nope", { importId: "x" })).status).toBe(404);
  });

  it("starts one import at a time", async () => {
    const importId = await start();
    const again = await post("start", {});
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ current: { importId, state: "running" } });
  });

  it("finds existing pages and journal days, and creates the rest, recorded as the import's", async () => {
    const importId = await start();
    index.claimTitle("existing", "Books", 1);
    const res = await post("pages", { importId, titles: ["books", "Novels", "Nov 3rd, 2026", "bad [[title"] });
    const { resolved } = (await res.json()) as { resolved: Record<string, string | null> };
    expect(resolved.books).toBe("existing");
    expect(resolved["nov 3rd, 2026"]).toBe("journal-2026-11-03");
    expect(resolved["bad [[title"]).toBeNull();
    expect(docs.get(resolved.novels!)?.title).toBe("Novels");
    expect(index.currentImport()).toMatchObject({ pages: 1, created: 1 });
    // Asked again (a continued import): the page it created is found, not made twice
    const again = (await (await post("pages", { importId, titles: ["Novels"] })).json()) as { resolved: Record<string, string> };
    expect(again.resolved.novels).toBe(resolved.novels);
    expect(index.currentImport()).toMatchObject({ pages: 1, created: 1 });
  });

  it("links to a page someone else created a moment before, and forgets the one it meant to make", async () => {
    const importId = await start();
    mockGetAgentByName.mockImplementation(async (ns: string, name: string) => {
      if (ns === "workspace") return indexStub;
      const doc = fakeDoc(name);
      return {
        ...doc,
        createWithTitle: async (title: string) => {
          index.claimTitle("theirs01", title, 1); // another tab won the race
          return doc.createWithTitle(title);
        },
      };
    });
    const { resolved } = (await (await post("pages", { importId, titles: ["Garden"] })).json()) as { resolved: Record<string, string> };
    expect(resolved.garden).toBe("theirs01");
    expect(index.currentImport()).toMatchObject({ pages: 0 });
  });

  it("refuses too many titles or pages in one request, bad lines, and imports that aren't running", async () => {
    const importId = await start();
    const titles = Array.from({ length: IMPORT_BATCH + 1 }, (_, i) => `t${i}`);
    expect((await post("pages", { importId, titles })).status).toBe(400);
    expect((await post("pages", { importId, titles: [1] })).status).toBe(400);
    expect((await post("write", { importId, pages: [{ pageId: "../x", lines: [] }] })).status).toBe(400);
    expect((await post("write", { importId, pages: [{ pageId: "abcd1234", lines: [{ text: 1 }] }] })).status).toBe(400);
    const tooMany = Array.from({ length: IMPORT_BATCH + 1 }, () => ({ pageId: "abcd1234", lines: [] }));
    expect((await post("write", { importId, pages: tooMany })).status).toBe(400);
    expect((await post("pages", { importId: "other", titles: ["x"] })).status).toBe(409);
    expect((await post("write", { importId: "other", pages: [] })).status).toBe(409);
    expect((await post("finish", { importId: "other" })).status).toBe(409);
    expect(docs.size).toBe(0);
  });

  it("writes pages and days, records each, and says which couldn't be written", async () => {
    const importId = await start();
    const { resolved } = (await (await post("pages", { importId, titles: ["Books"] })).json()) as { resolved: Record<string, string> };
    const res = await post("write", {
      importId,
      pages: [
        { pageId: resolved.books, lines: [line("- a"), line("- b")] },
        { pageId: "journal-2026-11-04", lines: [line("- day")] },
        { pageId: "gone0001", lines: [line("- lost")] },
      ],
    });
    expect(await res.json()).toEqual({ written: [resolved.books, "journal-2026-11-04"], failed: ["gone0001"] });
    expect(index.currentImport()).toMatchObject({ pages: 3, created: 1 });
    expect(await (await post("finish", { importId })).json()).toEqual({ current: expect.objectContaining({ importId, state: "done", pages: 3, created: 1 }) });
    // Finished: no more writes
    expect((await post("write", { importId, pages: [] })).status).toBe(409);
  });

  it("undoes a few documents per request until done: lines removed, created pages deleted", async () => {
    const importId = await start();
    const titles = Array.from({ length: IMPORT_BATCH }, (_, i) => `Page ${i}`);
    const { resolved } = (await (await post("pages", { importId, titles })).json()) as { resolved: Record<string, string> };
    index.claimTitle("mine0001", "Mine", 1);
    docs.set("mine0001", { title: "Mine", lines: {}, deleted: false, calls: [] });
    await post("write", { importId, pages: [{ pageId: "mine0001", lines: [line("- added")] }] });
    await post("finish", { importId });

    expect(await (await post("undo", { importId })).json()).toEqual({ done: false, left: 1 });
    expect(await (await post("undo", { importId })).json()).toEqual({ done: true, left: 0 });
    for (const id of Object.values(resolved)) expect(docs.get(id)).toMatchObject({ deleted: true });
    // A page that was there before keeps existing; only the import's lines go
    expect(docs.get("mine0001")).toMatchObject({ deleted: false, lines: {} });
    expect(docs.get("mine0001")!.calls).toEqual(["import", "undo"]);
    expect(index.currentImport()).toBeNull();
    // Nothing left to undo; a new import may start
    expect((await post("undo", { importId })).status).toBe(409);
    await start();
  });

  it("keeps the import's record if deleting a created page fails, so undoing can continue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const importId = await start();
    const { resolved } = (await (await post("pages", { importId, titles: ["Books"] })).json()) as { resolved: Record<string, string> };
    mockGetAgentByName.mockImplementation(async (ns: string, name: string) => (ns === "workspace" ? indexStub : { ...fakeDoc(name), deletePage: async () => ({ ok: false, code: "failed" }) }));
    expect((await post("undo", { importId })).status).toBe(503);
    expect(index.currentImport()).toMatchObject({ state: "undoing", pages: 1 });
    mockGetAgentByName.mockImplementation(async (ns: string, name: string) => (ns === "workspace" ? indexStub : fakeDoc(name)));
    expect(await (await post("undo", { importId })).json()).toEqual({ done: true, left: 0 });
    expect(docs.get(resolved.books)?.deleted).toBe(true);
    vi.restoreAllMocks();
  });

  it("says when the index can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    indexDown = true;
    expect((await post("start", {})).status).toBe(503);
    vi.restoreAllMocks();
  });
});
