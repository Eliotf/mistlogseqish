// @vitest-environment jsdom
/**
 * The shortcut list (PRD F43) and its helpers. The list must stay in step
 * with the code: every entry has a check below that fails if the code that
 * handles it goes, and a new entry without a check fails too.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getExtensionField, type AnyExtension } from "@tiptap/core";
import Collaboration from "@tiptap/extension-collaboration";
import { BulletEditing } from "~/lib/bullet-editing";
import { TaskEditing } from "~/lib/task-editing";
import { Folding } from "~/lib/folding-editing";
import { BlockMoving } from "~/lib/block-moving";
import { BlockSelectionStart } from "~/lib/block-selection";
import { Zoom } from "~/lib/zoom-editing";
import { Wikilink } from "~/lib/wikilink-editing";
import { allShortcuts, goChord, GO_CHORD_MS, GO_TARGETS, isSheetShortcut, isTypingTarget, keyLabel, SHORTCUT_GROUPS } from "~/lib/shortcuts";

/** An editor extension's keymap, by key, without running any handler. */
function keymapOf(extension: AnyExtension): Record<string, unknown> {
  const add = getExtensionField<(() => Record<string, unknown>) | undefined>(extension, "addKeyboardShortcuts", {
    name: extension.name,
    options: extension.options,
    storage: {},
    // Only the handlers use the editor, and none is run here
    editor: undefined as never,
    type: null,
  } as never);
  return add ? add() : {};
}

const source = (file: string) => readFileSync(resolve(__dirname, "../../..", file), "utf8");

/** How each listed shortcut is checked against the code. */
type Check =
  /** A TipTap keymap entry, on an extension the editor loads (mounted is how Editor.tsx adds it). */
  | { extension: AnyExtension; mounted: string; keys: string[] }
  /** Handled by code outside a keymap: the file must still contain each snippet. */
  | { file: string; has: string[] };

const SEARCH_BOX = "app/components/SearchBox.tsx";
const SELECTION = "app/lib/block-selection.ts";
const LINKS = "app/lib/wikilink-editing.ts";
const DATES = "app/lib/date-trigger.ts";
// The app-wide frame around every screen (root.tsx renders it)
const SHELL = "app/components/AppShell.tsx";

