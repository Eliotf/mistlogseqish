import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { WIKILINK_MARK } from "./wikilink";
import { journalId, journalTitle, localDate } from "./note-ids";
import { dateSuggestions, MAX_DATE_PHRASE } from "./fuzzy-dates";
import { SuggestionList, type Suggestion } from "./link-suggestions";
import { linkSpans, spanAt } from "./wikilink-editing";

/**
 * `@` dates (PRD 6.2, F20). Typing `@` at the start of a line or after a
 * space opens a list of days for the phrase typed after it (`@next fri`,
 * `@in 2 weeks`); choosing one replaces `@phrase` with a link to that day's
 * journal, `[[Nov 3rd, 2026]]`, as typing the link would. The journal needn't
 * exist: it is made when it first gets text. `@` anywhere else (an email
 * address) is plain text. Escape closes the list and leaves what was typed.
 */

export interface DateTriggerOptions {
  docState: { get: (key: string) => string | undefined } | null;
  /** Today as YYYY-MM-DD in the browser's time zone. */
  today: () => string;
}

/** Where the `@` is, while its list is open. */
type DateTriggerState = { from: number } | null;

export const dateTriggerKey = new PluginKey<DateTriggerState>("dateTrigger");

const NO_MATCH = (query: string) => `No date matches “${query}”. Try “next fri” or “in 2 weeks”.`;

/** What has been typed after the `@`, or null once the list should close. */
export function dateQuery(state: EditorState, from: number): string | null {
  const { selection, doc } = state;
  if (!selection.empty || from + 1 > doc.content.size) return null;
  const head = selection.head;
  const $at = doc.resolve(from);
  if (!$at.parent.isTextblock || head <= from || head > $at.end() || doc.textBetween(from, from + 1) !== "@") return null;
  const query = doc.textBetween(from + 1, head);
  // "@ " is a plain at sign; a long run of text isn't a date
  if (/^\s/.test(query) || query.length > MAX_DATE_PHRASE) return null;
  return query;
}

export const DateTrigger = Extension.create<DateTriggerOptions>({
  name: "dateTrigger",
  // Ahead of the link extension, so its keys reach the open list first
  priority: 200,

  addOptions() {
    return { docState: null, today: () => localDate(new Date()) };
  },

  addProseMirrorPlugins() {
    // The link extension asks for the new link's title, as for any link
    const { today } = this.options;
    const editing = (view: EditorView) => view.editable && this.options.docState?.get("mode") !== "suggest";
    let list: SuggestionList | null = null;
    let currentView: EditorView | null = null;

    const close = (view: EditorView) => {
      list?.hide();
      if (dateTriggerKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(dateTriggerKey, "close"));
    };

    const choose = (item: Suggestion) => {
      const view = currentView;
      const from = view ? dateTriggerKey.getState(view.state)?.from : undefined;
      if (!view || from === undefined || item.kind !== "date") return;
      list?.hide();
      const { state } = view;
      const pageId = journalId(item.date);
      const title = journalTitle(item.date);
      const mark = state.schema.marks[WIKILINK_MARK].create({ pageId });
      const tr = state.tr.replaceWith(from, state.selection.head, [state.schema.text("[["), state.schema.text(title, [mark]), state.schema.text("]]")]);
      tr.setSelection(TextSelection.create(tr.doc, from + title.length + 4));
      view.dispatch(tr.setMeta(dateTriggerKey, "close").scrollIntoView());
    };

    const placeUnder = (view: EditorView, pos: number) => {
      try {
        const at = view.coordsAtPos(pos);
        return { left: at.left, bottom: at.bottom };
      } catch {
        return { left: 0, bottom: 0 };
      }
    };

    return [
      new Plugin<DateTriggerState>({
        key: dateTriggerKey,
        state: {
          init: () => null,
          apply: (tr, prev, _old, state) => {
            const meta = tr.getMeta(dateTriggerKey) as { start: number } | "close" | undefined;
            if (meta === "close") return null;
            const next = meta ? { from: meta.start } : prev ? { from: tr.mapping.map(prev.from) } : null;
            return next && dateQuery(state, next.from) !== null ? next : null;
          },
        },
        view: (view) => {
          currentView = view;
          return {
            update: (v) => {
              const open = dateTriggerKey.getState(v.state);
              const query = open ? dateQuery(v.state, open.from) : null;
              if (!open || query === null) {
                list?.hide();
                return;
              }
              const items: Suggestion[] = dateSuggestions(query, today()).map(({ date, phrase }) => ({ kind: "date", date, phrase }));
              list ??= new SuggestionList(choose, "Link to a date");
              list.show(items, placeUnder(v, open.from), NO_MATCH(query));
            },
            destroy: () => {
              list?.destroy();
              list = null;
              currentView = null;
            },
          };
        },
        props: {
          handleTextInput: (view, from, to, text) => {
            if (text !== "@" || from !== to || !editing(view)) return false;
            const { doc } = view.state;
            const $from = doc.resolve(from);
            if (!$from.parent.isTextblock) return false;
            const before = doc.textBetween(Math.max(from - 1, $from.start()), from);
            // Only at the start of a line or after a space, and not inside a link
            if ((before && !/\s/.test(before)) || spanAt(linkSpans(doc), from)) return false;
            view.dispatch(view.state.tr.insertText("@", from, to).setMeta(dateTriggerKey, { start: from }));
            return true;
          },
          handleKeyDown: (view, event) => {
            if (!dateTriggerKey.getState(view.state)) return false;
            if (event.key === "Escape") {
              close(view);
              return true;
            }
            if (!list?.isOpen) return false;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              list.move(event.key === "ArrowDown" ? 1 : -1);
              return true;
            }
            if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) return list.choose();
            return false;
          },
          handleDOMEvents: {
            blur: (view) => {
              if (!view.isDestroyed) close(view);
              return false;
            },
          },
        },
      }),
    ];
  },
});
