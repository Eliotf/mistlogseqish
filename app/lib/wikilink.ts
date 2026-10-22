import type { MarkSpec } from "@tiptap/pm/model";
import { isPageId } from "./note-ids";

/**
 * The `wikilink` mark: a link to a page by its permanent ID (PRD 6.1).
 *
 * The marked text is a snapshot of the target's title; the displayed title
 * always comes from the workspace index, so a rename never edits linking
 * pages. In Yjs the mark is stored like Mist's CriticMarkup marks, as a
 * formatting attribute on the text: { wikilink: { pageId } }.
 *
 * This is the single definition of the mark's name and attributes. The
 * editor's TipTap extension (M2, chunk 2.5) must wrap this spec. Bump
 * DOC_FORMAT_VERSION when the editor starts writing the mark.
 */

export const WIKILINK_MARK = "wikilink";

export interface WikilinkAttrs {
  pageId: string;
}

export function isWikilinkAttrs(attrs: unknown): attrs is WikilinkAttrs {
  if (typeof attrs !== "object" || attrs === null) return false;
  const pageId = (attrs as { pageId?: unknown }).pageId;
  return typeof pageId === "string" && isPageId(pageId);
}

export const wikilinkMarkSpec: MarkSpec = {
  attrs: { pageId: { default: null } },
  // Typing at either edge of a link does not extend it
  inclusive: false,
  parseDOM: [
    {
      tag: "span[data-page-id]",
      getAttrs: (dom) => ({ pageId: (dom as HTMLElement).getAttribute("data-page-id") }),
    },
  ],
  toDOM: (mark) => ["span", { class: "wikilink", "data-page-id": mark.attrs.pageId as string }, 0],
};
