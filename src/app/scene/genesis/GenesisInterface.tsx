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

import { useCallback, useEffect, useRef, useState } from "react";
import { useGenesis, type GenesisPanel } from "./GenesisCore";
import GenesisModuleHost, { type ModuleRenderers } from "./GenesisModuleHost";
import UIStateStore from "../../../core/cognition/UIStateStore";
import GenesisDock from "./GenesisDock";
import GenesisCommandPalette from "./GenesisCommandPalette";
import { genesisTheme } from "./GenesisTheme";
import GenesisChat from "./GenesisChat";
import GenesisErrorBoundary from "./GenesisErrorBoundary";
import MultiChatTabs from "./MultiChatTabs";
import GenesisReasoningPanel from "./GenesisReasoningPanel";
import GenesisDiagnosticsPanel from "./GenesisDiagnosticsPanel";
import GenesisExecutivePanel from "./GenesisExecutivePanel";
import GenesisMemoryPanel from "./GenesisMemoryPanel";
import GenesisDevicePanel from "./GenesisDevicePanel";
import GenesisKnowledgePanel from "./GenesisKnowledgePanel";
import GenesisHistoryPanel from "./GenesisHistoryPanel";
import GenesisLogsPanel from "./GenesisLogsPanel";
import GenesisBrowserPanel from "./GenesisBrowserPanel";
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
import GenesisSelfEvolutionPanel from "./GenesisSelfEvolutionPanel";
import GenesisNotificationsPanel from "./GenesisNotificationsPanel";
import GenesisVisualStudio from "./GenesisVisualStudio";
import GenesisEarthCore from "./GenesisEarthCore";
import GenesisCosmosPanel from "./GenesisCosmosPanel";

/**
 * ONE module set — the same instances the dock, palette, chat commands
 * and surface controller open. The host renders each per its canonical
 * presentation (inline / expanded / minimized).
 */
const MODULE_RENDERERS: ModuleRenderers = {
  reasoning: ({ onClose }) => <GenesisReasoningPanel onClose={onClose} />,
  diagnostics: ({ onClose }) => <GenesisDiagnosticsPanel onClose={onClose} />,
  executive: ({ onClose }) => <GenesisExecutivePanel onClose={onClose} />,
  memory: ({ onClose }) => <GenesisMemoryPanel onClose={onClose} />,
  device: ({ onClose }) => <GenesisDevicePanel onClose={onClose} />,
  agents: ({ onClose }) => <GenesisAgentsPanel onClose={onClose} />,
  knowledge: ({ onClose }) => <GenesisKnowledgePanel onClose={onClose} />,
  history: ({ onClose }) => <GenesisHistoryPanel onClose={onClose} />,
  logs: ({ onClose }) => <GenesisLogsPanel onClose={onClose} />,
  browser: ({ onClose }) => <GenesisBrowserPanel onClose={onClose} />,
  sketch: ({ onClose }) => <GenesisSketchPanel onClose={onClose} />,
  render: ({ onClose }) => <GenesisRenderPanel onClose={onClose} />,
  video: ({ onClose }) => <GenesisVideoPanel onClose={onClose} />,
  avatar: ({ onClose }) => <GenesisAvatarPanel onClose={onClose} />,
  projects: ({ onClose }) => <GenesisProjectsPanel onClose={onClose} />,
  settings: ({ onClose }) => <GenesisSettingsPanel onClose={onClose} />,
  cognition: ({ onClose }) => <GenesisCognitionPanel onClose={onClose} />,
  engineering: ({ onClose }) => <GenesisEngineeringPanel onClose={onClose} />,
  evolution: ({ onClose }) => <GenesisSelfDevPanel onClose={onClose} />,
  notifications: ({ onClose }) => <GenesisNotificationsPanel onClose={onClose} />,
  visualstudio: ({ onClose }) => <GenesisVisualStudio onClose={onClose} />,
  // Earth Core is the canonical Eagle Eye Earth visual state. It remains
  // one module instance, but is rendered inline with chat rather than as a
  // separate navigation destination.
  earth: ({ onClose }) => <GenesisEarthCore onClose={onClose} />, 
};
import CognitiveLoop from "../../../core/cognition/CognitiveLoop";
import VisualInterface from "./VisualInterface";
import useVisual from "../../../core/visual/useVisual";
import VisualEngine from "../../../core/visual/VisualEngine";
import AgentEventBus from "../../../core/agent/AgentEvents";
import ExplorationController from "./ExplorationController";
import { useVoice } from "../../../core/voice/useVoice";
import GenesisPresenceEngine from "./GenesisPresenceEngine";
import WorldRegistry, { type DestinationKind } from "./WorldRegistry";
import CosmosEntityRegistry from "../../../core/cosmos/CosmosEntityRegistry";
import Sentinel from "../../../core/sentinel/Sentinel";
import CapabilityManifest from "../../../core/capabilities/CapabilityManifest";

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

