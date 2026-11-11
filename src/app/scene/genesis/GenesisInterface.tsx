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

import { lazy, useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceRoot } from "./useWorkspace";
import { conversationIdOf, useGenesis, type GenesisPanel } from "./GenesisCore";
import GenesisModuleHost, { type ModuleRenderers } from "./GenesisModuleHost";
import InterfaceRuntime from "./interface/InterfaceRuntime";
import InterfaceConsentBar from "./interface/InterfaceConsentBar";
import InterfaceLayoutPreview from "./interface/InterfaceLayoutPreview";
import UIStateStore from "../../../core/cognition/UIStateStore";
import UIActionBus from "../../../core/cognition/UIActionBus";
import { MODULE_CATALOG } from "./GenesisDock";
import GenesisErrorBoundary from "./GenesisErrorBoundary";
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisCreationStudio = lazy(() => import("./studio/GenesisCreationStudio"));
import StudioArtifactWindow from "./studio/StudioArtifactWindow";
import { artifactIdOf, artifactWindowId } from "./studio/useStudio";
import StudioStore from "../../../core/studio/StudioStore";
import { STUDIO_OPEN_EVENT } from "../../../core/studio/StudioTools";
import AtelierWindow from "./atelier/AtelierWindow";
import AtelierStore from "../../../core/atelier/AtelierStore";
import { ATELIER_OPEN_EVENT } from "../../../core/atelier/AtelierTools";

