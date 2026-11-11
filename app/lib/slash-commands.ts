import { bulletContentStart, indentOf, type PrefixEdit } from "./bullets";
import { parseLine, type TaskState } from "./note-parser";

/**
 * The `/` menu's commands (PRD F44), as data and pure edits; slash-menu.ts
 * shows them and applies them. Embed and template come with F48 and F51.
 */

export type SlashCommandId = TaskState | "heading-1" | "heading-2" | "heading-3" | "link" | "date";

export interface SlashCommand {
  id: SlashCommandId;
  label: string;
  /** What it does, shown beside it. */
  hint: string;
  /** Other words it is found by. */
  words: string[];
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { id: "TODO", label: "TODO", hint: "Make this line a task", words: ["task"] },
  { id: "DOING", label: "DOING", hint: "A task in progress", words: ["task"] },
  { id: "LATER", label: "LATER", hint: "A task for later", words: ["task"] },
  { id: "NOW", label: "NOW", hint: "A task for now", words: ["task"] },
  { id: "DONE", label: "DONE", hint: "A finished task", words: ["task"] },
  { id: "date", label: "Date", hint: "Link to a day, @next fri", words: ["today", "tomorrow", "journal", "day"] },
  { id: "link", label: "Link", hint: "Link to a page, [[ ]]", words: ["page", "reference"] },
  { id: "heading-1", label: "Heading 1", hint: "# Large heading", words: ["h1", "title"] },
  { id: "heading-2", label: "Heading 2", hint: "## Medium heading", words: ["h2"] },
  { id: "heading-3", label: "Heading 3", hint: "### Small heading", words: ["h3"] },
];

/** The longest text after `/` that can still match a command. */
export const MAX_SLASH_QUERY = 20;

/**
 * Commands for what has been typed after `/`, best first: labels starting
 * with it, then labels containing it, then other words starting with it.
 * Case and spaces don't matter. Nothing typed: every command.
 */
export function matchCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return [...SLASH_COMMANDS];
  const key = (c: SlashCommand) => c.label.toLowerCase().replace(/\s+/g, "");
  const ranked = SLASH_COMMANDS.map((c) => {
    if (key(c).startsWith(q)) return { c, rank: 0 };
    if (key(c).includes(q)) return { c, rank: 1 };
    if (c.words.some((w) => w.startsWith(q))) return { c, rank: 2 };
    return { c, rank: -1 };
  }).filter((r) => r.rank >= 0);
  return ranked.sort((a, b) => a.rank - b.rank).map((r) => r.c);
}

const HEADING_RE = /^#{1,6} /;

/**
 * The edit that makes line `line` a heading of `level` (1-6), or plain
 * again for null: `#`s and a space after its bullet (`- ## Notes`, as Logseq
 * writes it, F47), replacing any heading it has. On a task they go after
 * the keyword (`- LATER ## Plans`), so the line stays a task.
 */
export function headingEdit(line: number, text: string, level: number | null): PrefixEdit {
  const task = parseLine(text);
  const from = task.task ? task.bodyStart : (bulletContentStart(text) ?? indentOf(text));
  const existing = HEADING_RE.exec(text.slice(from))?.[0].length ?? 0;
  // A bare "-" bullet needs its space back before the #s
  const space = text.slice(indentOf(text)) === "-" ? " " : "";
  return { line, from, to: from + existing, text: level ? `${space}${"#".repeat(level)} ` : "" };
}
