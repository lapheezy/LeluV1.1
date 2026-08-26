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
 */

import {
  lazy,
  Suspense,
} from "react";

import * as THREE from "three";

import {
  Canvas,
} from "@react-three/fiber";

import {
  useContextBridge,
} from "@react-three/drei";


import GenesisController
  from "./GenesisController";

import GenesisCore, {
  GenesisContext,
  useGenesis,
} from "./GenesisCore";

import GenesisErrorBoundary
  from "./GenesisErrorBoundary";

import GenesisInterface
  from "./GenesisInterface";
import LeluV2Presence from "./LeluV2Presence";

/**
 * Where LÉLU stands in the default (V1) environment — beside the
 * living core, within the default camera frustum, facing the user.
 */
const V1_LELU_POS = new THREE.Vector3(1.95, -0.55, 1.15);


import { useSceneMountLog }
  from "./useSceneMountLog";

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

import { useLeluRuntime }
  from "../../../core/runtime/useLeluRuntime";

import { PlanetExplorerHUD }
  from "./render/PlanetExplorer";

import { CosmosScaleHUD }
  from "./CosmosScaleHUD";

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
 * PAGE 1 — the Genesis v1 cosmic world: its own 3D canvas plus the
 * v1 scene HUDs. The unified interface (chat/dock/modules) is NOT
 * mounted here — it lives above the router in GenesisWorkspaceRouter
 * so the same chat is available in every scene. Mounted ONLY while
 * the v1 workspace is the active scene; fully unmounted the moment
 * v2 or the system environment takes over.
 */
function GenesisV1Workspace() {
  // TEMP DEBUG — scene-isolation lifecycle log (see useSceneMountLog).
  useSceneMountLog("GenesisV1Workspace");

  // Consume the provider directly so this component re-renders when the
  // runtime finishes booting. That refreshes the R3F context bridge with the
  // live EngineRuntime instead of leaving the canvas on its initial null value.
  const ContextBridge = useContextBridge(GenesisContext);

  return (
    <div
      data-workspace="genesis-v1"
      style={{ position: "relative", width: "100vw", height: "100vh" }}
    >
      <Canvas
        style={{
          width: "100vw",
          height: "100vh",
          position: "fixed",
          top: 0,
          left: 0,
        }}
        camera={{
          position: [0, 0, 6.8],
          fov: 48,
        }}
        shadows
        gl={{
          antialias: true,
        }}
      >
        <color attach="background" args={["#020617"]} />

        <ambientLight intensity={0.45} />
        <directionalLight position={[4, 6, 4]} intensity={1.5} />
        <pointLight position={[-4, 2, 3]} intensity={1.2} color="#38bdf8" />

        <ContextBridge>
          <GenesisErrorBoundary>
            <GenesisController />
          </GenesisErrorBoundary>
          {/* The ONE live LÉLU presence — the same component the Gen V2
              world mounts, reading the same AvatarStore and reporting
              telemetry to the same Executive Runtime. The default
              environment is her home, not a separate demo. */}
          <LeluV2Presence position={V1_LELU_POS} />
        </ContextBridge>
      </Canvas>

      {/* v1 scene HUDs — the unified interface (chat/dock/modules) is
          mounted above the router in GenesisWorkspaceRouter, so it stays
          alive in every scene. */}
      <PlanetExplorerHUD />
      <CosmosScaleHUD />
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
