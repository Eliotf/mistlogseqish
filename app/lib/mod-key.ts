import { useSyncExternalStore } from "react";

/**
 * How to write the Cmd/Ctrl key: "⌘" on a Mac, "Ctrl" elsewhere. Safe to
 * call anywhere, including at module load on the server: the Workers
 * runtime has a `navigator` without `platform`.
 */
export function modKeyLabel(): string {
  const platform = typeof navigator === "undefined" ? undefined : (navigator as { platform?: unknown }).platform;
  return typeof platform === "string" && platform.startsWith("Mac") ? "⌘" : "Ctrl";
}

const noSubscription = () => () => {};

/** modKeyLabel for rendering: "Ctrl" on the server, so hydration matches, then the browser's. */
export function useModKeyLabel(): string {
  return useSyncExternalStore(noSubscription, modKeyLabel, () => "Ctrl");
}
