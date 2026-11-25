import type { MouseEvent, ReactNode } from "react";
import { NavLink } from "react-router";
import { TASKS_PANEL_ID, useHasSidePanel, useSidePanel } from "~/lib/side-panel";

interface TasksLinkProps {
  className: string;
  /** Called after either way of opening (the phone menu closes itself). */
  onChoose?: () => void;
  children: ReactNode;
}

/**
 * A link to the Tasks view (PRD F6). Cmd/Ctrl+click (or Cmd/Ctrl+Enter on it)
 * puts the list in the side panel instead (F18), as a linked page would go.
 */
export default function TasksLink({ className, onChoose, children }: TasksLinkProps) {
  const panel = useSidePanel();
  const hasPanel = useHasSidePanel();
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (hasPanel && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      panel.open(TASKS_PANEL_ID);
    }
    onChoose?.();
  };
  return (
    <NavLink to="/tasks" end onClick={onClick} className={className}>
      {children}
    </NavLink>
  );
}
