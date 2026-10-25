import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import { normalizeTitle, UNTITLED, type RenameResult } from "~/lib/page-title";
import { APP_DISPLAY_NAME } from "~/shared/constants";

/** Claim a title on the server (unique ignoring case) and get the page's new address. */
export async function renameOnServer(title: string, pageId: string): Promise<RenameResult> {
  const res = await fetch("/api/rename", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pageId, title }),
  });
  if (!res.ok) throw new Error(`Rename failed: ${res.status}`);
  return (await res.json()) as RenameResult;
}

interface PageTitleProps {
  doc: Y.Doc;
  pageId: string;
  /** Focus the title and select it, for a page that was just created. */
  autoFocus?: boolean;
  rename?: (title: string, pageId: string) => Promise<RenameResult>;
  /** Called with the page's new address after a successful rename. */
  onRenamed?: (path: string) => void;
}

/**
 * The page's editable title, stored in the Yjs document as meta.title so it
 * syncs live between tabs. Enter or leaving the title saves it; Esc cancels.
 * Saving claims the title on the server first (atomic uniqueness), so the
 * new address is known at once. With ID links no linking page changes.
 */
export default function PageTitle({ doc, pageId, autoFocus = false, rename = renameOnServer, onRenamed }: PageTitleProps) {
  const meta = useMemo(() => doc.getMap<unknown>("meta"), [doc]);
  const ref = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const stored = useCallback((): string => {
    const t = meta.get("title");
    return typeof t === "string" ? t : "";
  }, [meta]);

  // Show the stored title, unless the user is editing it right now
  useEffect(() => {
    const sync = () => {
      const el = ref.current;
      if (el && document.activeElement !== el) el.textContent = stored();
      document.title = `${stored() || UNTITLED} · ${APP_DISPLAY_NAME}`;
    };
    sync();
    meta.observe(sync);
    return () => meta.unobserve(sync);
  }, [meta, stored]);

  useEffect(() => {
    const el = ref.current;
    if (!autoFocus || !el) return;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [autoFocus]);

  async function commit() {
    const el = ref.current;
    if (!el) return;
    const previous = stored();
    const raw = el.textContent ?? "";
    if (!raw.trim()) {
      el.textContent = previous;
      setError(null);
      return;
    }
    const result = normalizeTitle(raw);
    if (!result.ok) {
      setError(result.reason);
      el.textContent = previous;
      return;
    }
    if (result.title === previous) {
      el.textContent = previous;
      setError(null);
      return;
    }
    setSaving(true);
    try {
      const answer = await rename(result.title, pageId);
      if (!answer.ok) {
        setError(`${answer.reason} The title was not changed.`);
        el.textContent = stored();
        return;
      }
      meta.set("title", answer.title);
      el.textContent = answer.title;
      setError(null);
      onRenamed?.(answer.path);
    } catch {
      setError("Couldn't save the title. Check your connection and try again.");
      el.textContent = stored();
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLHeadingElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.currentTarget.textContent = stored();
      setError(null);
      e.currentTarget.blur();
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLHeadingElement>) {
    // Titles are plain text: drop any formatting from the clipboard
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain").replace(/\s+/g, " ");
    const sel = window.getSelection();
    if (!sel?.rangeCount) return;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(text));
    range.collapse(false);
  }

  return (
    <div className="px-6 pt-6">
      <h1
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-label="Page title"
        aria-describedby={error ? "page-title-error" : undefined}
        aria-busy={saving}
        spellCheck={false}
        data-placeholder={UNTITLED}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={() => void commit()}
        className="max-w-[65ch] cursor-text text-[1.75rem] font-semibold leading-tight text-ink outline-none empty:before:text-muted empty:before:content-[attr(data-placeholder)] focus-visible:shadow-[0_2px_0_var(--color-chartreuse)]"
      />
      {error && (
        <p id="page-title-error" role="alert" className="mt-2 max-w-[65ch] text-sm text-coral">
          {error}
        </p>
      )}
    </div>
  );
}
