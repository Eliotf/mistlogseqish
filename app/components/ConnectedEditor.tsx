import { useNavigate } from "react-router";
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
        onOpenLink={navigate}
      />
      {showPreview && <Preview />}
    </>
  );
}