const CHECKS: Record<string, Check[]> = {
  // Behaviour tested in tests/unit/components/shortcut-sheet.test.tsx; here, that they are mounted
  sheet: [{ file: SHELL, has: ["<ShortcutSheetProvider>", "<ShortcutSheet />"] }],
  "go-journals": [{ file: "app/lib/shortcut-sheet.tsx", has: ["chord.next(event)", "navigate(to)"] }],
  "go-pages": [{ file: "app/lib/shortcut-sheet.tsx", has: ["chord.next(event)", "navigate(to)"] }],
  search: [
    { file: "app/lib/search-box.tsx", has: ['event.key.toLowerCase() === "k"'] },
    { file: SHELL, has: ["<SearchBoxProvider>", "<SearchBox />"] },
  ],
  "left-sidebar": [
    { file: "app/lib/side-panel.tsx", has: ['event.key === "t"', "event.key === key"] },
    { file: SHELL, has: ['useToggleShortcut(sidebar?.toggleFromKey ?? noop, "l")'] },
  ],
  "side-panel": [
    { file: "app/lib/side-panel.tsx", has: ['event.key === "t"', "event.key === key", 'key: "r" | "l" = "r"'] },
    { file: SHELL, has: ["useToggleShortcut(panel.toggle)"] },
  ],
  "search-choose": [{ file: SEARCH_BOX, has: ['event.key === "ArrowDown" || event.key === "ArrowUp"'] }],
  "search-open": [{ file: SEARCH_BOX, has: ['event.key === "Enter"', "void choose(rows[current], side)"] }],
  "search-side": [{ file: SEARCH_BOX, has: ["const side = event.metaKey || event.ctrlKey", "void choose(rows[index], event.metaKey || event.ctrlKey)"] }],
  "search-close": [{ file: SEARCH_BOX, has: ['event.key === "Escape"'] }],
  enter: [{ extension: BulletEditing, mounted: "BulletEditing.configure", keys: ["Enter"] }],
  indent: [{ extension: BulletEditing, mounted: "BulletEditing.configure", keys: ["Tab", "Shift-Tab"] }],
  backspace: [{ extension: BulletEditing, mounted: "BulletEditing.configure", keys: ["Backspace"] }],
  task: [{ extension: TaskEditing, mounted: "TaskEditing.configure", keys: ["Mod-Enter"] }],
  undo: [{ extension: Collaboration, mounted: "Collaboration.configure", keys: ["Mod-z"] }],
  redo: [{ extension: Collaboration, mounted: "Collaboration.configure", keys: ["Shift-Mod-z", "Mod-y"] }],
  move: [{ extension: BlockMoving, mounted: "BlockMoving.configure", keys: ["Alt-Shift-ArrowUp", "Alt-Shift-ArrowDown"] }],
  fold: [{ extension: Folding, mounted: "Folding.configure", keys: ["Mod-ArrowUp", "Mod-ArrowDown"] }],
  "zoom-in": [{ extension: Zoom, mounted: "Zoom.configure", keys: ["Mod-."] }],
  "zoom-out": [{ extension: Zoom, mounted: "Zoom.configure", keys: ["Mod-,"] }],
  "zoom-click": [{ file: "app/lib/block-moving.ts", has: ["requestZoom(view.dom, id)"] }],
  link: [{ file: LINKS, has: ['text === "[" && before === "["'] }],
  date: [{ file: DATES, has: ['insertText("@", from, to)'] }],
  slash: [{ file: "app/lib/slash-menu.ts", has: ['insertText("/", from, to)'] }, { file: "app/components/Editor.tsx", has: ["SlashMenu.configure"] }],
  "suggest-choose": [
    { file: LINKS, has: ['event.key === "ArrowDown" || event.key === "ArrowUp"', '(event.key === "Enter" || event.key === "Tab")'] },
    { file: DATES, has: ['event.key === "ArrowDown" || event.key === "ArrowUp"', '(event.key === "Enter" || event.key === "Tab")'] },
  ],
  "suggest-close": [
    { file: LINKS, has: ["closeSuggestions();\n                return true;"] },
    { file: DATES, has: ['if (event.key === "Escape") {\n              close(view);'] },
  ],
  "open-link": [{ extension: Wikilink, mounted: "Wikilink.configure", keys: ["Alt-Enter"] }],
  "open-link-side": [{ extension: Wikilink, mounted: "Wikilink.configure", keys: ["Alt-Shift-Enter"] }],
  "link-side-click": [{ file: LINKS, has: ["(event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey"] }],
  select: [{ extension: BlockSelectionStart, mounted: "BlockSelectionStart", keys: ["Escape"] }],
  "select-extend": [{ file: SELECTION, has: ["event.shiftKey ? extendRange("] }],
  "select-move": [{ file: SELECTION, has: [": moveRange("] }],
  "select-indent": [{ file: SELECTION, has: ['key === "Tab" && canEdit()', "event.shiftKey ? -1 : 1"] }],
  "select-task": [{ file: SELECTION, has: ['mod && key === "Enter"'] }],
  "select-copy": [{ file: SELECTION, has: ["copy: (view, event) => copyOrCut(view, event, false, canEdit)", "cut: (view, event) => copyOrCut(view, event, true, canEdit)"] }],
  "select-delete": [{ file: SELECTION, has: ['(key === "Backspace" || key === "Delete") && canEdit()'] }],
  "select-leave": [{ file: SELECTION, has: ['key === "Escape" || (key === "Enter" && !event.shiftKey && !event.altKey)'] }],
  "title-save": [{ file: "app/components/PageTitle.tsx", has: ['if (e.key === "Enter") {\n      e.preventDefault();\n      e.currentTarget.blur();'] }],
  "title-cancel": [{ file: "app/components/PageTitle.tsx", has: ['e.key === "Escape"', "e.currentTarget.textContent = stored();"] }],
  comment: [{ file: "app/components/CommentInput.tsx", has: ['(e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "m"'] }],
  preview: [{ file: "app/components/PreviewToggle.tsx", has: ['if (e.key !== "p" && e.key !== "P") return;', "onHold(true)", "onHold(false)"] }],
};

