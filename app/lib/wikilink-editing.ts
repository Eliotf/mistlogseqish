import { Mark } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import type { DOMOutputSpec, Fragment, MarkType, Node as ProseMirrorNode, Slice } from "@tiptap/pm/model";
import { ySyncPluginKey } from "@tiptap/y-tiptap";
import { WIKILINK_MARK, isWikilinkAttrs, wikilinkMarkSpec } from "./wikilink";
import { linkHref, linkPageForTitle, searchPages, targetOf, type LinkPage, type LinkTarget } from "./page-titles";
import { journalDateFromTitle, journalId, journalTitle } from "./note-ids";
import { titleKey } from "./page-title";
import { SuggestionList, type Suggestion } from "./link-suggestions";

/**
 * Links in the editor (PRD 6.1, chunks 2.5a to 2.5c), Logseq style.
 *
 * A link is text: `[[`, the title, `]]`. The title carries a `wikilink` mark
 * with the target's page ID. With the cursor elsewhere it reads as a link
 * (faint brackets, underlined current title). With the cursor between the
 * brackets it is plain text you edit, with title suggestions; when the
 * cursor leaves, the text decides what it links to: the same page, another
 * page with that title, a new page, or nothing if a bracket was deleted.
 *
 * The stored title is a copy from when the link was made. It is shown as
 * the current title, and only rewritten when your cursor enters that link
 * (never by opening a page), so renames edit no other page. Everything else
 * this does to the document only sets or removes the mark, which two tabs
 * can do at once safely. In suggest mode none of the editing applies.
 */

/** The part of PageTitleStore the editor needs. */
export interface TitleSource {
  get(pageId: string): LinkTarget | undefined;
  request(pageIds: Iterable<string>): void;
  subscribe(listener: () => void): () => void;
  prime?(pageId: string, target: LinkTarget): void;
}

interface ModeSource {
  get: (key: string) => string | undefined;
}

export interface WikilinkOptions {
  titles: TitleSource | null;
  docState: ModeSource | null;
  /** Open a link's page. Cmd/Ctrl+click will open the side panel (2.5d). */
  onOpen: (href: string, pageId: string, view: EditorView) => void;
  /** Titles for the suggestions list. */
  search: (query: string) => Promise<LinkPage[]>;
  /** The page a title links to, created if need be; null if it can't be had (offline). */
  linkPage: (title: string) => Promise<LinkPage | null>;
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

/** One `[[...]]` in the text. pageId is set when one link mark covers the whole title. */
export interface LinkSpan {
  from: number;
  to: number;
  innerFrom: number;
  innerTo: number;
  inner: string;
  pageId: string | null;
}

const BRACKETS_RE = /\[\[([^[\]\n]*)\]\]/g;

function linkIdOf(node: ProseMirrorNode): string | null {
  const mark = node.marks.find((m) => m.type.name === WIKILINK_MARK);
  return mark && isWikilinkAttrs(mark.attrs) ? mark.attrs.pageId : null;
}

/** The one page ID marking every character from..to, or null. */
function linkIdCovering(doc: ProseMirrorNode, from: number, to: number): string | null {
  if (from >= to) return null;
  let id: string | null | undefined;
  doc.nodesBetween(from, to, (node) => {
    if (!node.isText) return;
    const here = linkIdOf(node);
    id = id === undefined || id === here ? here : null;
  });
  return id ?? null;
}

/** Every `[[...]]` in the document, in order. */
export function linkSpans(doc: ProseMirrorNode): LinkSpan[] {
  const spans: LinkSpan[] = [];
  doc.forEach((block, offset) => {
    if (!block.isTextblock) return;
    const start = offset + 1;
    for (const m of block.textContent.matchAll(BRACKETS_RE)) {
      const from = start + m.index;
      const innerFrom = from + 2;
      const innerTo = innerFrom + m[1].length;
      spans.push({ from, to: innerTo + 2, innerFrom, innerTo, inner: m[1], pageId: linkIdCovering(doc, innerFrom, innerTo) });
    }
  });
  return spans;
}

/** The link whose brackets the cursor is between (from just inside `[[` to just inside `]]`). */
export function spanAt(spans: LinkSpan[], pos: number): LinkSpan | undefined {
  return spans.find((s) => s.from < pos && pos < s.to);
}

/** Marked text outside any `[[...]]` (a bracket was deleted): no longer a link. */
function strayMarks(doc: ProseMirrorNode, from: number, to: number, spans: LinkSpan[]): Array<[number, number]> {
  const stray: Array<[number, number]> = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText || !linkIdOf(node)) return;
    const end = pos + node.nodeSize;
    if (!spans.some((s) => s.innerFrom <= pos && end <= s.innerTo)) stray.push([pos, end]);
  });
  return stray;
}

