/**
 * ==========================================================
 * LÉLU
 * GENESIS SETTINGS PANEL — the Settings hub
 *
 * Aggregates the system destinations (API Status, Device,
 * Engines, Logs, Browser, Knowledge, Cognition workspaces)
 * and exposes honest local data controls: memory count,
 * clearing the conversation, exporting all creative data as
 * JSON, and resetting the creative stores. Offline-first.
 * ==========================================================
 */

import { useEffect, useMemo, useState } from "react";
import GenesisWindowFrame from "./GenesisWindowFrame";
import { useGenesis, type GenesisPanel } from "./GenesisCore";
import AIService from "../../../core/AIService";
import AvatarStore from "../../../core/avatar/AvatarProfile";
import AgentStore from "../../../core/agents/AgentStore";
import ProjectStore from "../../../core/projects/ProjectStore";
import SketchStore from "../../../core/creative/SketchDocument";
import RenderStore from "../../../core/creative/RenderStore";
import VideoStore from "../../../core/creative/VideoProject";

interface GenesisSettingsPanelProps {
  onClose: () => void;
}

const LINKS: { id: GenesisPanel; label: string; description: string }[] = [
  { id: "providers", label: "API Status", description: "Provider health, active provider, fallback state" },
  { id: "device", label: "Device", description: "Microphone, camera, clipboard, share, storage…" },
  { id: "diagnostics", label: "Engines", description: "Genesis engine status and errors" },
  { id: "logs", label: "Logs", description: "Execution trace of the request pipeline" },
  { id: "browser", label: "Browser", description: "Live browser surface" },
  { id: "knowledge", label: "Knowledge", description: "Research / knowledge providers" },
  { id: "workspaces", label: "Projects", description: "The workspace / project system" },
];

export default function GenesisSettingsPanel({ onClose }: GenesisSettingsPanelProps) {
  const { openPanel, clearConversation, state } = useGenesis();
  const [memoryCount, setMemoryCount] = useState<number | null>(null);
  const [avatarName, setAvatarName] = useState<string>("Lélu");
  const [exported, setExported] = useState(false);

  const stores = useMemo(
    () => ({
      agents: AgentStore.getInstance().list().length,
      projects: ProjectStore.getInstance().list().length,
      sketches: SketchStore.getInstance().list().length,
      renders: RenderStore.getInstance().list().length,
      videos: VideoStore.getInstance().list().length,
    }),
    [],
  );

  useEffect(() => {
    void AIService.getInstance()
      .getMemories(1000)
      .then((memories) => setMemoryCount(memories.length))
      .catch(() => setMemoryCount(null));
    setAvatarName(AvatarStore.getInstance().get().identity.name);
  }, []);

  function exportAll() {
    const payload = {
      exportedAt: new Date().toISOString(),
      conversations: state.messages,
      memories: memoryCount,
      agents: AgentStore.getInstance().list(),
      projects: ProjectStore.getInstance().list(),
      sketches: SketchStore.getInstance().list(),
      renders: RenderStore.getInstance().list(),
      videos: VideoStore.getInstance().list(),
      avatar: AvatarStore.getInstance().get(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lelu-export.json";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setExported(true);
  }

  function clearCreativeData() {
    if (!window.confirm("Delete ALL locally stored creative data (agents, projects, sketches, renders, videos)? This cannot be undone.")) {
      return;
    }
    const kv = localStorage;
    for (const key of ["lelu.agents.v1", "lelu.projects.v1", "lelu.sketches.v1", "lelu.renders.v1", "lelu.videos.v1", "lelu.avatar.v1"]) {
      try {
        kv.removeItem(key);
      } catch {
        // backend blocked
      }
    }
    window.location.reload();
  }

  return (
    <GenesisWindowFrame
      eyebrow="LÉLU · System"
      title="Settings · local-first operating environment"
      onClose={onClose}
      width="min(94vw, 820px)"
      maxHeight="min(90vh, 860px)"
      elevation="focus"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            <strong style={{ color: "#e7c883" }}>{avatarName}</strong> · {memoryCount ?? "…"} local memories ·{" "}
            {stores.agents} agents · {stores.projects} projects · {stores.sketches} sketches · {stores.renders} renders ·{" "}
            {stores.videos} video projects
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {LINKS.map((link) => (
            <button
              key={link.id}
              type="button"
              onClick={() => openPanel(link.id)}
              style={{
                textAlign: "left",
                border: "1px solid rgba(255,255,255,0.1)",
                borderRadius: 12,
                padding: "11px 13px",
                background: "rgba(255,255,255,0.03)",
                color: "white",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: "#9be8ff" }}>{link.label}</div>
              <div style={{ fontSize: 11, opacity: 0.65, marginTop: 2 }}>{link.description}</div>
            </button>
          ))}
        </div>

        <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 12 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 8 }}>
            Data
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() => {
                clearConversation();
                openPanel("none");
              }}
              style={{
                border: "1px solid rgba(255,255,255,0.16)",
                borderRadius: 8,
                background: "rgba(255,255,255,0.06)",
                color: "white",
                padding: "7px 12px",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Clear conversation
            </button>
            <button
              type="button"
              onClick={exportAll}
              style={{
                border: "1px solid rgba(125, 211, 252, 0.4)",
                borderRadius: 8,
                background: "rgba(34, 211, 238, 0.12)",
                color: "white",
                padding: "7px 12px",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {exported ? "✓ Exported" : "⬇ Export all local data (JSON)"}
            </button>
            <button
              type="button"
              onClick={clearCreativeData}
              style={{
                border: "1px solid rgba(248, 113, 113, 0.4)",
                borderRadius: 8,
                background: "rgba(248, 113, 113, 0.08)",
                color: "#fca5a5",
                padding: "7px 12px",
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Reset creative data
            </button>
          </div>
        </div>

        <div style={{ border: "1px solid rgba(255,255,255,0.1)", borderRadius: 14, padding: 12, fontSize: 12, lineHeight: 1.6, opacity: 0.85 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em", opacity: 0.6, marginBottom: 8 }}>
            Offline-first foundation
          </div>
          LÉLU launches, opens projects, sketches, saves sketches, manages agents, manages projects, configures the
          avatar, views previous work and accesses local memory with zero network. Cloud AI enhances LÉLU — it never
          determines whether the application is usable. Provider-dependent capabilities (cloud image/video generation)
          are clearly marked in their workspaces and require API keys.
        </div>
      </div>
    </GenesisWindowFrame>
  );
}