describe("the shortcut list (F43)", () => {
  it("has unique ids, and every group and entry has something to show", () => {
    const ids = allShortcuts().map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const group of SHORTCUT_GROUPS) {
      expect(group.title).not.toBe("");
      expect(group.shortcuts.length).toBeGreaterThan(0);
    }
    for (const s of allShortcuts()) {
      expect(s.keys.length).toBeGreaterThan(0);
      expect(s.action).not.toBe("");
    }
  });

  it("has a check for every entry, and no check for an entry that is gone", () => {
    expect(Object.keys(CHECKS).sort()).toEqual(allShortcuts().map((s) => s.id).sort());
  });

  it.each(allShortcuts().map((s) => [s.id, s] as const))("%s is handled in the code", (id) => {
    const editor = source("app/components/Editor.tsx");
    for (const check of CHECKS[id]) {
      if ("extension" in check) {
        const keymap = keymapOf(check.extension);
        for (const key of check.keys) expect(keymap, `${check.extension.name} handles ${key}`).toHaveProperty([key]);
        expect(editor, `Editor.tsx loads ${check.mounted}`).toContain(check.mounted);
      } else {
        const text = source(check.file);
        for (const snippet of check.has) expect(text, `${check.file} still has ${snippet}`).toContain(snippet);
      }
    }
  });

  it("lists the go-to shortcuts it handles, and only those", () => {
    const listed = allShortcuts()
      .flatMap((s) => s.keys)
      .filter((k) => k.startsWith("g "))
      .map((k) => k.slice(2))
      .sort();
    expect(listed).toEqual(Object.keys(GO_TARGETS).sort());
    expect(GO_TARGETS).toEqual({ j: "/", a: "/pages" });
  });
});

describe("keyLabel", () => {
  it("shows Mod as the platform's key and arrows as arrows", () => {
    expect(keyLabel("Mod+Enter", "⌘")).toBe("⌘+Enter");
    expect(keyLabel("Mod+Enter", "Ctrl")).toBe("Ctrl+Enter");
    expect(keyLabel("Alt+Shift+Up", "Ctrl")).toBe("Alt+Shift+↑");
    expect(keyLabel("Mod+Down", "⌘")).toBe("⌘+↓");
    expect(keyLabel("Mod+.", "⌘")).toBe("⌘+.");
  });

  it("leaves single characters, sequences and words alone", () => {
    expect(keyLabel("?", "⌘")).toBe("?");
    expect(keyLabel("+", "⌘")).toBe("+");
    expect(keyLabel("g j", "⌘")).toBe("g j");
    expect(keyLabel("[[", "⌘")).toBe("[[");
    expect(keyLabel("Click a bullet", "⌘")).toBe("Click a bullet");
  });
});

function el(html: string): HTMLElement {
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  document.body.append(wrap);
  return wrap.firstElementChild as HTMLElement;
}

