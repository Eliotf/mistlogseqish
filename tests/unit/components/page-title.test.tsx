// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import * as Y from "yjs";
import PageTitle, { renameOnServer } from "~/components/PageTitle";
import type { RenameResult } from "~/lib/page-title";

const PAGE_ID = "abcd1234";

function setup(options: { title?: string; check?: (t: string, id: string) => Promise<RenameResult>; autoFocus?: boolean } = {}) {
  const doc = new Y.Doc();
  if (options.title !== undefined) doc.getMap("meta").set("title", options.title);
  const check = vi.fn(
    options.check ?? (async (title: string) => ({ ok: true as const, title, path: `/page/${title.toLowerCase().replace(/ /g, "-")}` })),
  );
  const onRenamed = vi.fn();
  const utils = render(createElement(PageTitle, { doc, pageId: PAGE_ID, rename: check, onRenamed, autoFocus: options.autoFocus }));
  const heading = utils.getByRole("textbox", { name: "Page title" });
  return { ...utils, doc, check, onRenamed, heading };
}

/** Type a new title and leave the field, as a user would. */
async function rename(heading: HTMLElement, text: string, leaveWith: "blur" | "enter" = "blur") {
  heading.focus();
  heading.textContent = text;
  if (leaveWith === "enter") fireEvent.keyDown(heading, { key: "Enter" });
  await act(async () => {
    heading.blur();
  });
}

