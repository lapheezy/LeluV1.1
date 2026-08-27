/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS SCENE — UNIFIED RUNTIME + WORKSPACE ROUTER
 *
 * ONE LÉLU runtime, many visual presentations:
 *
 *   GenesisCore            → the single cognition/memory/chat state
 *   GenesisInterface       → the ONE canonical chat + dock + module
 *                            surface, mounted ABOVE the scene switch
 *   GenesisWorkspaceRouter → swaps the visual scene underneath it:
 *       GENESIS v1   → the cosmic Genesis world (3D canvas + HUDs)
 *       LÉLU SYSTEM  → the internal living-system visualization
 *       GENESIS v2   → the Core Transformation Lab scene
 *
 * The interface is NOT a child of any scene: it stays mounted and
 * interactive while v1 / System / v2 swap below it, so the same chat,
 * the same conversation and the same LÉLU are available in every scene.
 * Scene isolation applies to the *visual workspaces only* — each scene
 * is mounted/unmounted as a whole; the shared interface above them
 * never unmounts.
 * ==========================================================
 */import {
  lazy,
  Suspense,
  Suspense as ReactSuspense,
} from "react";
import { Canvas } from "@react-three/fiber";

import GenesisCore, {
  useGenesis,
} from "./GenesisCore";

import GenesisErrorBoundary
  from "./GenesisErrorBoundary";
import GenesisInterface
  from "./GenesisInterface";

import GenesisController from "./GenesisController";

import GenesisBridge from "./GenesisBridge";
import ProactiveBridge from "./ProactiveBridge";
import VoiceBridge from "./VoiceBridge";

import { useEffect, useState } from "react";
import { useSceneMountLog }
  from "./useSceneMountLog";
import { sampleCosmosAtmosphere } from "./cosmos/CosmosAtmosphere";

import useVisual
  from "../../../core/visual/useVisual";

import WorkspaceBridge
  from "./WorkspaceBridge";

import GenesisSurfaceController
  from "./GenesisSurfaceController";

import VisualBridge
  from "./VisualBridge";

import DeepLinkIntake
  from "./DeepLinkIntake";

import EngineTick
  from "./EngineTick";

import GenesisNotificationCenter
  from "./GenesisNotificationCenter";

import CosmosSkyBackdrop
  from "./CosmosSkyBackdrop";

import { useLeluRuntime }
  from "../../../core/runtime/useLeluRuntime";



/**
 * Heavy workspace scenes are code-split so the initial GEN V1 core
 * (chat + cognition + memory + the v1 canvas) loads without pulling in
 * the entire v2 lab, the living-system environment, or the cosmos map
 * until the user actually switches into them.
 */
const GenesisLab = lazy(() => import("./GenesisLab"));
const LivingSystemUI = lazy(() => import("./LivingSystemUI"));
const CosmosOverview = lazy(() => import("./cosmos/CosmosOverview"));

/** Minimal full-screen fallback shown while a code-split scene loads. */
function SceneLoadingFallback() {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "#020617",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "rgba(148, 163, 184, 0.6)",
        fontFamily: "monospace",
        fontSize: 12,
        letterSpacing: "0.1em",
      }}
    >
      LÉLU · INITIALIZING
    </div>
  );
}


/**
 * PAGE 1 — Gen V1 workspace: the 3D cosmic cosmos is the visual
 * environment. Eagle Eye Earth is available as a module panel that
 * opens on demand via dock, chat commands, or the command palette.
 * It does NOT fill the viewport by default.
 */
/**
 * Compact HUD that shows the current cosmos atmosphere phase so the user
 * can SEE the lifecycle transitions happening in real time.
 */
