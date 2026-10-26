import { useNavigate } from "react-router";
import { localDate } from "~/lib/note-ids";

/**
 * Header button: open today's journal. "Today" is worked out when clicked,
 * in the browser's time zone; the server runs on UTC and could be a day off.
 */
export default function TodayButton({ now = () => new Date() }: { now?: () => Date }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(`/journal/${localDate(now())}`)}
      className="flex h-full cursor-pointer items-center px-3 text-sm uppercase tracking-wider transition-colors hover:bg-border"
    >
      Today
    </button>
  );
}
