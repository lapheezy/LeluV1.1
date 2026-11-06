/**
 * ==========================================================
 * LÉLU — SPATIAL CAPABILITY CORE · TYPED SCHEMA
 *
 * Phase 2.1 of the master capability upgrade. This file is the
 * ONE definition of what a spatial object is, which operations
 * exist, and how a refusal is reported — so the scene graph,
 * the tier guard, the chat resolver and the R3F layer cannot
 * disagree about any of it.
 *
 * Revision contract (asserted by tests/spatial-core.test.ts):
 *
 *   - a scene starts at revision 0;
 *   - every ACCEPTED commit increments the revision by exactly
 *     1, no matter how many mutations that commit carries;
 *   - a REFUSED commit leaves the revision AND the scene
 *     untouched (compared deeply, not just by counter).
 *
 * Tiers are permissions, not labels. Tier is derived in
 * SpatialTierGuard from the documented security model
 * (docs/architecture/SECURITY_AND_PERMISSION_MODEL.md):
 *
 *   1 OBSERVE            read-only
 *   2 MANIPULATE         mutate existing objects, reversible
 *   3 CONSTRUCT          add/connect objects; destructive ops
 *                        additionally need owner approval
 *   4 ORCHESTRATE        multi-step composition (approval)
 *   5 AUTONOMOUS         propose → approve → commit (approval)
 * ==========================================================
 */

export type SpatialTier = 1 | 2 | 3 | 4 | 5;

export const SPATIAL_TIER_LABELS: Record<SpatialTier, string> = {
  1: "observe",
  2: "manipulate",
  3: "construct",
  4: "orchestrate",
  5: "autonomous-with-approval",
};

export type SpatialPrimitiveKind = "box" | "sphere" | "cylinder" | "cone" | "torus" | "plane";

export const SPATIAL_PRIMITIVES: readonly SpatialPrimitiveKind[] = [
  "box",
  "sphere",
  "cylinder",
  "cone",
  "torus",
  "plane",
];

/** Human names used for generated object names ("Cube 1"). */
export const SPATIAL_PRIMITIVE_LABELS: Record<SpatialPrimitiveKind, string> = {
  box: "Cube",
  sphere: "Sphere",
  cylinder: "Cylinder",
  cone: "Cone",
  torus: "Ring",
  plane: "Plane",
};

export interface SpatialVec3 {
  x: number;
  y: number;
  z: number;
}

export const SPATIAL_ORIGIN: SpatialVec3 = { x: 0, y: 0, z: 0 };

export interface SpatialTransform {
  position: SpatialVec3;
  /** Euler rotation in radians. */
  rotation: SpatialVec3;
  scale: SpatialVec3;
}

export interface SpatialMaterial {
  /** #rrggbb */
  color: string;
  metalness: number;
  roughness: number;
  opacity: number;
  /** #rrggbb */
  emissive: string;
  emissiveIntensity: number;
  wireframe: boolean;
}

export type SpatialRelationshipKind = "connected" | "orbits" | "contains" | "aligned";

export const SPATIAL_RELATIONSHIP_KINDS: readonly SpatialRelationshipKind[] = [
  "connected",
  "orbits",
  "contains",
  "aligned",
];

export interface SpatialRelationship {
  id: string;
  from: string;
  to: string;
  kind: SpatialRelationshipKind;
  createdAt: number;
}

/**
 * Where the object came from. LÉLU can answer "did I make this?"
 * from this field alone — it is never inferred from appearance.
 */
export type SpatialProvenance = "authored" | "scene" | "agent";

/** Who caused the write. The owner is the person; LÉLU is the operator. */
export type SpatialAuthor = "lelu" | "owner" | "system";

