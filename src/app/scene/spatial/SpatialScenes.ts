/**
 * ==========================================================
 * LÉLUVERSE — SPATIAL SCENE GRAPH
 *
 * The destinations of the spatial experience and the ten
 * cinematic transitions that carry the camera between them.
 *
 * This file is DATA and PURE MATH only: no React, no Three,
 * no DOM. The runtime (SpatialRuntime) owns the state and the
 * GSAP driver; the scene (SpatialPortals / SpatialCameraBridge)
 * only reads what the runtime publishes. One scene graph, one
 * source of truth.
 *
 * Every destination is an environment that already exists in
 * LÉLU (Core, Cosmos, an executive galaxy, a world node, the
 * Browser module, Genesis Studios, Projects, …). `panel` maps a
 * spatial destination onto the canonical GenesisPanel that
 * actually renders it, so travelling in space opens the REAL
 * surface — never a mockup.
 * ==========================================================
 */

import type { GenesisPanel } from "../genesis/GenesisCore";

export type SpatialSceneId =
  | "core"
  | "cosmos"
  | "galaxy"
  | "planet"
  | "portal"
  | "agents"
  | "browser"
  | "studio"
  | "research"
  | "projects"
  | "files"
  | "media"
  | "conversation";

/** What a destination IS, for rendering and routing. */
export type SpatialSceneKind =
  | "core"
  | "cosmos"
  | "galaxy"
  | "planet"
  | "portal"
  | "workspace"
  | "browser"
  | "studio";

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface CameraPose {
  position: Vec3;
  target: Vec3;
  fov: number;
}

/**
 * How the camera travels. Not decoration: each path is a different
 * continuous motion (lateral arc, pull-back, dive, materialisation)
 * rather than a fade between two static screens.
 */
export type CameraPath = "straight" | "arc" | "pullback" | "dive" | "materialize";

export type TransitionKind =
  | "core-awakening"
  | "camera-pullback"
  | "galaxy-approach"
  | "planet-approach"
  | "portal-open"
  | "environment-morph"
  | "workspace-expand"
  | "browser-materialize"
  | "studio-entrance"
  | "return-to-core";

export interface TransitionSpec {
  kind: TransitionKind;
  label: string;
  /** Milliseconds at full speed. */
  durationMs: number;
  path: CameraPath;
  /** GSAP ease name. */
  ease: string;
  /** [from, to] scene lighting level (0 = dark, 1 = fully lit). */
  light: [number, number];
  /** Peak particle burst (0..1). */
  burst: number;
  /** Peak geometry morph (0..1). */
  morph: number;
  /** Whether reversing mid-flight is meaningful. */
  reversible: boolean;
}

