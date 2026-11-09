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

async function start(label = "Logseq"): Promise<string> {
  const res = await post("start", { label });
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

  it("runs one import at a time, keeping each folder's name; a finished one doesn't stop another", async () => {
    const importId = await start("  Work notes ");
    const again = await post("start", { label: "Home" });
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ current: { importId, label: "Work notes", state: "running" } });
    await post("finish", { importId });
    const second = await start("Home");
    await post("finish", { importId: second });
    // A missing or odd name is kept as none
    const third = await post("start", { label: 42 });
    expect(third.status).toBe(201);
    expect(index.listImports().map((i) => i.label)).toEqual([null, "Home", "Work notes"]);
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
    // The existing page is recorded too (not as created), so undoing another import keeps it for this one
    expect(index.getImport(importId)).toMatchObject({ pages: 2, created: 1 });
    // Asked again (a continued import): the page it created is found, not made twice
    const again = (await (await post("pages", { importId, titles: ["Novels"] })).json()) as { resolved: Record<string, string> };
    expect(again.resolved.novels).toBe(resolved.novels);
    expect(index.getImport(importId)).toMatchObject({ pages: 2, created: 1 });
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
    expect(index.getImport(importId)).toMatchObject({ pages: 0 });
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
    expect(index.getImport(importId)).toMatchObject({ pages: 3, created: 1 });
    expect(await (await post("finish", { importId })).json()).toEqual({ record: expect.objectContaining({ importId, state: "done", pages: 3, created: 1 }) });
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
    expect(index.listImports()).toEqual([]);
    // Nothing left to undo
    expect((await post("undo", { importId })).status).toBe(409);
  });

  it("refuses to undo one import while another is running", async () => {
    const first = await start("A");
    await post("finish", { importId: first });
    const second = await start("B");
    const refused = await post("undo", { importId: first });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ busy: true });
    expect(index.getImport(first)?.state).toBe("done");
    // The running one itself can be undone
    expect(await (await post("undo", { importId: second })).json()).toEqual({ done: true, left: 0 });
    expect(await (await post("undo", { importId: first })).json()).toEqual({ done: true, left: 0 });
  });

  it("keeps a page another import uses when the import that created it is undone", async () => {
    const first = await start("A");
    const { resolved } = (await (await post("pages", { importId: first, titles: ["Novels", "Alone"] })).json()) as { resolved: Record<string, string> };
    await post("write", { importId: first, pages: [{ pageId: resolved.novels, lines: [line("- from A")] }] });
    await post("finish", { importId: first });
    // B only links to Novels (found, not created)
    const second = await start("B");
    const again = (await (await post("pages", { importId: second, titles: ["Novels"] })).json()) as { resolved: Record<string, string> };
    expect(again.resolved.novels).toBe(resolved.novels);
    await post("finish", { importId: second });

    expect(await (await post("undo", { importId: first })).json()).toEqual({ done: true, left: 0 });
    // A's lines are gone, and the page it alone used; Novels stays for B, which now owns it
    expect(docs.get(resolved.novels)).toMatchObject({ deleted: false, lines: {} });
    expect(docs.get(resolved.alone)).toMatchObject({ deleted: true });
    expect(index.getImport(second)).toMatchObject({ pages: 1, created: 1 });
    expect(await (await post("list", {})).json()).toEqual({ imports: [expect.objectContaining({ importId: second, label: "B", pages: 1, created: 1 })] });

    expect(await (await post("undo", { importId: second })).json()).toEqual({ done: true, left: 0 });
    expect(docs.get(resolved.novels)).toMatchObject({ deleted: true });
  });

  it("keeps the import's record if deleting a created page fails, so undoing can continue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const importId = await start();
    const { resolved } = (await (await post("pages", { importId, titles: ["Books"] })).json()) as { resolved: Record<string, string> };
    mockGetAgentByName.mockImplementation(async (ns: string, name: string) => (ns === "workspace" ? indexStub : { ...fakeDoc(name), deletePage: async () => ({ ok: false, code: "failed" }) }));
    expect((await post("undo", { importId })).status).toBe(503);
    expect(index.getImport(importId)).toMatchObject({ state: "undoing", pages: 1 });
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
