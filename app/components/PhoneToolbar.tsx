import { useEffect, useState, useSyncExternalStore, type PointerEvent } from "react";
import { activeEditor } from "~/lib/active-editor";
import { OUTLINE_ACTIONS, runPhoneAction, type PhoneAction } from "~/lib/phone-actions";

const BUTTONS: Array<{ action: PhoneAction; glyph: string; label: string }> = [
  { action: "outdent", glyph: "⇤", label: "Outdent" },
  { action: "indent", glyph: "⇥", label: "Indent" },
  { action: "task", glyph: "☐", label: "Task" },
  { action: "link", glyph: "[[", label: "Link" },
  { action: "up", glyph: "↑", label: "Up" },
  { action: "down", glyph: "↓", label: "Down" },
  { action: "fold", glyph: "▾", label: "Fold" },
  { action: "done", glyph: "✓", label: "Done" },
];

const TOUCH = "(pointer: coarse)";
const noSubscription = () => () => {};

function subscribeTouch(onChange: () => void): () => void {
  const query = window.matchMedia(TOUCH);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** How far the on-screen keyboard pushes up from the bottom of the window, in pixels. */
function keyboardInset(): number {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
}

/**
 * The phone keyboard toolbar (PRD F17, decision 2026-10-22): while an editor
 * has focus on a touch screen, a row of buttons sits just above the
 * on-screen keyboard for what has no key there (indent, outdent, task, link,
 * move, fold) and to close the keyboard. Buttons act on pointer down and
 * never take focus, so the keyboard stays open.
 */
export default function PhoneToolbar() {
  const current = useSyncExternalStore(activeEditor.subscribe, activeEditor.get, () => null);
  const touch = useSyncExternalStore(typeof window === "undefined" ? noSubscription : subscribeTouch, () => window.matchMedia(TOUCH).matches, () => false);
  const [inset, setInset] = useState(0);

  // Follow the keyboard as it opens, closes or the page scrolls under it
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!current || !touch || !viewport) return;
    const update = () => setInset(keyboardInset());
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [current, touch]);

  if (!current || !touch) return null;
  const suggesting = current.suggesting();

  const press = (action: PhoneAction) => (event: PointerEvent<HTMLButtonElement>) => {
    // Keep focus (and the keyboard) in the editor
    event.preventDefault();
    runPhoneAction(current.editor, action, suggesting);
  };

  return (
    <div
      role="toolbar"
      aria-label="Editing controls"
      className="phone-toolbar fixed left-0 right-0 z-40 flex border-t border-border bg-paper"
      style={{ bottom: inset }}
    >
      {BUTTONS.map(({ action, glyph, label }) => {
        const disabled = suggesting && OUTLINE_ACTIONS.has(action);
        return (
          <button
            key={action}
            type="button"
            tabIndex={-1}
            aria-label={label}
            aria-disabled={disabled || undefined}
            onPointerDown={press(action)}
            className={`flex min-h-[46px] flex-1 flex-col items-center justify-center gap-px text-[10px] text-muted active:bg-chartreuse active:text-[#1a1a1a] ${
              disabled ? "opacity-40" : ""
            } [&+&]:border-l [&+&]:border-border`}
          >
            <b className="font-mono text-sm font-medium text-ink">{glyph}</b>
            {label}
          </button>
        );
      })}
    </div>
  );
}
