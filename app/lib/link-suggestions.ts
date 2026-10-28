import type { LinkPage } from "./page-titles";

/**
 * The `[[` suggestions list (PRD 6.1). Plain DOM, positioned under the link
 * being typed; the link extension owns it and drives it from the keyboard.
 * Items keep the editor focused (mousedown is cancelled), so choosing one
 * never blurs the editor.
 */

export type Suggestion = { kind: "page"; page: LinkPage } | { kind: "create"; title: string };

export class SuggestionList {
  private el: HTMLDivElement;
  private items: Suggestion[] = [];
  private selected = 0;

  constructor(private onChoose: (item: Suggestion) => void) {
    this.el = document.createElement("div");
    this.el.className = "link-suggest";
    this.el.setAttribute("role", "listbox");
    this.el.setAttribute("aria-label", "Link to page");
    this.el.hidden = true;
    document.body.appendChild(this.el);
  }

  get isOpen(): boolean {
    return !this.el.hidden && this.items.length > 0;
  }

  show(items: Suggestion[], at: { left: number; bottom: number }): void {
    this.items = items;
    this.selected = Math.min(this.selected, Math.max(0, items.length - 1));
    this.render();
    this.el.style.left = `${Math.round(at.left + window.scrollX)}px`;
    this.el.style.top = `${Math.round(at.bottom + window.scrollY + 4)}px`;
    this.el.hidden = items.length === 0;
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

  private render(): void {
    this.el.textContent = "";
    this.items.forEach((item, i) => {
      const option = document.createElement("div");
      option.className = "link-suggest-item";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(i === this.selected));
      option.textContent = item.kind === "page" ? item.page.title : `New page: ${item.title}`;
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
