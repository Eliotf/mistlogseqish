import { useOnline } from "~/lib/offline";

/** Says so when there is no connection (PRD F14): what you see is this device's copy, and edits wait to sync. */
export default function OfflineNotice() {
  const online = useOnline();
  if (online) return null;
  return (
    <p role="status" className="border-b border-border bg-canary px-4 py-1.5 text-sm text-[#1a1a1a]">
      Offline: showing the copy on this device. Edits sync when you're back online.
    </p>
  );
}