/** The ten reusable transitions, exactly, in the brief's order. */
export const TRANSITIONS: Record<TransitionKind, TransitionSpec> = {
  "core-awakening": {
    kind: "core-awakening",
    label: "Core awakening",
    durationMs: 2600,
    path: "dive",
    ease: "power2.out",
    light: [0, 1],
    burst: 0.55,
    morph: 0.35,
    reversible: false,
  },
  "camera-pullback": {
    kind: "camera-pullback",
    label: "Camera pullback into Cosmos",
    durationMs: 2200,
    path: "pullback",
    ease: "power2.inOut",
    light: [1, 0.85],
    burst: 0.35,
    morph: 0.25,
    reversible: true,
  },
  "galaxy-approach": {
    kind: "galaxy-approach",
    label: "Galaxy approach",
    durationMs: 2000,
    path: "arc",
    ease: "power3.inOut",
    light: [0.85, 0.95],
    burst: 0.4,
    morph: 0.3,
    reversible: true,
  },
  "planet-approach": {
    kind: "planet-approach",
    label: "Planet approach",
    durationMs: 1800,
    path: "arc",
    ease: "power2.inOut",
    light: [0.9, 1],
    burst: 0.3,
    morph: 0.2,
    reversible: true,
  },
  "portal-open": {
    kind: "portal-open",
    label: "Portal opening",
    durationMs: 1600,
    path: "dive",
    ease: "power3.in",
    light: [0.8, 0.6],
    burst: 0.9,
    morph: 0.6,
    reversible: true,
  },
  "environment-morph": {
    kind: "environment-morph",
    label: "Environment morphing",
    durationMs: 1900,
    path: "arc",
    ease: "sine.inOut",
    light: [0.9, 0.9],
    burst: 0.5,
    morph: 0.85,
    reversible: true,
  },
  "workspace-expand": {
    kind: "workspace-expand",
    label: "Workspace expansion",
    durationMs: 1500,
    path: "materialize",
    ease: "power2.out",
    light: [0.9, 1],
    burst: 0.25,
    morph: 0.15,
    reversible: true,
  },
  "browser-materialize": {
    kind: "browser-materialize",
    label: "Browser materialisation",
    durationMs: 1400,
    path: "materialize",
    ease: "power2.out",
    light: [0.9, 1],
    burst: 0.35,
    morph: 0.2,
    reversible: true,
  },
  "studio-entrance": {
    kind: "studio-entrance",
    label: "Studio entrance",
    durationMs: 1700,
    path: "dive",
    ease: "power2.inOut",
    light: [1, 0.95],
    burst: 0.45,
    morph: 0.5,
    reversible: true,
  },
  "return-to-core": {
    kind: "return-to-core",
    label: "Return to core",
    durationMs: 2400,
    path: "pullback",
    ease: "power2.inOut",
    light: [0.7, 1],
    burst: 0.3,
    morph: 0.4,
    reversible: true,
  },
};

export interface SpatialDestination {
  id: SpatialSceneId;
  label: string;
  kind: SpatialSceneKind;
  /** Short line for the spatial HUD. */
  hint: string;
  /** The canonical surface this environment opens (real panel, not a mock). */
  panel?: GenesisPanel;
  /** Where its portal/geometry lives in the Genesis world. */
  anchor: Vec3;
  camera: CameraPose;
  accent: string;
  /** Transitions used when entering from the Cosmos / elsewhere. */
  enter: TransitionKind;
  enterFromDeep: TransitionKind;
}

/* The Cosmos entities are drawn 25 units behind the Core
   (see cosmos/CosmosLayer), so world anchors use the same depth. */
const COSMOS_DEPTH = -25;

