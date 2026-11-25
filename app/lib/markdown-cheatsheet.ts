/**
 * The Markdown the editor understands, for the shortcut sheet (PRD F43).
 * Like the shortcut list, tests/unit/lib/markdown-cheatsheet.test.ts checks
 * each example against the code that shows it, so adding an entry here
 * means adding its check there.
 */

export interface MarkdownEntry {
  /** Stable name, used by the tests. */
  id: string;
  /** What to type, as written in the page text. */
  example: string;
  /** What it does, in a few words. */
  action: string;
}

export const MARKDOWN_CHEATSHEET: readonly MarkdownEntry[] = [
  { id: "bold", example: "**bold**", action: "Bold" },
  { id: "italic", example: "*italic* or _italic_", action: "Italic" },
  { id: "strikethrough", example: "~~struck~~", action: "Struck through" },
  { id: "code", example: "`code`", action: "Inline code" },
  { id: "heading", example: "# Heading … ###### Heading", action: "Headings, at the start of a line" },
  { id: "quote", example: "> quote", action: "Quote" },
  { id: "hr", example: "---", action: "Divider, alone on a line" },
  { id: "code-block", example: "```js", action: "Code block, with its language; close it with ```" },
  { id: "web-link", example: "[text](https://…)", action: "Web link" },
  { id: "image", example: "![alt](photo.png)", action: "Image" },
  { id: "page-link", example: "[[Page]]", action: "Link to a page" },
  { id: "tag", example: "#tag or #[[two words]]", action: "Tag, a link to a page" },
  { id: "task", example: "TODO / DOING / LATER / NOW / DONE", action: "Task, at the start of a line" },
  { id: "priority", example: "[#A] [#B] [#C]", action: "Task priority" },
  { id: "pomodoro", example: "{{POMO}} or {{POMO 10}}", action: "Pomodoro timer (25 or 10 minutes)" },
];
