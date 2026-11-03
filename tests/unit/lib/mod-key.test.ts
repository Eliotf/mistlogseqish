import { describe, it, expect, vi, afterEach } from "vitest";
import { modKeyLabel } from "~/lib/mod-key";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("modKeyLabel", () => {
  it("is ⌘ on a Mac and Ctrl elsewhere", () => {
    vi.stubGlobal("navigator", { platform: "MacIntel" });
    expect(modKeyLabel()).toBe("⌘");
    vi.stubGlobal("navigator", { platform: "Win32" });
    expect(modKeyLabel()).toBe("Ctrl");
  });

  it("works where navigator has no platform, as on the Workers runtime", () => {
    vi.stubGlobal("navigator", {});
    expect(modKeyLabel()).toBe("Ctrl");
    vi.stubGlobal("navigator", undefined);
    expect(modKeyLabel()).toBe("Ctrl");
  });

  // Regression: TasksView read navigator.platform when its module loaded, which threw on
  // the Workers runtime and broke the server build, so every page failed to render
  it("lets the Tasks view load where navigator has no platform", async () => {
    vi.stubGlobal("navigator", {});
    await expect(import("~/components/TasksView")).resolves.toBeTruthy();
  });
});
