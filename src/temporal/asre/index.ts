/**
 * ==========================================================
 * TEMPORAL STUDIO — ASRE public surface
 *
 * Import from here. The internal file layout is deliberately separable:
 *
 *   image.ts        one photograph → measurements (no model, no framework)
 *   lattice.ts      the projection is fixed once, for every hypothesis
 *   hypotheses.ts   four competing depth/geometry hypotheses, scored
 *   layers.ts       persistent frames, incremental fusion, duplicate guard
 *   components.ts   the anatomical graph and what a change invalidates
 *   schedule.ts     gain/cost scheduling with measured concurrency
 *   identity.ts     one persistent character, 36 hairstyles, 8 garments
 *   benchmark.ts    methods 1–4 over an injected engine
 *   integration.ts  the LÉLU ports and the session service
 *
 * Everything exported here is implemented and exercised by
 * tests/temporal-asre-*.test.ts.
 * ==========================================================
 */

export type {
  BBox2D,
  ComponentId,
  ImageFrame,
  Landmark,
  Provenance,
  RowSpan,
  Vec2,
} from "./types.ts";
export {
  COMPONENT_IDS,
  COMPONENT_LABELS,
  PROVENANCE_BY_CODE,
  PROVENANCE_CEILING,
  PROVENANCE_CODE,
  PROVENANCE_ORDER,
  bboxArea,
  bboxCentre,
  bboxHeight,
  bboxIsEmpty,
  bboxUnion,
  bboxWidth,
  emptyBBox,
} from "./types.ts";

export {
  analyseDepth,
  analyseImage,
  analyseSurface,
  analysisBBox,
  detectLandmarks,
  distanceTransform,
  foregroundMask,
  identifyComponents,
  largestComponent,
  lumaOf,
  luminance,
  maskBBox,
  measureSilhouette,
  measureSpatial,
  otsuThreshold,
  percentile,
  pixelDigest,
  resampleMask,
  rowSpans,
  type AnalyseOptions,
  type ColourAnalysis,
  type ComponentLayout,
  type ComponentObservation,
  type DepthAnalysis,
  type ImageAnalysis,
  type LandmarkSet,
  type Segmentation,
  type Silhouette,
  type SpatialMeasurements,
  type SurfaceAnalysis,
} from "./image.ts";

export {
  cellToImage,
  cellWorld,
  columnForImageX,
  imageToCell,
  latticeForAnalysis,
  pixelsToCells,
  rowForCellJ,
  type AnalysisLattice,
  type LatticeOptions,
} from "./lattice.ts";

export {
  PROVENANCE_CHANNEL,
  buildHypotheses,
  combineHypotheses,
  compareHypotheses,
  projectCoverage,
  provenanceSummary,
  scoreHypothesis,
  type DepthColumn,
  type HypothesisComparison,
  type HypothesisEvaluation,
  type HypothesisKind,
  type HypothesisScore,
  type ReconstructionHypothesis,
} from "./hypotheses.ts";

export {
  addObservation,
  createLayeredReconstruction,
  flipbook,
  frameById,
  headFrame,
  restoreFrame,
  type AddObservationResult,
  type ChangeReport,
  type FlipbookEntry,
  type FrameState,
  type LayeredReconstruction,
  type ObservationFrame,
  type ObservationInput,
} from "./layers.ts";

export {
  COMPONENT_GRAPH,
  OVERLAY_COMPONENTS,
  STRUCTURAL_COMPONENTS,
  checkAnatomy,
  dependencyEdges,
  dirtySet,
  mergeComponents,
  reusableSet,
  splitByComponent,
  voxelDigest,
  type AnatomyIssue,
  type ComponentNode,
  type ComponentSplit,
  type DependencyEdge,
  type DirtyOptions,
} from "./components.ts";

export {
  expectedInformationGain,
  nextTask,
  planOrder,
  planWaves,
  priorities,
  priorityValue,
  readyTasks,
  runPool,
  runSchedule,
  sampleResources,
  type ResourceSample,
  type RunRecord,
  type ScheduleResult,
  type ScheduledTask,
  type TaskPriority,
} from "./schedule.ts";

export {
  GARMENTS,
  HAIRSTYLES,
  POSES,
  applyVariation,
  buildGarmentGeometry,
  buildHairGeometry,
  createIdentity,
  defaultAppearance,
  defaultRig,
  garmentById,
  hairstyleById,
  identityBody,
  identityVoxels,
  reuseRatio,
  type AppearanceParameters,
  type CharacterIdentity,
  type GarmentFamily,
  type GarmentSpec,
  type HairstyleFamily,
  type HairstyleSpec,
  type PoseSpec,
  type RigParameters,
  type VariationKind,
  type VariationRequest,
  type VariationResult,
} from "./identity.ts";

export { measureQuality, runBenchmark, type BenchmarkArtifact, type BenchmarkEngine, type BenchmarkMethodId, type BenchmarkReport, type MethodMeasurement, type QualityReport, type TrialSet } from "./benchmark.ts";

export {
  AsreSessionNotFound,
  VARIATION_LIBRARY,
  createAsreService,
  createLocalPorts,
  type AsreService,
  type AsreServiceOptions,
  type AsreSession,
  type CosmosObjectPayload,
  type LeluPorts,
  type MissingInformation,
  type RefinementOutcome,
  type SessionSnapshot,
  type VariationOutcome,
  type VersionComparison,
  type ViewRequest,
} from "./integration.ts";

export { PROVENANCE_LABELS, meanObservation } from "./shared.ts";

export {
  provenanceTotals,
  reconstructFromAnalysis,
  reconstructFromImage,
  syntheticCharacterFrame,
  variationSweep,
  type Reconstruction,
  type ReconstructOptions,
  type SweepEntry,
} from "./experiments/mission4.ts";
