import { data, redirect, useLocation, useNavigate } from "react-router";
import type { Route } from "./+types/docs.$id";
import { isValidDocumentId, APP_DISPLAY_NAME } from "~/shared/constants";
import { currentSlugOrNull, loadDocument } from "~/lib/document-loader.server";
import { pagePath } from "~/lib/slug";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider, useDocument } from "~/lib/DocumentContext";
import PreviewToggle from "~/components/PreviewToggle";
import ConnectionStatus from "~/components/ConnectionStatus";
import { useSidePanel } from "~/lib/side-panel";
import ShareButton from "~/components/ShareButton";
import ModeToggle from "~/components/ModeToggle";
import CleanViewToggle from "~/components/CleanViewToggle";
import SuggestionActions from "~/components/SuggestionActions";
import CommentInput from "~/components/CommentInput";
import ThreadList from "~/components/ThreadList";
import MobilePanel from "~/components/MobilePanel";
import OnboardingBanner from "~/components/OnboardingBanner";
import PageTitle from "~/components/PageTitle";
import JournalHeading from "~/components/JournalHeading";
import AppHeader from "~/components/AppHeader";
import ConnectedEditor from "~/components/ConnectedEditor";
import { isJournalId } from "~/lib/note-ids";

export function meta(_args: Route.MetaArgs) {
  return [{ title: APP_DISPLAY_NAME }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const id = params.id;
  // Journals live at /journal/<date>
  if (isJournalId(id)) throw redirect(pagePath(id, null));
  if (!isValidDocumentId(id)) {
    throw data(null, { status: 404 });
  }
  // /docs/<id> is the permanent address; pages with a title live at /page/<slug>
  const slug = await currentSlugOrNull(context, id);
  if (slug) throw redirect(pagePath(id, slug));
  const doc = await loadDocument(context, id);
  return { ...doc, path: pagePath(id, null) };
}

export default function DocumentPage({ loaderData }: Route.ComponentProps) {
  const { id, createdAt, path, exists } = loaderData;
  const location = useLocation();
  const focusTitle = (location.state as { focusTitle?: boolean } | null)?.focusTitle === true;
  // Keyed by page so moving between pages gets a fresh Yjs doc and editor
  return <DocumentScreen key={id} id={id} createdAt={createdAt} exists={exists} path={path} focusTitle={focusTitle} />;
}

interface ScreenProps {
  id: string;
  createdAt: number | null;
  /** False only for a journal day nobody has written in yet. */
  exists: boolean;
  /** The address the page was loaded at: /page/<slug> or /docs/<id>. */
  path: string;
  focusTitle: boolean;
}

function DocumentScreen({ id, createdAt, exists, path, focusTitle }: ScreenProps) {
  const yjs = useYjsEditor(id);

  return (
    <DocumentProvider docId={id} createdAt={createdAt} yjs={yjs}>
      <DocumentLayout id={id} exists={exists} path={path} focusTitle={focusTitle} />
    </DocumentProvider>
  );
}

function DocumentLayout({ id, exists, path, focusTitle }: Omit<ScreenProps, "createdAt">) {
  const navigate = useNavigate();
  // Move to the new address straight away; the index already knows it
  const onRenamed = (newPath: string) => {
    if (newPath !== path) navigate(newPath, { replace: true });
  };
  const { yjs, mode } = useDocument();
  // The side panel takes the comments column while it shows pages
  const panel = useSidePanel();
  const panelOpen = panel.shown && panel.pages.length > 0;

  return (
    <div className="flex h-screen flex-col">
      <AppHeader>
        <div className="flex grow shrink-0 items-center px-4">
          <span className="font-mono text-sm text-muted" title="This page's address">
            {decodeURIComponent(path)}
          </span>
        </div>
        <div className="flex shrink-0 items-center border-l border-border px-3">
          <ConnectionStatus />
        </div>
        <div className="shrink-0 border-l border-border">
          <ShareButton />
        </div>
      </AppHeader>
      <div className="flex flex-1 overflow-hidden">
        <main className={`flex-1 overflow-y-auto pb-[33vh] lg:pb-0 ${panelOpen ? "" : "lg:border-r lg:border-border"}`}>
          {isJournalId(id) ? (
            <JournalHeading doc={yjs.doc} pageId={id} exists={exists} />
          ) : (
            <PageTitle doc={yjs.doc} pageId={id} autoFocus={focusTitle} onRenamed={onRenamed} />
          )}
          <ConnectedEditor />
        </main>
        <aside className={`hidden w-96 flex-col overflow-hidden ${panelOpen ? "" : "lg:flex"}`}>
          <div className="flex-1 overflow-y-auto">
            <OnboardingBanner />
            <ModeToggle />
            <SuggestionActions />
            {mode === "suggest" && <CleanViewToggle />}
            <div className="border-t border-border" />
            <CommentInput />
            <ThreadList />
          </div>
          <div className="shrink-0 border-t border-border">
            <PreviewToggle />
          </div>
        </aside>
      </div>
      <MobilePanel className="lg:hidden" />
    </div>
  );
}
