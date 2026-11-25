import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { applyWidth, clampWidth, dragWidth, keyWidth, saveWidth, type PanelSize } from "~/lib/panel-width";

interface ResizeHandleProps {
  size: PanelSize;
  /** What it resizes, for screen readers ("Resize the sidebar"). */
  label: string;
  /** The id of the panel it resizes. */
  controls: string;
  /** Where it sits: over the panel's inner edge. */
  className: string;
}

/**
 * A panel's draggable inner edge (PRD F8, F18). Drag it, or focus it and
 * use the arrow keys (Shift for bigger steps, Home and End for narrowest
 * and widest); double-click or Enter puts the default width back.
 */
export default function ResizeHandle({ size, label, controls, className }: ResizeHandleProps) {
  const drag = useRef<{ x: number; start: number; last: number | null } | null>(null);
  // For screen readers; the width itself lives in a CSS variable, so it is read from the panel
  const [width, setWidth] = useState<number | null>(null);

  /** How wide the panel is drawn now (its default, if never resized). */
  const drawnWidth = () => clampWidth(size, document.getElementById(controls)?.offsetWidth ?? size.min, window.innerWidth);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    drag.current = { x: event.clientX, start: drawnWidth(), last: null };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    document.documentElement.classList.add("resizing-panel");
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const next = dragWidth(size, drag.current.start, event.clientX - drag.current.x, window.innerWidth);
    drag.current.last = next;
    applyWidth(size, next);
    setWidth(next);
  };

  const onPointerUp = () => {
    const last = drag.current?.last;
    drag.current = null;
    document.documentElement.classList.remove("resizing-panel");
    if (last != null) saveWidth(size, last);
  };

  const reset = () => {
    saveWidth(size, null);
    setWidth(drawnWidth());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      reset();
      return;
    }
    const next = keyWidth(size, drawnWidth(), event.key, event.shiftKey, window.innerWidth);
    if (next === null) return;
    event.preventDefault();
    saveWidth(size, next);
    setWidth(next);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuemin={size.min}
      aria-valuemax={size.max}
      aria-valuenow={width ?? undefined}
      tabIndex={0}
      title="Drag to resize; double-click for the default width"
      onFocus={() => setWidth(drawnWidth())}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={reset}
      onKeyDown={onKeyDown}
      className={`group z-10 w-2 cursor-col-resize touch-none outline-none ${className}`}
    >
      <span aria-hidden="true" className="mx-auto block h-full w-0.5 transition-colors group-hover:bg-chartreuse group-focus-visible:bg-chartreuse group-active:bg-chartreuse" />
    </div>
  );
}
