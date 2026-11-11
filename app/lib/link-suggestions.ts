import type { LinkPage } from "./page-titles";
import { journalTitle } from "./note-ids";

/**
 * The `[[` suggestions list (PRD 6.1). Plain DOM, positioned under the link
 * being typed; the link extension owns it and drives it from the keyboard.
 * Items keep the editor focused (mousedown is cancelled), so choosing one
 * never blurs the editor. The `@` date list (date-trigger.ts) and the `/`
 * menu (slash-menu.ts) use it too.
 */

export type Suggestion =
  | { kind: "page"; page: LinkPage }
  | { kind: "create"; title: string }
  | { kind: "date"; date: string; phrase: string }
  | { kind: "command"; id: string; label: string; hint: string };

export class SuggestionList {
  private el: HTMLDivElement;
  private items: Suggestion[] = [];
  private selected = 0;

  constructor(
    private onChoose: (item: Suggestion) => void,
    label = "Link to page",
  ) {
    this.el = document.createElement("div");
    this.el.className = "link-suggest";
    this.el.setAttribute("role", "listbox");
    this.el.setAttribute("aria-label", label);
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden && this.items.length > 0;
  }

  /** Show items under `at`. With none, `empty` is shown instead if given (and nothing can be chosen). */
  show(items: Suggestion[], at: { left: number; bottom: number }, empty?: string): void {
    this.items = items;
    this.selected = Math.min(this.selected, Math.max(0, items.length - 1));
    this.render(empty);
    this.el.style.left = `${Math.round(at.left + window.scrollX)}px`;
    this.el.style.top = `${Math.round(at.bottom + window.scrollY + 4)}px`;
    this.el.hidden = items.length === 0 && !empty;
  }

  hide(): void {
    this.el.hidden = true;
    this.items = [];
    this.selected = 0;
  }

  move(delta: number): void {
    if (!this.items.length) return;
    this.selected = (this.selected + delta + this.items.length) % this.items.length;
    this.render();
  }

  choose(): boolean {
    const item = this.items[this.selected];
    if (!item) return false;
    this.onChoose(item);
    return true;
  }

  destroy(): void {
    this.el.remove();
  }

  private render(empty?: string): void {
    this.el.textContent = "";
    if (!this.items.length && empty) {
      const note = document.createElement("div");
      note.className = "link-suggest-item link-suggest-none";
      note.textContent = empty;
      this.el.appendChild(note);
      return;
    }
    this.items.forEach((item, i) => {
      const option = document.createElement("div");
      option.className = "link-suggest-item";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(i === this.selected));
      if (item.kind === "date" || item.kind === "command") {
        // The day and the phrase it was found from, or the command and what it does
        option.textContent = item.kind === "date" ? journalTitle(item.date) : item.label;
        const sub = document.createElement("span");
        sub.className = "link-suggest-sub";
        sub.textContent = item.kind === "date" ? item.phrase : item.hint;
        option.appendChild(sub);
      } else {
        option.textContent = item.kind === "page" ? item.page.title : `New page: ${item.title}`;
      }
      if (item.kind === "create") option.classList.add("link-suggest-create");
      option.addEventListener("mousedown", (event) => {
        event.preventDefault();
        this.selected = i;
        this.onChoose(item);
      });
      this.el.appendChild(option);
    });
  }
}
