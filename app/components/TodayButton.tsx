import { useNavigate } from "react-router";
import { localDate } from "~/lib/note-ids";

/**
 * Sidebar button (PRD F8): open today's journal. "Today" is worked out when
 * clicked, in the browser's time zone; the server runs on UTC and could be a
 * day off.
 */
export default function TodayButton({ now = () => new Date(), className = "" }: { now?: () => Date; className?: string }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(`/journal/${localDate(now())}`)} className={`cursor-pointer ${className}`}>
      Today
    </button>
  );
}
