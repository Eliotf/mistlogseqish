import { useOpenLink } from "~/lib/side-panel";
import Editor from "~/components/Editor";
import Preview from "~/components/Preview";
import { useDocument } from "~/lib/DocumentContext";
import ZoomCrumbs from "~/components/ZoomCrumbs";

/**
 * Mist's editor wired to the surrounding document's context (comments,
 * suggest mode, preview). `zoom` shows one block (PRD F40) with its
 * breadcrumb; `onZoom` is what a bullet click or Cmd/Ctrl+. and , do.
 */
export default function ConnectedEditor({ zoom = null, onZoom }: { zoom?: string | null; onZoom?: (blockId: string | null) => void }) {
  const {
    docId,
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
  // Cmd/Ctrl+click opens the page in the side panel, otherwise it is navigated to
  const openLink = useOpenLink();

  return (
    <>
      {zoom && onZoom && <ZoomCrumbs doc={yjs.doc} docId={docId} zoom={zoom} synced={yjs.synced} onZoom={onZoom} />}
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
        zoom={zoom}
        onZoom={onZoom}
      />
      {showPreview && <Preview />}
    </>
  );
}
