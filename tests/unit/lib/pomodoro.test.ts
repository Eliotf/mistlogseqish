// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { Editor } from "@tiptap/core";
import Document from "@tiptap/extension-document";
import Text from "@tiptap/extension-text";
import { TextSelection } from "@tiptap/pm/state";
import { BlockParagraph } from "~/lib/block-id-editing";
import {
  findPomos,
  finishRound,
  formatTimeLeft,
  isPomoTimer,
  newTimer,
  pause,
  start,
  timeLeft,
  toggle,
  type PomoTimer,
} from "~/lib/pomodoro";
import { pomodoroStore, pomodoroTicking, resetPomodoroStore, tick, timerKey } from "~/lib/pomodoro-store";
import { Pomodoro, timerAtCaret } from "~/lib/pomodoro-editing";

const MIN = 60_000;

describe("findPomos", () => {
  it("finds {{POMO}} as a 25 minute timer, and {{POMO 10}} as 10", () => {
    expect(findPomos("- work {{POMO}} now")).toEqual([{ from: 7, to: 15, minutes: 25 }]);
    expect(findPomos("- What are you thinking about {{POMO 10}}")).toEqual([{ from: 30, to: 41, minutes: 10 }]);
  });

  it("reads Roam's forms, any case, and several on a line", () => {
    expect(findPomos("{{[[POMO]]}} {{pomo: 15}} {{ POMO 5 }}").map((p) => p.minutes)).toEqual([25, 15, 5]);
  });

  it("keeps lengths between 1 and 180 minutes", () => {
    expect(findPomos("{{POMO 0}} {{POMO 999}}").map((p) => p.minutes)).toEqual([1, 180]);
  });

  it("leaves other braces alone", () => {
    expect(findPomos("{{embed [[Page]]}} {{POMODORO}} {POMO}")).toEqual([]);
  });
});

describe("timer rounds", () => {
  it("starts, pauses and carries on from the time a round ends, not a count", () => {
    let t = start(newTimer(10), 0);
    expect(t.endsAt).toBe(10 * MIN);
    expect(timeLeft(t, 4 * MIN)).toBe(6 * MIN);
    t = pause(t, 4 * MIN);
    expect(t).toEqual({ phase: "focus", rounds: 0, endsAt: null, leftMs: 6 * MIN });
    expect(timeLeft(t, 60 * MIN)).toBe(6 * MIN);
    t = toggle(t, 100 * MIN);
    expect(t.endsAt).toBe(106 * MIN);
    expect(start(t, 101 * MIN)).toBe(t);
    expect(pause(newTimer(10), 0)).toEqual(newTimer(10));
  });

  it("moves focus into a 5 minute break, and a break back into focus, stopped each time", () => {
    const focus = start(newTimer(10), 0);
    expect(finishRound(focus, 10 * MIN - 1, 10)).toBeNull();
    const rest = finishRound(focus, 10 * MIN, 10)!;
    expect(rest).toEqual({ phase: "break", rounds: 1, endsAt: null, leftMs: 5 * MIN });
    expect(finishRound(rest, 99 * MIN, 10)).toBeNull(); // not running
    expect(finishRound(start(rest, 0), 5 * MIN, 10)).toEqual({ phase: "focus", rounds: 1, endsAt: null, leftMs: 10 * MIN });
  });

  it("gives a 15 minute break after every fourth focus round", () => {
    const third: PomoTimer = { phase: "focus", rounds: 3, endsAt: 0, leftMs: 0 };
    expect(finishRound(third, 0, 25)?.leftMs).toBe(15 * MIN);
    expect(finishRound({ ...third, rounds: 4 }, 0, 25)?.leftMs).toBe(5 * MIN);
  });

  it("shows minutes and seconds, rounded up", () => {
    expect(formatTimeLeft(10 * MIN)).toBe("10:00");
    expect(formatTimeLeft(61_001)).toBe("1:02");
    expect(formatTimeLeft(0)).toBe("0:00");
  });

  it("accepts only well-formed stored timers", () => {
    expect(isPomoTimer(newTimer(5))).toBe(true);
    expect(isPomoTimer({ ...newTimer(5), endsAt: 3 })).toBe(true);
    expect(isPomoTimer(null)).toBe(false);
    expect(isPomoTimer({ ...newTimer(5), phase: "nap" })).toBe(false);
    expect(isPomoTimer({ ...newTimer(5), leftMs: -1 })).toBe(false);
    expect(isPomoTimer({ ...newTimer(5), endsAt: "soon" })).toBe(false);
    expect(isPomoTimer({ ...newTimer(5), rounds: Number.NaN })).toBe(false);
  });
});

