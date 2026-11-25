/**
 * The Markdown cheatsheet (PRD F43) must stay in step with the editor: each
 * example has a check below against the code that shows it, and a new
 * entry without a check fails.
 */
import { describe, it, expect } from "vitest";
import { MARKDOWN_CHEATSHEET } from "~/lib/markdown-cheatsheet";
import { CODE_FENCE_REGEX, MARKDOWN_PATTERNS } from "~/lib/markdown-decorations";
import { findImages } from "~/lib/images";
import { priorityOf, tagsInLine, writtenLinks } from "~/lib/note-parser";
import { taskStateOf } from "~/lib/tasks";
import { findPomos } from "~/lib/pomodoro";

/** The alternatives an example lists ("a or b", "a / b", "a … b", "[#A] [#B]"). */
function parts(example: string): string[] {
  return example.split(/ or | \/ | … |\s(?=\[#)/);
}

/** The editor's decoration pattern `name`'s first match in `text`. */
function firstMatch(name: string, text: string): string | undefined {
  const pattern = MARKDOWN_PATTERNS.find((p) => p.name === name);
  if (!pattern) return undefined;
  pattern.regex.lastIndex = 0;
  return pattern.regex.exec(text)?.[0];
}

/** Whether the editor's decoration pattern `name` matches all of `text`. */
function matchesWhole(name: string, text: string): boolean {
  return firstMatch(name, text) === text;
}

const CHECKS: Record<string, (example: string) => boolean> = {
  bold: (ex) => matchesWhole("bold", ex),
  italic: (ex) => {
    const [star, underscore] = parts(ex);
    return matchesWhole("italic", star) && matchesWhole("italic-underscore", underscore);
  },
  strikethrough: (ex) => matchesWhole("strikethrough", ex),
  code: (ex) => matchesWhole("code", ex),
  heading: (ex) => {
    const [first, last] = parts(ex);
    return first === "# Heading" && last === "###### Heading" && matchesWhole("heading", first) && matchesWhole("heading", last) && !matchesWhole("heading", "####### Heading");
  },
  quote: (ex) => matchesWhole("blockquote", ex.slice(0, 2)) && ex.startsWith("> "),
  hr: (ex) => matchesWhole("hr", ex),
  "code-block": (ex) => CODE_FENCE_REGEX.exec(ex)?.[2] === "js",
  "web-link": (ex) => matchesWhole("link", ex),
  // Shown as a picture, not as a web link
  image: (ex) => findImages(ex)[0]?.src === "photo.png" && firstMatch("link", ex) === undefined,
  "page-link": (ex) => writtenLinks(ex).length === 1 && writtenLinks(ex)[0].kind === "link" && writtenLinks(ex)[0].name === "Page",
  tag: (ex) => {
    const [plain, bracketed] = parts(ex);
    return tagsInLine(plain)[0]?.name === "tag" && tagsInLine(bracketed)[0]?.name === "two words";
  },
  task: (ex) => {
    const words = parts(ex);
    return words.length === 5 && words.every((word) => taskStateOf(`- ${word} call Sam`) === word);
  },
  priority: (ex) => {
    const all = parts(ex);
    return all.length === 3 && all.every((p, i) => priorityOf(`- TODO ${p} call Sam`) === "ABC"[i]);
  },
  pomodoro: (ex) => {
    const [plain, ten] = parts(ex);
    return findPomos(plain)[0]?.minutes === 25 && findPomos(ten)[0]?.minutes === 10;
  },
};

describe("the Markdown cheatsheet", () => {
  it("has a check for every entry, and no check for an entry that's gone", () => {
    expect(Object.keys(CHECKS).sort()).toEqual(MARKDOWN_CHEATSHEET.map((e) => e.id).sort());
  });

  it("has no two entries with the same id", () => {
    const ids = MARKDOWN_CHEATSHEET.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(MARKDOWN_CHEATSHEET.map((e) => [e.id, e.example] as const))("%s: the editor understands %s", (id, example) => {
    expect(CHECKS[id]?.(example)).toBe(true);
  });
});
