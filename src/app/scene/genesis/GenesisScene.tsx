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
  memo,
  Suspense,
  Suspense as ReactSuspense,
} from "react";
import { Canvas } from "@react-three/fiber";

import GenesisCore, {
  useGenesisState,
} from "./GenesisCore";

import GenesisErrorBoundary
  from "./GenesisErrorBoundary";
import GenesisInterface
  from "./GenesisInterface";

import GenesisController from "./GenesisController";

import GenesisBridge from "./GenesisBridge";
import ProactiveBridge from "./ProactiveBridge";
import VoiceBridge from "./VoiceBridge";
import { useSurface } from "./surface/useSurface";
import CoreHoldGesture from "./CoreHoldGesture";

import { useEffect, useRef, useState } from "react";
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

import LeluCompanion
  from "./avatar/LeluCompanion";

import GenesisNotificationCenter
  from "./GenesisNotificationCenter";

import SpatialExperience
  from "../spatial/SpatialExperience";

import CosmosSkyBackdrop
  from "./CosmosSkyBackdrop";

import { useUniverseOpen }
  from "./chat/universe/universeOpen";

import SceneFrameGovernor, { useSceneFrameloop, type Frameloop }
  from "./SceneFrameGovernor";

import { getSceneRenderBudget }
  from "./SceneRenderBudget";

import AdaptiveQuality
  from "./AdaptiveQuality";

import { DPR_START }
  from "./qualityLimits";

import { useLeluRuntime }
  from "../../../core/runtime/useLeluRuntime";

import { IS_DEV }
  from "../../../core/env/buildEnv";



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
 * Whether this viewport is narrow enough that an open conversation covers
 * the world.
 *
 * It was read as `window.innerWidth` during render, which is only as fresh
 * as the last render of this component — so a phone rotating, or a desktop
 * window narrowed, kept the old answer. This subscribes to the events that
 * actually change it.
 */
