import { useCallback } from "react";
import { useNavigate } from "react-router";
import { useHasSidePanel, useSidePanel } from "~/lib/side-panel";
import { pageTitles } from "~/lib/page-titles";
import Editor from "~/components/Editor";
import Preview from "~/components/Preview";
import { useDocument } from "~/lib/DocumentContext";

/** Mist's editor wired to the surrounding document's context (comments, suggest mode, preview). */
export default function ConnectedEditor() {
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
  } = useDocument();
  const navigate = useNavigate();
  const panel = useSidePanel();
  const hasPanel = useHasSidePanel();
  // Cmd/Ctrl+click opens the page in the side panel; a missing page has nothing to show there
  const openLink = useCallback(
    (href: string, link: { pageId: string; side: boolean }) => {
      if (link.side && hasPanel && !pageTitles().get(link.pageId)?.missing) panel.open(link.pageId);
      else navigate(href);
    },
    [navigate, panel, hasPanel],
  );

  return (
    <>
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
        onOpenLink={openLink}
      />
      {showPreview && <Preview />}
    </>
  );
}
