import { useEffect, useSyncExternalStore } from "react";
import { pageTitles, type LinkTarget } from "./page-titles";

/** A link target's current title and address, kept up to date from the title store. */
export function useLinkTarget(pageId: string): LinkTarget | undefined {
  const store = pageTitles();
  useEffect(() => store.request([pageId]), [store, pageId]);
  return useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.get(pageId),
    () => undefined,
  );
}

