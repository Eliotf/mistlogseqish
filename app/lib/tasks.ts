import { indentOf, type PrefixEdit } from "./bullets";
import { parseLine, type TaskPriority, type TaskState } from "./note-parser";
import type { BacklinkLine } from "./backlink-lines";

/**
 * Task keywords on a line (PRD F6, F42). A task is TODO, DOING, DONE, LATER
 * or NOW at the start of a line's content, after its tabs and optional "- ".
 * These functions are pure; task-editing.ts and block-selection.ts apply the
 * edits.
 */

/**
 * Cmd/Ctrl+Enter: a plain line becomes TODO; TODO -> DOING -> DONE and
 * LATER -> NOW -> DONE; DONE goes back to a plain line.
 */
export function nextTaskState(current: TaskState | null): TaskState | null {
  switch (current) {
    case null:
      return "TODO";
    case "TODO":
      return "DOING";
    case "LATER":
      return "NOW";
    case "DOING":
    case "NOW":
      return "DONE";
    case "DONE":
      return null;
  }
}

/** Where a line's task keyword sits (keyword and its space), or an empty range at the content start. */
function keywordRange(text: string): { from: number; to: number; bareDash: boolean } {
  const shape = parseLine(text);
  const indent = indentOf(text);
  const bareDash = text.slice(indent) === "-";
  const from = text.startsWith("- ", indent) ? indent + 2 : bareDash ? indent + 1 : indent;
  return { from, to: shape.task ? shape.bodyStart : from, bareDash };
}

export function taskStateOf(text: string): TaskState | null {
  return parseLine(text).task;
}

/** The edit that gives a line `state` (or removes its keyword for null), keeping the rest of the line. */
export function setTaskEdit(line: number, text: string, state: TaskState | null): PrefixEdit {
  const range = keywordRange(text);
  if (range.bareDash) return { line, from: range.from, to: range.to, text: state ? ` ${state} ` : " " };
  return { line, from: range.from, to: range.to, text: state ? `${state} ` : "" };
}

/** Cycle the task keyword of each of `lines` (indexes), each from its own state. */
export function cyclePlan(texts: readonly string[], lines: readonly number[]): PrefixEdit[] {
  return lines.map((i) => setTaskEdit(i, texts[i], nextTaskState(taskStateOf(texts[i]))));
}

/** Open task states in the order the Tasks view lists them (decision 2026-11-01). */
export const OPEN_STATES: readonly TaskState[] = ["NOW", "DOING", "TODO", "LATER"];

/** A task as the Tasks view gets it from the server (serialisable). */
export interface TaskItem {
  pageId: string;
  pageTitle: string;
  pageKind: "page" | "journal";
  /** When its page was last indexed; orders done tasks, most recent first. */
  updatedAt: number;
  state: TaskState;
  priority: TaskPriority | null;
  /** Null until its page is indexed with block IDs: then it opens unzoomed. */
  blockId: string | null;
  line: BacklinkLine;
}
