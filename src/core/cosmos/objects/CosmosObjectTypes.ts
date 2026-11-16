/**
 * ==========================================================
 * LÉLU — COSMOS OBJECTS
 *
 * What a constructed thing becomes once it leaves the card.
 *
 * A construction is an artifact in the Studio; an OBJECT is that same
 * thing living in the Cosmos: it has its own id, a place, an
 * orientation, a size, a motion, and optionally a parent. The object
 * carries a snapshot of its geometry, so it keeps standing even if the
 * artifact it came from is later revised — and it keeps the artifact's
 * id, so "open it in the workspace" goes back to the same source.
 *
 * Nothing here calls a model, a server or a paid service: these are
 * plain records and pure functions over them.
 * ==========================================================
 */

import type { Scene3DProgram } from "../../creative/kit/Scene3D";

export type Vec3 = [number, number, number];

export type MotionKind = "still" | "spin" | "orbit" | "bob" | "drift";

export interface ObjectMotion {
  kind: MotionKind;
  /** spins/orbits per second for spin and orbit; metres per second for drift */
  speed: number;
  axis: "x" | "y" | "z";
  paused: boolean;
}

export interface ObjectFrame {
  position: Vec3;
  /** degrees, applied X → Y → Z, the same convention as Scene3D */
  rotation: Vec3;
  /** uniform scale, 0.05 … 12 */
  scale: number;
}

export interface ObjectProvenance {
  at: number;
  action: string;
  detail: string;
}

export interface CosmosObject {
  /** stable for life: duplicating makes a NEW id, nothing else does */
  id: string;
  name: string;
  description: string;
  /** the construction domain it was built in */
  domain: string;
  builder: string;
  /** where it came from, so it can always be reopened and exported */
  source: { artifactId: string; rev: number } | null;
  params: Record<string, number | string>;
  /** the geometry itself, snapshot at the revision it was spawned from */
  scene: Scene3DProgram;
  partCount: number;
  frame: ObjectFrame;
  motion: ObjectMotion;
  parent: string | null;
  children: string[];
  group: string | null;
  visible: boolean;
  locked: boolean;
  /** where in LÉLU it lives: cosmos, workspace, gallery */
  place: "cosmos" | "workspace" | "gallery";
  createdAt: number;
  updatedAt: number;
  provenance: ObjectProvenance[];
  /**
   * Which placement scheme the stored frame was written for. Absent means the
   * object predates the fix to the ring maths (see `isLegacyRingPosition`).
   */
  placementVersion?: number;
}

export interface CosmosGroups {
  /** group id → the objects in it, in the order they were added */
  [id: string]: { id: string; name: string; members: string[]; createdAt: number };
}

export interface CosmosObjectState {
  objects: CosmosObject[];
  groups: CosmosGroups;
  /** removed objects, restorable until the user deletes them for good */
  trash: CosmosObject[];
  /** the object the user is looking at */
  selected: string | null;
  /** everything selected, for grouping and moving several at once */
  selection: string[];
  revision: number;
  canUndo: boolean;
  canRedo: boolean;
}

export const DEFAULT_FRAME: ObjectFrame = { position: [0, 0, 4], rotation: [0, 0, 0], scale: 1 };

export const DEFAULT_MOTION: ObjectMotion = { kind: "still", speed: 0.08, axis: "y", paused: false };

export function clampScale(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(12, Math.max(0.05, n));
}

export function frameOf(partial?: Partial<ObjectFrame>): ObjectFrame {
  return {
    position: vec(partial?.position, DEFAULT_FRAME.position),
    rotation: vec(partial?.rotation, DEFAULT_FRAME.rotation),
    scale: clampScale(partial?.scale ?? 1),
  };
}

function vec(v: unknown, fallback: Vec3): Vec3 {
  if (!Array.isArray(v) || v.length !== 3) return [...fallback] as Vec3;
  const nums = v.map((n) => (typeof n === "number" && Number.isFinite(n) ? n : 0)) as Vec3;
  return nums;
}

