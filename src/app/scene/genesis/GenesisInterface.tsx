/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS INTERFACE
 *
 * The panel router for the AI OS, now composed around the
 * reference workspace preview:
 *
 *   GenesisDock          → the navigation rail (left, full-height
 *                          on desktop / bottom bar on phones)
 *   GenesisWorkspacePreview → the non-covering overlay: bottom
 *                          nav + spatial controls (the "Genesis ·
 *                          Live" status card was removed)
 *   GenesisAgentWorkspace → the live agent work surface (driven
 *                          by real WorkspaceEngine events)
 *   VisualInterface      → the ambient visual layer
 *
 * The floating command palette + fullscreen control stay
 * mounted in every state (even minimized) so ⌘K and fullscreen
 * always work. Exactly one panel mounts at a time via
 * AnimatePresence, keyed by state.activePanel — unchanged.
 * ==========================================================
 */

import { useEffect, useState } from "react";
import { AnimatePresence } from "framer-motion";
import { useGenesis, type GenesisPanel } from "./GenesisCore";
import GenesisDock from "./GenesisDock";
import GenesisCommandPalette from "./GenesisCommandPalette";
import { genesisTheme } from "./GenesisTheme";
import GenesisChat from "./GenesisChat";
import GenesisReasoningPanel from "./GenesisReasoningPanel";
import GenesisDiagnosticsPanel from "./GenesisDiagnosticsPanel";
import GenesisMemoryPanel from "./GenesisMemoryPanel";
import GenesisProvidersPanel from "./GenesisProvidersPanel";
import GenesisDevicePanel from "./GenesisDevicePanel";
import GenesisKnowledgePanel from "./GenesisKnowledgePanel";
import GenesisHistoryPanel from "./GenesisHistoryPanel";
import GenesisLogsPanel from "./GenesisLogsPanel";
import GenesisBrowserPanel from "./GenesisBrowserPanel";
import GenesisWorkspacePreview from "./GenesisWorkspacePreview";
import GenesisAgentWorkspace from "./GenesisAgentWorkspace";
import GenesisAgentsPanel from "./GenesisAgentsPanel";
import GenesisSketchPanel from "./GenesisSketchPanel";
import GenesisRenderPanel from "./GenesisRenderPanel";
import GenesisVideoPanel from "./GenesisVideoPanel";
import GenesisAvatarPanel from "./GenesisAvatarPanel";
import GenesisProjectsPanel from "./GenesisProjectsPanel";
import GenesisSettingsPanel from "./GenesisSettingsPanel";
import GenesisCognitionPanel from "./GenesisCognitionPanel";
import GenesisEngineeringPanel from "./GenesisEngineeringPanel";
import GenesisSelfDevPanel from "./GenesisSelfDevPanel";
import GenesisCosmosPanel from "./GenesisCosmosPanel";
import { CycleIndicator } from "./render/WorldMorph";
import CognitiveLoop from "../../../core/cognition/CognitiveLoop";
import VisualInterface from "./VisualInterface";
import useVisual from "../../../core/visual/useVisual";
import VisualEngine from "../../../core/visual/VisualEngine";
import WorkspaceEngine from "../../../core/workspace/WorkspaceEngine";
import AgentEventBus from "../../../core/agent/AgentEvents";

/** Fullscreen toggle — real requestFullscreen / exitFullscreen. */
function GenesisFullscreenButton() {
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    function onChange() {
      setFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  async function toggle() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (error) {
      console.error("[GenesisInterface] Fullscreen request failed:", error);
    }
  }

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
      style={{
        pointerEvents: "auto",
        width: 34,
        height: 34,
        borderRadius: 999,
        border: "1px solid rgba(148, 163, 184, 0.24)",
        background: "rgba(8, 16, 38, 0.55)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        color: "rgba(214, 228, 244, 0.9)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        boxShadow: "0 6px 20px rgba(2, 6, 23, 0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
        transition: "background 0.15s ease, border-color 0.15s ease",
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        {fullscreen ? (
          <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
        ) : (
          <path d="M9 3H3v6M15 3h6v6M9 21H3v-6M15 21h6v-6" />
        )}
      </svg>
    </button>
  );
}

/** Minimize — replaces the control that used to live in the removed
 *  "Genesis · Live" status card, so the v1 environment keeps its
 *  collapse behavior without anything floating over the interface. */
function GenesisMinimizeButton() {
  const { minimize } = useGenesis();
  return (
    <button
      type="button"
      onClick={minimize}
      title="Minimize Genesis"
      aria-label="Minimize Genesis"
      style={{
        pointerEvents: "auto",
        width: 34,
        height: 34,
        borderRadius: 999,
        border: "1px solid rgba(148, 163, 184, 0.24)",
        background: "rgba(8, 16, 38, 0.55)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        color: "rgba(214, 228, 244, 0.9)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        boxShadow: "0 6px 20px rgba(2, 6, 23, 0.4), inset 0 1px 0 rgba(255,255,255,0.06)",
        transition: "background 0.15s ease, border-color 0.15s ease",
      }}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        aria-hidden
      >
        <path d="M5 12h14" />
      </svg>
    </button>
  );
}

export default function GenesisInterface() {
  const {
    state,
    universe,
    engineRuntime,
    openPanel,
    expand,
  } = useGenesis();

  /* The continuous cognitive loop — starts with the primary environment
     and observes/proposes in the background (level 0-1 only, see the
     Cognition workspace for the cycle report). */
  useEffect(() => {
    CognitiveLoop.getInstance().start();
    return () => CognitiveLoop.getInstance().stop();
  }, []);

  /*
   * LÉLU can transform the ONE Core herself. The workspace orchestration
   * emits a typed `core_transform` event; this always-mounted app layer
   * forwards it to the shared EngineBus (setMorphRequest) so the Core
   * morphs toward the requested environment morphology while the
   * evolution cycle keeps advancing. Only the presentation target
   * changes — the Core is never recreated.
   */
  useEffect(() => {
    const bus = AgentEventBus.getInstance();
    return bus.subscribe((event) => {
      if (event.type !== "core_transform") {
        return;
      }
      const liveBus = engineRuntime?.getEngineBus();
      if (liveBus && (event.morphology === null || event.morphology !== liveBus.getMorphRequest())) {
        liveBus.setMorphRequest(event.morphology);
      }
      if (event.system) {
        VisualEngine.getInstance().setMode(event.system as "matrix" | "neuron" | "nerve" | "heartbeat" | "core");
      }
    });
  }, [engineRuntime]);

  // Live Visual-interface focus (driven by the dock's System tab and by
  // agent events) — the dock tab reflects the same single source of truth.
  const { state: visualState } = useVisual();
  const visualFocus = visualState.interfaceFocus;
  const systemEnvironmentActive = visualFocus === "visual";

  const evolutionColor =
    universe.evolutionSystem.colorShift > 0.72
      ? "#fbbf24"
      : universe.evolutionSystem.colorShift > 0.42
        ? "#a78bfa"
        : "#67e8f9";
  const pulse = universe.pulse.heartbeat;
  const interfaceActivity = Math.max(
    0.12,
    Math.min(1, pulse * 0.45 + universe.evolutionSystem.emergence * 0.35 + universe.awareness * 0.2),
  );

  function handleExitChat() {
    openPanel("none");
  }

  /*
   * The Workspace dock item toggles the workspace LAYER (which runs
   * alongside the conversation) instead of swapping the exclusive
   * active panel — chat stays mounted while the workspace is visible.
   */
  function handleDockSelect(panel: GenesisPanel) {
    if (panel === "workspace") {
      WorkspaceEngine.getInstance().toggle();
      return;
    }
    if (panel === "visual") {
      const visualEngine = VisualEngine.getInstance();
      visualEngine.setInterfaceFocus(
        visualEngine.getState().interfaceFocus === "visual" ? "genesis" : "visual",
      );
      return;
    }
    openPanel(panel);
  }

  return (
    <div
      data-workspace="genesis-v1"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        /* Scene separation is pure mounting — no z-index. isolation
           keeps the chrome's internal z-indexes inside this layer. */
        isolation: "isolate",
      }}
    >
      {/*
       * UI #1 — the Genesis environment. This component is mounted ONLY
       * while the v1 workspace is the active scene (the workspace router
       * in GenesisScene owns the v2 / system scenes).
       */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          animation: "lelu-environment-enter 0.38s ease",
        }}
      >
          <GenesisDock
            activePanel={state.activePanel}
            onSelect={handleDockSelect}
            online={state.runtimeReady}
            thinking={state.thinking}
            speaking={state.speaking}
            reasoningActive={Boolean(state.cognition?.reasoning)}
            engineErrorCount={state.engineStatuses.filter((engine) => Boolean(engine.error)).length}
            visualActive={systemEnvironmentActive}
          />

          {/* The reference workspace preview — status panel, node diamond,
              beams, bottom nav, spatial controls. Only when expanded. */}
          {state.minimized ? null : <GenesisWorkspacePreview />}

          {/* World lifecycle indicator — phase, speed, developmental age */}
          <CycleIndicator />

          {/*
            * The visual agent workspace: rendered as a layer below the
            * dialogue overlay, driven by REAL agent events (WorkspaceBridge).
            * Conversation + workspace run simultaneously.
            */}
          <GenesisAgentWorkspace
            onDockToggle={() => WorkspaceEngine.getInstance().minimizeAll()}
          />

          {/* The ambient visual layer behind the primary environment — fed
              by the same real agent events through VisualBridge. */}
          <VisualInterface />

          {/* Top chrome: expand chip (when minimized) + command palette +
              fullscreen. The palette and fullscreen stay usable in both
              states. */}
          <div
            style={{
              position: "absolute",
              top: 16,
              left: 16,
              right: 16,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 10,
              pointerEvents: "none",
              zIndex: 24,
            }}
          >
            {state.minimized ? (
              <button
                type="button"
                onClick={expand}
                title="Expand Genesis"
                aria-label="Expand Genesis"
                style={{
                  pointerEvents: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  background: `rgba(8, 16, 38, ${0.72 + interfaceActivity * 0.12})`,
                  border: `1px solid ${evolutionColor}${Math.round((0.24 + interfaceActivity * 0.32) * 255).toString(16).padStart(2, "0")}`,
                  borderRadius: genesisTheme.radius.pill,
                  padding: "8px 14px",
                  color: "white",
                  backdropFilter: genesisTheme.glass.blurSoft,
                  cursor: "pointer",
                  boxShadow: genesisTheme.elevation.chrome.boxShadow,
                }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 999,
                    background: evolutionColor,
                    boxShadow: `0 0 ${6 + pulse * 8}px ${evolutionColor}`,
                    transform: `scale(${0.8 + pulse * 0.45})`,
                  }}
                />
                <strong style={{ fontSize: 12 }}>Genesis</strong>
                <span style={{ opacity: 0.6, fontSize: 11 }}>＋</span>
              </button>
            ) : null}

            <div style={{ pointerEvents: "auto", display: "flex", gap: 8, alignItems: "center" }}>
              {state.minimized ? null : <GenesisMinimizeButton />}
              <GenesisCommandPalette />
              <GenesisFullscreenButton />
            </div>
          </div>
        </div>

      <AnimatePresence mode="wait">
        {/* Chat is INVISIBLE — the dialogue overlay floats in the scene and
            stays available in BOTH environments (click the SystemCore in UI #2). */}
        {state.activePanel === "chat" ? (
          <GenesisChat />
        ) : null}

        {/* Genesis chrome panels belong to UI #1 only. */}
        {systemEnvironmentActive ? null : state.activePanel === "reasoning" ? (
          <GenesisReasoningPanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "diagnostics" ? (
          <GenesisDiagnosticsPanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "memory" ? (
          <GenesisMemoryPanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "providers" ? (
          <GenesisProvidersPanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "device" ? (
          <GenesisDevicePanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "agents" ? (
          <GenesisAgentsPanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "knowledge" ? (
          <GenesisKnowledgePanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "history" ? (
          <GenesisHistoryPanel onClose={handleExitChat} />
        ) : null}

        {/* UI #3 — GENESIS v2 is a full-page workspace, rendered at the
            top of the environment conditional above (not as an overlay). */}

        {systemEnvironmentActive ? null : state.activePanel === "workspaces" ? (
          <GenesisProjectsPanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "logs" ? (
          <GenesisLogsPanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "browser" ? (
          <GenesisBrowserPanel onClose={handleExitChat} />
        ) : null}

        {/* LÉLU V1 creative expansion workspaces. */}
        {systemEnvironmentActive ? null : state.activePanel === "sketch" ? (
          <GenesisSketchPanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "render" ? (
          <GenesisRenderPanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "video" ? (
          <GenesisVideoPanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "avatar" ? (
          <GenesisAvatarPanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "projects" ? (
          <GenesisProjectsPanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "settings" ? (
          <GenesisSettingsPanel onClose={handleExitChat} />
        ) : null}

        {/* Autonomous cognition + engineering layer. */}
        {systemEnvironmentActive ? null : state.activePanel === "cognition" ? (
          <GenesisCognitionPanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "engineering" ? (
          <GenesisEngineeringPanel onClose={handleExitChat} />
        ) : null}

        {systemEnvironmentActive ? null : state.activePanel === "evolution" ? (
          <GenesisSelfDevPanel onClose={handleExitChat} />
        ) : null}

        {/* Cosmos Map — resizable touch minimap */}
        {systemEnvironmentActive ? null : state.activePanel === "cosmos" ? (
          <GenesisCosmosPanel onClose={handleExitChat} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
