/**
 * Whether the app is running from the Home Screen (or as an installed app)
 * rather than in a browser tab, so there are no browser back and forward
 * buttons. iOS reports it as `navigator.standalone`; other browsers through
 * the `display-mode` media query. Browser-only: call it from an effect,
 * never at module load or during server rendering.
 */
export function isStandaloneApp(win: Window = window): boolean {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  return typeof win.matchMedia === "function" && win.matchMedia("(display-mode: standalone)").matches;
}

/**
 * Whether there is a page to go back to in this app's history. React Router
 * numbers each entry it adds (`idx`, 0 for the first); without that number,
 * assume there is.
 */
export function canGoBack(historyState: unknown): boolean {
  const idx = (historyState as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx > 0 : true;
}
