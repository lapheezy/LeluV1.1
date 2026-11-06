/**
 * ==========================================================
 * LÉLU — SPATIAL CORE · PUBLIC SURFACE
 * ==========================================================
 */

export * from "./SpatialTypes";
export * from "./SpatialRenderModel";
export * from "./SpatialCapabilityManifest";
export * from "./SpatialLiveScene";
export * from "./SpatialVerification";
export * from "./SpatialComposition";
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
export { default as SpatialAdapter } from "./SpatialAdapter";
export type { SpatialEntityRef, SpatialEntitySource } from "./SpatialAdapter";
export { default as SpatialCameraApplier } from "./SpatialCameraApplier";
export { default as SpatialComposition } from "./SpatialComposition";
