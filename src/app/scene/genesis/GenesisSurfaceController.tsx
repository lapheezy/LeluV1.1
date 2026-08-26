/**
 * ==========================================================
 * LÉLUVERSE
 * SURFACE CONTROLLER — CHAT CONTROLS THE ENVIRONMENT
 *
 * When LÉLU performs a task, the correct visual surface opens
 * automatically — no "go to the Render tab" instructions. The
 * controller subscribes to the SAME real AgentEventBus the
 * resolver chain emits into and maps actual tool execution to
 * the existing surface that shows that work:
 *
 *   creative / 3d render  → Render gallery
 *   avatar                → Avatar panel  (+ camera focus LÉLU)
 *   browser               → Browser
 *   research / news       → Browser (web activity surface)
 *   video                 → Video
 *   engineering / sandbox → Engineering (sandbox)
 *   sketch                → Sketch
 *   memory                → Memory
 *   project               → Projects
 *   cosmos                → Cosmos map
 *
 * While Gen V2 owns the viewport, the same real events drive
 * the v2 camera to the active work area (LÉLU shows you where
 * she is working), and chat commands ("Take me into Gen V2",
 * "focus on LÉLU", "make it fullscreen") are applied through
 * the v2 camera command bridge.
 *
 * User camera control always wins: the rig cancels any
 * autonomous flight the moment the user touches the scene.
 * ==========================================================
 */

import { useEffect, useRef } from "react";
import AgentEventBus, { type AgentEvent } from "../../../core/agent/AgentEvents";
import { useGenesis, type GenesisPanel } from "./GenesisCore";
import VisualEngine from "../../../core/visual/VisualEngine";
import { genesisCameraIntentBus, type GenesisV2CameraCommand, type GenesisV2FocusTarget } from "./GenesisCameraIntent";

/** Map a real agent tool to the existing surface that shows its work. */
function surfaceForEvent(event: AgentEvent): GenesisPanel | null {
  switch (event.type) {
    case "creative_artifact":
      return "render";
    case "tool_selected":
    case "tool_started": {
      switch (event.tool) {
        case "creative": {
          const label = (event.label ?? "").toLowerCase();
          if (label.includes("video")) return "video";
          if (label.includes("sketch") || label.includes("draw") || label.includes("paint")) return "sketch";
          return "render";
        }
        case "avatar":
          return "avatar";
        case "browser":
          return "browser";
        case "research":
          return "browser";
        case "video":
          return "video";
        case "engineering":
        case "sandbox":
          return "engineering";
        case "sketch":
          return "sketch";
        case "memory":
          return "memory";
        case "project":
          return "projects";
        case "cosmos":
          return "cosmos";
        case "earth":
          return "earth";
        default:
          return null;
      }
    }
    case "browser_opened":
    case "browser_navigation":
    case "browser_result":
      return "browser";
    case "tool_result":
      return event.tool === "research" || event.tool === "browser" ? "browser" : null;
    case "spatial_event":
      // Earth Core activity (navigate / layer / track / query) surfaces
      // inside the unified environment — the same event bus chat reads.
      return "earth";
    case "workspace_open":
    case "workspace_focus":
      return "engineering";
    default:
      return null;
  }
}

/** Map a real agent tool to the v2 camera focus (the active work area). */
function focusForEvent(event: AgentEvent): GenesisV2FocusTarget | null {
  if (event.type !== "tool_started" && event.type !== "tool_selected") return null;
  switch (event.tool) {
    case "avatar":
      return "lelu";
    case "creative":
      return "core";
    case "research":
      return "lab";
    case "engineering":
    case "sandbox":
      return "studio";
    case "memory":
      return "vault";
    default:
      return null;
  }
}

