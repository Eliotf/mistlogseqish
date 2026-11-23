import { useOnline } from "~/lib/offline";

/**
 * Says so when there is no connection (PRD F14): what you see is this
 * device's copy, and edits wait to sync. It floats over the screen rather
 * than taking a line above it, as screens are exactly the visible height
 * (`h-dvh`) and a line above would push their bottom off the screen. It
 * lets taps through, and the phone toolbar covers it while typing.
 */
export default function OfflineNotice() {
  const online = useOnline();
  if (online) return null;
  return (
    <p
      role="status"
      className="pointer-events-none fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-1/2 z-30 w-max max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full border border-border bg-canary px-4 py-1.5 text-center text-sm text-[#1a1a1a] shadow"
    >
      Offline: showing the copy on this device. Edits sync when you're back online.
    </p>
  );
}
