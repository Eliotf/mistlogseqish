// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement } from "react";
import { render, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
import * as Y from "yjs";
import PageTitle, { checkTitleOnServer } from "~/components/PageTitle";
import type { TitleCheck } from "~/lib/page-title";

const PAGE_ID = "abcd1234";

function setup(options: { title?: string; check?: (t: string, id: string) => Promise<TitleCheck>; autoFocus?: boolean } = {}) {
  const doc = new Y.Doc();
  if (options.title !== undefined) doc.getMap("meta").set("title", options.title);
  const check = vi.fn(options.check ?? (async (title: string) => ({ available: true as const, title })));
  const utils = render(createElement(PageTitle, { doc, pageId: PAGE_ID, checkTitle: check, autoFocus: options.autoFocus }));
  const heading = utils.getByRole("textbox", { name: "Page title" });
  return { ...utils, doc, check, heading };
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

  it("saves a new title to the Yjs document after checking it", async () => {
    const { heading, doc, check } = setup({ title: "Old" });
    await rename(heading, "  New   name ");
    expect(check).toHaveBeenCalledWith("New name", PAGE_ID);
    await waitFor(() => expect(doc.getMap("meta").get("title")).toBe("New name"));
    expect(heading.textContent).toBe("New name");
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
      check: async () => ({ available: false, reason: "A page called “Taken” already exists." }),
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
    expect((await findByRole("alert")).textContent).toContain("Couldn't check the title");
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
      check: async (title) => (free ? { available: true, title } : { available: false, reason: "Taken." }),
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

describe("checkTitleOnServer", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("calls the title check route with the title and page", async () => {
    vi.mocked(fetch).mockResolvedValue(Response.json({ available: true, title: "A & B" }));
    expect(await checkTitleOnServer("A & B", PAGE_ID)).toEqual({ available: true, title: "A & B" });
    expect(fetch).toHaveBeenCalledWith("/api/title-check?title=A+%26+B&pageId=abcd1234");
  });

  it("throws when the server fails", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(checkTitleOnServer("A", PAGE_ID)).rejects.toThrow("Title check failed: 500");
  });
});
