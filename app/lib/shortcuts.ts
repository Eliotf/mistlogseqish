/**
 * Every keyboard shortcut Mistlog has, for the shortcut sheet (PRD F43).
 * This list is the one place they are written down: the sheet renders it,
 * and tests/unit/lib/shortcuts.test.ts checks each entry against the code
 * that handles it, so adding a shortcut here means adding its check there.
 *
 * Keys are written as combos joined with "+", alternatives as separate
 * strings. "Mod" is Cmd on a Mac and Ctrl elsewhere; "Up" and "Down" are
 * the arrow keys. A combo with a space ("g j") is a sequence: press one key,
 * then the other.
 */

export interface Shortcut {
  /** Stable name, used by the tests. */
  id: string;
  /** Alternatives, each a combo such as "Mod+Enter" or a sequence such as "g j". */
  keys: readonly string[];
  /** What it does, in a few words. */
  action: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: readonly Shortcut[];
}

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: "Getting around",
    shortcuts: [
      { id: "sheet", keys: ["?"], action: "Show these shortcuts" },
      { id: "go-journals", keys: ["g j"], action: "Go to the journals" },
      { id: "go-pages", keys: ["g a"], action: "Go to All pages" },
      { id: "search", keys: ["Mod+K"], action: "Search, even while typing" },
      { id: "side-panel", keys: ["t r"], action: "Show or hide the side panel" },
    ],
  },
  {
    title: "In the search box",
    shortcuts: [
      { id: "search-choose", keys: ["Up", "Down"], action: "Choose a result" },
      { id: "search-open", keys: ["Enter"], action: "Open it" },
      { id: "search-side", keys: ["Mod+Enter", "Mod+click"], action: "Open it in the side panel" },
      { id: "search-close", keys: ["Esc"], action: "Close the search box" },
    ],
  },
  {
    title: "Writing",
    shortcuts: [
      { id: "enter", keys: ["Enter"], action: "New bullet at the same level" },
      { id: "indent", keys: ["Tab", "Shift+Tab"], action: "Indent / outdent, with children" },
      { id: "backspace", keys: ["Backspace"], action: "Right after a bullet: outdent, then remove the bullet" },
      { id: "task", keys: ["Mod+Enter"], action: "Cycle TODO → DOING → LATER → NOW → DONE" },
      { id: "slash", keys: ["/"], action: "Commands: task keywords, date, link, headings" },
      { id: "undo", keys: ["Mod+Z"], action: "Undo" },
      { id: "redo", keys: ["Mod+Shift+Z", "Mod+Y"], action: "Redo" },
    ],
  },
  {
    title: "Blocks",
    shortcuts: [
      { id: "move", keys: ["Alt+Shift+Up", "Alt+Shift+Down"], action: "Move the block up / down" },
      { id: "fold", keys: ["Mod+Up", "Mod+Down"], action: "Fold / unfold its children" },
      { id: "zoom-in", keys: ["Mod+."], action: "Zoom into the block" },
      { id: "zoom-out", keys: ["Mod+,"], action: "Zoom out one level" },
      { id: "zoom-click", keys: ["Click a bullet"], action: "Zoom into its block" },
    ],
  },
  {
    title: "Links and dates",
    shortcuts: [
      { id: "link", keys: ["[["], action: "Link to a page" },
      { id: "date", keys: ["@"], action: "Link to a date (@next fri, @in 2 weeks)" },
      { id: "suggest-choose", keys: ["Up", "Down", "Enter", "Tab"], action: "Choose a suggestion" },
      { id: "suggest-close", keys: ["Esc"], action: "Close the suggestions, keeping what you typed" },
      { id: "open-link", keys: ["Alt+Enter"], action: "Open the link at the cursor" },
      { id: "open-link-side", keys: ["Alt+Shift+Enter"], action: "Open it in the side panel" },
      { id: "link-side-click", keys: ["Mod+click"], action: "Open a link in the side panel" },
    ],
  },
  {
    title: "Selecting blocks",
    shortcuts: [
      { id: "select", keys: ["Esc"], action: "Select the block at the cursor" },
      { id: "select-extend", keys: ["Shift+Up", "Shift+Down"], action: "Select more blocks" },
      { id: "select-move", keys: ["Up", "Down"], action: "Move the selection" },
      { id: "select-indent", keys: ["Tab", "Shift+Tab"], action: "Indent / outdent the selected blocks" },
      { id: "select-task", keys: ["Mod+Enter"], action: "Cycle the selected tasks" },
      { id: "select-copy", keys: ["Mod+C", "Mod+X"], action: "Copy / cut the selected blocks" },
      { id: "select-delete", keys: ["Backspace", "Delete"], action: "Delete the selected blocks" },
      { id: "select-leave", keys: ["Esc", "Enter"], action: "Back to typing" },
    ],
  },
  {
    title: "On a page",
    shortcuts: [
      { id: "title-save", keys: ["Enter"], action: "In the title: save it" },
      { id: "title-cancel", keys: ["Esc"], action: "In the title: undo your change" },
      { id: "comment", keys: ["Mod+Shift+M"], action: "Add a comment" },
      { id: "preview", keys: ["Hold P"], action: "Preview, outside the editor" },
    ],
  },
];

