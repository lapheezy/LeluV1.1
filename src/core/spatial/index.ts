/**
 * ==========================================================
 * LÉLU — SPATIAL CORE · PUBLIC SURFACE
 * ==========================================================
 */

export * from "./SpatialTypes";
export * from "./SpatialRenderModel";
export * from "./SpatialCapabilityManifest";
export { default as SpatialSceneGraph } from "./SpatialSceneGraph";
export type {
  SpatialCommitResult,
  SpatialMutation,
  SpatialObjectPatch,
} from "./SpatialSceneGraph";
export { default as SpatialObjectRegistry } from "./SpatialObjectRegistry";
export { default as SpatialTierGuard } from "./SpatialTierGuard";
export { SPATIAL_OPERATIONS } from "./SpatialTierGuard";
export type { SpatialAuthorization } from "./SpatialTierGuard";
export { default as SpatialIntentBus } from "./SpatialIntentBus";
export { default as SpatialPresence } from "./SpatialPresence";
export type { SpatialPresenceState, SpatialTraversal } from "./SpatialPresence";
