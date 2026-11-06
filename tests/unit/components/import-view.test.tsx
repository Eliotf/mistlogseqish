// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import ImportView from "~/components/ImportView";
import type { ImportApi } from "~/lib/import-run";
import type { ImportRecord } from "~/lib/import-lines";

/** A picked file as the browser gives it from a folder: with its path inside the folder. */
function picked(path: string, text: string): File {
  const file = new File([text], path.split("/").pop()!);
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  Object.defineProperty(file, "text", { value: async () => text });
  return file;
}

function choose(files: File[]) {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

function show(props: Partial<Parameters<typeof ImportView>[0]> = {}) {
  return render(createElement(MemoryRouter, null, createElement(ImportView, { current: null, ...props })) as ReactNode as never);
}

describe("ImportView (dry run)", () => {
  afterEach(cleanup);

  it("asks for a whole folder", () => {
    show();
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.hasAttribute("webkitdirectory")).toBe(true);
    expect(screen.getByText(/before anything is written/i)).toBeTruthy();
  });

  it("reads the folder, checks titles and dates only, and reports what an import would do", async () => {
    const check = vi.fn(async () => ({ pages: ["books"], days: ["2026-11-04"] }));
    show({ check });
    choose([
      picked("Logseq/pages/Books.md", "- read [[Novels]] #reading"),
      picked("Logseq/pages/[[Ideas]].md", "- later"),
      picked("Logseq/journals/2026_11_04.md", "- today"),
      picked("Logseq/journals/2026_11_04 2.md", "- copy"),
      picked("Logseq/assets/photo.jpg", ""),
    ]);
    const report = await screen.findByRole("region", { name: "What an import would do" });
    // Only what the check needs: the plan, from which titles and dates are sent
    expect(check).toHaveBeenCalledTimes(1);
    expect(report.textContent).toContain("1 new page; 1 page you have already get the imported lines added below");
    expect(report.textContent).toContain("0 new journal days; 1 day you have already get the imported lines added below");
    expect(report.textContent).toContain("2 empty pages for links to pages that aren't in your graph");
    expect(report.textContent).toContain("1 link and 1 tag");
    expect(report.textContent).toContain("1 attachment (images, PDFs) not imported yet");
    expect(report.textContent).toContain("“[[Ideas]]” becomes “Ideas”");
    expect(report.textContent).toContain("Logseq/journals/2026_11_04 2.md: A conflict copy");
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("says so when Mistlog can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    show({ check: async () => Promise.reject(new Error("down")) });
    choose([picked("g/pages/A.md", "- x")]);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't read the folder or reach Mistlog"));
    vi.restoreAllMocks();
  });
});

const RUNNING: ImportRecord = { importId: "imp1", state: "running", startedAt: 1, finishedAt: null, pages: 3, created: 2 };
const DONE: ImportRecord = { ...RUNNING, state: "done", finishedAt: 2 };

function fakeApi(overrides: Partial<ImportApi> = {}): ImportApi {
  return {
    start: vi.fn(async () => ({ ok: true as const, importId: "imp9" })),
    pages: vi.fn(async (_id: string, titles: string[]) => Object.fromEntries(titles.map((t) => [t.toLowerCase(), `p${t.toLowerCase().padEnd(7, "x")}`]))),
    write: vi.fn(async (_id: string, pages: Array<{ pageId: string }>) => ({ written: pages.map((p) => p.pageId), failed: [] })),
    finish: vi.fn(async () => ({ ...DONE, importId: "imp9", created: 4 })),
    undo: vi.fn(async () => ({ done: true, left: 0 })),
    ...overrides,
  };
}

const check = async () => ({ pages: [], days: [] });
const noWait = async () => {};

describe("ImportView (import and undo)", () => {
  afterEach(cleanup);

  it("imports after the report, then offers undo", async () => {
    const api = fakeApi();
    show({ check, api, wait: noWait });
    choose([picked("g/pages/Books.md", "- read [[Novels]]"), picked("g/journals/2026_11_04.md", "- today")]);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    const done = await screen.findByRole("region", { name: "Import finished" });
    expect(done.textContent).toContain("Imported: 2 pages and days written.");
    expect(api.start).toHaveBeenCalledTimes(1);
    expect(api.write).toHaveBeenCalledWith("imp9", expect.any(Array));
    expect(api.finish).toHaveBeenCalledWith("imp9");
    // No second import while this one exists
    expect(document.querySelector('input[type="file"]')).toBeNull();
    // Undo knows what the import created
    fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
    expect(screen.getByRole("region", { name: "Undo the import" }).textContent).toContain("deletes the 4 pages it created");
  });

  it("continues an import that didn't finish, under the same import", async () => {
    const api = fakeApi();
    show({ current: RUNNING, check, api, wait: noWait });
    expect(screen.getByRole("region", { name: "Your import" }).textContent).toContain("didn't finish");
    choose([picked("g/pages/Books.md", "- a")]);
    fireEvent.click(await screen.findByRole("button", { name: "Continue import" }));
    await screen.findByRole("region", { name: "Import finished" });
    expect(api.start).not.toHaveBeenCalled();
    expect(api.pages).toHaveBeenCalledWith("imp1", ["Books"]);
  });

  it("says so when another import exists, and when an import stops part way", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    show({ check, api: fakeApi({ start: async () => ({ ok: false, current: DONE }) }), wait: noWait });
    choose([picked("g/pages/Books.md", "- a")]);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    expect((await screen.findByRole("alert")).textContent).toContain("An import exists already");
    cleanup();

    show({ check, api: fakeApi({ write: async () => Promise.reject(new Error("refused")) }), wait: noWait });
    choose([picked("g/pages/Books.md", "- a")]);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    expect((await screen.findByRole("alert")).textContent).toContain("stopped before it finished");
    expect(screen.getByRole("button", { name: "Undo this import" })).toBeTruthy();
    vi.restoreAllMocks();
  });

  it("undoes a finished import after asking, and then allows another", async () => {
    const api = fakeApi({ undo: vi.fn().mockResolvedValueOnce({ done: false, left: 1 }).mockResolvedValue({ done: true, left: 0 }) });
    show({ current: DONE, api, wait: noWait });
    expect(screen.getByRole("region", { name: "Your import" }).textContent).toContain("Undo it to import again");
    expect(document.querySelector('input[type="file"]')).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
    const confirm = screen.getByRole("region", { name: "Undo the import" });
    expect(confirm.textContent).toContain("deletes the 2 pages it created");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.undo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo the import" }));
    expect((await screen.findByText(/The import is undone/)).textContent).toContain("You can import again");
    expect(api.undo).toHaveBeenCalledTimes(2);
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
  });

  it("offers to continue an undo that stopped", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    show({ current: DONE, api: fakeApi({ undo: async () => Promise.reject(new Error("refused")) }), wait: noWait });
    fireEvent.click(screen.getByRole("button", { name: "Undo this import" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo the import" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Undoing stopped");
    expect(screen.getByRole("button", { name: "Continue undoing" })).toBeTruthy();
    vi.restoreAllMocks();
  });
});