describe("isTypingTarget", () => {
  it("is true in inputs, text areas, selects and editable content", () => {
    expect(isTypingTarget(el("<input>"))).toBe(true);
    expect(isTypingTarget(el("<textarea></textarea>"))).toBe(true);
    expect(isTypingTarget(el("<select></select>"))).toBe(true);
    expect(isTypingTarget(el('<div contenteditable="true"></div>'))).toBe(true);
    expect(isTypingTarget(el("<div contenteditable></div>"))).toBe(true);
    expect(isTypingTarget(el('<div contenteditable="true"><p><span>in a line</span></p></div>').querySelector("span"))).toBe(true);
  });

  it("is false elsewhere", () => {
    expect(isTypingTarget(el("<button>x</button>"))).toBe(false);
    expect(isTypingTarget(el('<div contenteditable="false"></div>'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

const key = (k: string, over: Partial<KeyboardEvent> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, altKey: false, isComposing: false, target: document.body, ...over }) as KeyboardEvent;

describe("isSheetShortcut", () => {
  it("matches ? by its character, with or without Shift", () => {
    expect(isSheetShortcut(key("?"))).toBe(true);
    expect(isSheetShortcut(key("?", { shiftKey: true }))).toBe(true);
    expect(isSheetShortcut(key("/", { shiftKey: true }))).toBe(false);
    expect(isSheetShortcut(key("/"))).toBe(false);
  });

  it("is ignored with Cmd, Ctrl or Alt, while composing, and while typing", () => {
    expect(isSheetShortcut(key("?", { metaKey: true }))).toBe(false);
    expect(isSheetShortcut(key("?", { ctrlKey: true }))).toBe(false);
    expect(isSheetShortcut(key("?", { altKey: true }))).toBe(false);
    expect(isSheetShortcut(key("?", { isComposing: true }))).toBe(false);
    expect(isSheetShortcut(key("?", { target: el("<input>") }))).toBe(false);
  });
});

describe("goChord", () => {
  function chord() {
    let t = 1000;
    const c = goChord(() => t);
    return { next: (e: KeyboardEvent) => c.next(e), wait: (ms: number) => (t += ms) };
  }

  it("goes to the journals with g j and to All pages with g a", () => {
    const c = chord();
    expect(c.next(key("g"))).toBeNull();
    expect(c.next(key("j"))).toBe("/");
    expect(c.next(key("g"))).toBeNull();
    expect(c.next(key("a"))).toBe("/pages");
  });

  it("needs the g first, and each g counts once", () => {
    const c = chord();
    expect(c.next(key("j"))).toBeNull();
    expect(c.next(key("a"))).toBeNull();
    c.next(key("g"));
    expect(c.next(key("j"))).toBe("/");
    expect(c.next(key("j"))).toBeNull();
  });

  it("allows up to GO_CHORD_MS between the keys, and no more", () => {
    const c = chord();
    c.next(key("g"));
    c.wait(GO_CHORD_MS);
    expect(c.next(key("j"))).toBe("/");
    c.next(key("g"));
    c.wait(GO_CHORD_MS + 1);
    expect(c.next(key("j"))).toBeNull();
  });

  it("is cancelled by another key, and a second g starts again", () => {
    const c = chord();
    c.next(key("g"));
    expect(c.next(key("x"))).toBeNull();
    expect(c.next(key("j"))).toBeNull();
    c.next(key("g"));
    c.next(key("g"));
    expect(c.next(key("a"))).toBe("/pages");
  });

  it("doesn't fire with a modifier on either key, and isn't cancelled by pressing one alone", () => {
    const c = chord();
    c.next(key("g", { metaKey: true }));
    expect(c.next(key("j"))).toBeNull();
    c.next(key("g"));
    expect(c.next(key("j", { ctrlKey: true }))).toBeNull();
    expect(c.next(key("j"))).toBeNull();
    c.next(key("g"));
    expect(c.next(key("a", { altKey: true }))).toBeNull();
    c.next(key("g"));
    expect(c.next(key("Shift"))).toBeNull();
    expect(c.next(key("J"))).toBeNull();
    c.next(key("G"));
    expect(c.next(key("j"))).toBeNull();
  });

  it("ignores keys typed into a field or editor", () => {
    const c = chord();
    const input = el("<input>");
    const editor = el('<div contenteditable="true"></div>');
    c.next(key("g", { target: input }));
    expect(c.next(key("j"))).toBeNull();
    c.next(key("g"));
    expect(c.next(key("j", { target: editor }))).toBeNull();
    expect(c.next(key("j"))).toBeNull();
  });
});
