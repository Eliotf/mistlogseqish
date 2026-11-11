import { useShortcutSheet } from "~/lib/shortcut-sheet";

/** Header button: show the keyboard shortcuts (PRD F43), the way in without `?`. Nothing outside ShortcutSheetProvider. */
export default function ShortcutsButton() {
  const sheet = useShortcutSheet();
  if (!sheet) return null;
  return (
    <button
      type="button"
      onClick={sheet.open}
      aria-label="Keyboard shortcuts"
      title="Keyboard shortcuts (?)"
      aria-keyshortcuts="?"
      className="flex h-full cursor-pointer items-center px-2 text-sm text-muted transition-colors hover:text-ink"
    >
      ?
    </button>
  );
}
