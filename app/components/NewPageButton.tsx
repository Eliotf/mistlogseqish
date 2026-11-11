import { useState } from "react";
import { useNavigate } from "react-router";
import { generateDocumentId } from "~/shared/constants";

/** Create an empty page and return its ID. */
export async function createPage(): Promise<string> {
  const id = generateDocumentId();
  const res = await fetch(`/agents/document-agent/${id}`, { method: "POST" });
  if (!res.ok) throw new Error(`Could not create page: ${res.status}`);
  return id;
}

/** Sidebar button (PRD F8): create an empty page and open it with its title ready to type. */
export default function NewPageButton({ create = createPage, className = "" }: { create?: () => Promise<string>; className?: string }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onClick() {
    setBusy(true);
    setFailed(false);
    try {
      const id = await create();
      navigate(`/docs/${id}`, { state: { focusTitle: true } });
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={busy}
      title={failed ? "Couldn't create a page. Check your connection and try again." : undefined}
      className={`cursor-pointer disabled:cursor-wait disabled:opacity-60 ${className}`}
    >
      {failed ? "Try again" : "New page"}
    </button>
  );
}
