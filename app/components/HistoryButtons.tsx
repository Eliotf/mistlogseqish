import { useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";
import { canGoBack, isStandaloneApp } from "~/lib/standalone";

const BUTTON =
  "flex shrink-0 items-center border-r border-border px-2.5 text-ink transition-colors hover:bg-border disabled:text-muted disabled:opacity-50 disabled:hover:bg-transparent";

const noSubscription = () => () => {};

/**
 * Header back and forward buttons, shown only when the app runs from the
 * Home Screen, where there is no browser bar to provide them (PRD F17).
 * In a browser tab they would only repeat the browser's own.
 */
export default function HistoryButtons() {
  const navigate = useNavigate();
  // Re-render on every move so the back button's state stays current
  useLocation();
  // False on the server; in the browser it doesn't change while the app runs
  const standalone = useSyncExternalStore(noSubscription, isStandaloneApp, () => false);
  if (!standalone) return null;
  return (
    <>
      <button
        type="button"
        onClick={() => navigate(-1)}
        disabled={!canGoBack(window.history.state)}
        aria-label="Back"
        className={BUTTON}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M15 5l-7 7 7 7" />
        </svg>
      </button>
      <button type="button" onClick={() => navigate(1)} aria-label="Forward" className={BUTTON}>
        <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75">
          <path d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </>
  );
}
