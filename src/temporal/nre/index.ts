/**
 * TEMPORAL STUDIO — NRE public surface.
 *
 * Import from here, not from individual modules, so the internal file
 * layout stays free to change. Everything exported is real: implemented,
 * typechecked and exercised by tests/temporal-nre-*.test.ts.
 */

export type {
  AttributeChannel,
  AttributeKind,
  BoundingVolume,
  CoordinateSystem,
  ExperimentStatus,
  NreContainerManifest,
  NreSnapshot,
  Observation,
  ObservationProvenance,
  ProvenanceInput,
  Quantisation,
  SnapshotLineage,
  SnapshotManifest,
  SnapshotState,
  SourceKind,
  SpatialGrid,
  SparseVoxels,
  TransformRecord,
  Vec3,
} from "./types.ts";
export {
  MORTON_BITS_PER_AXIS,
  MORTON_MAX_AXIS,
  NRE_SCHEMA_VERSION,
  SUPPORTED_INPUT_VERSIONS,
  VXZ_CHUNK_VOXELS,
  VXZ_MAGIC,
  VXZ_VERSION_BYTE,
} from "./types.ts";

export { decodeMorton, isStrictlyAscending, morton3, MortonRangeError, sortByMorton } from "./morton.ts";
export { canonicalJson, sha256Hex, sha256HexOfText } from "./hash.ts";
export { availableCodecs, KNOWN_CODEC_IDS, NreCodecUnavailableError, codecById, registerCodec, type NreCodec, type NreCodecId } from "./codec.ts";

export {
  DEFAULT_CONFIDENCE_CHANNEL,
  DEFAULT_COORDINATE_SYSTEM,
  IDENTITY_MATRIX,
  attributeAt,
  buildSparseVoxels,
  cellBounds,
  cellCenter,
  cellCount,
  createGrid,
  denseIndexOf,
  fuseConfidence,
  isInside,
  occupancyKeySet,
  occupancyMask,
  transformPoint,
  transformVoxels,
  unionVoxels,
  validateVoxels,
  voxelCount,
  voxelsFromCoords,
  withConfidence,
} from "./voxels.ts";

export { NreCorruptionError, NreFormatError, NreVersionError, deserializeSnapshot, readContainerHeader, serializeSnapshot } from "./vxz.ts";

export {
  boundaryOf,
  boxMesh,
  emptyMesh,
  encodeGlb,
  irregularMesh,
  meshFromVoxels,
  sphereMesh,
  triangleCount,
  vertexCount,
  voxelizeMesh,
  type TriangleMesh,
} from "./geometry.ts";

export { NreGridMismatchError, NreIdentityError, compareVoxelSets, diffSnapshots, type ChangeKind, type SetMetrics, type SnapshotDiff } from "./compare.ts";

export {
  MemorySnapshotStore,
  SnapshotNotFoundError,
  accumulateSnapshots,
  createFsSnapshotStore,
  createTemporalObject,
  diffSeries,
  history,
  interpolateVoxels,
  loadHistory,
  recordSnapshot,
  restoreSnapshot,
  sameOccupancy,
  snapshotRecord,
  worldCenter,
  type AccumulationResult,
  type RecordSnapshotInput,
  type RecordSnapshotResult,
  type SnapshotRecord,
  type SnapshotStore,
  type TemporalObject,
} from "./snapshot.ts";

export {
  boxShell,
  filledBox,
  filledSphere,
  irregularBlob,
  lineOfCells,
  planeSheet,
  randomSparse,
  rotationYMatrix,
  scaleMatrix,
  sphereShell,
  torus,
  translationMatrix,
  withUniformConfidence,
} from "./shapes.ts";

export { eligibleFor, makeObservation, numericalFromGeometry, planSingleImageReconstruction, type PipelineStage, type PipelineStageId, type SingleImagePlan, type SingleImagePlanRequest } from "./pipeline.ts";

export {
  connectedComponents,
  measureSurfaceRoundTrip,
  measureVolume,
  measureVolumeRoundTrip,
  solidFromSurface,
  surfaceFromSolid,
  withVolumeConfidence,
  type ConversionReport,
  type SolidificationResult,
  type VolumeMetrics,
} from "./volume.ts";

export {
  analyseMotion,
  analyseRepresentation,
  withRepresentation,
  type MotionAnalysis,
  type RepresentationDecision,
  type RepresentationKind,
  type TemporalSignals,
} from "./select.ts";

export {
  centreOf,
  interpolateSnapshots,
  interpolateTransform,
  type InterpolationMethod,
  type InterpolationMetrics,
  type InterpolationResult,
} from "./interpolate.ts";