const ATELIER_WINDOW_PREFIX = "atelier:";
import GenesisCommandPalette from "./GenesisCommandPalette";
import { genesisTheme } from "./GenesisTheme";
import GenesisChat from "./GenesisChat";
import ChatErrorBoundary from "./chat/ChatErrorBoundary";
import { useSurface } from "./surface/useSurface";
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisReasoningPanel = lazy(() => import("./GenesisReasoningPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisDiagnosticsPanel = lazy(() => import("./GenesisDiagnosticsPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisExecutivePanel = lazy(() => import("./GenesisExecutivePanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisMemoryPanel = lazy(() => import("./GenesisMemoryPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisDevicePanel = lazy(() => import("./GenesisDevicePanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisKnowledgePanel = lazy(() => import("./GenesisKnowledgePanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisHistoryPanel = lazy(() => import("./GenesisHistoryPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisLogsPanel = lazy(() => import("./GenesisLogsPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisBrowserPanel = lazy(() => import("./GenesisBrowserPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisAgentsPanel = lazy(() => import("./GenesisAgentsPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisSketchPanel = lazy(() => import("./GenesisSketchPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisRenderPanel = lazy(() => import("./GenesisRenderPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisVideoPanel = lazy(() => import("./GenesisVideoPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisAvatarPanel = lazy(() => import("./GenesisAvatarPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisProjectsPanel = lazy(() => import("./GenesisProjectsPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisSettingsPanel = lazy(() => import("./GenesisSettingsPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisCognitionPanel = lazy(() => import("./GenesisCognitionPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisCognitiveTracePanel = lazy(() => import("./GenesisCognitiveTracePanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisEngineeringPanel = lazy(() => import("./GenesisEngineeringPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisSelfDevPanel = lazy(() => import("./GenesisSelfDevPanel"));
import GenesisSelfEvolutionPanel from "./GenesisSelfEvolutionPanel";
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisNotificationsPanel = lazy(() => import("./GenesisNotificationsPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisVisualStudio = lazy(() => import("./GenesisVisualStudio"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisEarthCore = lazy(() => import("./GenesisEarthCore"));
import GenesisCosmosPanel from "./GenesisCosmosPanel";
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisIdentityPanel = lazy(() => import("./GenesisIdentityPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const EngineeringStudioPanel = lazy(() => import("./integration/EngineeringStudioPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const VoiceStudioPanel = lazy(() => import("./integration/VoiceStudioPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const InfrastructureMonitorPanel = lazy(() => import("./integration/InfrastructureMonitorPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const SecurityCenterPanel = lazy(() => import("./integration/SecurityCenterPanel"));
// Code-split: this panel's chunk loads the first time it is opened.
const GenesisEngineeringCommandPanel = lazy(() => import("./GenesisEngineeringCommandPanel"));

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
  "cognitive-trace": ({ onClose }) => <GenesisCognitiveTracePanel onClose={onClose} />,
  engineering: ({ onClose }) => <GenesisEngineeringPanel onClose={onClose} />,
  evolution: ({ onClose }) => <GenesisSelfDevPanel onClose={onClose} />,
  notifications: ({ onClose }) => <GenesisNotificationsPanel onClose={onClose} />,
  briefings: ({ onClose }) => <GenesisBriefingsPanel onClose={onClose} />,
  visualstudio: ({ onClose }) => <GenesisVisualStudio onClose={onClose} />,
  // Earth Core is the canonical Eagle Eye Earth visual state. It remains
  // one module instance, but is rendered inline with chat rather than as a
  // separate navigation destination.
  earth: ({ onClose }) => <GenesisEarthCore onClose={onClose} />,
  identity: ({ onClose }) => <GenesisIdentityPanel onClose={onClose} />,
  creation: ({ onClose }) => <GenesisCreationStudio onClose={onClose} />,
  // Operational studios — live server data, one capability gate.
  "eng-studio": ({ onClose }) => <EngineeringStudioPanel onClose={onClose} />,
  "voice-studio": ({ onClose }) => <VoiceStudioPanel onClose={onClose} />,
  "infra-monitor": ({ onClose }) => <InfrastructureMonitorPanel onClose={onClose} />,
  "security-center": ({ onClose }) => <SecurityCenterPanel onClose={onClose} />,
  command: ({ onClose }) => <GenesisEngineeringCommandPanel onClose={onClose} />,
};

/** Every module that can be a window — what LÉLU's interface tools can see and arrange. */
const MODULE_WINDOW_IDS = Object.keys(MODULE_RENDERERS);
const moduleLabel = (id: string) => MODULE_CATALOG.find((m) => m.id === id)?.label ?? id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
import CognitiveLoop from "../../../core/cognition/CognitiveLoop";
import AvatarPresenceBridge from "../../../core/avatar/AvatarPresenceBridge";
import VisualInterface from "./VisualInterface";
import useVisual from "../../../core/visual/useVisual";
import VisualEngine from "../../../core/visual/VisualEngine";
import CosmosHome from "./home/CosmosHome";
import SpatialNav, { type HomeSheet } from "./home/SpatialNav";
import ChatUniverse from "./chat/universe/ChatUniverse";
import { useUniverseOpen } from "./chat/universe/universeOpen";
import SpatialRevealBridge from "./spatial/SpatialRevealBridge";
import UniverseChatWindow from "./chat/universe/UniverseChatWindow";
import { useHomeStore } from "./home/useHomeLive";
import AgentEventBus from "../../../core/agent/AgentEvents";
import ExplorationController from "./ExplorationController";
import { useVoice } from "../../../core/voice/useVoice";
import GenesisPresenceEngine from "./GenesisPresenceEngine";
import WorldRegistry, { type DestinationKind } from "./WorldRegistry";
import CosmosEntityRegistry from "../../../core/cosmos/CosmosEntityRegistry";
import Sentinel from "../../../core/sentinel/Sentinel";
import CapabilityManifest from "../../../core/capabilities/CapabilityManifest";
import LeluSignInGate from "./LeluSignInGate";
const GenesisBriefingsPanel = lazy(() => import("./GenesisBriefingsPanel"));

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
  const attachWorkspaceRoot = useWorkspaceRoot();
  const {
    state,
    universe,
    engineRuntime,
    openPanel,
    openModule,
    minimizeModule,
    closeModule,
    expand,
    setSelfExploration,
    setModulePresentation,
    raiseModule,
    applyModuleLayout,
  } = useGenesis();
  const voice = useVoice();
  const surface = useSurface();

  /* Creation Studio: LÉLU's studio.* tools and the chat cards ask for
     artifacts to be shown; each is its own `artifact:<id>` window in the
     one window host. Two or more are placed side by side across the
     screen (a phone shows one window at a time anyway). */
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ ids?: string[]; layout?: string }>).detail;
      const ids = (detail?.ids ?? []).filter((id) => StudioStore.getInstance().get(id));
      if (ids.length === 0) return;
      const windows = ids.map(artifactWindowId);
      for (const id of windows) {
        openModule(id);
        setModulePresentation(id, "inline");
      }
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (windows.length === 1 && width > 900) {
        // One document: big enough to read, beside the side rail.
        const w = Math.min(1000, width - (width > 1200 ? 300 : 48));
        applyModuleLayout({ [windows[0]]: { presentation: "inline", position: { x: width > 1200 ? 270 : 24, y: 64 }, size: { width: w, height: Math.min(height - 110, 860) } } });
      } else if (windows.length > 1 && detail?.layout === "side-by-side" && width > 900) {
        const gap = 16;
        const left = width > 1200 ? 260 : 24;
        const usable = width - left - gap * (windows.length + 1);
        const w = Math.max(360, Math.floor(usable / windows.length));
        const h = Math.max(420, Math.min(height - 140, 900));
        applyModuleLayout(Object.fromEntries(windows.map((id, i) => [id, { presentation: "inline" as const, position: { x: left + gap + i * (w + gap), y: 72 }, size: { width: w, height: h } }])));
      }
      raiseModule(windows[windows.length - 1]);
    };
    // An Atelier project is one window; LÉLU opening it again raises it.
    const onAtelier = (event: Event) => {
      const projectId = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!projectId || !AtelierStore.getInstance().get(projectId)) return;
      const id = `${ATELIER_WINDOW_PREFIX}${projectId}`;
      openModule(id);
      setModulePresentation(id, "inline");
      if (window.innerWidth > 900) applyModuleLayout({ [id]: { presentation: "inline", position: { x: window.innerWidth > 1200 ? 280 : 24, y: 64 }, size: { width: Math.min(1100, window.innerWidth - 320), height: Math.min(window.innerHeight - 110, 920) } } });
      raiseModule(id);
    };
    window.addEventListener(STUDIO_OPEN_EVENT, onOpen);
    window.addEventListener(ATELIER_OPEN_EVENT, onAtelier);
    return () => {
      window.removeEventListener(STUDIO_OPEN_EVENT, onOpen);
      window.removeEventListener(ATELIER_OPEN_EVENT, onAtelier);
    };
  }, [openModule, setModulePresentation, raiseModule, applyModuleLayout]);

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

  // Sync UI state to cognition — panel changes are visible to the cognitive loop.
  // Chat windows are module windows too, but they are not an APPLICATION
  // panel: counting them here would make the single-chat surface think a
  // panel opened (and cover the window that just opened).
  const openModuleIds = Object.entries(state.modules)
    .filter(([id, m]) => m.presentation !== "closed" && conversationIdOf(id) === null)
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
   * UI Action Bus — the one canonical mounted interface registers its
   * REAL action functions here (the same openPanel/openModule/etc. a
   * user's click calls). This is what lets cognition (EngineeringResolver
   * today) actually move the UI instead of only reading it. Kept behind
   * a ref to the latest state/handlers so the registration itself never
   * needs to re-run on every panel change.
   * ------------------------------------------------------------- */
  const activePanelRef = useRef(state.activePanel);
  activePanelRef.current = state.activePanel;
  useEffect(() => {
    // The real, currently-rendered panel set — module-hosted panels plus
    // the special-cased full-page surfaces below (chat/self-evolution/
    // cosmos aren't in MODULE_RENDERERS but do have a real mount). This
    // is intentionally NOT the full GenesisPanel type union — "providers"
    // and "workspaces" are type values with no renderer at all, so they
    // correctly stay unsupported rather than silently accepted.
    const supportedPanels = [...Object.keys(MODULE_RENDERERS), "chat", "self-evolution", "cosmos", "none"];
    const unregister = UIActionBus.getInstance().registerHandlers({
      supportedPanels,
      openPanel: (panel) => openPanel(panel as GenesisPanel),
      openModule: (id) => openModule(id),
      minimizeModule: (id) => minimizeModule(id),
      closeModule: (id) => closeModule(id),
      getActivePanel: () => activePanelRef.current,
    });
    return unregister;
    // Registered once per mount — handlers close over stable useGenesis
    // callbacks, and activePanelRef always reads the live value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Runtime-start reporting belongs in its own once-per-mount effect —
  // it was previously inside the presence-reconnection effect below,
  // which legitimately re-runs whenever state.activePanel changes (its
  // closures need the fresh value). That meant every panel navigation
  // re-logged "LELU runtime initialized" to Sentinel and re-ran
  // caps.updateStatus, several times within the first second of a real
  // load (found via a live Playwright audit: 3 near-simultaneous
  // "runtime_start" events on one page load). Harmless in isolation,
  // but misleading telemetry that made a normal startup look like
  // repeated re-initialization — exactly the kind of noise that makes
  // a real instability harder to distinguish from a false alarm.
  useEffect(() => {
    Sentinel.getInstance().info("runtime_start", "LELU runtime initialized", "GenesisInterface");
    CapabilityManifest.getInstance().updateStatus("ai-chat", "available");
  }, []);

  useEffect(() => {
    const presence = presenceRef.current;
    const sentinel = Sentinel.getInstance();
    const cosmosRegistry = CosmosEntityRegistry.getInstance();

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
  }, [openPanel, state.activePanel, handleDiscover]);

  /**
   * The LIFECYCLES the effect above used to own, now started once.
   *
   * That effect re-runs on every render, not only on panel changes:
   * `openPanel` comes from the Genesis context, whose memo depends on
   * `state`, so its identity changes whenever any state does — which
   * during a streamed reply is several times a second. Everything
   * lifecycle-shaped in it was therefore being torn down and rebuilt at
   * render rate. Measured in a real browser turn: 12 stop/start pairs,
   * each persisting the whole avatar profile, 170 KB of writes for one
   * message.
   *
   * It also starved the presence engine. start() arms a 2800 ms
   * interval AND ticks immediately; restarting it per render meant the
   * interval never got to fire and every render drove an autonomous
   * camera decision instead. Its own `ticksSinceLastAction` counting
   * was measuring renders, not time.
   *
   * Only connect() belongs in the effect above — it is a plain
   * assignment, so refreshing the closures per render is free and keeps
   * them reading current state. Starting things does not belong there,
   * for the same reason the runtime_start effect above was split out.
   */
  useEffect(() => {
    const presence = presenceRef.current;
    const cosmosRegistry = CosmosEntityRegistry.getInstance();

    presence.start();

    // The avatar follows LIVE cognition from here on: the bridge
    // subscribes to the thinking/speaking/listening signals AIService
    // already emits during a real turn. Nothing else drives it, so the
    // avatar cannot display a state that did not occur.
    AvatarPresenceBridge.getInstance().start();

    // Clean stale cosmos entities periodically
    const cleanupInterval = setInterval(() => cosmosRegistry.cleanStale(), 300_000);

    return () => {
      presence.stop();
      AvatarPresenceBridge.getInstance().stop();
      clearInterval(cleanupInterval);
    };
  }, []);

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

  // THE HOME: the Cosmos workspace (home/CosmosHome) and the one spatial
  // navigation (home/SpatialNav). They replace the side rail and the
  // phone's vertical menu list; every panel is still one tap away in the
  // app library, and ⌘K.
  const homeStore = useHomeStore();
  const [homeSheet, setHomeSheet] = useState<HomeSheet>(null);
  // On a phone, when chat (or a window) owns the screen, Home is not rendered
  // at all — it is not hidden under the conversation.
  const showHome = !state.minimized && state.activePanel === "none" && !sceneIsV2 && !systemEnvironmentActive && !homeStore.immersive && !surface.chatOwnsScreen && !surface.workspaceOwnsScreen;
  const universeOpen = useUniverseOpen();
  const narrowScreen = typeof window !== "undefined" && window.innerWidth <= 720;
  const navHidden =
    state.minimized ||
    surface.chatOwnsScreen ||
    surface.workspaceOwnsScreen ||
    // A conversation is open above the Cosmos (the floating Universe mode),
    // which is nearly the whole screen on a phone: the rail sat ACROSS the
    // composer and the send button. On a narrow screen it steps aside and
    // comes back the moment the conversation closes. Desktop keeps it —
    // there the windows float clear of it.
    (universeOpen && narrowScreen) ||
    // On a phone an application window is the screen. The bottom nav was
    // painting over its last controls and composer; the window's own close
    // and the ⌘K palette remain the way out.
    (state.activePanel !== "none" && typeof window !== "undefined" && window.innerWidth < 720);

  /*
   * Workspace activity is event-driven. Opening Chat or Avatar must not
   * force the workspace surface open; only real agent/tool activity may
   * reveal it through WorkspaceEngine.autoShow().
   */
  /*
   * CHAT WINDOWS — the Universe's open chats are module windows rendered by
   * the ONE host (GenesisModuleHost). Their ids are per conversation, so
   * they are resolved here rather than in the static renderer map; the
   * window itself is GenesisWindowFrame's body, so there is no second
   * window system and no second title bar.
   */
  const resolveModule = useCallback(
    (id: string) => {
      const artifactId = artifactIdOf(id);
      if (artifactId) {
        return ({ onClose }: { onClose: () => void }) => <StudioArtifactWindow artifactId={artifactId} onClose={onClose} />;
      }
      if (id.startsWith(ATELIER_WINDOW_PREFIX)) {
        const projectId = id.slice(ATELIER_WINDOW_PREFIX.length);
        return ({ onClose }: { onClose: () => void }) => <AtelierWindow projectId={projectId} onClose={onClose} />;
      }
      const conversationId = conversationIdOf(id);
      if (!conversationId) return undefined;
      return ({ onClose }: { onClose: () => void }) => (
        <UniverseChatWindow conversationId={conversationId} onClose={onClose} />
      );
    },
    [],
  );
  const labelForModule = useCallback(
    (id: string) => {
      const artifactId = artifactIdOf(id);
      if (artifactId) return StudioStore.getInstance().get(artifactId)?.title ?? "Artifact";
      if (id.startsWith(ATELIER_WINDOW_PREFIX)) return AtelierStore.getInstance().get(id.slice(ATELIER_WINDOW_PREFIX.length))?.title ?? "Atelier";
      const conversationId = conversationIdOf(id);
      if (!conversationId) return undefined;
      return state.conversations.find((c) => c.id === conversationId)?.title ?? "Chat";
    },
    [state.conversations],
  );

  return (
    <div
      data-workspace="genesis-unified"
      // The measurement root. Every panel, the dock, the composer and the
      // notification layer size themselves from THIS element rather than
      // from window.innerWidth, so the interface fits the space it is
      // actually given — inside the Freebuff workspace that is smaller
      // than the window, which is why panels were being clipped.
      ref={attachWorkspaceRoot}
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
      {/* Asked once, BEFORE the conversation starts — not inside the chat
          branch, which only renders after the user has already opened chat.
          Renders nothing when already signed in or already answered. */}
      <LeluSignInGate />

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
          {showHome ? (
            <CosmosHome
              onOpenLibrary={(group) => setHomeSheet({ kind: "library", group })}
              onOpenWindows={() => setHomeSheet({ kind: "windows" })}
            />
          ) : null}

          {/* Live tool activity is rendered by GenesisChat's execution
              timeline. There is no second workspace/activity surface. */}

          {/* The ambient visual layer behind the primary environment — fed
              by the same real agent events through VisualBridge. */}
          {sceneIsV2 || systemEnvironmentActive || surface.chatOwnsScreen || showHome ? null : <VisualInterface />}

          {/* Top chrome: expand chip (when minimized) + command palette +
              fullscreen. The palette and fullscreen stay usable in both
              states. */}
          {surface.chatOwnsScreen || showHome ? null : (
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
              // marginLeft:auto keeps these at the top RIGHT. As the row's only
              // child (when not minimized) they otherwise sat top-left, under
              // the desktop dock rail.
              <div style={{ pointerEvents: "auto", display: "flex", gap: 8, alignItems: "center", marginLeft: "auto" }}>
                {state.minimized ? null : <GenesisMinimizeButton />}
                <GenesisCommandPalette />
                <GenesisFullscreenButton />
              </div>
            )}
          </div>
          )}
        </div>

      {/* Multi-Chat tab bar — visible while the dialogue surface is open so
          the user can switch between isolated conversations without losing
          state. It floats above the dialogue overlay (higher z-index). */}
      {/* The old browser-style chat tab strip is gone: the Chat Universe lists and switches chats. */}

      {/* Explorer cards — autonomous LÉLU discoveries as small floating cards */}


      {/* Chat is the PERSISTENT core of the unified UI: it is shown while
          chat or any environment module is open, so the main UI never
          disappears when LÉLU is working. Closing it (going Home) HIDES it
          rather than unmounting it: a reply still streaming belongs to the
          mounted chat that sent it, and unmounting mid-turn left the
          reopened chat with no Stop control, no streamed text and a turn
          queue that no longer knew the turn was running. It unmounts only
          when the whole interface is minimized. Its own boundary logs a
          render error and offers to reopen the conversation. */}
      {state.minimized ? null : (
        <ChatErrorBoundary onLeave={handleExitChat}>
          {/* Send engine only — draws nothing. The Chat Universe is the chat. */}
          <GenesisChat hidden />
        </ChatErrorBoundary>
      )}

      <ChatUniverse />
      {/* A chat-created object is revealed in the live Genesis world: closing
          chat lands on the world framed on it instead of the home dashboard. */}
      <SpatialRevealBridge />
      
      {/* Unmounted (not hidden) while a conversation or window owns the phone screen. */}
      {navHidden && (surface.chatOwnsScreen || surface.workspaceOwnsScreen) ? null : (
        <SpatialNav
          sheet={homeSheet}
          setSheet={setHomeSheet}
          onHoldVoice={handleCoreHoldVoice}
          hidden={navHidden}
          selfExploration={state.selfExplorationEnabled}
          onToggleSelfExploration={() => setSelfExploration(!state.selfExplorationEnabled)}
        />
      )}

      {/* Unified module host — inline / expanded / minimized windows for
          the SAME module instances (one runtime each). Mounted in every
          scene so tools remain part of the canonical chat surface. */}
      <GenesisModuleHost renderers={MODULE_RENDERERS} resolve={resolveModule} labelFor={labelForModule} />

      {/* Interface orchestration: the live bridge LÉLU's interface.* tools
          act through, the consent bar where the user approves or rejects
          her proposals, and the outlines that preview new window layouts. */}
      <InterfaceRuntime windowIds={MODULE_WINDOW_IDS} labelOf={moduleLabel} />
      <InterfaceLayoutPreview />
      <GenesisErrorBoundary>
        <InterfaceConsentBar />
      </GenesisErrorBoundary>

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
