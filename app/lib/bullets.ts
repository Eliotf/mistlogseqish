/**
 * Logseq-style bullet editing on Mist's line model (PRD F7). A page is a list
 * of lines (one paragraph each). Nesting is leading tab characters and a
 * bullet is "- " after them, so the text stays Logseq-compatible.
 *
 * These functions are pure: given the lines, they say what to change. Every
 * change only rewrites the start of a line (its tabs and bullet), so marks
 * on the rest of the line are untouched. bullet-editing.ts applies them.
 */

/** Rewrite a line's first `from`..`to` characters with `text`. */
export interface PrefixEdit {
  line: number;
  from: number;
  to: number;
  text: string;
}

export function indentOf(text: string): number {
  let i = 0;
  while (text[i] === "\t") i++;
  return i;
}

/**
 * Where a bullet's content starts ("\t- foo" -> 3), or null if the line is
 * not a bullet. A bare "-" (an empty bullet with no space) counts as a bullet.
 */
export function bulletContentStart(text: string): number | null {
  const indent = indentOf(text);
  if (text.startsWith("- ", indent)) return indent + 2;
  if (text.slice(indent) === "-") return indent + 1;
  return null;
}

/** The index just after line `i`'s last child: the following lines indented deeper. */
export function blockEnd(lines: string[], i: number): number {
  const base = indentOf(lines[i]);
  let j = i + 1;
  while (j < lines.length && indentOf(lines[j]) > base && lines[j] !== "") j++;
  return j;
}

/**
 * Indent (dir 1) or outdent (dir -1) lines `first`..`last` and all their
 * children. A line can be at most one level deeper than the line above it.
 * Indenting makes the selected lines bullets if they are not already.
 * Returns null if nothing can move.
 */
export function indentPlan(lines: string[], first: number, last: number, dir: 1 | -1): PrefixEdit[] | null {
  const end = blockEnd(lines, last);
  const top = indentOf(lines[first]);
  if (dir === 1) {
    if (first === 0) return null;
    if (top + 1 > indentOf(lines[first - 1]) + 1) return null;
  } else if (top === 0) {
    return null;
  }
  const edits: PrefixEdit[] = [];
  for (let i = first; i < end; i++) {
    const text = lines[i];
    const indent = indentOf(text);
    if (dir === -1 && indent === 0) continue;
    const isBullet = bulletContentStart(text) !== null;
    const makeBullet = dir === 1 && i <= last && !isBullet;
    const tabs = "\t".repeat(indent + dir);
    edits.push({ line: i, from: 0, to: indent, text: makeBullet ? `${tabs}- ` : tabs });
  }
  return edits;
}

export type EnterPlan =
  | { kind: "edits"; edits: PrefixEdit[]; caretLine: number; caretOffset: number }
  /** Split the line at the caret, and start the new line with `prefix`. */
  | { kind: "split"; prefix: string }
  /** Insert a line with `text` above, keeping the caret where it is. */
  | { kind: "above"; text: string };

/**
 * What Enter does on a bullet line, or null to leave it to the editor:
 * - an empty bullet outdents, or at the top level stops being a bullet;
 * - with the caret before the content, an empty bullet is added above;
 * - otherwise the line splits and the new line is a bullet at the same level,
 *   or the first child when the caret is at the end of a line with children.
 */
export function enterPlan(lines: string[], i: number, caret: number): EnterPlan | null {
  const text = lines[i];
  const start = bulletContentStart(text);
  if (start === null) return null;
  const indent = indentOf(text);
  const tabs = "\t".repeat(indent);

  if (text.slice(start).trim() === "") {
    if (indent > 0) {
      const edits = indentPlan(lines, i, i, -1)!;
      return { kind: "edits", edits, caretLine: i, caretOffset: indent - 1 + 2 };
    }
    return { kind: "edits", edits: [{ line: i, from: 0, to: text.length, text: "" }], caretLine: i, caretOffset: 0 };
  }

  if (caret <= start) return { kind: "above", text: `${tabs}- ` };

  const hasChildren = blockEnd(lines, i) > i + 1;
  const childLevel = hasChildren && caret >= text.length;
  return { kind: "split", prefix: `${childLevel ? tabs + "\t" : tabs}- ` };
}

/**
 * What Backspace does with the caret right after a bullet's "- ", or null to
 * leave it to the editor: outdent (with children), or at the top level
 * remove the bullet so the line becomes plain text.
 */
export function backspacePlan(lines: string[], i: number, caret: number): { edits: PrefixEdit[]; caretOffset: number } | null {
  const text = lines[i];
  const start = bulletContentStart(text);
  if (start === null || caret !== start) return null;
  const indent = indentOf(text);
  if (indent > 0) return { edits: indentPlan(lines, i, i, -1)!, caretOffset: start - 1 };
  return { edits: [{ line: i, from: indent, to: start, text: "" }], caretOffset: indent };
}
