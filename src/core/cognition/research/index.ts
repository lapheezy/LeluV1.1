/**
 * LÉLU — research cognition.
 *
 * One import surface for observation, journal, agenda, visual study,
 * capability promotion and the bridge into existing cognition.
 */

export * from "./types";
export { default as ResearchStore, MemoryDocStore, renderMarkdown } from "./store";
export type { DocStore, JournalIndex } from "./store";
export { default as ResearchJournal, ResearchError, confidenceFor, overlap, tokens, validateInput } from "./journal";
export type { Contradiction, KnowledgeGap, SearchHit } from "./journal";
export { default as ObservationLog, workPackageOf, classifyArtifact, defaultSession } from "./observations";
export type {
  DevelopmentEventSource,
  Observation,
  ObservationType,
  RawArtifact,
  RawCommit,
  RawResult,
  SessionDigest,
} from "./observations";
export { default as ResearchAgenda, priorityOf } from "./agenda";
export type { ProposalInput } from "./agenda";
export { decodePng, silhouette, compareRenders, backgroundOf } from "./visual";
export type { Inflate, RasterImage, SilhouetteMetrics, VisualComparison, VisualFinding } from "./visual";
export { default as CapabilityPipeline, CapabilityError } from "./capabilities";
export type { CapabilityInput } from "./capabilities";
export { default as CognitionBridge } from "./bridge";
export type { DailySink, KnowledgeSink, PublishResult } from "./bridge";