describe("PageTitle", () => {
  afterEach(cleanup);

  it("shows the stored title and sets the browser tab title", () => {
    const { heading } = setup({ title: "Mistlog" });
    expect(heading.textContent).toBe("Mistlog");
    expect(document.title).toBe("Mistlog · mistlogseqish");
  });

  it("is empty with an Untitled placeholder when there is no title", () => {
    const { heading } = setup();
    expect(heading.textContent).toBe("");
    expect(heading.getAttribute("data-placeholder")).toBe("Untitled");
    expect(document.title).toBe("Untitled · mistlogseqish");
  });

  it("claims the title on the server, then saves it to the Yjs document", async () => {
    const { heading, doc, check } = setup({ title: "Old" });
    await rename(heading, "  New   name ");
    expect(check).toHaveBeenCalledWith("New name", PAGE_ID);
    await waitFor(() => expect(doc.getMap("meta").get("title")).toBe("New name"));
    expect(heading.textContent).toBe("New name");
  });

  it("reports the new address after a rename", async () => {
    const { heading, onRenamed } = setup({ title: "Old" });
    await rename(heading, "Fresh Start");
    await waitFor(() => expect(onRenamed).toHaveBeenCalledWith("/page/fresh-start"));
  });

  it("does not save or report an address when the server refuses", async () => {
    const { heading, onRenamed, doc } = setup({ title: "Mine", check: async () => ({ ok: false, reason: "Taken." }) });
    await rename(heading, "Other");
    await act(async () => {});
    expect(onRenamed).not.toHaveBeenCalled();
    expect(doc.getMap("meta").get("title")).toBe("Mine");
  });

  it("saves the title the server returns", async () => {
    const { heading, doc } = setup({ title: "Old", check: async () => ({ ok: true, title: "Server Title", path: "/page/x" }) });
    await rename(heading, "typed");
    await waitFor(() => expect(doc.getMap("meta").get("title")).toBe("Server Title"));
  });

  it("saves on Enter", async () => {
    const { heading, doc } = setup({ title: "Old" });
    await rename(heading, "Entered", "enter");
    await waitFor(() => expect(doc.getMap("meta").get("title")).toBe("Entered"));
  });

  it("cancels on Escape", async () => {
    const { heading, doc, check } = setup({ title: "Keep" });
    heading.focus();
    heading.textContent = "Discard";
    fireEvent.keyDown(heading, { key: "Escape" });
    await act(async () => {});
    expect(heading.textContent).toBe("Keep");
    expect(check).not.toHaveBeenCalled();
    expect(doc.getMap("meta").get("title")).toBe("Keep");
  });

  it("refuses a title another page has, and keeps the old one", async () => {
    const { heading, doc, findByRole } = setup({
      title: "Mine",
      check: async () => ({ ok: false, reason: "A page called “Taken” already exists." }),
    });
    await rename(heading, "taken");
    const alert = await findByRole("alert");
    expect(alert.textContent).toBe("A page called “Taken” already exists. The title was not changed.");
    expect(heading.textContent).toBe("Mine");
    expect(doc.getMap("meta").get("title")).toBe("Mine");
    expect(heading.getAttribute("aria-describedby")).toBe("page-title-error");
  });

  it("refuses an invalid title without asking the server", async () => {
    const { heading, check, findByRole } = setup({ title: "Mine" });
    await rename(heading, "a [[b]]");
    expect((await findByRole("alert")).textContent).toBe("Titles can't contain [[ or ]].");
    expect(check).not.toHaveBeenCalled();
    expect(heading.textContent).toBe("Mine");
  });

  it("keeps the old title if the check fails", async () => {
    const { heading, doc, findByRole } = setup({
      title: "Mine",
      check: async () => {
        throw new Error("offline");
      },
    });
    await rename(heading, "New");
    expect((await findByRole("alert")).textContent).toContain("Couldn't save the title");
    expect(doc.getMap("meta").get("title")).toBe("Mine");
  });

  it("does nothing when the title is cleared or unchanged", async () => {
    const { heading, check, doc } = setup({ title: "Same" });
    await rename(heading, "   ");
    expect(heading.textContent).toBe("Same");
    await rename(heading, "Same");
    expect(check).not.toHaveBeenCalled();
    expect(doc.getMap("meta").get("title")).toBe("Same");
  });

  it("clears an earlier error after a successful rename", async () => {
    let free = false;
    const { heading, queryByRole } = setup({
      title: "Mine",
      check: async (title) => (free ? { ok: true, title, path: "/page/other" } : { ok: false, reason: "Taken." }),
    });
    await rename(heading, "Other");
    await waitFor(() => expect(queryByRole("alert")).not.toBeNull());
    free = true;
    await rename(heading, "Other");
    await waitFor(() => expect(queryByRole("alert")).toBeNull());
  });

  it("follows title changes from another tab while not editing", () => {
    const { heading, doc } = setup({ title: "Before" });
    act(() => {
      doc.getMap("meta").set("title", "From another tab");
    });
    expect(heading.textContent).toBe("From another tab");
  });

  it("does not overwrite what the user is typing when another tab changes the title", () => {
    const { heading, doc } = setup({ title: "Before" });
    heading.focus();
    heading.textContent = "Typing";
    act(() => {
      doc.getMap("meta").set("title", "From another tab");
    });
    expect(heading.textContent).toBe("Typing");
  });

  it("focuses and selects the title for a new page", () => {
    const { heading } = setup({ autoFocus: true });
    expect(document.activeElement).toBe(heading);
  });

  it("pastes plain text only", () => {
    const { heading } = setup({ title: "" });
    heading.focus();
    const range = document.createRange();
    range.selectNodeContents(heading);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    fireEvent.paste(heading, { clipboardData: { getData: () => "Pasted\n\ttitle" } });
    expect(heading.textContent).toBe("Pasted title");
    expect(heading.querySelector("*")).toBeNull();
  });
});

describe("renameOnServer", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts the page and title to the rename route as JSON", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ ok: true, title: "A & B", path: "/page/a-b" }));
    expect(await renameOnServer("A & B", PAGE_ID)).toEqual({ ok: true, title: "A & B", path: "/page/a-b" });
    expect(fetch).toHaveBeenCalledWith("/api/rename", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pageId: PAGE_ID, title: "A & B" }),
    });
  });

  it("throws when the server fails", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(renameOnServer("A", PAGE_ID)).rejects.toThrow("Rename failed: 500");
  });
});