function CosmosPhaseHUD() {
  const [phase, setPhase] = useState(() => sampleCosmosAtmosphere(0));

  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setPhase(sampleCosmosAtmosphere(performance.now() / 1000));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const phaseLabel = phase.phase
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const phaseColors: Record<string, string> = {
    "deep-black-space": "#4a5568",
    "core-colors": "#38bdf8",
    sunset: "#f97316",
    static: "#cbd5e1",
    storm: "#a855f7",
    hurricane: "#f472b6",
    dissipation: "#64748b",
    rainbow: "#f43f5e",
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 12,
        left: 12,
        zIndex: 50,
        pointerEvents: "none",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontFamily: "monospace",
      }}
    >
      <div
        style={{
          fontSize: 9,
          letterSpacing: "0.15em",
          color: "rgba(148, 163, 184, 0.5)",
          textTransform: "uppercase",
        }}
      >
        Atmosphere
      </div>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: phaseColors[phase.phase] ?? "#e2e8f0",
          textShadow: `0 0 8px ${phaseColors[phase.phase] ?? "#94a3b8"}40`,
          letterSpacing: "0.08em",
        }}
      >
        {phaseLabel}
      </div>
      {/* Progress bar through the current phase */}
      <div
        style={{
          width: 120,
          height: 2,
          background: "rgba(30, 41, 59, 0.8)",
          borderRadius: 1,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${Math.round(phase.progress * 100)}%`,
            height: "100%",
            background: phaseColors[phase.phase] ?? "#94a3b8",
            borderRadius: 1,
            transition: "width 0.1s linear",
          }}
        />
      </div>
      {/* Key atmospheric values */}
      <div
        style={{
          fontSize: 8,
          color: "rgba(100, 116, 139, 0.6)",
          display: "flex",
          gap: 8,
          marginTop: 2,
        }}
      >
        {phase.sunset > 0.05 && (
          <span style={{ color: "#f97316" }}>
            sunset {phase.sunset.toFixed(2)}
          </span>
        )}
        {phase.static > 0.05 && (
          <span style={{ color: "#94a3b8" }}>
            static {phase.static.toFixed(2)}
          </span>
        )}
        {phase.storm > 0.05 && (
          <span style={{ color: "#a855f7" }}>
            storm {phase.storm.toFixed(2)}
          </span>
        )}
        {phase.hurricane > 0.05 && (
          <span style={{ color: "#f472b6" }}>
            hurricane {phase.hurricane.toFixed(2)}
          </span>
        )}
        {phase.rainbow > 0.05 && (
          <span style={{ color: "#f43f5e" }}>
            rainbow {phase.rainbow.toFixed(2)}
          </span>
        )}
        {phase.lightning > 0.05 && (
          <span style={{ color: "#bfdbfe" }}>
            ⚡ {phase.lightning.toFixed(2)}
          </span>
        )}
      </div>
    </div>
  );
}

function GenesisV1Workspace() {
  useSceneMountLog("GenesisV1Workspace");

  return (
    <div
      data-workspace="genesis-v1"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        background: "#020617",
      }}
    >
      {/*
        * AI → GENESIS bridges — the real AIService / proactive / voice
        * event wiring that feeds chat, actions, cognition and voice into
        * the shared Genesis state. Mounted as DOM siblings of the Canvas
        * (NOT inside the R3F scene) so no bridge lifecycle code can ever
        * touch the 3D render loop.
        */}
      <GenesisBridge />
      <ProactiveBridge />
      <VoiceBridge />

      {/*
        * THE PHASE SKY — a plain DOM layer behind the transparent 3D
        * canvas, driven by the SAME sampleCosmosAtmosphere() as the HUD.
        * It guarantees the atmosphere lifecycle (sunset / static / storm /
        * hurricane …) is visibly transitioning even if WebGL fails to
        * paint the shader dome — the 3D scene renders on top of it.
        */}
      <CosmosSkyBackdrop />

      {/* The 3D cosmic core: orb, cosmos, atmosphere, evolution */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
        }}
      >
        <ReactSuspense fallback={null}>
          <Canvas
            camera={{ position: [0, 0, 5], fov: 50 }}
            gl={{ alpha: true, antialias: true }}
            style={{ width: "100%", height: "100%" }}
          >
            <GenesisController />
          </Canvas>
        </ReactSuspense>
      </div>

      {/* Phase indicator so the user can see lifecycle transitions */}
      <CosmosPhaseHUD />
    </div>
  );
}

/**
 * PAGE 3 — Genesis v2, wrapped in its own named scene component so the
 * router boundary is explicit and observable: when the router stops
 * rendering this component, the entire v2 scene (Core, modules, beams,
 * background, animations) unmounts with it. Nothing v2 is mounted
 * anywhere else in the tree.
 */
function GenesisV2Workspace({ onClose }: { onClose: () => void }) {
  // TEMP DEBUG — scene-isolation lifecycle log (see useSceneMountLog).
  useSceneMountLog("GenesisV2Workspace");

  return (
    <Suspense fallback={<SceneLoadingFallback />}>
      <GenesisLab onClose={onClose} />
    </Suspense>
  );
}

/**
 * The exclusive workspace switch. Exactly one complete SCENE exists in
 * the DOM at any moment — the others are unmounted, not hidden — while
 * the unified interface (GenesisInterface) stays mounted above the
 * switch and is shared by every scene:
 *
 *   activeScene === "genesisv2"  → Genesis v2 owns the viewport
 *   VisualEngine.interfaceFocus === "visual" → LÉLU System owns it
 *   otherwise                    → Genesis v1 owns it
 *
 * Stable keys make the exchange explicit: each branch is a distinct
 * mounted scene, and no branch ever renders another scene's content.
 */
function GenesisWorkspaceRouter() {
  const { state, openPanel } = useGenesis();
  const { state: visualState } = useVisual();

  const v2Active = state.activeScene === "genesisv2";
  const systemActive = !v2Active && visualState.interfaceFocus === "visual";

  return (
    <>
      {v2Active ? (
        /* PAGE 3 — Genesis v2 is the complete viewport. Nothing from
           the v1 world is mounted; the shared GenesisCore state below
           stays alive (evolution never pauses). The unified interface
           above the router keeps Chat reachable inside v2. A failing
           scene is contained: it can never take down LÉLU or the
           other scenes. */
        <GenesisErrorBoundary>
          <GenesisV2Workspace key="genesis-v2" onClose={() => openPanel("none")} />
        </GenesisErrorBoundary>
      ) : systemActive ? (
        /* PAGE 2 — the internal living-system environment. */
        <Suspense fallback={<SceneLoadingFallback />}>
          <GenesisErrorBoundary>
            <LivingSystemUI key="lelu-system" />
          </GenesisErrorBoundary>
        </Suspense>
      ) : (
        /* PAGE 1 — the Genesis v1 cosmic world. */
        <GenesisErrorBoundary>
          <GenesisV1Workspace key="genesis-v1" />
        </GenesisErrorBoundary>
      )}

      {/*
        * THE UNIFIED INTERFACE — the one canonical LÉLU surface
        * (dock, chat, side panel, modules, avatar, palette). Mounted
        * ABOVE the scene switch, never inside a scene, so the same
        * chat and the same conversation are available in V1, System,
        * V2, Earth Core and Cosmos. Scene changes are presentation
        * only — LÉLU does not reset.
        */}
      <GenesisErrorBoundary>
        <GenesisInterface />
      </GenesisErrorBoundary>

      {/*
        * App-level services shared by every workspace: real agent-event
        * bridges, deeplink intake. They produce no workspace visuals —
        * the workspace scene above is the only visible layer.
        */}
      <WorkspaceBridge />
      <GenesisSurfaceController />
      <VisualBridge />
      <DeepLinkIntake />

      {/* The ONE simulation heartbeat — runs while ANY workspace owns
          the viewport, so the Core keeps morphing and evolving in
          Genesis v2 (the v1 canvas only renders, it never ticks). */}
      <EngineTick />

      {/*
        * COSMOS UI — floating navigation and overview.
        * These are HTML/CSS layers above the canvas, only visible
        * in the v1 workspace (not v2 or system).
        */}
      {!v2Active && !systemActive && (
        <Suspense fallback={null}>
          <CosmosOverview />
        </Suspense>
      )}

      {/*
        * Notification toasts belong to the v1 world and the LÉLU system.
        * They must never float over the immersive Genesis v2 scene, so
        * while v2 owns the viewport they unmount entirely.
        */}
      {v2Active ? null : (
        <GenesisNotificationCenter />
      )}
    </>
  );
}

/**
 * Boot the LÉLU Runtime once at the scene root. Every subsystem
 * (Orchestrator, TaskEngine, BackgroundEngine, ProactiveEngine,
 * UIOrchestrator, SelfHealing, health monitor) starts here and
 * lives for the lifetime of the scene.
 */
function LeluRuntimeBoot() {
  useLeluRuntime();
  return null;
}

export default function GenesisScene() {
  return (
    <GenesisCore>
      <LeluRuntimeBoot />
      <GenesisWorkspaceRouter />
    </GenesisCore>
  );
}
