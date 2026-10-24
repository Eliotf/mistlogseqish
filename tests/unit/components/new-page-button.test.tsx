// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement } from "react";
import { render, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router";
import NewPageButton, { createPage } from "~/components/NewPageButton";

function Opened() {
  const location = useLocation();
  return createElement("p", null, `${location.pathname} ${JSON.stringify(location.state)}`);
}

function renderButton(create: () => Promise<string>) {
  return render(
    createElement(
      MemoryRouter,
      { initialEntries: ["/docs/start000"] },
      createElement(
        Routes,
        null,
        createElement(Route, { path: "/docs/start000", element: createElement(NewPageButton, { create }) }),
        createElement(Route, { path: "/docs/:id", element: createElement(Opened) }),
      ),
    ),
  );
}

describe("NewPageButton", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("creates a page and opens it with the title ready to type", async () => {
    const { getByRole, findByText } = renderButton(async () => "newpage1");
    fireEvent.click(getByRole("button", { name: "New page" }));
    expect(await findByText('/docs/newpage1 {"focusTitle":true}')).toBeTruthy();
  });

  it("offers to try again if creating fails", async () => {
    const { getByRole } = renderButton(async () => {
      throw new Error("offline");
    });
    fireEvent.click(getByRole("button", { name: "New page" }));
    const retry = await waitFor(() => getByRole("button", { name: "Try again" }));
    expect(retry.getAttribute("title")).toContain("Couldn't create a page");
  });

  it("createPage posts to a new document agent and returns its ID", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const id = await createPage();
    expect(id).toMatch(/^[a-z0-9]{8}$/);
    expect(fetchMock).toHaveBeenCalledWith(`/agents/document-agent/${id}`, { method: "POST" });
  });

  it("createPage throws when the server refuses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 500 })));
    await expect(createPage()).rejects.toThrow("Could not create page: 500");
  });
});
