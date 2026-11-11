import { Fragment, useEffect, useId, useRef } from "react";
import { useShortcutSheet } from "~/lib/shortcut-sheet";
import { keyLabel, SHORTCUT_GROUPS } from "~/lib/shortcuts";
import { useModKeyLabel } from "~/lib/mod-key";

/** The keyboard shortcut sheet, while it is open (see ShortcutSheetProvider). */
export default function ShortcutSheet() {
  const control = useShortcutSheet();
  if (!control?.isOpen) return null;
  return <SheetDialog onClose={control.close} />;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Every shortcut, grouped, as in the prototype's key list (PRD F43). Modal:
 * Tab stays inside, Esc, the close button or a click outside closes it.
 */
function SheetDialog({ onClose }: { onClose: () => void }) {
  const mod = useModKeyLabel();
  const titleId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog.current) return;
      // Keep the focus inside the sheet
      const items = [...dialog.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const inside = dialog.current.contains(document.activeElement);
      if (event.shiftKey && (!inside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    // Capture, so nothing behind the sheet sees Esc or Tab first
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30" aria-hidden="true" onMouseDown={onClose} />
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="fixed left-1/2 top-16 z-50 flex max-h-[calc(100vh-96px)] w-[min(720px,calc(100%-32px))] -translate-x-1/2 flex-col border border-ink bg-paper shadow-lg"
      >
        <div className="flex items-center border-b border-border">
          <h2 id={titleId} className="flex-1 px-3.5 py-2.5 text-sm font-medium uppercase tracking-wider">
            Keyboard shortcuts
          </h2>
          <button
            ref={closeButton}
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="cursor-pointer self-stretch border-l border-border px-3.5 text-muted transition-colors hover:bg-border hover:text-ink"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        {/* Focusable, so the list scrolls from the keyboard on a short screen */}
        <div tabIndex={0} aria-label="Shortcuts" role="region" className="grid gap-x-8 gap-y-4 overflow-y-auto px-3.5 py-3 outline-none focus-visible:ring-1 focus-visible:ring-ink sm:grid-cols-2">
          {SHORTCUT_GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title}>
              <h3 className="mb-1.5 text-[11px] uppercase tracking-wider text-muted">{group.title}</h3>
              <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-[13px]">
                {group.shortcuts.map((shortcut) => (
                  <Fragment key={shortcut.id}>
                    <dt className="whitespace-nowrap" data-shortcut={shortcut.id}>
                      {shortcut.keys.map((combo, i) => (
                        <Fragment key={combo}>
                          {i > 0 && <span className="text-muted"> / </span>}
                          <kbd className="font-[inherit] text-[12px] text-ink">{keyLabel(combo, mod)}</kbd>
                        </Fragment>
                      ))}
                    </dt>
                    <dd className="text-muted">{shortcut.action}</dd>
                  </Fragment>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </>
  );
}
