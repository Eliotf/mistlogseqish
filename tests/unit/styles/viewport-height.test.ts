import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Screens are sized to the visible height (dvh), never 100vh or h-screen:
 * on phones those are the height with the browser's bars hidden, and as
 * screens scroll inside themselves the bars never hide, so the bottom of
 * every screen sat under them in Safari and Chrome.
 */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(tsx?|css)$/.test(entry.name) ? [path] : [];
  });
}

describe("screen heights", () => {
  it("use dvh, not vh or h-screen", () => {
    const found = sources(resolve(__dirname, "../../../app")).flatMap((path) =>
      readFileSync(path, "utf8")
        .split("\n")
        .flatMap((text, i) => (/\bh-screen\b|\b100vh\b/.test(text.replace(/\/\*.*?\*\//g, "")) ? [`${path}:${i + 1}`] : [])),
    );
    expect(found).toEqual([]);
  });
});