function useNarrowScreen(maxWidth = 720): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== "undefined" && window.innerWidth <= maxWidth,
  );
  useEffect(() => {
    const read = () => setNarrow(window.innerWidth <= maxWidth);
    read();
    window.addEventListener("resize", read);
    window.visualViewport?.addEventListener("resize", read);
    return () => {
      window.removeEventListener("resize", read);
      window.visualViewport?.removeEventListener("resize", read);
    };
  }, [maxWidth]);
  return narrow;
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
  const shownRef = useRef(phase);

  useEffect(() => {
    let raf = 0;
    let sampledAt = 0;
    const tick = () => {
      // A text HUD needs a few updates a second, not one per animation
      // frame — and only when what it shows (phase name, whole percent of
      // progress, the two values it prints to 2 places) has changed.
      const now = performance.now();
      if (now - sampledAt < 250) {
        raf = requestAnimationFrame(tick);
        return;
      }
      sampledAt = now;
      const next = sampleCosmosAtmosphere(now / 1000);
      const prev = shownRef.current;
      const same =
        prev.phase === next.phase &&
        Math.round(prev.progress * 100) === Math.round(next.progress * 100) &&
        prev.sunset.toFixed(2) === next.sunset.toFixed(2) &&
        prev.static.toFixed(2) === next.static.toFixed(2);
      if (!same) {
        shownRef.current = next;
        setPhase(next);
      }
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
      className="lelu-phase-hud"
      style={{
        position: "fixed",
        /* Bottom-left (see .lelu-phase-hud): top-left belongs to the dock
           rail and the Genesis chip, which this readout used to cover. */
        zIndex: 2,
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

/**
 * Memoised, like EngineTick, and for the same reason.
 *
 * The router above calls useGenesis(), so it re-renders on every state
 * change — including every streamed token — and rebuilds each child
 * element beneath it. The scene's own consumers read the stable scene
 * context and so are not re-rendered BY context, but they were still
 * being re-rendered by their parent. This takes no props, so once
 * memoised a parent re-render stops here.
 *
 * It is not a correctness guard: everything inside that must follow
 * live state reads it from the scene context's getters or subscribes
 * for itself. Blocking a prop-less re-render therefore removes work,
 * not updates.
 */
const GenesisV1Workspace = memo(function GenesisV1Workspace() {
  useSceneMountLog("GenesisV1Workspace");
  // The budget's own decision, before anything may override it. Kept in its
  // own binding so the <Canvas> prop stays derived from the budget hook
  // (see tests/cosmos-chat-experience.test.tsx) instead of a literal.
  const budgetedFrameloop = useSceneFrameloop();
  /*
   * The Cosmos and her 3D body are two WebGL contexts drawing the same
   * device's worth of frames at once. When a conversation is open over the
   * world on a phone-sized screen, the world is behind an opaque sheet:
   * paying for it is pure loss, and on a software renderer it is what made
   * both of them stutter. The canvas keeps its scene, camera and state and
   * simply stops painting until the conversation closes — the last frame
   * stays behind the sheet, and the Cosmos is redrawn the moment it can be
   * seen again. Desktop is untouched: windows float clear of the world.
   */
  const universeOpen = useUniverseOpen();
  const narrowScreen = useNarrowScreen();
  const worldCovered = universeOpen && narrowScreen;
  /*
   * A SOFTWARE renderer cannot draw this world at any interactive rate.
   *
   * Measured at 384x661 with the world mounted: 0-1 fps, 158 draw calls,
   * 218k triangles — and the whole interface drags behind it, because every
   * repaint waits on a rasteriser with no GPU. The DOM sky in
   * CosmosSkyBackdrop was built for precisely this failure (“No WebGL, no
   * GLSL, no GPU — this layer cannot fail to render”), so on a software
   * renderer the canvas is simply not painted: the atmosphere, the phase
   * HUD, the Core's state and every panel keep working, and the interface
   * runs at the browser's own frame rate instead of the rasteriser's.
   *
   * Detected from the GL driver string, never guessed from the user agent:
   * a machine with a real GPU keeps the world exactly as it is.
   */
  const [softwareGL, setSoftwareGL] = useState(false);
  useEffect(() => {
    try {
      const probe = document.createElement("canvas");
      const gl = (probe.getContext("webgl2") ?? probe.getContext("webgl")) as
        | WebGLRenderingContext
        | null;
      if (!gl) {
        setSoftwareGL(true);
        return;
      }
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : "";
      if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)) {
        setSoftwareGL(true);
      }
      // The probe holds a second context until it is told to let go.
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      setSoftwareGL(true);
    }
  }, []);
  /*
   * A measurement affordance, development only.
   *
   * The software-renderer guard above deliberately refuses to paint the
   * world, which is right for a person on llvmpipe and useless for an
   * instrument: in a container with no GPU every run would measure the
   * guard, not the scene, and would do so identically before and after any
   * fix. `?perf-world` lets the harness drive the real scene path on this
   * machine. It is stripped from production builds (IS_DEV is inlined to
   * false) and cannot be reached by a link.
   */
  /*
   * A covered world goes through the RENDER BUDGET, not through a second
   * opinion on the frameloop.
   *
   * This used to force `frameloop="never"` from this component while every
   * other surface (the phone chat, the Chat Universe) reported through
   * SceneRenderBudget.setOccluded. Two mechanisms deciding the same thing is
   * how a canvas ends up painting under an opaque sheet again the moment one
   * of them is missed. The budget knows about every occluder at once, and
   * the frameloop prop below is now derived from nothing else.
   */
  useEffect(() => {
    const budget = getSceneRenderBudget();
    budget.setOccluded("genesis-world-covered", worldCovered);
    return () => budget.setOccluded("genesis-world-covered", false);
  }, [worldCovered]);

  const perfWorld =
    IS_DEV &&
    typeof window !== "undefined" &&
    window.location.search.includes("perf-world");
  const frameloop: Frameloop = softwareGL && !perfWorld ? "never" : budgetedFrameloop;
  // Adaptive resolution: the ratio starts device-appropriate and follows
  // the MEASURED frame rate (Appearance follows measured fps, never the
  // display), publishing window.__leluRenderStats for the demo harness.
  const [dpr, setDpr] = useState(DPR_START);

  return (
    <div
      data-workspace="genesis-v1"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        background: "#020617",
      }}
    >
      {/*
        * THE PHASE SKY — a plain DOM layer behind the transparent 3D
        * canvas, driven by the SAME sampleCosmosAtmosphere() as the HUD.
        * It guarantees the atmosphere lifecycle (sunset / static / storm /
        * hurricane …) is visibly transitioning even if WebGL fails to
        * paint the shader dome — the 3D scene renders on top of it.
        */}
      <CosmosSkyBackdrop />

      {/* The 3D cosmic core: orb, cosmos, atmosphere, evolution.
          CoreHoldGesture observes pointer events for hold-to-voice;
          it does NOT intercept or prevent R3F / Three.js events. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
        }}
      >
        <CoreHoldGesture>
          <ReactSuspense fallback={null}>
            <Canvas
              camera={{ position: [0, 0, 5], fov: 50 }}
              gl={{ alpha: true, antialias: true }}
              dpr={dpr}
              frameloop={frameloop}
              style={{ width: "100%", height: "100%" }}
            >
              <SceneFrameGovernor />
              <AdaptiveQuality onChange={setDpr} />
              <GenesisController />
            </Canvas>
          </ReactSuspense>
        </CoreHoldGesture>
      </div>

      {/* Phase indicator so the user can see lifecycle transitions */}
      <CosmosPhaseHUD />
    </div>
  );
});

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
  const { state, openPanel } = useGenesisState();
  const { state: visualState } = useVisual();

  const surface = useSurface();

  const v2Active = state.activeScene === "genesisv2";
  const systemActive = !v2Active && visualState.interfaceFocus === "visual";

  return (
    <>
      {/*
        * AI → GENESIS bridges — the real AIService / proactive / voice
        * event wiring that feeds chat, actions, cognition and voice into
        * the shared Genesis state. They lived inside the v1 scene, so
        * in Gen V2 or the System scene no reply was written back, and
        * no scene could be left out while chat owns a phone screen.
        * They belong to the app, not to a scene.
        */}
      <GenesisBridge />
      <ProactiveBridge />
      <VoiceBridge />

      {!surface.cosmosRendered ? (
        /* Chat owns the phone screen: no scene is rendered beneath it —
           not hidden, not behind it. The Core, cognition and the engine
           tick (below) carry on; only the picture of them stops, and it
           comes back when the user goes Home. See surface/Surface. */
        null
      ) : v2Active ? (
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

      {/* LÉLU in companion mode: her figure over every surface, mounted
          once here so moving between surfaces never recreates her. */}
      <LeluCompanion />

      {/* The spatial navigation rail: the Cosmos itself is the way around
          the app — environments are destinations, chat is one of them. */}
      <SpatialExperience />
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
      {surface.cosmosRendered && !v2Active && !systemActive && (
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
