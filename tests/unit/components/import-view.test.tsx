// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, cleanup, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import ImportView, { folderName } from "~/components/ImportView";
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
  return render(createElement(MemoryRouter, null, createElement(ImportView, { imports: [], ...props })) as ReactNode as never);
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

const RUNNING: ImportRecord = { importId: "imp1", label: "g", state: "running", startedAt: 1, finishedAt: null, pages: 3, created: 2 };
const DONE: ImportRecord = { ...RUNNING, state: "done", finishedAt: 2 };
const OTHER: ImportRecord = { ...DONE, importId: "imp0", label: "Work", pages: 5, created: 1 };

function fakeApi(overrides: Partial<ImportApi> = {}): ImportApi {
  return {
    list: vi.fn(async () => []),
    start: vi.fn(async () => ({ ok: true as const, importId: "imp9" })),
    pages: vi.fn(async (_id: string, titles: string[]) => Object.fromEntries(titles.map((t) => [t.toLowerCase(), `p${t.toLowerCase().padEnd(7, "x")}`]))),
    write: vi.fn(async (_id: string, pages: Array<{ pageId: string }>) => ({ written: pages.map((p) => p.pageId), failed: [] })),
    finish: vi.fn(async (importId: string) => ({ ...DONE, importId, created: 4 })),
    undo: vi.fn(async () => ({ done: true, left: 0 })),
    ...overrides,
  };
}

const check = async () => ({ pages: [], days: [] });
const noWait = async () => {};
const list = () => screen.getByRole("region", { name: "Your imports" });
const rows = () => within(list()).getAllByRole("listitem");

describe("folderName", () => {
  it("is the picked folder's name, from the files' paths inside it", () => {
    expect(folderName([picked("My graph/pages/A.md", "")])).toBe("My graph");
    expect(folderName([new File([""], "loose.md")])).toBeNull();
    expect(folderName([])).toBeNull();
  });
});