export const SPATIAL_DESTINATIONS: SpatialDestination[] = [
  {
    id: "core",
    label: "LÉLU",
    kind: "core",
    hint: "Her core — the intelligence you speak with",
    anchor: { x: 0, y: 0, z: 0 },
    camera: { position: { x: 0, y: 0, z: 6.8 }, target: { x: 0, y: 0, z: 0 }, fov: 50 },
    accent: "#67e8f9",
    enter: "return-to-core",
    enterFromDeep: "return-to-core",
  },
  {
    id: "cosmos",
    label: "Cosmos",
    kind: "cosmos",
    hint: "Every galaxy, agent and world in one space",
    anchor: { x: 0, y: 0, z: COSMOS_DEPTH },
    // Far enough out that the whole system is IN frame: measuring the
    // screenshot showed a 44-unit pull-back still sitting inside the
    // planet's disc, so the "Cosmos" view was a planet close-up.
    camera: { position: { x: 0, y: 34, z: 118 }, target: { x: 0, y: 0, z: -26 }, fov: 55 },
    accent: "#7dd3fc",
    enter: "camera-pullback",
    enterFromDeep: "environment-morph",
  },
  {
    id: "galaxy",
    label: "Governor galaxy",
    kind: "galaxy",
    hint: "An executive galaxy and the agents inside it",
    anchor: { x: 0, y: 18, z: COSMOS_DEPTH - 6 },
    camera: { position: { x: 8, y: 24, z: -14 }, target: { x: 0, y: 18, z: COSMOS_DEPTH - 6 }, fov: 52 },
    accent: "#a78bfa",
    enter: "galaxy-approach",
    enterFromDeep: "environment-morph",
  },
  {
    id: "planet",
    label: "Creation world",
    kind: "planet",
    hint: "A world in the system, close enough to land on",
    // The Sun world-node drawn by GenesisWorkspace.
    anchor: { x: -5.8, y: 0.4, z: 1.2 },
    camera: { position: { x: -3.4, y: 1.9, z: 8.4 }, target: { x: -5.8, y: 0.4, z: 1.2 }, fov: 54 },
    accent: "#fbbf24",
    enter: "planet-approach",
    enterFromDeep: "environment-morph",
  },
  {
    id: "portal",
    label: "Dimensional portal",
    kind: "portal",
    hint: "The seam between the Cosmos and the working environments",
    anchor: { x: 0, y: 2.4, z: 6 },
    camera: { position: { x: 0, y: 2.6, z: 15 }, target: { x: 0, y: 2.4, z: 2 }, fov: 60 },
    accent: "#22d3ee",
    enter: "portal-open",
    enterFromDeep: "portal-open",
  },
  {
    id: "agents",
    label: "Agent universes",
    kind: "workspace",
    hint: "Her agents at work, each in its own universe",
    panel: "agents",
    anchor: { x: 12, y: 10, z: COSMOS_DEPTH + 6 },
    camera: { position: { x: 20, y: 15, z: -6 }, target: { x: 12, y: 10, z: COSMOS_DEPTH + 6 }, fov: 55 },
    accent: "#c4b5fd",
    enter: "galaxy-approach",
    enterFromDeep: "environment-morph",
  },
  {
    id: "browser",
    label: "Browser",
    kind: "browser",
    hint: "The live web, read by LÉLU",
    panel: "browser",
    anchor: { x: 6, y: 2.2, z: -6 },
    camera: { position: { x: 6, y: 3, z: 16 }, target: { x: 0, y: 1, z: -4 }, fov: 58 },
    accent: "#38bdf8",
    enter: "browser-materialize",
    enterFromDeep: "browser-materialize",
  },
  {
    id: "studio",
    label: "Genesis Studios",
    kind: "studio",
    hint: "Sketch, render and avatar — the live studio",
    panel: "visualstudio",
    anchor: { x: -7, y: 2.4, z: -5 },
    camera: { position: { x: -7, y: 2.6, z: 15 }, target: { x: 0, y: 0.5, z: -5 }, fov: 56 },
    accent: "#f9a8d4",
    enter: "studio-entrance",
    enterFromDeep: "studio-entrance",
  },
  {
    id: "research",
    label: "Research",
    kind: "workspace",
    hint: "What she is reading and learning right now",
    panel: "browser",
    anchor: { x: 7, y: 1.2, z: -8 },
    camera: { position: { x: 8, y: 1.4, z: 13 }, target: { x: 2, y: 0, z: -8 }, fov: 56 },
    accent: "#34d399",
    enter: "browser-materialize",
    enterFromDeep: "browser-materialize",
  },
  {
    id: "projects",
    label: "Projects",
    kind: "workspace",
    hint: "Live projects and their real previews",
    panel: "projects",
    anchor: { x: -6, y: -1.5, z: -6 },
    camera: { position: { x: -6, y: -1.4, z: 13 }, target: { x: 0, y: -0.5, z: -6 }, fov: 56 },
    accent: "#fbbf24",
    enter: "workspace-expand",
    enterFromDeep: "workspace-expand",
  },
  {
    id: "files",
    label: "Files",
    kind: "workspace",
    hint: "Documents and the knowledge library",
    panel: "knowledge",
    anchor: { x: 5, y: -3, z: -8 },
    camera: { position: { x: 5, y: -3, z: 12 }, target: { x: 0, y: -1, z: -8 }, fov: 56 },
    accent: "#93c5fd",
    enter: "workspace-expand",
    enterFromDeep: "workspace-expand",
  },
  {
    id: "media",
    label: "Media",
    kind: "workspace",
    hint: "Motion, video and rendered work",
    panel: "video",
    anchor: { x: -4, y: 3.6, z: -7 },
    camera: { position: { x: -4, y: 3.8, z: 11 }, target: { x: 0, y: 1, z: -7 }, fov: 57 },
    accent: "#fb7185",
    enter: "environment-morph",
    enterFromDeep: "environment-morph",
  },
  {
    id: "conversation",
    label: "Conversation",
    kind: "workspace",
    hint: "The chat — summonable, never the opening screen",
    panel: "chat",
    anchor: { x: 0, y: 0.6, z: 1.5 },
    camera: { position: { x: 0, y: 0.8, z: 9 }, target: { x: 0, y: 0, z: 0 }, fov: 50 },
    accent: "#e9d5ff",
    enter: "workspace-expand",
    enterFromDeep: "workspace-expand",
  },
];

