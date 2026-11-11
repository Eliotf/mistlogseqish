import type { ReactNode } from "react";
import PhoneToolbar from "~/components/PhoneToolbar";
import SidePanel from "~/components/SidePanel";
import SearchBox from "~/components/SearchBox";
import ShortcutSheet from "~/components/ShortcutSheet";
import LeftSidebar, { PhoneMenu } from "~/components/LeftSidebar";
import { LeftSidebarProvider, useIsDesktop, useLeftSidebar, type IndexStatus } from "~/lib/left-sidebar";
import { SearchBoxProvider } from "~/lib/search-box";
import { ShortcutSheetProvider } from "~/lib/shortcut-sheet";
import { SidePanelProvider, useSidePanel, useToggleShortcut } from "~/lib/side-panel";

interface ShellProps {
  children: ReactNode;
  /** For tests: where the sidebar's index status line comes from. */
  fetchStatus?: () => Promise<IndexStatus>;
}

/** Every screen (the route's content as children), with the app-wide controls around it. */
export default function AppShell(props: ShellProps) {
  return (
    <SidePanelProvider>
      <SearchBoxProvider>
        <ShortcutSheetProvider>
          <LeftSidebarProvider>
            <Shell {...props} />
          </LeftSidebarProvider>
        </ShortcutSheetProvider>
      </SearchBoxProvider>
    </SidePanelProvider>
  );
}

/**
 * The left sidebar (PRD F8) or phone menu (F17) and the side panel (F18)
 * beside the screen, and the search box (F13) and shortcut sheet (F43) over it.
 */
function Shell({ children, fetchStatus }: ShellProps) {
  const panel = useSidePanel();
  useToggleShortcut(panel.toggle);
  const sidebar = useLeftSidebar();
  useToggleShortcut(sidebar?.toggleFromKey ?? noop, "l");
  const desktop = useIsDesktop();
  return (
    <div className="flex">
      {sidebar?.shown && desktop && <LeftSidebar fetchStatus={fetchStatus} />}
      <PhoneMenu fetchStatus={fetchStatus} />
      <div className="min-w-0 flex-1">{children}</div>
      <SidePanel />
      <PhoneToolbar />
      <SearchBox />
      <ShortcutSheet />
    </div>
  );
}

function noop() {}
