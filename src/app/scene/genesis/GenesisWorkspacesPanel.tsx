/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS WORKSPACES PANEL
 *
 * Phase 7 — a 2D list view over the Workspace Manager,
 * complementing the 3D spheres GenesisWorkspace already draws
 * in the scene. Clicking a row focuses it exactly the way
 * clicking a sphere or a command-palette entry does — all three
 * share focusWorkspace/selectDestination on GenesisCore, so
 * they can never drift out of sync with each other.
 * ==========================================================
 */

import { useMemo } from "react";
import { useGenesis } from "./GenesisCore";
import { genesisTheme } from "./GenesisTheme";
import GenesisWindowFrame from "./GenesisWindowFrame";

interface WorkspaceShape {
  id?: string;
  name?: string;
  description?: string;
}

const EMPTY_WORKSPACES: WorkspaceShape[] = [];

interface GenesisWorkspacesPanelProps {
  onClose: () => void;
}

export default function GenesisWorkspacesPanel({ onClose }: GenesisWorkspacesPanelProps) {
  const { state, focusWorkspace, selectDestination } = useGenesis();
  const workspaces = (state.cognition?.workspaces as WorkspaceShape[] | undefined) ?? EMPTY_WORKSPACES;

  const rows = useMemo(
    () => workspaces.map((workspace, index) => ({ ...workspace, index })),
    [workspaces],
  );

  function open(workspace: WorkspaceShape, index: number) {
    const id = workspace.id ?? String(index);
    const name = workspace.name ?? "Workspace";
    const position = { x: index * 3 - 3, y: 0, z: -5 };
    focusWorkspace(id);
    selectDestination({ id, type: "workspace", name, position });
  }

  return (
    <GenesisWindowFrame
      title={<>Workspaces · {rows.length}</>}
      onClose={onClose}
      width="min(92vw, 480px)"
    >
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, opacity: 0.6 }}>No workspaces registered yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {rows.map((workspace) => {
            const active = state.activeWorkspace === (workspace.id ?? String(workspace.index));
            return (
              <button
                key={workspace.id ?? workspace.index}
                type="button"
                onClick={() => open(workspace, workspace.index)}
                style={{
                  textAlign: "left",
                  border: active ? genesisTheme.glass.borderAccent : "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 12,
                  padding: "10px 12px",
                  background: active ? "rgba(34, 211, 238, 0.1)" : "rgba(255,255,255,0.03)",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{workspace.name ?? "Workspace"}</div>
                {workspace.description ? (
                  <div style={{ fontSize: 12, opacity: 0.6, marginTop: 2 }}>{workspace.description}</div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </GenesisWindowFrame>
  );
}
