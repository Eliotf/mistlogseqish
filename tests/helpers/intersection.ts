import { vi } from "vitest";

/** A controllable IntersectionObserver for jsdom: call `scrollIntoView(el)` to fire it. */
export function installIntersectionObserver() {
  const observers = new Set<{ cb: IntersectionObserverCallback; els: Set<Element>; options?: IntersectionObserverInit }>();
  class FakeObserver {
    private entry: { cb: IntersectionObserverCallback; els: Set<Element>; options?: IntersectionObserverInit };
    constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      this.entry = { cb, els: new Set(), options };
      observers.add(this.entry);
    }
    observe(el: Element) {
      this.entry.els.add(el);
    }
    unobserve(el: Element) {
      this.entry.els.delete(el);
    }
    disconnect() {
      observers.delete(this.entry);
    }
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  return {
    /** Fire every observer watching `el`, as if it scrolled near the screen. */
    scrollNear(el: Element) {
      for (const o of [...observers]) {
        if (o.els.has(el)) o.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], o as never);
      }
    },
    /** Root margins of active observers, to check how early things connect. */
    margins: () => [...observers].map((o) => o.options?.rootMargin),
    count: () => observers.size,
  };
}
