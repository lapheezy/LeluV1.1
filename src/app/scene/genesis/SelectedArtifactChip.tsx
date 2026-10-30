/**
 * ==========================================================
 * LÉLU — WHAT "THIS" MEANS, SHOWN IN THE CONVERSATION
 *
 * When the user has selected an artifact in the workspace, the chat
 * composer says so: that is what LÉLU reads and changes when they say
 * "this" or "it". Subscribes to the workspace on its own and re-renders
 * only when the selection (or its title/revision) changes — never on the
 * stream of agent events — so the chat does not re-render with them.
 * ==========================================================
 */

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import WorkspaceEngine from "../../../core/workspace/WorkspaceEngine";
import VisualEngine from "../../../core/visual/VisualEngine";

type Selection = { id: string; title: string; kind: string; revision: number } | null;

function readSelection(): Selection {
  const view = WorkspaceEngine.getInstance().getSelected();
  return view ? { id: view.id, title: view.title, kind: view.kind, revision: view.revision } : null;
}

export default function SelectedArtifactChip() {
  const [selection, setSelection] = useState<Selection>(readSelection);
  useEffect(
    () =>
      WorkspaceEngine.getInstance().subscribe(() => {
        const next = readSelection();
        setSelection((current) =>
          current?.id === next?.id && current?.title === next?.title && current?.revision === next?.revision ? current : next,
        );
      }),
    [],
  );
  if (!selection) return null;
  return (
    <div
      data-testid="chat-selected-artifact"
      data-artifact-id={selection.id}
      data-revision={selection.revision}
      className="lelu-cc-pending"
      style={{ alignItems: "center", gap: 6, fontSize: 11.5, color: "#fde68a" }}
    >
      <button
        type="button"
        onClick={() => VisualEngine.getInstance().setInterfaceFocus("visual")}
        title="Show it in the workspace"
        style={{
          border: "1px solid rgba(250, 204, 21, 0.45)",
          background: "rgba(250, 204, 21, 0.1)",
          color: "inherit",
          borderRadius: 999,
          padding: "3px 10px",
          fontSize: "inherit",
          cursor: "pointer",
          maxWidth: "calc(100% - 32px)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        About: {selection.kind} “{selection.title}”{selection.revision > 1 ? ` · rev ${selection.revision}` : ""}
      </button>
      <button
        type="button"
        aria-label="Stop talking about the selected artifact"
        onClick={() => WorkspaceEngine.getInstance().selectView(null)}
        className="lelu-cc-pending-remove"
        style={{ position: "static" }}
      >
        <X size={12} aria-hidden />
      </button>
    </div>
  );
}