/** What the reader sees for a link: its current title, or the stored copy until titles load. */
export function shownTitle(inner: string, target: LinkTarget | undefined): string {
  return target && !target.missing ? target.title : inner;
}

function targetClasses(target: LinkTarget | undefined): string {
  if (!target) return "";
  if (target.missing) return "wikilink-missing";
  return [target.empty ? "wikilink-empty" : "", target.kind === "journal" ? "wikilink-journal" : ""].filter(Boolean).join(" ");
}

interface LinkPluginState {
  decorations: DecorationSet;
  focused: boolean;
  /** The link the cursor is in, and its text when the cursor arrived. */
  entry: { from: number; inner: string } | null;
}

const linkKey = new PluginKey<LinkPluginState>("wikilinks");
const TITLES_CHANGED = "wikilinkTitlesChanged";
const FOCUS = "wikilinkFocus";
const REWRITTEN = "wikilinkRewritten";

function buildDecorations(doc: ProseMirrorNode, spans: LinkSpan[], titles: TitleSource | null, activeFrom: number | null): DecorationSet {
  const decorations: Decoration[] = [];
  for (const span of spans) {
    if (span.from === activeFrom) {
      decorations.push(Decoration.inline(span.from, span.to, { class: "wikilink-editing" }));
      continue;
    }
    const linkAttrs = span.pageId ? { "data-page-id": span.pageId } : {};
    decorations.push(Decoration.inline(span.from, span.innerFrom, { class: "wikilink-bracket", ...linkAttrs }));
    decorations.push(Decoration.inline(span.innerTo, span.to, { class: "wikilink-bracket", ...linkAttrs }));
    if (!span.pageId) {
      if (span.inner.trim()) decorations.push(Decoration.inline(span.innerFrom, span.innerTo, { class: "wikilink-pending", title: "Not linked yet" }));
      continue;
    }
    const target = titles?.get(span.pageId);
    const classes = targetClasses(target);
    const title = shownTitle(span.inner, target);
    if (title === span.inner) {
      if (classes) decorations.push(Decoration.inline(span.innerFrom, span.innerTo, { class: classes }));
      continue;
    }
    // A stale copy: hide it and show the current title in its place
    decorations.push(Decoration.inline(span.innerFrom, span.innerTo, { class: "wikilink-stale", "aria-hidden": "true" }));
    const pageId = span.pageId;
    decorations.push(
      Decoration.widget(
        span.innerFrom,
        () => {
          const el = document.createElement("span");
          el.className = ["wikilink", "wikilink-shown", classes].filter(Boolean).join(" ");
          el.dataset.pageId = pageId;
          el.textContent = title;
          return el;
        },
        { side: 1, key: `${pageId}:${title}:${classes}`, ignoreSelection: true },
      ),
    );
  }
  return DecorationSet.create(doc, decorations);
}

/** Plain-text copy writes each link's current title between its brackets. */
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
    const pageId = linkIdOf(child);
    const last = runs[runs.length - 1];
    if (pageId && last?.pageId === pageId) last.text += child.text ?? "";
    else runs.push({ pageId, text: child.text ?? "" });
  });
  return runs.map(({ pageId, text }) => (pageId ? shownTitle(text, titles?.get(pageId)) : text)).join("");
}

/** Where pasted or dropped content landed, in the final document of these transactions. */
export function pastedRanges(trs: readonly Transaction[]): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  trs.forEach((tr, i) => {
    const event = tr.getMeta("uiEvent");
    if (event !== "paste" && event !== "drop") return;
    tr.mapping.maps.forEach((map, j) => {
      map.forEach((_oldFrom, _oldTo, from, to) => {
        let a = tr.mapping.slice(j + 1).map(from, -1);
        let b = tr.mapping.slice(j + 1).map(to, 1);
        for (const later of trs.slice(i + 1)) {
          a = later.mapping.map(a, -1);
          b = later.mapping.map(b, 1);
        }
        ranges.push([a, b]);
      });
    });
  });
  return ranges;
}

function isRemote(tr: Transaction): boolean {
  return !!(tr.getMeta(ySyncPluginKey) as { isChangeOrigin?: boolean } | undefined)?.isChangeOrigin;
}