const BY_ID = new Map(SPATIAL_DESTINATIONS.map((destination) => [destination.id, destination]));

export function destinationFor(id: SpatialSceneId): SpatialDestination {
  const found = BY_ID.get(id);
  if (!found) throw new Error(`Unknown spatial scene: ${id}`);
  return found;
}

/** The destination that renders a given canonical panel, if any. */
export function destinationForPanel(panel: string): SpatialDestination | null {
  return SPATIAL_DESTINATIONS.find((destination) => destination.panel === panel) ?? null;
}

/** Which of the ten transitions an edge uses. */
export function transitionFor(from: SpatialSceneId, to: SpatialSceneId): TransitionKind {
  if (to === "core") return "return-to-core";
  if (to === "cosmos") return from === "core" ? "camera-pullback" : "environment-morph";
  if (to === "portal") return "portal-open";
  const destination = destinationFor(to);
  if (from === "core" || from === "cosmos") return destination.enter;
  if (from === "galaxy" && to === "planet") return "planet-approach";
  if (from === "galaxy" && to === "agents") return "galaxy-approach";
  if (from === "planet" && to === "galaxy") return "galaxy-approach";
  return destination.enterFromDeep;
}

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * Sample a camera pose along a transition path.
 *
 * Continuous in t, and exactly equal to `from` at t=0 and `to` at t=1
 * for every path — an interrupted transition can therefore be resumed
 * or reversed without a jump. Paths bow outward (arc), lift and pull
 * back (pullback), rush through the destination plane (dive) or pass
 * through the interface and settle (materialize); the environment
 * keeps moving the whole way instead of fading.
 */
export function sampleCameraPath(
  from: CameraPose,
  to: CameraPose,
  t: number,
  path: CameraPath,
): CameraPose {
  const k = clamp01(t);
  let px = mix(from.position.x, to.position.x, k);
  let py = mix(from.position.y, to.position.y, k);
  let pz = mix(from.position.z, to.position.z, k);
  let tx = mix(from.target.x, to.target.x, k);
  let ty = mix(from.target.y, to.target.y, k);
  let tz = mix(from.target.z, to.target.z, k);
  let fov = mix(from.fov, to.fov, k);

  const bow = Math.sin(Math.PI * k);

  switch (path) {
    case "arc": {
      px += bow * 6.5;
      py += bow * 5.5;
      pz += bow * 3.5;
      ty += bow * 1.4;
      break;
    }
    case "pullback": {
      py += bow * 11;
      pz += bow * 8;
      tx += bow * 0.8;
      break;
    }
    case "dive": {
      // Strong in the middle, zero at both ends: the camera plunges
      // toward the destination then settles into it.
      const plunge = Math.sin(Math.PI * k) * (1 - k);
      pz -= plunge * 12;
      px += plunge * 2.2;
      py += plunge * 1.4;
      tz -= plunge * 2;
      break;
    }
    case "materialize": {
      const through = bow * bow;
      pz -= through * 3.4;
      px += through * 0.6;
      fov -= Math.sin(Math.PI * k) * 6;
      break;
    }
    case "straight":
    default:
      break;
  }

  return {
    position: { x: px, y: py, z: pz },
    target: { x: tx, y: ty, z: tz },
    fov,
  };
}

/** Number of transitions the brief requires — asserted by the tests. */
export const TRANSITION_COUNT = 10;

export const SPATIAL_SCENE_IDS: SpatialSceneId[] = SPATIAL_DESTINATIONS.map((d) => d.id);