export default function GenesisSurfaceController() {
  const {
    state,
    openPanel,
    openModule,
    expandModule,
    minimizeModule,
    closeModule,
    setModulePresentation,
    setModuleStatus,
    setUiControl,
    setActiveScene,
  } = useGenesis();
  const openedRef = useRef<Set<string>>(new Set());
  const queuedCameraRef = useRef<GenesisV2CameraCommand[]>([]);
  const uiControlRef = useRef(state.uiControl);
  uiControlRef.current = state.uiControl;

  const v2Active = state.activeScene === "genesisv2";

  /* ------------------------- v2 camera plumbing ----------------------- */

  function deliverCameraCommand(command: GenesisV2CameraCommand): void {
    if (command.intent === "focus") {
      genesisCameraIntentBus.emit({ type: "focus", target: command.target });
    } else if (command.intent === "fly") {
      genesisCameraIntentBus.emit({ type: "fly", position: command.position, lookAt: command.lookAt });
    } else if (command.intent === "reset") {
      genesisCameraIntentBus.emit({ type: "reset" });
    } else if (command.intent === "fullscreen") {
      genesisCameraIntentBus.emit({ type: "fullscreen" });
    }
  }

  // While v2 is mounted, forward camera commands immediately. When a
  // command arrives before v2 mounts (e.g. "take me into Gen V2 and
  // focus on LÉLU"), queue it and flush once the canvas is live.
  useEffect(() => {
    function onCommand(e: Event) {
      const detail = (e as CustomEvent).detail as GenesisV2CameraCommand;
      if (!detail?.intent) return;
      if (v2Active) {
        deliverCameraCommand(detail);
      } else {
        queuedCameraRef.current.push(detail);
      }
    }
    window.addEventListener("genesis-v2-camera", onCommand);
    return () => window.removeEventListener("genesis-v2-camera", onCommand);
  }, [v2Active]);

  useEffect(() => {
    if (!v2Active) return;
    if (queuedCameraRef.current.length === 0) return;
    const queue = queuedCameraRef.current.splice(0, queuedCameraRef.current.length);
    // The v2 canvas mounts a frame after the workspace switch — deliver
    // after it is live so the flight is seen, not lost.
    const timer = setTimeout(() => {
      for (const command of queue) deliverCameraCommand(command);
    }, 220);
    return () => clearTimeout(timer);
  }, [v2Active]);

  /* ------------------------- chat → surface bridge -------------------- */

  useEffect(() => {
    function onShowSurface(e: Event) {
      const detail = (e as CustomEvent).detail as { panel?: GenesisPanel };
      if (!detail?.panel) return;
      // "Open System UI" from chat/voice — same behavior as the dock's
      // System tab: leave the v2 scene if needed, then toggle the System
      // environment (one runtime, presentation changes only).
      if (detail.panel === "visual") {
        if (state.activeScene === "genesisv2") {
          setActiveScene("genesis");
        }
        const visualEngine = VisualEngine.getInstance();
        visualEngine.setInterfaceFocus(
          visualEngine.getState().interfaceFocus === "visual" ? "genesis" : "visual",
        );
        return;
      }
      openPanel(detail.panel);
    }
    // Explicit scene switch — "show me the solar system" from inside Gen V2
    // returns to the Genesis scene (where the physical cosmos camera lives)
    // without closing the chat or any open modules.
    function onSetScene(e: Event) {
      const detail = (e as CustomEvent).detail as { scene?: "genesis" | "genesisv2" };
      if (detail?.scene !== "genesis" && detail?.scene !== "genesisv2") return;
      // Leaving any non-Genesis scene for Genesis also clears the System
      // environment focus (its scene is driven by interfaceFocus).
      if (detail.scene === "genesis") {
        VisualEngine.getInstance().setInterfaceFocus("genesis");
      }
      setActiveScene(detail.scene);
    }
    // Unified module presentation control — "minimize earth", "detach
    // browser", "restore earth" … from chat/voice (Explicit user or LÉLU
    // commands, so they apply in every uiControl mode).
    function onModulePresentation(e: Event) {
      const detail = (e as CustomEvent).detail as { id?: string; presentation?: string };
      if (!detail?.id || !detail?.presentation) return;
      switch (detail.presentation) {
        case "inline":
          openModule(detail.id);
          break;
        case "expanded":
          expandModule(detail.id);
          break;
        case "minimized":
          minimizeModule(detail.id);
          break;
        case "detached":
          // Legacy commands normalize to the canonical inline window.
          openModule(detail.id);
          break;
        case "closed":
          closeModule(detail.id);
          break;
        default:
          setModulePresentation(detail.id, detail.presentation as never);
      }
    }
    function onUiControl(e: Event) {
      const detail = (e as CustomEvent).detail as { mode?: string };
      if (detail?.mode === "auto" || detail?.mode === "assisted" || detail?.mode === "manual") {
        setUiControl(detail.mode);
      }
    }
    window.addEventListener("genesis-show-surface", onShowSurface);
    window.addEventListener("genesis-module-presentation", onModulePresentation);
    window.addEventListener("genesis-ui-control", onUiControl);
    window.addEventListener("genesis-set-scene", onSetScene);
    return () => {
      window.removeEventListener("genesis-show-surface", onShowSurface);
      window.removeEventListener("genesis-module-presentation", onModulePresentation);
      window.removeEventListener("genesis-ui-control", onUiControl);
      window.removeEventListener("genesis-set-scene", onSetScene);
    };
  }, [openPanel, openModule, expandModule, minimizeModule, closeModule, setModulePresentation, setUiControl, setActiveScene, state.activeScene]);

  /* ----------------------- agent events → surfaces -------------------- */

  useEffect(() => {
    const unsubscribe = AgentEventBus.getInstance().subscribe((event) => {
      // Real research/browser execution is itself an explicit visual
      // consequence of the user's request. Open the existing canonical
      // module even in MANUAL mode; MANUAL only suppresses unrelated
      // autonomous presentation changes.
      const surface = surfaceForEvent(event);
      const isLiveResearchSurface =
        event.type === "browser_opened" ||
        event.type === "browser_navigation" ||
        event.type === "browser_result" ||
        ((event.type === "tool_selected" || event.type === "tool_started" || event.type === "tool_result") &&
          (event.tool === "research" || event.tool === "browser"));
      if (surface && (uiControlRef.current !== "manual" || isLiveResearchSurface)) {
        const key = `${event.taskId}:${surface}`;
        if (!openedRef.current.has(key)) {
          openedRef.current.add(key);
          if (openedRef.current.size > 60) {
            openedRef.current = new Set([...openedRef.current].slice(-40));
          }
          openPanel(surface);
        }
      }

      // Live module status — the authoritative "what is running" state
      // LÉLU's orchestration reads (active while working, complete when
      // a real result lands, failed on errors).
      if (surface) {
        if (event.type === "tool_started" || event.type === "tool_selected" || event.type === "spatial_event" || event.type === "browser_opened" || event.type === "browser_navigation") {
          setModuleStatus(surface, "active");
        } else if (event.type === "tool_result" || event.type === "browser_result") {
          setModuleStatus(surface, "complete");
        } else if (event.type === "tool_failed" || event.type === "task_failed") {
          setModuleStatus(surface, "failed");
        }
      }

      // While Gen V2 owns the viewport, follow the real work with the
      // camera — LÉLU presents the area she is actually using.
      if (v2Active) {
        const focus = focusForEvent(event);
        if (focus) deliverCameraCommand({ intent: "focus", target: focus });
      }
    });
    return unsubscribe;
  }, [openPanel, v2Active, setModuleStatus]);

  return null;
}
