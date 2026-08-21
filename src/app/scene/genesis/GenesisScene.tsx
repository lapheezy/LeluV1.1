/**
 * ==========================================================
 * LÉLUVERSE
 * GENESIS SCENE — WORKSPACE ROUTER
 *
 * Three sibling workspaces share ONE GenesisCore state:
 *
 *   GENESIS v1   → the cosmic Genesis world (3D canvas + chrome)
 *   LÉLU SYSTEM  → the internal living-system visualization
 *   GENESIS v2   → the Core Transformation Lab scene
 *
 * The router mounts EXACTLY ONE workspace scene at a time —
 * this is scene isolation, not layering:
 *
 *   V1 ACTIVE → the v1 canvas and v1 chrome exist; V2 does NOT
 *               exist anywhere in the DOM.
 *   V2 ACTIVE → the V2 scene is the complete viewport; the v1
 *               canvas and v1 chrome are unmounted entirely.
 *
 * The shared EngineRuntime (evolution) lives in GenesisCore and
 * keeps running while workspaces swap — only the presentation
 * leaves. App-level services (event bridges, notifications,
 * voice) mount once beside the router; they render no workspace
 * visuals.
 * ==========================================================
 */

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

import GenesisLab
  from "./GenesisLab";

import LivingSystemUI
  from "./LivingSystemUI";

import { useSceneMountLog }
  from "./useSceneMountLog";

import useVisual
  from "../../../core/visual/useVisual";

import WorkspaceBridge
  from "./WorkspaceBridge";

import VisualBridge
  from "./VisualBridge";

import DeepLinkIntake
  from "./DeepLinkIntake";

import EngineTick
  from "./EngineTick";

import GenesisNotificationCenter
  from "./GenesisNotificationCenter";

import VoiceControl
  from "./VoiceControl";

import CosmosCloudNav
  from "./cosmos/CosmosCloudNav";
import CosmosOverview
  from "./cosmos/CosmosOverview";

import { useLeluRuntime }
  from "../../../core/runtime/useLeluRuntime";


/**
 * PAGE 1 — the Genesis v1 cosmic world. Its own 3D canvas and its
 * own interface chrome. Mounted ONLY while the v1 workspace is the
 * active scene; fully unmounted the moment v2 or the system
 * environment takes over.
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
        </ContextBridge>
      </Canvas>

      <GenesisInterface />
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

  return <GenesisLab onClose={onClose} />;
}

/**
 * The exclusive workspace switch. Exactly one complete scene exists in
 * the DOM at any moment — the others are unmounted, not hidden:
 *
 *   activePanel === "genesisv2"        → Genesis v2 owns the viewport
 *   VisualEngine.interfaceFocus === "visual" → LÉLU System owns it
 *   otherwise                          → Genesis v1 owns it
 *
 * Stable keys make the exchange explicit: each branch is a distinct
 * mounted scene, and no branch ever renders another scene's content.
 */
function GenesisWorkspaceRouter() {
  const { state, openPanel } = useGenesis();
  const { state: visualState } = useVisual();

  const v2Active = state.activePanel === "genesisv2";
  const systemActive = !v2Active && visualState.interfaceFocus === "visual";

  return (
    <>
      {v2Active ? (
        /* PAGE 3 — Genesis v2 is the complete viewport. Nothing from
           the v1 world is mounted; the shared GenesisCore state below
           stays alive (evolution never pauses). */
        <GenesisV2Workspace key="genesis-v2" onClose={() => openPanel("none")} />
      ) : systemActive ? (
        /* PAGE 2 — the internal living-system environment. */
        <LivingSystemUI key="lelu-system" />
      ) : (
        /* PAGE 1 — the Genesis v1 cosmic world. */
        <GenesisV1Workspace key="genesis-v1" />
      )}

      {/*
        * App-level services shared by every workspace: real agent-event
        * bridges, deeplink intake. They produce no workspace visuals —
        * the workspace scene above is the only visible layer.
        */}
      <WorkspaceBridge />
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
        <>
          <CosmosCloudNav />
          <CosmosOverview />
        </>
      )}

      {/*
        * The voice mic and notification toasts belong to the v1 world
        * and the LÉLU system — they must NEVER float over the immersive
        * Genesis v2 scene. While v2 owns the viewport they unmount
        * entirely (the voice engine keeps running in the background;
        * only its overlay leaves the screen), so nothing covers v2.
        */}
      {v2Active ? null : (
        <>
          <GenesisNotificationCenter />
          <VoiceControl />
        </>
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