/** Every shortcut in the list, in order. */
export function allShortcuts(): Shortcut[] {
  return SHORTCUT_GROUPS.flatMap((group) => group.shortcuts);
}

const KEY_NAMES: Record<string, string> = { Up: "↑", Down: "↓" };

/** How to show a combo: "Mod+Up" is "⌘+↑" on a Mac (mod "⌘") and "Ctrl+↑" elsewhere. */
export function keyLabel(combo: string, mod: string): string {
  if (combo.length === 1) return combo;
  return combo
    .split("+")
    .map((part) => (part === "Mod" ? mod : (KEY_NAMES[part] ?? part)))
    .join("+");
}

/**
 * True if a key event is typing into a field or editor, where single-key
 * shortcuts must not fire. Checks the attribute too: jsdom has no
 * isContentEditable.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true;
  return !!target.closest('[contenteditable]:not([contenteditable="false"])');
}

type KeyFields = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "target" | "isComposing">;

/** Whether a key event could start or finish a single-key shortcut: no Cmd, Ctrl or Alt, not typing. */
function plainKey(event: KeyFields): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey && !event.isComposing && !isTypingTarget(event.target);
}

/** `?` outside text fields. Matched on the character, so Shift (or no Shift, on some layouts) doesn't matter. */
export function isSheetShortcut(event: KeyFields): boolean {
  return event.key === "?" && plainKey(event);
}

/** How long after `g` the second key still counts. */
export const GO_CHORD_MS = 1000;

/** Where each `g` sequence goes. */
export const GO_TARGETS: Readonly<Record<string, string>> = { j: "/", a: "/pages" };

const MODIFIER_KEYS = new Set(["Shift", "Meta", "Control", "Alt", "AltGraph", "CapsLock", "Fn"]);

/**
 * Follows `g` sequences (`g j`, `g a`) across key events. `next` returns
 * the path to go to when an event finishes a sequence, or null. Any other
 * key, a key with a modifier, typing, or a pause longer than GO_CHORD_MS
 * cancels a started sequence.
 */
export function goChord(now: () => number = Date.now) {
  let gAt: number | null = null;
  return {
    next(event: KeyFields): string | null {
      // Pressing Shift on its way to another key changes nothing
      if (MODIFIER_KEYS.has(event.key)) return null;
      if (!plainKey(event)) {
        gAt = null;
        return null;
      }
      const started = gAt;
      gAt = null;
      if (started !== null && now() - started <= GO_CHORD_MS && Object.hasOwn(GO_TARGETS, event.key)) return GO_TARGETS[event.key];
      if (event.key === "g") gAt = now();
      return null;
    },
  };
}
