import type { EditorState } from "@tiptap/pm/state";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { linkSpans, spanAt } from "./wikilink-editing";

/**
 * A character typed in text that opens a list for what follows it: `@`
 * for dates (date-trigger.ts, F20) and `/` for commands (slash-menu.ts,
 * F44). Both open only at the start of a line or after a space, so an
 * email address or `and/or` stays plain text, and never inside a link.
 */

/** Whether a trigger character typed at `pos` may open its list. */
export function canTriggerAt(doc: ProseMirrorNode, pos: number): boolean {
  const $pos = doc.resolve(pos);
  if (!$pos.parent.isTextblock) return false;
  const before = doc.textBetween(Math.max(pos - 1, $pos.start()), pos);
  return (!before || /\s/.test(before)) && !spanAt(linkSpans(doc), pos);
}

/**
 * What has been typed after the trigger character at `from` (up to the
 * cursor), or null once its list should close: the cursor left the text or
 * its line, the character was deleted, the text starts with a space (a
 * plain `@` or `/`), or it is longer than `max`.
 */
export function triggerQuery(state: EditorState, from: number, char: string, max: number): string | null {
  const { selection, doc } = state;
  if (!selection.empty || from + 1 > doc.content.size) return null;
  const head = selection.head;
  const $at = doc.resolve(from);
  if (!$at.parent.isTextblock || head <= from || head > $at.end() || doc.textBetween(from, from + 1) !== char) return null;
  const query = doc.textBetween(from + 1, head);
  if (/^\s/.test(query) || query.length > max) return null;
  return query;
}
