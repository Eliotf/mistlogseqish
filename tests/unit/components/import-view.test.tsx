// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import ImportView from "~/components/ImportView";

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

describe("ImportView (dry run)", () => {
  afterEach(cleanup);

  it("asks for a whole folder", () => {
    render(createElement(ImportView) as ReactNode as never);
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    expect(input.hasAttribute("webkitdirectory")).toBe(true);
    expect(screen.getByText(/nothing is written/i)).toBeTruthy();
  });

  it("reads the folder, checks titles and dates only, and reports what an import would do", async () => {
    const check = vi.fn(async () => ({ pages: ["books"], days: ["2026-11-04"] }));
    render(createElement(ImportView, { check }) as ReactNode as never);
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
    expect((screen.getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says so when Mistlog can't be reached", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    render(createElement(ImportView, { check: async () => Promise.reject(new Error("down")) }) as ReactNode as never);
    choose([picked("g/pages/A.md", "- x")]);
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Couldn't read the folder or reach Mistlog"));
    vi.restoreAllMocks();
  });
});