/* Singleton guard — exactly ONE canonical LÉLU interface (chat + dock +
   modules) may be mounted. A second mount is a duplicate-system bug.
   StrictMode's mount→unmount→mount dev cycle keeps the count at 1. */
let genesisInterfaceMountCount = 0;

export default function GenesisInterface() {
  const {
    state,
    universe,
    engineRuntime,
    openPanel,
    expand,
    setSelfExploration,
    setActiveScene,
  } = useGenesis();
  const voice = useVoice();

  useEffect(() => {
    genesisInterfaceMountCount += 1;
    if (genesisInterfaceMountCount > 1) {
      console.warn(
        `[GenesisInterface] DUPLICATE INTERFACE: ${genesisInterfaceMountCount} canonical chat interfaces mounted — this is a duplicate-system bug.`,
      );
    }
    return () => {
      genesisInterfaceMountCount -= 1;
    };
  }, []);

  /* Scene awareness — the interface is mounted ABOVE the scene router, so
     it knows which visual workspace is currently underneath and keeps the
     canonical chat/dock/modules in every scene while hiding v1-only
     ambient chrome (bottom nav, lifecycle badge, ambient visual layer)
     when a cinematic scene (Gen V2 / System) owns the viewport. */
  const sceneIsV2 = state.activeScene === "genesisv2";

  // Sync UI state to cognition — panel changes are visible to the cognitive loop
  const openModuleIds = Object.entries(state.modules)
    .filter(([, m]) => m.presentation !== "closed")
    .map(([id]) => id);

  useEffect(() => {
    UIStateStore.getInstance().update({
      activeTab: state.activePanel !== "none" ? state.activePanel : null,
      openPanels: openModuleIds.length > 0 ? openModuleIds : state.activePanel !== "none" ? [state.activePanel] : [],
      modulePresentations: Object.fromEntries(
        Object.entries(state.modules).map(([id, m]) => [id, m.presentation]),
      ),
      uiControl: state.uiControl,
      isChatOpen: state.activePanel === "chat" || openModuleIds.length > 0,
    });
  }, [state.activePanel, openModuleIds.length, state.modules, state.uiControl]);

  /* -------------------------------------------------------------
   * World Registry — auto-register all known panels as exploration
   * destinations so LÉLU can discover them without hardcoding.
   * ------------------------------------------------------------- */
  useEffect(() => {
    const world = WorldRegistry.getInstance();
    const panels: Array<{ key: string; label: string; kind: DestinationKind; scale: "short" | "medium" | "long" }> = [
      { key: "panel-chat", label: "Chat", kind: "panel", scale: "short" },
      { key: "cosmos-earth", label: "Earth", kind: "cosmos", scale: "long" },
      { key: "cosmos-mars", label: "Mars", kind: "cosmos", scale: "long" },
      { key: "cosmos-jupiter", label: "Jupiter", kind: "cosmos", scale: "long" },
      { key: "cosmos-orion", label: "Orion", kind: "cosmos", scale: "long" },
      { key: "cosmos-andromeda", label: "Andromeda", kind: "cosmos", scale: "long" },
      { key: "cosmos-neptune", label: "Neptune", kind: "cosmos", scale: "long" },
      { key: "cosmos-saturn", label: "Saturn", kind: "cosmos", scale: "long" },
      { key: "panel-memory", label: "Memory", kind: "panel", scale: "short" },
      { key: "panel-reasoning", label: "Reasoning", kind: "panel", scale: "medium" },
      { key: "panel-agents", label: "Agents", kind: "panel", scale: "medium" },
      { key: "panel-cognition", label: "Cognition", kind: "panel", scale: "medium" },
      { key: "panel-engineering", label: "Engineering", kind: "panel", scale: "medium" },
      { key: "panel-diagnostics", label: "Diagnostics", kind: "panel", scale: "short" },
      { key: "panel-executive", label: "Executive", kind: "panel", scale: "medium" },
      { key: "panel-projects", label: "Projects", kind: "panel", scale: "short" },
      { key: "panel-cosmos", label: "Cosmos", kind: "panel", scale: "long" },
      { key: "panel-visualstudio", label: "Genesis Studios", kind: "panel", scale: "medium" },
      { key: "panel-earth", label: "Earth Core", kind: "panel", scale: "medium" },
      // Sketch/Render/Avatar are capabilities inside Genesis Studios —
      // still registered so LÉLU can visit them, no longer top-level.
      { key: "panel-sketch", label: "Sketch", kind: "panel", scale: "medium" },
      { key: "panel-render", label: "Render", kind: "panel", scale: "medium" },
      { key: "panel-avatar", label: "Avatar", kind: "panel", scale: "short" },
      { key: "panel-providers", label: "API Status", kind: "panel", scale: "short" },
      { key: "panel-video", label: "Video", kind: "panel", scale: "medium" },
      { key: "panel-evolution", label: "Evolution", kind: "panel", scale: "medium" },
      { key: "panel-self-evolution", label: "Self Evolution", kind: "panel", scale: "medium" },
      { key: "panel-knowledge", label: "Knowledge", kind: "panel", scale: "medium" },
      { key: "panel-genesisv2", label: "Genesis v2", kind: "panel", scale: "medium" },
      { key: "workspace-core", label: "Genesis Core", kind: "workspace", scale: "short" },
      { key: "workspace-research", label: "Research Lab", kind: "workspace", scale: "medium" },
      { key: "workspace-creation", label: "Creation Studio", kind: "workspace", scale: "medium" },
      // Gen v2 and System UI as exploration-worthy environments
      { key: "environment-genv2", label: "Genesis v2 Lab", kind: "environment", scale: "long" },
      { key: "environment-system", label: "System UI", kind: "environment", scale: "long" },
      { key: "cosmos-core", label: "Core", kind: "cosmos", scale: "short" },
      { key: "cosmos-venus", label: "Venus", kind: "cosmos", scale: "long" },
      { key: "cosmos-mercury", label: "Mercury", kind: "cosmos", scale: "long" },
      { key: "cosmos-pluto", label: "Pluto", kind: "cosmos", scale: "long" },
    ];

    for (const p of panels) {
      world.register({ key: p.key, label: p.label, kind: p.kind, scale: p.scale, weight: 0.6 + Math.random() * 0.4 });
    }
  }, []);

  /* -------------------------------------------------------------
   * Autonomous Presence Engine — LÉLU explores without being told.
   * Connects to the existing Genesis context actions so she can
   * navigate the cosmos, open panels, and use her UI autonomously.
   * Panel discoveries render as small floating cards, not full-screen.
   * ------------------------------------------------------------- */
  const presenceRef = useRef(GenesisPresenceEngine.getInstance());

  const handleDiscover = useCallback(
    (panelId: string, label: string, icon: string, reasoning: string) => {
      // Register as cosmos entity — NO pop-up cards
      const cosmosRegistry = CosmosEntityRegistry.getInstance();
      cosmosRegistry.register("search", panelId, `${label}: ${reasoning}`, icon);
      // Also register the source panel so LELU can visit it
      cosmosRegistry.register("panel", `discover-${panelId}`, label, icon);
      // Notify Sentinel of autonomous discovery
      Sentinel.getInstance().info(
        "system_event",
        `Autonomous discovery: ${label} — ${reasoning}`,
        "GenesisInterface",
      );
    },
    [],
  );

  useEffect(() => {
    const presence = presenceRef.current;
    const sentinel = Sentinel.getInstance();
    const cosmosRegistry = CosmosEntityRegistry.getInstance();
    const caps = CapabilityManifest.getInstance();

    // Report runtime start to Sentinel
    sentinel.info("runtime_start", "LELU runtime initialized", "GenesisInterface");
    caps.updateStatus("ai-chat", "available");

    presence.connect({
      openPanel: (panel) => {
        if (state.activePanel !== panel) {
          openPanel(panel as GenesisPanel);
        }
        // Register as cosmos entity so LELU can visit it
        cosmosRegistry.register("panel", panel, panel, "◈");
        sentinel.info("tab_opened", `Panel opened: ${panel}`, "GenesisInterface", { panel });
      },
      selectDestination: (_dest) => {
        ExplorationController.getInstance().setMode("EXPLORATION");
        cosmosRegistry.register("search", _dest, _dest, "◎");
      },
      focusWorkspace: (_ws) => {
        cosmosRegistry.register("workspace", _ws, _ws, "◉");
      },
      onDiscover: (panelId, label, icon, reasoning) => {
        handleDiscover(panelId, label, icon, reasoning);
        cosmosRegistry.register("search", panelId, label, icon);
      },
      setMode: (mode: string) => {
        ExplorationController.getInstance().setMode(mode as any);
      },
    });
    presence.start();

    // Clean stale cosmos entities periodically
    const cleanupInterval = setInterval(() => cosmosRegistry.cleanStale(), 300_000);

    return () => {
      presence.stop();
      clearInterval(cleanupInterval);
    };
  }, [openPanel, state.activePanel]);

  // Sync self-exploration toggle to presence engine
  useEffect(() => {
    presenceRef.current.setSelfExploration(state.selfExplorationEnabled);
  }, [state.selfExplorationEnabled]);

  /* Earth Core hold → voice activation. Opens chat and starts listening. */
  function handleCoreHoldVoice() {
    // Ensure chat panel is open
    if (state.activePanel !== "chat") {
      openPanel("chat");
    }
    // Toggle voice engine — same pipeline as chat mic button
    voice.engine.toggle();
  }

  /* The continuous cognitive loop — starts with the primary environment
     and observes/proposes in the background (level 0-1 only, see the
     Cognition workspace for the cycle report). */
  useEffect(() => {
    if (state.minimized) {
      CognitiveLoop.getInstance().stop();
      return;
    }
    CognitiveLoop.getInstance().start();
    return () => {
      CognitiveLoop.getInstance().stop();
      ExplorationController.getInstance().stopAll();
    };
  }, [state.minimized]);

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
      // Cognitive-state-driven visual transitions: when the cognitive loop
      // emits a visual_state_changed event, update the UI state so the
      // visual environment can transform to match the current cognitive phase.
      if (event.type === "visual_state_changed") {
        const uiStore = UIStateStore.getInstance();
        const current = uiStore.get();
        if (current.uiControl === "auto") {
          // In auto mode, cognitive transitions drive the visual state
          uiStore.update({
            activeTab: event.state === "conversation" ? "chat" : event.state,
          });
        }
        return;
      }
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
   * Workspace activity is event-driven. Opening Chat or Avatar must not
   * force the workspace surface open; only real agent/tool activity may
   * reveal it through WorkspaceEngine.autoShow().
   */
  function handleDockSelect(panel: GenesisPanel) {
    if (panel === "visual") {
      // Leaving the Gen V2 workspace returns to the Genesis environment
      // first — chat and open modules stay mounted (scene change is
      // presentation only); the System scene is then toggled on top of it.
      if (state.activeScene === "genesisv2") {
        setActiveScene("genesis");
      }
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
      data-workspace="genesis-unified"
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        /* The unified interface paints ABOVE whatever scene the router
           mounted below it. Scene separation is pure mounting — no
           z-index; isolation keeps the chrome's internal z-indexes
           inside this layer. */
        isolation: "isolate",
      }}
    >
      {/*
       * THE ONE GENESIS ENVIRONMENT — the canonical LÉLU surface. Mounted
       * above the workspace router, so this exact component (and its chat,
       * dock, side panel and module host) is the SAME interface inside
       * Genesis v1, LÉLU System, Gen V2, Earth Core and Cosmos.
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
            onCoreHoldVoice={handleCoreHoldVoice}
            selfExplorationEnabled={state.selfExplorationEnabled}
            onToggleSelfExploration={() => setSelfExploration(!state.selfExplorationEnabled)}
          />

          {/* Live tool activity is rendered by GenesisChat's execution
              timeline. There is no second workspace/activity surface. */}

          {/* The ambient visual layer behind the primary environment — fed
              by the same real agent events through VisualBridge. */}
          {sceneIsV2 || systemEnvironmentActive ? null : <VisualInterface />}

          {/* Top chrome: expand chip (when minimized) + command palette +
              fullscreen. The palette and fullscreen stay usable in both
              states. */}
          <div
            style={{
              position: "absolute",
              top: 16,
              left: 16,
              /* In Gen V2 the scene rail sits on the right — keep the
                 palette/fullscreen controls clear of it. */
              right: sceneIsV2 ? 96 : 16,
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

            {/* The System environment owns its top navigation bar, so the
                global top-right controls stay in the v1/v2 scenes only. */}
            {systemEnvironmentActive ? null : (
              <div style={{ pointerEvents: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                {state.minimized ? null : <GenesisMinimizeButton />}
                <GenesisCommandPalette />
                <GenesisFullscreenButton />
              </div>
            )}
          </div>
        </div>

      {/* Multi-Chat tab bar — visible while the dialogue surface is open so
          the user can switch between isolated conversations without losing
          state. It floats above the dialogue overlay (higher z-index). */}
      {state.minimized ? null : state.activePanel === "chat" ? <MultiChatTabs /> : null}

      {/* Explorer cards — autonomous LÉLU discoveries as small floating cards */}


      {/* Chat is the PERSISTENT core of the unified UI: it stays mounted
          and interactive while any environment module is open, so the main
          UI never disappears when LÉLU is working. It unmounts only when
          the whole interface is minimized or explicitly exited. Wrapped in
          an error boundary so a failed message render never takes down the
          app. */}
      {state.minimized ? null : state.activePanel === "chat" || openModuleIds.length > 0 ? (
        <GenesisErrorBoundary>
          <GenesisChat />
        </GenesisErrorBoundary>
      ) : null}

      {/* Unified module host — inline / expanded / minimized windows for
          the SAME module instances (one runtime each). Mounted in every
          scene so tools remain part of the canonical chat surface. */}
      <GenesisModuleHost renderers={MODULE_RENDERERS} />

      {/* Full-page / special surfaces keep their dedicated mounts. */}
      {state.activePanel === "self-evolution" ? (
        <GenesisSelfEvolutionPanel />
      ) : null}

      {state.activePanel === "cosmos" ? (
        <GenesisCosmosPanel onClose={handleExitChat} />
      ) : null}
    </div>
  );
}
