import { data, Link, redirect, useLocation, useNavigate } from "react-router";
import type { Route } from "./+types/docs.$id";
import { isValidDocumentId, APP_DISPLAY_NAME } from "~/shared/constants";
import { currentSlugOrNull, loadDocument } from "~/lib/document-loader.server";
import { pagePath } from "~/lib/slug";
import { useYjsEditor } from "~/lib/useYjsEditor";
import { DocumentProvider, useDocument } from "~/lib/DocumentContext";
import Editor from "~/components/Editor";
import Preview from "~/components/Preview";
import PreviewToggle from "~/components/PreviewToggle";
import ConnectionStatus from "~/components/ConnectionStatus";
import ShareButton from "~/components/ShareButton";
import ModeToggle from "~/components/ModeToggle";
import CleanViewToggle from "~/components/CleanViewToggle";
import SuggestionActions from "~/components/SuggestionActions";
import CommentInput from "~/components/CommentInput";
import ThreadList from "~/components/ThreadList";
import ThemeSelector from "~/components/ThemeSelector";
import MobilePanel from "~/components/MobilePanel";
import OnboardingBanner from "~/components/OnboardingBanner";
import PageTitle from "~/components/PageTitle";
import NewPageButton from "~/components/NewPageButton";

export function meta(_args: Route.MetaArgs) {
  return [{ title: APP_DISPLAY_NAME }];
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const id = params.id;
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
  const { id, createdAt, path } = loaderData;
  const location = useLocation();
  const focusTitle = (location.state as { focusTitle?: boolean } | null)?.focusTitle === true;
  // Keyed by page so moving between pages gets a fresh Yjs doc and editor
  return <DocumentScreen key={id} id={id} createdAt={createdAt} path={path} focusTitle={focusTitle} />;
}

interface ScreenProps {
  id: string;
  createdAt: number | null;
  /** The address the page was loaded at: /page/<slug> or /docs/<id>. */
  path: string;
  focusTitle: boolean;
}

function DocumentScreen({ id, createdAt, path, focusTitle }: ScreenProps) {
  const yjs = useYjsEditor(id);

  return (
    <DocumentProvider docId={id} createdAt={createdAt} yjs={yjs}>
      <DocumentLayout id={id} path={path} focusTitle={focusTitle} />
    </DocumentProvider>
  );
}

function DocumentLayout({ id, path, focusTitle }: Omit<ScreenProps, "createdAt">) {
  const navigate = useNavigate();
  // Move to the new address straight away; the index already knows it
  const onRenamed = (newPath: string) => {
    if (newPath !== path) navigate(newPath, { replace: true });
  };
  const {
    yjs,
    showPreview,
    handleEditorReady,
    handleCommentClick,
    commentHighlight,
    activeCommentRange,
    cleanView,
    openCommentInput,
    handleResolveAtCursor,
    handleDeleteAtCursor,
    mode,
  } = useDocument();

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-stretch overflow-x-auto scrollbar-none border-b border-border">
        <Link
          to="/"
          className="flex items-center bg-ink px-4 py-2 font-medium text-paper transition-colors hover:bg-chartreuse hover:text-[#1a1a1a]"
        >
          {APP_DISPLAY_NAME}
        </Link>
        <div className="shrink-0 border-r border-border">
          <NewPageButton />
        </div>
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
        <div className="flex shrink-0 items-center border-l border-border">
          <ThemeSelector />
        </div>
      </header>
      <div className="flex flex-1 overflow-hidden">
        <main className="flex-1 overflow-y-auto pb-[33vh] lg:border-r lg:border-border lg:pb-0">
          <PageTitle doc={yjs.doc} pageId={id} autoFocus={focusTitle} onRenamed={onRenamed} />
          <Editor
            yjs={yjs}
            hidden={showPreview}
            onEditorReady={handleEditorReady}
            onCommentClick={handleCommentClick}
            commentHighlight={commentHighlight}
            activeCommentRange={activeCommentRange}
            cleanView={cleanView}
            onNewComment={openCommentInput}
            onResolveAtCursor={handleResolveAtCursor}
            onDeleteAtCursor={handleDeleteAtCursor}
          />
          {showPreview && <Preview />}
        </main>
        <aside className="hidden w-96 flex-col overflow-hidden lg:flex">
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
