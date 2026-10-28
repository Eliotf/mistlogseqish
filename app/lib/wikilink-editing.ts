import { Mark } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { DOMOutputSpec, Fragment, Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import { WIKILINK_MARK, isWikilinkAttrs, wikilinkMarkSpec } from "./wikilink";
import { linkHref, type LinkTarget } from "./page-titles";

/**
 * Links in the editor (PRD 6.1, chunk 2.5a). A link is a `wikilink` mark on a
 * copy of the target's title. The editor shows the target's current title
 * instead, and never rewrites the copy: a rename edits no other page, and two
 * tabs can never race to rewrite the same link. The copy shows while titles
 * load. A link moves and deletes as one unit, so the cursor never lands
 * inside it. Creating links is 2.5b.
 */

/** The part of PageTitleStore the editor needs. */
export interface TitleSource {
  get(pageId: string): LinkTarget | undefined;
  request(pageIds: Iterable<string>): void;
  subscribe(listener: () => void): () => void;
}

interface ModeSource {
  get: (key: string) => string | undefined;
}

export interface WikilinkOptions {
  titles: TitleSource | null;
  docState: ModeSource | null;
  /** Open a link's page. Cmd/Ctrl+click will open the side panel (2.5e). */
  onOpen: (href: string, pageId: string, view: EditorView) => void;
}

/** Fired (bubbling, cancelable) on the editor's element to open a link; detail is { href, pageId }. */
export const OPEN_LINK_EVENT = "wikilink-open";

/**
 * By default a link asks the page around the editor to open it (so React
 * Router can navigate), and falls back to a full page load if nobody does.
 */
function openLink(href: string, pageId: string, view: EditorView): void {
  const event = new CustomEvent(OPEN_LINK_EVENT, { detail: { href, pageId }, bubbles: true, cancelable: true });
  if (view.dom.dispatchEvent(event)) window.location.assign(href);
}

/** One link in the document: a run of text carrying the same link mark. */
export interface LinkRange {
  from: number;
  to: number;
  pageId: string;
  text: string;
}

/** Every link in the document. A link split into several text nodes by other marks is one range. */
export function linkRanges(doc: ProseMirrorNode): LinkRange[] {
  const ranges: LinkRange[] = [];
  doc.forEach((block, blockOffset) => {
    let current: LinkRange | null = null;
    block.forEach((child, childOffset) => {
      const from = blockOffset + 1 + childOffset;
      const mark = child.marks.find((m) => m.type.name === WIKILINK_MARK);
      const pageId = mark && isWikilinkAttrs(mark.attrs) ? mark.attrs.pageId : null;
      if (pageId && current && current.pageId === pageId && current.to === from) {
        current.to = from + child.nodeSize;
        current.text += child.text ?? "";
        return;
      }
      current = pageId ? { from, to: from + child.nodeSize, pageId, text: child.text ?? "" } : null;
      if (current) ranges.push(current);
    });
  });
  return ranges;
}

/** The link the cursor position sits strictly inside, or at an edge of, per `edge`. */
function linkAt(state: EditorState, pos: number, edge: "before" | "after" | "inside"): LinkRange | undefined {
  return linkRanges(state.doc).find((r) =>
    edge === "after" ? r.to === pos : edge === "before" ? r.from === pos : r.from < pos && pos < r.to,
  );
}

/** What the reader sees for a link: its current title, or the stored copy until titles load. */
export function shownTitle(range: LinkRange, target: LinkTarget | undefined): string {
  return target && !target.missing ? target.title : range.text;
}

function targetClasses(target: LinkTarget | undefined): string {
  if (!target) return "";
  if (target.missing) return "wikilink-missing";
  return [target.empty ? "wikilink-empty" : "", target.kind === "journal" ? "wikilink-journal" : ""].filter(Boolean).join(" ");
}

const decorationsKey = new PluginKey<DecorationSet>("wikilinkDecorations");
const TITLES_CHANGED = "wikilinkTitlesChanged";

function buildDecorations(doc: ProseMirrorNode, titles: TitleSource | null): DecorationSet {
  const decorations: Decoration[] = [];
  for (const range of linkRanges(doc)) {
    const target = titles?.get(range.pageId);
    const classes = targetClasses(target);
    const title = shownTitle(range, target);
    if (title === range.text) {
      if (classes) decorations.push(Decoration.inline(range.from, range.to, { class: classes }));
      continue;
    }
    // A stale copy: hide it and show the current title in its place
    decorations.push(Decoration.inline(range.from, range.to, { class: "wikilink-stale", "aria-hidden": "true" }));
    decorations.push(
      Decoration.widget(
        range.from,
        () => {
          const span = document.createElement("span");
          span.className = ["wikilink", "wikilink-shown", classes].filter(Boolean).join(" ");
          span.dataset.pageId = range.pageId;
          span.textContent = title;
          return span;
        },
        // side 1: a cursor at the link's start is drawn before the title
        { side: 1, key: `${range.pageId}:${title}:${classes}`, ignoreSelection: true },
      ),
    );
  }
  return DecorationSet.create(doc, decorations);
}

/** Plain-text copy writes links as [[Current Title]], as Logseq does. */
export function clipboardText(slice: Slice, titles: TitleSource | null): string {
  const content = slice.content;
  // A copy within one line has no paragraph around it
  if (content.firstChild?.isInline) return inlineText(content, titles);
  const blocks: string[] = [];
  content.forEach((block) => blocks.push(block.isTextblock ? inlineText(block.content, titles) : block.textContent));
  return blocks.join("\n\n");
}

function inlineText(content: Fragment, titles: TitleSource | null): string {
  // Group text nodes into runs first: a link split by other marks is one link
  const runs: Array<{ pageId: string | null; text: string }> = [];
  content.forEach((child) => {
    const mark = child.marks.find((m) => m.type.name === WIKILINK_MARK);
    const pageId = mark && isWikilinkAttrs(mark.attrs) ? mark.attrs.pageId : null;
    const last = runs[runs.length - 1];
    if (pageId && last?.pageId === pageId) last.text += child.text ?? "";
    else runs.push({ pageId, text: child.text ?? "" });
  });
  return runs
    .map(({ pageId, text }) => {
      if (!pageId) return text;
      const target = titles?.get(pageId);
      return `[[${target && !target.missing ? target.title : text}]]`;
    })
    .join("");
}

/** UTF-16 length of the character at (or, backwards, ending at) an offset, so emoji stay whole. */
function charLength(text: string, offset: number, backwards = false): number {
  const code = text.charCodeAt(offset);
  if (backwards) return code >= 0xdc00 && code <= 0xdfff && offset > 0 ? 2 : 1;
  return code >= 0xd800 && code <= 0xdbff && offset + 1 < text.length ? 2 : 1;
}

/** Move a cursor that ends up inside a link (a click, a remote edit) to the nearer edge. */
function keepCursorOutside(state: EditorState): Transaction | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const pos = selection.from;
  const inside = linkAt(state, pos, "inside");
  if (!inside) return null;
  const edge = pos - inside.from <= inside.to - pos ? inside.from : inside.to;
  return state.tr.setSelection(TextSelection.create(state.doc, edge));
}

