import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { BLOCK_ID_ATTR } from "./block-ids";
import { findPomos, formatTimeLeft, isRunning, timeLeft, toggle, type PomoRef } from "./pomodoro";
import { pomodoroStore, timerKey } from "./pomodoro-store";

/**
 * Shows the Pomodoro timers written in a page (`{{POMO}}`, `{{POMO 10}}`;
 * rules in pomodoro.ts, PRD F22). The timer appears where its text is, with
 * start or pause and reset buttons. As with images, the text is hidden on
 * every line but the caret's, where it shows so it can be edited. From the
 * keyboard, Mod+Alt+P starts or pauses the first timer on the caret's line
 * and Mod+Alt+Shift+P resets it. A line not yet given a block ID (just
 * typed) shows its timer once it has one.
 */

export const pomodoroKey = new PluginKey("pomodoro");

function caretLine(state: EditorState): number | null {
  const { $head } = state.selection;
  return $head.depth > 0 ? $head.before(1) : null;
}

function render(wrap: HTMLElement, key: string, minutes: number): void {
  const timer = pomodoroStore.get(key, minutes);
  const running = isRunning(timer);
  const phase = timer.phase === "focus" ? "Focus" : "Break";
  const left = formatTimeLeft(timeLeft(timer, Date.now()));
  wrap.dataset.phase = timer.phase;
  wrap.dataset.running = String(running);
  const time = wrap.querySelector<HTMLElement>(".md-pomo-time")!;
  time.textContent = timer.phase === "focus" ? left : `Break ${left}`;
  time.setAttribute("aria-label", `${phase}, ${left} left`);
  const button = wrap.querySelector<HTMLButtonElement>(".md-pomo-toggle")!;
  // U+FE0E asks for the text form, not the coloured emoji (iOS shows ⏸ as one)
  button.textContent = running ? "⏸\uFE0E" : "▶\uFE0E";
  button.setAttribute("aria-label", running ? "Pause" : `Start ${phase.toLowerCase()}`);
}

function timerWidget(key: string, minutes: number): (view: { dom: HTMLElement }) => HTMLElement {
  return (view) => {
    const doc = view.dom.ownerDocument;
    const wrap = doc.createElement("span");
    wrap.className = "md-pomo";
    wrap.contentEditable = "false";
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Pomodoro timer");
    const icon = doc.createElement("span");
    icon.className = "md-pomo-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "🍅";
    const time = doc.createElement("span");
    time.className = "md-pomo-time";
    time.setAttribute("role", "timer");
    const button = (className: string, onPress: () => void) => {
      const el = doc.createElement("button");
      el.type = "button";
      el.className = className;
      el.tabIndex = -1;
      // Keep the caret (and the phone keyboard) where it is
      el.addEventListener("mousedown", (event) => event.preventDefault());
      el.addEventListener("click", (event) => {
        event.preventDefault();
        onPress();
      });
      return el;
    };
    const toggleButton = button("md-pomo-toggle", () => pomodoroStore.update(key, minutes, toggle));
    const reset = button("md-pomo-reset", () => pomodoroStore.reset(key, minutes));
    reset.textContent = "↺";
    reset.setAttribute("aria-label", "Reset");
    for (const part of [icon, time, toggleButton, reset]) wrap.appendChild(part);
    render(wrap, key, minutes);
    const unsubscribe = pomodoroStore.subscribe(key, minutes, () => render(wrap, key, minutes));
    (wrap as HTMLElement & { pomoUnsubscribe?: () => void }).pomoUnsubscribe = unsubscribe;
    return wrap;
  };
}

/** The decorations for every timer in the document: the timer, and hidden text away from the caret. */
export function pomodoroDecorations(state: EditorState): DecorationSet {
  const decorations: Decoration[] = [];
  const caret = caretLine(state);
  state.doc.forEach((line, offset) => {
    const text = line.textContent;
    if (!/\{\{/.test(text)) return;
    const blockId: unknown = line.attrs[BLOCK_ID_ATTR];
    if (typeof blockId !== "string" || !blockId) return;
    const start = offset + 1;
    findPomos(text).forEach((pomo, index) => {
      if (offset !== caret) decorations.push(Decoration.inline(start + pomo.from, start + pomo.to, { class: "md-pomo-source" }));
      const key = timerKey(blockId, index);
      decorations.push(
        Decoration.widget(start + pomo.to, timerWidget(key, pomo.minutes), {
          side: -1,
          key: `pomo ${key} ${pomo.minutes}`,
          // The timer is not text: presses on it never move the caret
          stopEvent: () => true,
          ignoreSelection: true,
          destroy: (node) => (node as HTMLElement & { pomoUnsubscribe?: () => void }).pomoUnsubscribe?.(),
        }),
      );
    });
  });
  return DecorationSet.create(state.doc, decorations);
}

/** The first timer on the caret's line, as its store key and length, or null. */
export function timerAtCaret(state: EditorState): { key: string; pomo: PomoRef } | null {
  const { $head } = state.selection;
  if ($head.depth === 0) return null;
  const line = $head.node(1);
  const blockId: unknown = line.attrs[BLOCK_ID_ATTR];
  const pomo = findPomos(line.textContent)[0];
  if (typeof blockId !== "string" || !blockId || !pomo) return null;
  return { key: timerKey(blockId, 0), pomo };
}

export const Pomodoro = Extension.create({
  name: "pomodoro",

  addKeyboardShortcuts() {
    return {
      "Mod-Alt-p": () => {
        const found = timerAtCaret(this.editor.state);
        if (!found) return false;
        pomodoroStore.update(found.key, found.pomo.minutes, toggle);
        return true;
      },
      "Mod-Alt-Shift-p": () => {
        const found = timerAtCaret(this.editor.state);
        if (!found) return false;
        pomodoroStore.reset(found.key, found.pomo.minutes);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: pomodoroKey,
        props: { decorations: pomodoroDecorations },
      }),
    ];
  },
});