/** A fake Web Audio context that records each chime's tones. */
function fakeAudio() {
  const tones: number[] = [];
  class FakeContext {
    currentTime = 0;
    destination = {};
    resume = vi.fn(async () => {});
    createOscillator() {
      const osc = { frequency: { value: 0 }, connect: (g: unknown) => g, start: () => tones.push(osc.frequency.value), stop: () => {} };
      return osc;
    }
    createGain() {
      const gain = { gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} }, connect: (d: unknown) => d };
      return gain;
    }
  }
  vi.stubGlobal("AudioContext", FakeContext);
  return tones;
}

describe("pomodoroStore", () => {
  beforeEach(() => {
    resetPomodoroStore();
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    resetPomodoroStore();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps a timer on this device, so it survives a reload", () => {
    pomodoroStore.update("b1:0", 10, start, 0);
    expect(JSON.parse(localStorage.getItem("mistlog:pomo:b1:0")!)).toEqual({ phase: "focus", rounds: 0, endsAt: 10 * MIN, leftMs: 10 * MIN });
    resetPomodoroStore(); // a reload: memory gone, storage kept
    expect(pomodoroStore.get("b1:0", 10).endsAt).toBe(10 * MIN);
  });

  it("ignores stored nonsense and starts afresh", () => {
    localStorage.setItem("mistlog:pomo:b1:0", "{not json");
    expect(pomodoroStore.get("b1:0", 10)).toEqual(newTimer(10));
    localStorage.setItem("mistlog:pomo:b2:0", JSON.stringify({ phase: "nap" }));
    expect(pomodoroStore.get("b2:0", 10)).toEqual(newTimer(10));
  });

  it("ticks each second only while a timer on screen runs, and chimes when a round ends", () => {
    const tones = fakeAudio();
    const seen = vi.fn();
    const stop = pomodoroStore.subscribe("b1:0", 1, seen);
    expect(pomodoroTicking()).toBe(false); // nothing running, no ticking
    pomodoroStore.update("b1:0", 1, start); // the press also allows sound
    expect(pomodoroTicking()).toBe(true);
    seen.mockClear();
    vi.advanceTimersByTime(1000);
    expect(seen).toHaveBeenCalled();
    vi.advanceTimersByTime(59_000);
    expect(pomodoroStore.get("b1:0", 1)).toEqual({ phase: "break", rounds: 1, endsAt: null, leftMs: 5 * MIN });
    expect(tones).toEqual([880, 660]);
    expect(pomodoroTicking()).toBe(false); // the break waits to be started
    pomodoroStore.update("b1:0", 1, start);
    stop();
    expect(pomodoroTicking()).toBe(false); // off screen: no ticking
  });

  it("moves on quietly from a round that ended while the page was closed", () => {
    const tones = fakeAudio();
    pomodoroStore.update("b1:0", 10, start, 0);
    resetPomodoroStore();
    vi.setSystemTime(3 * 60 * MIN);
    pomodoroStore.update("other:0", 10, (t) => t); // a press elsewhere, so sound is allowed
    pomodoroStore.subscribe("b1:0", 10, () => {});
    expect(pomodoroStore.get("b1:0", 10).phase).toBe("break");
    expect(tones).toEqual([]);
  });

  it("resets to a full focus round and forgets it", () => {
    pomodoroStore.update("b1:0", 10, start, 0);
    pomodoroStore.reset("b1:0", 10);
    expect(pomodoroStore.get("b1:0", 10)).toEqual(newTimer(10));
    expect(localStorage.getItem("mistlog:pomo:b1:0")).toBeNull();
  });

  it("gives an unstarted timer its new length when the text changes it", () => {
    pomodoroStore.subscribe("b1:0", 10, () => {})();
    pomodoroStore.subscribe("b1:0", 15, () => {})();
    expect(pomodoroStore.get("b1:0", 15).leftMs).toBe(15 * MIN);
    // A started one keeps its round
    pomodoroStore.update("b1:0", 15, start, 0);
    pomodoroStore.subscribe("b1:0", 20, () => {})();
    expect(pomodoroStore.get("b1:0", 20).endsAt).toBe(15 * MIN);
  });

  it("tick with nothing ended changes nothing", () => {
    pomodoroStore.update("b1:0", 10, start, 0);
    tick(MIN);
    expect(pomodoroStore.get("b1:0", 10).phase).toBe("focus");
  });
});