describe("ImportView (import and undo)", () => {
  afterEach(cleanup);

  it("imports after the report, lists it, and allows another folder", async () => {
    const api = fakeApi();
    show({ check, api, wait: noWait });
    choose([picked("g/pages/Books.md", "- read [[Novels]]"), picked("g/journals/2026_11_04.md", "- today")]);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    const done = await screen.findByRole("region", { name: "Import finished" });
    expect(done.textContent).toContain("Imported: 2 pages and days written.");
    expect(api.start).toHaveBeenCalledWith("g");
    expect(api.write).toHaveBeenCalledWith("imp9", expect.any(Array));
    expect(api.finish).toHaveBeenCalledWith("imp9");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("“g” Imported");
    expect(rows()[0].textContent).toContain("4 new pages");
    // Another folder can be imported straight away
    expect(screen.getByText("Choose another folder")).toBeTruthy();
    // Undo knows what the import created
    fireEvent.click(screen.getByRole("button", { name: "Undo the import of “g”" }));
    expect(screen.getByRole("region", { name: "Undo the import" }).textContent).toContain("deletes the 4 pages it created");
  });

  it("imports a second folder alongside the first, and warns before importing the same folder twice", async () => {
    const api = fakeApi({ start: vi.fn(async () => ({ ok: true as const, importId: "imp9" })), finish: vi.fn(async () => ({ ...DONE, importId: "imp9", label: "Home" })) });
    show({ imports: [DONE], check, api, wait: noWait });
    choose([picked("g/pages/Books.md", "- a")]);
    expect((await screen.findByRole("note")).textContent).toContain("You have imported a folder called “g” already");
    cleanup();

    show({ imports: [DONE], check, api, wait: noWait });
    choose([picked("Home/pages/Books.md", "- a")]);
    await screen.findByRole("region", { name: "What an import would do" });
    expect(screen.queryByRole("note")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByRole("region", { name: "Import finished" });
    expect(api.start).toHaveBeenCalledWith("Home");
    expect(rows().map((r) => r.textContent?.split(" ")[0])).toEqual(["“Home”", "“g”"]);
  });

  it("continues an import that didn't finish with its own folder, under the same import", async () => {
    const api = fakeApi();
    show({ imports: [RUNNING, OTHER], check, api, wait: noWait });
    expect(rows()[0].textContent).toContain("didn't finish");
    // While it is unfinished, the others can't be undone
    expect((screen.getByRole("button", { name: "Undo the import of “Work”" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Undo the import of “g”" }) as HTMLButtonElement).disabled).toBe(false);
    choose([picked("g/pages/Books.md", "- a")]);
    fireEvent.click(await screen.findByRole("button", { name: "Continue import" }));
    await screen.findByRole("region", { name: "Import finished" });
    expect(api.start).not.toHaveBeenCalled();
    expect(api.pages).toHaveBeenCalledWith("imp1", ["Books"]);
    expect((screen.getByRole("button", { name: "Undo the import of “Work”" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("won't import another folder until an unfinished import is continued or undone", async () => {
    const api = fakeApi();
    show({ imports: [RUNNING], check, api, wait: noWait });
    choose([picked("Other/pages/Books.md", "- a")]);
    expect((await screen.findByRole("alert")).textContent).toContain("The import of “g” isn't finished");
    expect(screen.queryByRole("button", { name: /^(Import|Continue import)$/ })).toBeNull();
    cleanup();
    // An import from before folder names were kept is continued with any folder
    show({ imports: [{ ...RUNNING, label: null }], check, api, wait: noWait });
    choose([picked("Other/pages/Books.md", "- a")]);
    expect(await screen.findByRole("button", { name: "Continue import" })).toBeTruthy();
  });

  it("says so when the server refuses to start, and when an import stops part way", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    show({ check, api: fakeApi({ start: async () => ({ ok: false, current: { ...RUNNING, label: "Elsewhere" } }) }), wait: noWait });
    choose([picked("g/pages/Books.md", "- a")]);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    expect((await screen.findByRole("alert")).textContent).toContain("The import of “Elsewhere” isn't finished");
    expect(rows()[0].textContent).toContain("“Elsewhere”");
    cleanup();

    show({ check, api: fakeApi({ write: async () => Promise.reject(new Error("refused")) }), wait: noWait });
    choose([picked("g/pages/Books.md", "- a")]);
    fireEvent.click(await screen.findByRole("button", { name: "Import" }));
    expect((await screen.findByRole("alert")).textContent).toContain("stopped before it finished");
    expect(rows()[0].textContent).toContain("didn't finish");
    expect(screen.getByRole("button", { name: "Undo the import of “g”" })).toBeTruthy();
    vi.restoreAllMocks();
  });

  it("undoes one import of several after asking, leaving the others with their counts fetched afresh", async () => {
    const api = fakeApi({
      undo: vi.fn().mockResolvedValueOnce({ done: false, left: 1 }).mockResolvedValue({ done: true, left: 0 }),
      // The page "Work" created and "g" also used is now g's
      list: vi.fn(async () => [{ ...DONE, created: 3 }]),
    });
    show({ imports: [DONE, OTHER], api, wait: noWait });
    fireEvent.click(screen.getByRole("button", { name: "Undo the import of “Work”" }));
    const confirm = screen.getByRole("region", { name: "Undo the import" });
    expect(confirm.textContent).toContain("Undo the import of “Work”?");
    expect(confirm.textContent).toContain("deletes the 1 page it created");
    expect(confirm.textContent).toContain("except pages another import uses too");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(api.undo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Undo the import of “Work”" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo the import" }));
    expect((await screen.findByText(/is undone/)).textContent).toBe("The import of “Work” is undone.");
    expect(api.undo).toHaveBeenCalledTimes(2);
    expect(api.undo).toHaveBeenCalledWith("imp0");
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain("“g”");
    await waitFor(() => expect(rows()[0].textContent).toContain("3 new pages"));
  });

  it("offers to continue an undo that stopped, and no new import until it is done", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    show({ imports: [DONE, OTHER], api: fakeApi({ undo: async () => Promise.reject(new Error("refused")) }), wait: noWait });
    fireEvent.click(screen.getByRole("button", { name: "Undo the import of “g”" }));
    fireEvent.click(screen.getByRole("button", { name: "Undo the import" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Undoing stopped");
    expect(screen.getByRole("button", { name: "Continue undoing the import of “g”" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Undo the import of “Work”" }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.querySelector('input[type="file"]')).toBeNull();
    vi.restoreAllMocks();
  });
});