/**
 * WHERE AN OBJECT IS BORN.
 *
 * The ring sits BETWEEN the viewer and the LÉLU core: in front of the core's
 * room cluster (drawn at z = -25) and in front of the camera that looks at it.
 *
 * Both of those bounds are real numbers from the scene, and the depth has to
 * satisfy both. The default camera rests at z = 6.8 looking at the origin
 * (see the OrbitControls reset in GenesisCameraController), so a ring at
 * z = +7.2 is *behind the viewer*: every object on it projects far outside the
 * frame, at any aspect ratio, which is why a wide window looked empty even
 * though the canvas, the camera and the store all agreed.
 *
 * The depth was also once packed inside the rounding factor —
 *
 *     Math.round((z + sin(angle) * radius * 100) / 100) / 100
 *
 * — which divides z by 100 as well: every "ring" in every version collapsed
 * onto z ≈ 0 (z = 7.2 → 0, z = 4 → 0.04, z = -18 → -0.18). That is why a
 * chair always appeared inside the core's rooms however far in front the ring
 * was meant to be. The maths below is the corrected form; the values those two
 * earlier schemes produced are what `legacyRingSignature` recognises.
 */
export const RING_RADIUS = 3.2;
/** Negative z is toward the core and away from the viewer: in view, clear of it. */
export const RING_DEPTH = -7.2;
/** Where v2 put the ring: 32 m past the core and behind the resting camera. */
export const LEGACY_RING_DEPTH = 7.2;
export const RING_HEIGHT = 0.9;
export const RING_SLOTS = 6;
/** The resting camera's depth. A slot must be in FRONT of this to be seen. */
export const VIEWER_DEPTH = 6.8;

/** Bumped when stored positions need a one-time normalisation. */
export const PLACEMENT_VERSION = 3;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function ringSlot(index: number, radius = RING_RADIUS, z = RING_DEPTH, y = RING_HEIGHT): Vec3 {
  const slot = ((index % RING_SLOTS) + RING_SLOTS) % RING_SLOTS;
  const angle = (slot * Math.PI * 2) / RING_SLOTS;
  return [round2(Math.cos(angle) * radius), y, round2(z + Math.sin(angle) * radius)];
}

/**
 * Which earlier placement scheme, if any, wrote this position.
 *
 *  - "cluster": the broken maths' output — the ring's height and a depth
 *    squashed into ±one radius of the origin, i.e. inside the core's rooms.
 *  - "behind-camera": v2's ring, correctly round but at +7.2, on the far side
 *    of the resting camera, where nothing it holds can be seen.
 *
 * Only a signal: whether the object may be moved is decided by its provenance
 * and `placementVersion` (see `needsPlacementNormalization`).
 */
export function legacyRingSignature(position: Vec3): "cluster" | "behind-camera" | null {
  const [x, y, z] = position;
  if (![x, y, z].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (Math.abs(y - RING_HEIGHT) > 0.05) return null;
  // v2's ring: on the same circle, centred on the depth that sits behind the viewer.
  const fromV2Centre = Math.hypot(x, z - LEGACY_RING_DEPTH);
  if (fromV2Centre >= RING_RADIUS - 0.35 && fromV2Centre <= RING_RADIUS + 0.35) return "behind-camera";
  // v1's ring: squashed to the origin's depth, inside the cluster.
  if (Math.abs(z) > RING_RADIUS + 0.05) return null;
  if (Math.abs(x) > RING_RADIUS + 0.05) return null;
  const radius = Math.hypot(x, z);
  if (radius > 0.5 && radius <= RING_RADIUS + 0.35) return "cluster";
  return null;
}

/** Whether a stored position came from an earlier placement scheme. */
export function isLegacyRingPosition(position: Vec3): boolean {
  return legacyRingSignature(position) !== null;
}

/** A short, human line about one object — used by the tools and the panel. */
export function describeObject(o: CosmosObject): string {
  const p = o.frame.position.map((n) => n.toFixed(1)).join(", ");
  const bits = [`${o.id} “${o.name}”`, `${o.partCount} parts`, `at [${p}]`, `scale ${o.frame.scale.toFixed(2)}`];
  if (o.parent) bits.push(`inside ${o.parent}`);
  if (o.group) bits.push(`group ${o.group}`);
  if (o.motion.kind !== "still") bits.push(`${o.motion.paused ? "paused" : "moving"} ${o.motion.kind}`);
  if (!o.visible) bits.push("hidden");
  if (o.locked) bits.push("locked");
  if (o.source) bits.push(`from ${o.source.artifactId}@r${o.source.rev}`);
  return bits.join(" · ");
}

/** How many draw calls an object needs: one per scene object, capped. */
export function objectDrawCalls(o: CosmosObject): number {
  return o.scene.objects.length;
}

export function isVec3(v: unknown): v is Vec3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
}