export const Wikilink = Mark.create<WikilinkOptions>({
  name: WIKILINK_MARK,
  inclusive: false,

  addOptions() {
    return {
      titles: null,
      docState: null,
      onOpen: openLink,
    };
  },

  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-page-id"),
        renderHTML: () => ({}),
      },
    };
  },

  parseHTML() {
    return wikilinkMarkSpec.parseDOM ?? [];
  },

  renderHTML({ mark }) {
    return wikilinkMarkSpec.toDOM!(mark, true) as DOMOutputSpec;
  },

  addKeyboardShortcuts() {
    const editor = this.editor;
    const inSuggestMode = () => this.options.docState?.get("mode") === "suggest";
    const jump = (direction: "left" | "right", extend: boolean) => {
      const { state, view } = editor;
      const { selection } = state;
      if (!extend && !selection.empty) return false;
      const head = selection.head;
      const link = linkAt(state, head, direction === "left" ? "after" : "before");
      if (!link) return leaveLink(direction, extend);
      const to = direction === "left" ? link.from : link.to;
      const next = extend ? TextSelection.create(state.doc, selection.anchor, to) : TextSelection.create(state.doc, to);
      view.dispatch(state.tr.setSelection(next).scrollIntoView());
      return true;
    };
    // Moving away from a link's edge: the browser's own move can land in the
    // hidden copy of a stale link and map back to the same place, so step
    // one character ourselves
    const leaveLink = (direction: "left" | "right", extend: boolean) => {
      const { state, view } = editor;
      const { selection } = state;
      const head = selection.head;
      const link = linkAt(state, head, direction === "left" ? "before" : "after");
      if (!link || (!extend && !selection.empty)) return false;
      const $head = state.doc.resolve(head);
      const text = $head.parent.textContent;
      const offset = $head.parentOffset;
      if (direction === "right" ? offset >= text.length : offset <= 0) return false;
      const step = direction === "right" ? charLength(text, offset) : -charLength(text, offset - 1, true);
      const to = head + step;
      const next = extend ? TextSelection.create(state.doc, selection.anchor, to) : TextSelection.create(state.doc, to);
      view.dispatch(state.tr.setSelection(next).scrollIntoView());
      return true;
    };
    const remove = (edge: "after" | "before") => {
      const { state, view } = editor;
      if (!state.selection.empty || inSuggestMode()) return false;
      const link = linkAt(state, state.selection.from, edge);
      if (!link) return false;
      view.dispatch(state.tr.delete(link.from, link.to).scrollIntoView());
      return true;
    };
    return {
      ArrowLeft: () => jump("left", false),
      ArrowRight: () => jump("right", false),
      "Shift-ArrowLeft": () => jump("left", true),
      "Shift-ArrowRight": () => jump("right", true),
      Backspace: () => remove("after"),
      Delete: () => remove("before"),
      "Alt-Enter": () => {
        const { state } = editor;
        const pos = state.selection.head;
        const link = linkAt(state, pos, "after") ?? linkAt(state, pos, "inside");
        if (!link) return false;
        this.options.onOpen(linkHref(link.pageId, this.options.titles?.get(link.pageId)), link.pageId, editor.view);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const { titles, onOpen } = this.options;
    return [
      new Plugin<DecorationSet>({
        key: decorationsKey,
        state: {
          init: (_, state) => buildDecorations(state.doc, titles),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(TITLES_CHANGED) ? buildDecorations(tr.doc, titles) : old.map(tr.mapping, tr.doc)),
        },
        appendTransaction: (_trs, _old, state) => keepCursorOutside(state),
        view: (view: EditorView) => {
          const requestTitles = (doc: ProseMirrorNode) => titles?.request(linkRanges(doc).map((r) => r.pageId));
          requestTitles(view.state.doc);
          const unsubscribe = titles?.subscribe(() => {
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(TITLES_CHANGED, true));
          });
          return {
            update: (v, prev) => {
              if (v.state.doc !== prev.doc) requestTitles(v.state.doc);
            },
            destroy: () => unsubscribe?.(),
          };
        },
        props: {
          decorations: (state) => decorationsKey.getState(state),
          clipboardTextSerializer: (slice) => clipboardText(slice, titles),
          handleDOMEvents: {
            click: (view, event) => {
              const el = (event.target as Element | null)?.closest?.("[data-page-id]");
              if (!(el instanceof HTMLElement) || !view.dom.contains(el)) return false;
              const pageId = el.dataset.pageId;
              if (!pageId) return false;
              event.preventDefault();
              onOpen(linkHref(pageId, titles?.get(pageId)), pageId, view);
              return true;
            },
          },
        },
      }),
    ];
  },
});
