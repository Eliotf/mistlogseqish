import { pagePath } from "./slug";

/**
 * Current titles for link targets (PRD 6.1). A link stores a page ID and a
 * copy of the title from when it was made; the editor shows the title from
 * here instead. One store serves every editor on screen (the feed has many),
 * so IDs are batched into one request and answers are cached. Titles are
 * refreshed when the tab comes back into view; live updates are F33.
 */

/** What a link shows for its target, as returned by /api/pages/titles. */
export interface LinkTarget {
  title: string;
  kind: "page" | "journal";
  slug: string | null;
  /** The page exists but has no text yet (a placeholder). */
  empty: boolean;
  /** No such page: shown dashed, as unresolved. */
  missing: boolean;
}

export const MAX_TITLE_IDS = 200;

/** Where a link to this target goes. */
export function linkHref(pageId: string, target: LinkTarget | undefined): string {
  return pagePath(pageId, target?.slug ?? null);
}

type Fetcher = (ids: string[]) => Promise<Record<string, LinkTarget>>;

export async function fetchLinkTargets(ids: string[]): Promise<Record<string, LinkTarget>> {
  const res = await fetch(`/api/pages/titles?ids=${ids.map(encodeURIComponent).join(",")}`);
  if (!res.ok) throw new Error(`titles: ${res.status}`);
  return ((await res.json()) as { pages: Record<string, LinkTarget> }).pages;
}

export class PageTitleStore {
  private targets = new Map<string, LinkTarget>();
  private wanted = new Set<string>();
  private queued = new Set<string>();
  private flushScheduled = false;
  private listeners = new Set<() => void>();

  constructor(private fetcher: Fetcher = fetchLinkTargets) {}

  get(pageId: string): LinkTarget | undefined {
    return this.targets.get(pageId);
  }

  /** Ask for these pages' titles; unknown ones are fetched in one batch. */
  request(pageIds: Iterable<string>): void {
    for (const id of pageIds) {
      if (this.wanted.has(id)) continue;
      this.wanted.add(id);
      this.queued.add(id);
    }
    this.scheduleFlush();
  }

  /** Fetch every title asked for so far again, e.g. when the tab is shown. */
  refresh(): void {
    for (const id of this.wanted) this.queued.add(id);
    this.scheduleFlush();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private scheduleFlush(): void {
    if (this.flushScheduled || this.queued.size === 0) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      void this.flush();
    });
  }

  private async flush(): Promise<void> {
    const ids = [...this.queued];
    this.queued.clear();
    for (let i = 0; i < ids.length; i += MAX_TITLE_IDS) {
      const batch = ids.slice(i, i + MAX_TITLE_IDS);
      try {
        const found = await this.fetcher(batch);
        let changed = false;
        for (const id of batch) {
          const next = found[id];
          if (!next || sameTarget(this.targets.get(id), next)) continue;
          this.targets.set(id, next);
          changed = true;
        }
        if (changed) this.listeners.forEach((l) => l());
      } catch (err) {
        // Keep showing what we had (or the stored copy); the next refresh retries
        console.error("Loading link titles failed", err);
      }
    }
  }
}

function sameTarget(a: LinkTarget | undefined, b: LinkTarget): boolean {
  return !!a && a.title === b.title && a.kind === b.kind && a.slug === b.slug && a.empty === b.empty && a.missing === b.missing;
}

let shared: PageTitleStore | null = null;

/** The browser's one store, refreshed whenever the tab is shown again. */
export function pageTitles(): PageTitleStore {
  if (!shared) {
    shared = new PageTitleStore();
    const store = shared;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") store.refresh();
      });
    }
  }
  return shared;
}