export interface SpatialObject {
  id: string;
  name: string;
  kind: SpatialPrimitiveKind;
  transform: SpatialTransform;
  material: SpatialMaterial;
  visible: boolean;
  provenance: SpatialProvenance;
  createdBy: SpatialAuthor;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Immutable view of the scene at one revision. Arrays are frozen;
 * consumers read, they never write into the authoritative state.
 */
export interface SpatialSceneSnapshot {
  revision: number;
  objects: readonly SpatialObject[];
  relationships: readonly SpatialRelationship[];
  updatedAt: number;
}

export type SpatialOperationId =
  | "scene.list"
  | "scene.inspect"
  | "object.create"
  | "object.move"
  | "object.rotate"
  | "object.scale"
  | "object.setVisible"
  | "material.set"
  | "object.connect"
  | "object.delete"
  | "scene.undo"
  | "scene.recover"
  | "scene.compose"
  | "scene.commit"
  | "camera.focus"
  | "camera.frame"
  | "camera.reset"
  | "camera.orbit"
  | "camera.zoom";

export interface SpatialOperationDef {
  id: SpatialOperationId;
  tier: SpatialTier;
  /** True when the operation changes scene state. */
  mutates: boolean;
  /** True when it removes or replaces something a person authored. */
  destructive: boolean;
  /** Owner approval is required for EVERY execution of this operation. */
  requiresApproval: boolean;
  /**
   * False when the tier is enforced but the applier does not exist
   * yet. The guard refuses it with `not-implemented` instead of
   * pretending it works — the manifest reports it as unavailable.
   */
  implemented: boolean;
  description: string;
}

export type SpatialRefusalCode =
  | "tier-insufficient"
  | "approval-required"
  | "approval-invalid"
  | "stale-revision"
  | "validation-failed"
  | "unknown-object"
  | "already-exists"
  | "limit-exceeded"
  | "unauthorized"
  | "not-implemented"
  | "verification-failed";

export interface SpatialRefusal {
  code: SpatialRefusalCode;
  /** Plain-language reason, safe to show in chat. */
  detail: string;
  requiredTier?: SpatialTier;
  grantedTier?: SpatialTier;
  expectedRevision?: number;
  actualRevision?: number;
  /** Known candidates when a name could not be resolved. */
  candidates?: string[];
}

export type SpatialVerificationLayer =
  | "graph"
  | "renderer"
  | "camera"
  | "framing"
  | "screenshot";

export type SpatialVerificationStatus = "pass" | "fail" | "skipped";

export interface SpatialVerificationCheck {
  layer: SpatialVerificationLayer;
  name: string;
  status: SpatialVerificationStatus;
  detail: string;
}

export interface SpatialVerificationSummary {
  ok: boolean;
  layers: Record<SpatialVerificationLayer, SpatialVerificationStatus>;
  checks: readonly SpatialVerificationCheck[];
  /** Honest screenshot state: the core never fabricates visual evidence. */
  screenshot: "not-captured" | "captured-externally" | "unavailable";
  checkedAt: number;
}

export interface SpatialCameraPose {
  position: SpatialVec3;
  target: SpatialVec3;
  distance: number;
  fov: number;
}

export interface SpatialIntentResult {
  ok: boolean;
  op: SpatialOperationId;
  /** The scene revision AFTER the attempt (unchanged on refusal). */
  revision: number;
  /** What actually happened, or why nothing happened. */
  message: string;
  objectId?: string;
  objectName?: string;
  objectIds?: string[];
  objectNames?: string[];
  relationshipId?: string;
  /** Prepared (but uncommitted) composition, awaiting owner approval. */
  planId?: string;
  planSummary?: string;
  verification?: SpatialVerificationSummary;
  camera?: SpatialCameraPose;
  refusal?: SpatialRefusal;
}

export type SpatialIntent =
  | { op: "scene.list" }
  | { op: "scene.inspect"; target: string }
  | {
      op: "object.create";
      kind: SpatialPrimitiveKind;
      name?: string;
      position?: Partial<SpatialVec3>;
      color?: string;
      scale?: number;
      material?: Partial<SpatialMaterial>;
    }
  | {
      op: "object.move";
      target: string;
      /** Absolute destination (preferred) or a delta from the current position. */
      position?: Partial<SpatialVec3>;
      delta?: Partial<SpatialVec3>;
    }
  | { op: "object.rotate"; target: string; delta: Partial<SpatialVec3> }
  | { op: "object.scale"; target: string; factor?: number; scale?: number }
  | { op: "object.setVisible"; target: string; visible: boolean }
  | {
      op: "material.set";
      target: string;
      color?: string;
      metalness?: number;
      roughness?: number;
      opacity?: number;
      emissive?: string;
      emissiveIntensity?: number;
      wireframe?: boolean;
    }
  | {
      op: "object.connect";
      from: string;
      to: string;
      kind?: SpatialRelationshipKind;
    }
  | { op: "object.delete"; target: string }
  | { op: "scene.undo" }
  | { op: "scene.compose"; request: string; anchor?: string }
  | { op: "scene.commit"; planId?: string }
  | { op: "camera.focus"; targets: string[]; padding?: number }
  | { op: "camera.frame"; targets?: string[]; padding?: number }
  | { op: "camera.reset" }
  | { op: "camera.orbit"; target?: string; degrees: number }
  | { op: "camera.zoom"; factor: number };

/**
 * Viewport/camera bounds shared by the applier and the existing Genesis
 * v2 rig (GenesisV2CameraRig DEFAULT_LIMITS), so a requested pose can be
 * clamped by the rig without the core inventing different limits.
 */
export const SPATIAL_VIEW_LIMITS = {
  minDistance: 1.8,
  maxDistance: 64,
  worldRadius: 36,
  yMin: -12,
  yMax: 30,
  defaultFov: 46,
  defaultAspect: 1.7,
  /** Extra room around a framed bounding sphere. */
  padding: 1.35,
} as const;

/** Hard bounds — validated on every mutation, never clamped silently. */
export const SPATIAL_LIMITS = {
  objects: 64,
  relationships: 128,
  /** Metres from the world origin in any axis. */
  position: 40,
  scaleMin: 0.05,
  scaleMax: 20,
  nameLength: 48,
  history: 50,
} as const;

export const DEFAULT_SPATIAL_COLOR = "#7c3aed";
export const DEFAULT_SPATIAL_EMISSIVE = "#a78bfa";

export const SPATIAL_DEFAULT_MATERIAL: SpatialMaterial = {
  color: DEFAULT_SPATIAL_COLOR,
  metalness: 0.25,
  roughness: 0.35,
  opacity: 1,
  emissive: DEFAULT_SPATIAL_EMISSIVE,
  emissiveIntensity: 0.35,
  wireframe: false,
};

/**
 * Default placement for new objects: a small arc to the lower right
 * of the Core, in front of the camera the Gen V2 scene opens with
 * (camera z 8.6, fov 46) — so "create a cube" produces something a
 * person can actually see, not something hidden behind the Core.
 */
export function defaultSpatialPlacement(index: number): SpatialVec3 {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return { x: 2.2 + column * 1.25, y: -1.35 + row * 1.25, z: 2.2 };
}