export const Wikilink = Mark.create<WikilinkOptions>({
  name: WIKILINK_MARK,
  inclusive: false,

  addOptions() {
    return {
      titles: null,
      docState: null,
      onOpen: openLink,
      search: searchPages,
      linkPage: linkPageForTitle,
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
    return {
      // Open the link the cursor is in or just after
      "Alt-Enter": () => {
        const { state, view } = this.editor;
        const spans = linkSpans(state.doc);
        const head = state.selection.head;
        const span = spanAt(spans, head) ?? spans.find((s) => s.to === head);
        if (!span?.pageId) return false;
        this.options.onOpen(linkHref(span.pageId, this.options.titles?.get(span.pageId)), span.pageId, view);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const { titles, onOpen, search, linkPage } = this.options;
    const markType = (state: EditorState): MarkType => state.schema.marks[WIKILINK_MARK];
    const editing = (target: EditorView | EditorState): boolean => {
      const editable = "editable" in target ? target.editable : true;
      return editable && this.options.docState?.get("mode") !== "suggest";
    };
    let currentView: EditorView | null = null;
    /** Titles being looked up, by title key, so each is asked for once. */
    const lookups = new Map<string, Promise<LinkPage | null>>();

    /** Mark every unlinked `[[title]]` with this key, other than the one being edited. */
    const applyLink = (key: string, page: LinkPage) => {
      const view = currentView;
      if (!view || view.isDestroyed) return;
      titles?.prime?.(page.pageId, targetOf(page));
      const active = linkKey.getState(view.state)?.entry?.from ?? null;
      const tr = view.state.tr;
      for (const span of linkSpans(view.state.doc)) {
        if (span.pageId || span.from === active || titleKey(span.inner) !== key) continue;
        tr.addMark(span.innerFrom, span.innerTo, markType(view.state).create({ pageId: page.pageId }));
      }
      if (tr.docChanged) view.dispatch(tr.setMeta("addToHistory", false));
    };

    const lookUp = (title: string) => {
      const key = titleKey(title);
      if (lookups.has(key)) return;
      const found = linkPage(title).catch(() => null);
      lookups.set(key, found);
      void found.then((page) => {
        lookups.delete(key);
        if (page) applyLink(key, page);
      });
    };

    /** The cursor left the link that started at `from`: decide from its text what it links to. */
    const settle = (tr: Transaction, state: EditorState, entry: { from: number; inner: string }, from: number) => {
      const spans = linkSpans(state.doc);
      const $pos = state.doc.resolve(Math.min(from, state.doc.content.size));
      if ($pos.parent.isTextblock) {
        for (const [a, b] of strayMarks(state.doc, $pos.start(), $pos.end(), spans)) tr.removeMark(a, b, markType(state));
      }
      const span = spans.find((s) => s.from === from);
      if (!span) return;
      const title = span.inner.trim();
      if (!title) {
        tr.removeMark(span.innerFrom, span.innerTo, markType(state));
        return;
      }
      if (span.pageId && span.inner === entry.inner) return;
      const target = span.pageId ? titles?.get(span.pageId) : undefined;
      if (span.pageId && target && !target.missing && titleKey(target.title) === titleKey(title)) return;
      tr.removeMark(span.innerFrom, span.innerTo, markType(state));
      const date = journalDateFromTitle(title);
      if (date) {
        const pageId = journalId(date);
        tr.addMark(span.innerFrom, span.innerTo, markType(state).create({ pageId }));
        titles?.request([pageId]);
        return;
      }
      lookUp(title);
    };

    /**
     * Pasted or dropped text (2.5c): link every unlinked `[[...]]` in it at
     * once, by the same rules as typing. Links copied from Mistlog keep
     * their page ID, so only plain [[Title]] text is looked up.
     */
    const linkPasted = (tr: Transaction, state: EditorState, ranges: Array<[number, number]>, activeFrom: number | null) => {
      for (const span of linkSpans(state.doc)) {
        if (span.pageId || span.from === activeFrom || !span.inner.trim()) continue;
        if (!ranges.some(([a, b]) => span.from < b && span.to > a)) continue;
        const date = journalDateFromTitle(span.inner);
        if (date) {
          tr.addMark(span.innerFrom, span.innerTo, markType(state).create({ pageId: journalId(date) }));
          titles?.request([journalId(date)]);
        } else {
          lookUp(span.inner.trim());
        }
      }
    };

    /** The cursor entered a link to a renamed page: make the stored copy the current title. */
    const rewriteStale = (tr: Transaction, state: EditorState, span: LinkSpan): boolean => {
      if (!span.pageId) return false;
      const target = titles?.get(span.pageId);
      if (!target || target.missing || target.title === span.inner) return false;
      const marks = state.doc.resolve(span.innerFrom + 1).marks();
      const head = state.selection.head;
      tr.replaceWith(span.innerFrom, span.innerTo, state.schema.text(target.title, marks));
      const at = head >= span.innerTo ? span.innerFrom + target.title.length + (head - span.innerTo) : span.innerFrom + Math.min(Math.max(head - span.innerFrom, 0), target.title.length);
      tr.setSelection(TextSelection.create(tr.doc, at));
      return true;
    };

    let suggestions: SuggestionList | null = null;
    let suggestFor: string | null = null;
    let suggestTimer: ReturnType<typeof setTimeout> | null = null;

    const choose = (item: Suggestion) => {
      const view = currentView;
      suggestions?.hide();
      if (!view) return;
      const { state } = view;
      const span = spanAt(linkSpans(state.doc), state.selection.head);
      if (!span) return;
      const tr = state.tr;
      if (item.kind === "page") {
        titles?.prime?.(item.page.pageId, targetOf(item.page));
        tr.replaceWith(span.innerFrom, span.innerTo, state.schema.text(item.page.title, [markType(state).create({ pageId: item.page.pageId })]));
      }
      // Step out of the brackets; leaving the link settles it
      tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(span.to)));
      view.dispatch(tr.scrollIntoView());
    };

    const closeSuggestions = () => {
      if (suggestTimer) clearTimeout(suggestTimer);
      suggestTimer = null;
      suggestFor = null;
      suggestions?.hide();
    };

    const updateSuggestions = (view: EditorView) => {
      const entry = linkKey.getState(view.state)?.entry;
      const span = entry && editing(view) ? spanAt(linkSpans(view.state.doc), view.state.selection.head) : undefined;
      // Shown once you type in a link, or straight away in a new empty one
      if (!entry || !span || (span.inner === entry.inner && span.inner !== "")) return closeSuggestions();
      if (span.inner === suggestFor) return;
      suggestFor = span.inner;
      if (suggestTimer) clearTimeout(suggestTimer);
      const query = span.inner;
      suggestTimer = setTimeout(() => {
        suggestTimer = null;
        void search(query.trim())
          .catch(() => [] as LinkPage[])
          .then((pages) => {
            const v = currentView;
            if (!v || v.isDestroyed || suggestFor !== query) return;
            const now = spanAt(linkSpans(v.state.doc), v.state.selection.head);
            if (!now) return;
            const items: Suggestion[] = pages.map((page) => ({ kind: "page", page }));
            const wanted = query.trim();
            if (wanted && !pages.some((p) => titleKey(p.title) === titleKey(wanted))) {
              const date = journalDateFromTitle(wanted);
              items.push(
                date
                  ? { kind: "page", page: { pageId: journalId(date), title: journalTitle(date), kind: "journal", slug: null, empty: true } }
                  : { kind: "create", title: wanted },
              );
            }
            suggestions ??= new SuggestionList(choose);
            suggestions.show(items, placeUnder(v, now.innerFrom));
          });
      }, 120);
    };

    /** Where the list goes: under the link's title (top left if the browser can't say). */
    const placeUnder = (view: EditorView, pos: number) => {
      try {
        const at = view.coordsAtPos(pos);
        return { left: at.left, bottom: at.bottom };
      } catch {
        return { left: 0, bottom: 0 };
      }
    };

    const linkElement = (view: EditorView, event: Event): HTMLElement | null => {
      const target = event.target as Element | null;
      const el = target?.closest?.("[data-page-id]");
      if (!(el instanceof HTMLElement) || !view.dom.contains(el) || target?.closest(".wikilink-editing")) return null;
      return el;
    };

    return [
      new Plugin<LinkPluginState>({
        key: linkKey,
        state: {
          init: (_, state) => ({ decorations: buildDecorations(state.doc, linkSpans(state.doc), titles, null), focused: false, entry: null }),
          apply: (tr, prev, _old, state) => {
            const focusMeta = tr.getMeta(FOCUS) as boolean | undefined;
            const focused = focusMeta ?? prev.focused;
            const spans = linkSpans(state.doc);
            const active = focused ? spanAt(spans, state.selection.head) : undefined;
            let entry = prev.entry ? { from: tr.mapping.map(prev.entry.from), inner: prev.entry.inner } : null;
            if (!active) entry = null;
            else if (!entry || entry.from !== active.from || tr.getMeta(REWRITTEN)) entry = { from: active.from, inner: active.inner };
            const redraw = tr.docChanged || tr.selectionSet || focusMeta !== undefined || tr.getMeta(TITLES_CHANGED);
            const decorations = redraw ? buildDecorations(state.doc, spans, titles, active?.from ?? null) : prev.decorations.map(tr.mapping, tr.doc);
            return { decorations, focused, entry };
          },
        },
        appendTransaction: (trs, oldState, newState) => {
          if (!editing(newState) || trs.some(isRemote)) return null;
          const before = linkKey.getState(oldState)?.entry ?? null;
          const after = linkKey.getState(newState)?.entry ?? null;
          const mapped = before ? trs.reduce((pos, tr) => tr.mapping.map(pos), before.from) : null;
          const tr = newState.tr;
          const pasted = pastedRanges(trs);
          if (pasted.length) linkPasted(tr, newState, pasted, after?.from ?? null);
          if (before && mapped !== null && (!after || after.from !== mapped)) settle(tr, newState, before, mapped);
          if (after && (!before || mapped !== after.from)) {
            const span = linkSpans(tr.doc).find((s) => s.from === after.from);
            if (span && rewriteStale(tr, newState, span)) tr.setMeta(REWRITTEN, true).setMeta("addToHistory", false);
          }
          return tr.docChanged ? tr : null;
        },
        view: (view) => {
          currentView = view;
          const requestTitles = (doc: ProseMirrorNode) => titles?.request(linkSpans(doc).flatMap((s) => (s.pageId ? [s.pageId] : [])));
          requestTitles(view.state.doc);
          const unsubscribe = titles?.subscribe(() => {
            if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(TITLES_CHANGED, true));
          });
          return {
            update: (v, prev) => {
              if (v.state.doc !== prev.doc) requestTitles(v.state.doc);
              updateSuggestions(v);
            },
            destroy: () => {
              unsubscribe?.();
              closeSuggestions();
              suggestions?.destroy();
              currentView = null;
            },
          };
        },
        props: {
          decorations: (state) => linkKey.getState(state)?.decorations,
          clipboardTextSerializer: (slice) => clipboardText(slice, titles),
          handleKeyDown: (view, event) => {
            if (suggestions?.isOpen) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                suggestions.move(event.key === "ArrowDown" ? 1 : -1);
                return true;
              }
              if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
                return suggestions.choose();
              }
              if (event.key === "Escape") {
                closeSuggestions();
                return true;
              }
            }
            // Backspace in an empty [[|]] removes all four brackets
            if (event.key === "Backspace" && editing(view) && view.state.selection.empty) {
              const { head } = view.state.selection;
              const span = spanAt(linkSpans(view.state.doc), head);
              if (span && span.inner === "" && head === span.innerFrom) {
                view.dispatch(view.state.tr.delete(span.from, span.to));
                return true;
              }
            }
            return false;
          },
          handleTextInput: (view, from, to, text) => {
            if (!editing(view) || from !== to) return false;
            const { doc } = view.state;
            const $from = doc.resolve(from);
            const before = doc.textBetween(Math.max(from - 1, $from.start()), from);
            const after = doc.textBetween(to, Math.min(to + 2, $from.end()));
            // Typing [[ adds the closing ]] and puts the cursor between
            if (text === "[" && before === "[" && !after.startsWith("]]")) {
              const tr = view.state.tr.insertText("[]]", from, to);
              view.dispatch(tr.setSelection(TextSelection.create(tr.doc, from + 1)));
              return true;
            }
            // Typing ] before the closing ]] steps out of the link
            if (text === "]" && after === "]]" && spanAt(linkSpans(doc), from)) {
              view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, to + 2)));
              return true;
            }
            return false;
          },
          handleDOMEvents: {
            focus: (view) => {
              view.dispatch(view.state.tr.setMeta(FOCUS, true));
              return false;
            },
            blur: (view) => {
              closeSuggestions();
              if (!view.isDestroyed) view.dispatch(view.state.tr.setMeta(FOCUS, false));
              return false;
            },
            // A link you are not editing opens on click instead of taking the cursor
            mousedown: (view, event) => {
              if (!linkElement(view, event)) return false;
              event.preventDefault();
              return true;
            },
            click: (view, event) => {
              const pageId = linkElement(view, event)?.dataset.pageId;
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
