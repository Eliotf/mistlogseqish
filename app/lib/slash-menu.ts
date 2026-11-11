import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { applyEdits, readLines } from "./bullet-editing";
import { setTaskEdit } from "./tasks";
import { canTriggerAt, triggerQuery } from "./inline-trigger";
import { headingEdit, matchCommands, MAX_SLASH_QUERY, type SlashCommandId } from "./slash-commands";
import { dateTriggerKey } from "./date-trigger";
import { SuggestionList, type Suggestion } from "./link-suggestions";
import type { TaskState } from "./note-parser";

/**
 * The `/` menu (PRD F44). Typing `/` at the start of a line or after a space
 * opens a list of commands, narrowed by what is typed after it (`/la` for
 * LATER). Choosing one removes `/...` and does it: sets the line's task
 * keyword or heading, opens a link (`[[ ]]`) or the `@` date list. `/`
 * anywhere else (`and/or`, a URL) is plain text; Escape closes the list and
 * leaves what was typed. Not in suggest mode.
 */

export interface SlashMenuOptions {
  docState: { get: (key: string) => string | undefined } | null;
}

/** Where the `/` is, while the menu is open. */
type SlashMenuState = { from: number } | null;

export const slashMenuKey = new PluginKey<SlashMenuState>("slashMenu");

const NO_MATCH = (query: string) => `No command matches “${query}”.`;
const TASK_STATES = new Set<string>(["TODO", "DOING", "LATER", "NOW", "DONE"]);

/** Remove `/query` (from..to) and do command `id`, in one transaction (one undo step). */
export function runSlashCommand(state: EditorState, from: number, to: number, id: SlashCommandId): Transaction {
  const tr = state.tr.delete(from, to).setMeta(slashMenuKey, "close");
  if (id === "link") {
    // The link extension sees a new empty link and suggests pages
    tr.insertText("[[]]", from);
    return tr.setSelection(TextSelection.create(tr.doc, from + 2));
  }
  if (id === "date") {
    tr.insertText("@", from);
    return tr.setSelection(TextSelection.create(tr.doc, from + 1)).setMeta(dateTriggerKey, { start: from });
  }
  const line = tr.doc.resolve(from).index(0);
  const lines = readLines(tr.doc);
  const text = lines.texts[line];
  const edit = TASK_STATES.has(id) ? setTaskEdit(line, text, id as TaskState) : headingEdit(line, text, Number(id.slice(-1)));
  applyEdits(tr, lines, [edit]);
  return tr;
}

export const SlashMenu = Extension.create<SlashMenuOptions>({
  name: "slashMenu",
  // Ahead of the link extension, as the date list is, so its keys reach the open menu first
  priority: 200,

  addOptions() {
    return { docState: null };
  },

  addProseMirrorPlugins() {
    const editing = (view: EditorView) => view.editable && this.options.docState?.get("mode") !== "suggest";
    let list: SuggestionList | null = null;
    let currentView: EditorView | null = null;

    const close = (view: EditorView) => {
      list?.hide();
      if (slashMenuKey.getState(view.state)) view.dispatch(view.state.tr.setMeta(slashMenuKey, "close"));
    };

    const choose = (item: Suggestion) => {
      const view = currentView;
      const from = view ? slashMenuKey.getState(view.state)?.from : undefined;
      if (!view || from === undefined || item.kind !== "command") return;
      list?.hide();
      view.dispatch(runSlashCommand(view.state, from, view.state.selection.head, item.id as SlashCommandId).scrollIntoView());
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
      new Plugin<SlashMenuState>({
        key: slashMenuKey,
        state: {
          init: () => null,
          apply: (tr, prev, _old, state) => {
            const meta = tr.getMeta(slashMenuKey) as { start: number } | "close" | undefined;
            if (meta === "close") return null;
            const next = meta ? { from: meta.start } : prev ? { from: tr.mapping.map(prev.from) } : null;
            return next && triggerQuery(state, next.from, "/", MAX_SLASH_QUERY) !== null ? next : null;
          },
        },
        view: (view) => {
          currentView = view;
          return {
            update: (v) => {
              const open = slashMenuKey.getState(v.state);
              const query = open ? triggerQuery(v.state, open.from, "/", MAX_SLASH_QUERY) : null;
              if (!open || query === null) {
                list?.hide();
                return;
              }
              const items: Suggestion[] = matchCommands(query).map((c) => ({ kind: "command", id: c.id, label: c.label, hint: c.hint }));
              list ??= new SuggestionList(choose, "Commands");
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
            if (text !== "/" || from !== to || !editing(view) || !canTriggerAt(view.state.doc, from)) return false;
            view.dispatch(view.state.tr.insertText("/", from, to).setMeta(slashMenuKey, { start: from }));
            return true;
          },
          handleKeyDown: (view, event) => {
            if (!slashMenuKey.getState(view.state)) return false;
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