describe("Pomodoro in the editor", () => {
  let editor: Editor;
  beforeEach(() => {
    resetPomodoroStore();
    localStorage.clear();
  });
  afterEach(() => {
    editor?.destroy();
    resetPomodoroStore();
    vi.unstubAllGlobals();
  });

  function makeEditor(lines: Array<{ text: string; blockId: string | null }>) {
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [Document, BlockParagraph, Text, Pomodoro],
      content: { type: "doc", content: lines.map((l) => ({ type: "paragraph", attrs: { blockId: l.blockId }, content: l.text ? [{ type: "text", text: l.text }] : [] })) },
    });
    return editor;
  }

  const timers = () => [...editor.view.dom.querySelectorAll<HTMLElement>(".md-pomo")];

  it("shows a timer where {{POMO 10}} is written, its text hidden away from the caret", () => {
    makeEditor([
      { text: "- What are you thinking about {{POMO 10}}", blockId: "aaaaaaaa" },
      { text: "- other", blockId: "bbbbbbbb" },
    ]);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1)));
    const [timer] = timers();
    expect(timer.querySelector(".md-pomo-time")?.textContent).toBe("10:00");
    expect(timer.querySelector(".md-pomo-time")?.getAttribute("aria-label")).toBe("Focus, 10:00 left");
    expect(timer.querySelector(".md-pomo-toggle")?.getAttribute("aria-label")).toBe("Start focus");
    expect(editor.view.dom.querySelector(".md-pomo-source")?.textContent).toBe("{{POMO 10}}");
    // The text itself is unchanged
    expect(editor.state.doc.firstChild?.textContent).toBe("- What are you thinking about {{POMO 10}}");
  });

  it("shows the text on the caret's line, so it can be edited", () => {
    makeEditor([{ text: "- {{POMO}}", blockId: "aaaaaaaa" }]);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3)));
    expect(editor.view.dom.querySelector(".md-pomo-source")).toBeNull();
    expect(timers()).toHaveLength(1);
  });

  it("waits for a block ID before showing a timer", () => {
    makeEditor([{ text: "- {{POMO}}", blockId: null }]);
    expect(timers()).toHaveLength(0);
  });

  it("starts, pauses and resets from its buttons", () => {
    makeEditor([{ text: "- {{POMO 10}}", blockId: "aaaaaaaa" }, { text: "", blockId: "bbbbbbbb" }]);
    const timer = () => timers()[0];
    const press = (cls: string) => timer().querySelector<HTMLButtonElement>(cls)!.click();
    press(".md-pomo-toggle");
    expect(pomodoroStore.get(timerKey("aaaaaaaa", 0), 10).endsAt).not.toBeNull();
    expect(timer().dataset.running).toBe("true");
    expect(timer().querySelector(".md-pomo-toggle")?.getAttribute("aria-label")).toBe("Pause");
    press(".md-pomo-toggle");
    expect(timer().dataset.running).toBe("false");
    press(".md-pomo-reset");
    expect(pomodoroStore.get(timerKey("aaaaaaaa", 0), 10)).toEqual(newTimer(10));
  });

  it("keeps the caret where it is when a button is pressed", () => {
    makeEditor([{ text: "- {{POMO}}", blockId: "aaaaaaaa" }]);
    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    timers()[0].querySelector(".md-pomo-toggle")!.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  });

  it("starts or pauses, and resets, the caret line's timer from the keyboard", () => {
    makeEditor([{ text: "- {{POMO 5}} and {{POMO}}", blockId: "aaaaaaaa" }, { text: "- none", blockId: "bbbbbbbb" }]);
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 2)));
    expect(timerAtCaret(editor.state)).toEqual({ key: "aaaaaaaa:0", pomo: { from: 2, to: 12, minutes: 5 } });
    const shortcuts = Pomodoro.config.addKeyboardShortcuts!.call({ editor } as never) as Record<string, () => boolean>;
    expect(shortcuts["Mod-Alt-p"]()).toBe(true);
    expect(pomodoroStore.get("aaaaaaaa:0", 5).endsAt).not.toBeNull();
    expect(shortcuts["Mod-Alt-Shift-p"]()).toBe(true);
    expect(pomodoroStore.get("aaaaaaaa:0", 5)).toEqual(newTimer(5));
    // A line with no timer leaves the keys alone
    editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, editor.state.doc.content.size - 1)));
    expect(timerAtCaret(editor.state)).toBeNull();
    expect(shortcuts["Mod-Alt-p"]()).toBe(false);
    expect(shortcuts["Mod-Alt-Shift-p"]()).toBe(false);
  });

  it("stops following a timer when its text is removed", () => {
    makeEditor([{ text: "- {{POMO 1}}", blockId: "aaaaaaaa" }]);
    vi.useFakeTimers();
    try {
      timers()[0].querySelector<HTMLButtonElement>(".md-pomo-toggle")!.click();
      expect(pomodoroTicking()).toBe(true);
      editor.commands.setContent({ type: "doc", content: [{ type: "paragraph", attrs: { blockId: "aaaaaaaa" }, content: [{ type: "text", text: "- gone" }] }] });
      expect(timers()).toHaveLength(0);
      expect(pomodoroTicking()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
