/**
 * ==========================================================
 * TEMPORAL STUDIO — ASRE — CONTROLLED BENCHMARK
 *
 * Four methods, identical inputs, identical hardware, identical output
 * requirement:
 *
 *   M1  conventional whole-object reconstruction: one model call produces
 *       the object; any update repeats the whole call
 *   M2  component-based: each anatomical part is reconstructed from its own
 *       crop; an update regenerates only the affected parts
 *   M3  incremental with accumulated observations: the base is built once,
 *       then new evidence is fused numerically — no model call at all
 *   M4  adaptive parallel: the scheduler prices each part by
 *       expected-information-gain / cost and runs independent parts
 *       concurrently, measured rather than assumed
 *
 * The harness owns no model. Everything expensive is an injected operator,
 * so the same code prices the real TripoSR worker in the experiment runner
 * and a synthetic engine in the tests. `median`/`min`/`max` are reported
 * together because a single timing run is not a measurement.
 * ==========================================================
 */

import type { SparseVoxels } from "../nre/types.ts";
import { voxelCount } from "../nre/voxels.ts";
import { encodeGlb, meshFromVoxels } from "../nre/geometry.ts";
import { compareVoxelSets } from "../nre/compare.ts";
import type { ComponentId } from "./types.ts";
import { expectedInformationGain, runPool, runSchedule, sampleResources, type ResourceSample, type ScheduledTask } from "./schedule.ts";

export type BenchmarkMethodId = "M1-whole" | "M2-components" | "M3-incremental" | "M4-adaptive-parallel";

export interface BenchmarkArtifact {
  voxels: SparseVoxels;
  /** Model invocations this artifact required. */
  modelCalls: number;
  /** Time spent inside the model/worker, as measured by the engine. */
  inferenceMs: number;
  /** Time spent on numerics: voxelisation, fusion, meshing. */
  geometryMs: number;
}

export interface QualityReport {
  /** IoU of the reconstructed silhouette against the input image silhouette. */
  silhouetteIou: number;
  /** Voxel IoU against the method's reference volume. */
  referenceIou: number;
  cells: number;
  triangles: number;
  exportBytes: number;
  /** 1 - referenceIou, the share of the reference volume not reproduced. */
  informationLoss: number;
}

export interface BenchmarkEngine {
  name: string;
  description: string;
  /** Parts the engine can reconstruct independently. */
  components: ComponentId[];
  /** Parts the current image actually observes. */
  observedComponents: ComponentId[];
  reference(): SparseVoxels;
  wholeObject(): Promise<BenchmarkArtifact>;
  componentWise(components: ComponentId[], concurrency: number): Promise<{ parts: Partial<Record<ComponentId, BenchmarkArtifact>>; combined: BenchmarkArtifact }>;
  compose(parts: Partial<Record<ComponentId, SparseVoxels>>): Promise<BenchmarkArtifact>;
  /** Numeric-only refinement of one part from accumulated evidence. */
  incremental(component: ComponentId): Promise<BenchmarkArtifact>;
  /** Model call for one part only (M2's update path). */
  regenerate(component: ComponentId): Promise<BenchmarkArtifact>;
  /** Which parts a new observation would touch. */
  changedComponents(): ComponentId[];
}

export interface MethodMeasurement {
  method: BenchmarkMethodId;
  label: string;
  success: boolean;
  error: string | null;
  /** First artifact the user could look at, and when it arrived. */
  timeToFirstUsableMs: number;
  /** When the final accepted reconstruction was ready. */
  timeToFinalMs: number;
  totalInferenceMs: number;
  totalGeometryMs: number;
  totalModelCalls: number;
  componentsRegenerated: number;
  componentsReused: number;
  cells: number;
  triangles: number;
  exportBytes: number;
  silhouetteIou: number;
  referenceIou: number;
  informationLoss: number;
  /** Time to apply one localised change afterwards. */
  updateLatencyMs: number;
  updateModelCalls: number;
  updateRegeneratedComponents: number;
  updateReusedComponents: number;
  /** CPU-time expenditure (user+system), and the wall clock it took. */
  computeExpenditureMs: number;
  wallMs: number;
  cpuUtilisation: number;
  peakRssBytes: number | null;
  notes: string[];
}

export interface TrialSet {
  method: BenchmarkMethodId;
  label: string;
  trials: number;
  successRate: number;
  median: Record<string, number>;
  min: Record<string, number>;
  max: Record<string, number>;
  /** Spread as a fraction of the median: how noisy this measurement is. */
  variability: Record<string, number>;
  sample: MethodMeasurement[];
}

export interface BenchmarkReport {
  engine: string;
  description: string;
  trialsPerMethod: number;
  coldStart: boolean;
  methods: TrialSet[];
  /** Headline comparisons, computed from the medians. */
  comparison: {
    /** M3 vs M1 update latency, as a speed-up factor. */
    incrementalUpdateSpeedup: number;
    /** M2 vs M1 first-usable time. */
    componentFirstResultRatio: number;
    /** M4 vs M2 wall clock (parallel against sequential). */
    parallelSpeedup: number;
    qualityAtSpeed: Array<{ method: BenchmarkMethodId; medianWallMs: number; medianReferenceIou: number }>;
    statement: string;
  };
  limitations: string[];
}

const METRICS = [
  "timeToFirstUsableMs",
  "timeToFinalMs",
  "totalInferenceMs",
  "totalGeometryMs",
  "totalModelCalls",
  "componentsRegenerated",
  "componentsReused",
  "cells",
  "triangles",
  "exportBytes",
  "silhouetteIou",
  "referenceIou",
  "informationLoss",
  "updateLatencyMs",
  "updateModelCalls",
  "updateRegeneratedComponents",
  "updateReusedComponents",
  "computeExpenditureMs",
  "wallMs",
  "cpuUtilisation",
] as const;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function summarise(measurements: MethodMeasurement[]): TrialSet {
  const successful = measurements.filter((m) => m.success);
  const medianOut: Record<string, number> = {};
  const minOut: Record<string, number> = {};
  const maxOut: Record<string, number> = {};
  const variability: Record<string, number> = {};
  for (const metric of METRICS) {
    const values = successful.map((m) => m[metric] as number).filter((v) => Number.isFinite(v));
    const med = median(values);
    medianOut[metric] = med;
    minOut[metric] = values.length > 0 ? Math.min(...values) : 0;
    maxOut[metric] = values.length > 0 ? Math.max(...values) : 0;
    variability[metric] = med !== 0 && values.length > 1 ? (maxOut[metric] - minOut[metric]) / Math.abs(med) : 0;
  }
  return {
    method: measurements[0]?.method ?? "M1-whole",
    label: measurements[0]?.label ?? "",
    trials: measurements.length,
    successRate: measurements.length > 0 ? successful.length / measurements.length : 0,
    median: medianOut,
    min: minOut,
    max: maxOut,
    variability,
    sample: measurements,
  };
}

function trianglesOf(voxels: SparseVoxels): number {
  return Math.floor(meshFromVoxels(voxels).indices.length / 3);
}

function bytesOf(voxels: SparseVoxels): number {
  return encodeGlb(meshFromVoxels(voxels), { name: "asre-benchmark", generator: "asre-mission4" }).byteLength;
}

/** Shared quality computation, so every method is scored the same way. */
export function measureQuality(voxels: SparseVoxels, reference: SparseVoxels, silhouetteIou: number): QualityReport {
  const metrics = compareVoxelSets(reference, voxels);
  const triangles = trianglesOf(voxels);
  return {
    silhouetteIou,
    referenceIou: metrics.iou,
    cells: voxelCount(voxels),
    triangles,
    exportBytes: bytesOf(voxels),
    informationLoss: 1 - metrics.iou,
  };
}

/** Silhouette IoU is supplied by the engine: it owns the image and the mask. */
export interface SilhouetteScorer {
  (voxels: SparseVoxels): number;
}

export interface BenchmarkOptions {
  trials?: number;
  /** M2/M4 concurrency for component-wise reconstruction. */
  concurrency?: number;
  /** How many components M3/M4 refine after the base exists. */
  refinementSteps?: number;
  silhouetteIou?: SilhouetteScorer;
  /** Supplied so the report states which engine was measured. */
  coldStart?: boolean;
}

export async function runBenchmark(engine: BenchmarkEngine, options: BenchmarkOptions = {}): Promise<BenchmarkReport> {
  const trials = Math.max(1, options.trials ?? 1);
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const steps = Math.max(1, options.refinementSteps ?? 3);
  const scorer = options.silhouetteIou ?? (() => 0);
  const reference = engine.reference();

  const each = async (method: BenchmarkMethodId, label: string, run: () => Promise<MethodMeasurement>): Promise<TrialSet> => {
    const measurements: MethodMeasurement[] = [];
    for (let trial = 0; trial < trials; trial++) {
      try {
        measurements.push(await run());
      } catch (error) {
        measurements.push({
          method,
          label,
          success: false,
          error: error instanceof Error ? error.message : String(error),
          timeToFirstUsableMs: NaN,
          timeToFinalMs: NaN,
          totalInferenceMs: NaN,
          totalGeometryMs: NaN,
          totalModelCalls: NaN,
          componentsRegenerated: NaN,
          componentsReused: NaN,
          cells: NaN,
          triangles: NaN,
          exportBytes: NaN,
          silhouetteIou: NaN,
          referenceIou: NaN,
          informationLoss: NaN,
          updateLatencyMs: NaN,
          updateModelCalls: NaN,
          updateRegeneratedComponents: NaN,
          updateReusedComponents: NaN,
          computeExpenditureMs: NaN,
          wallMs: NaN,
          cpuUtilisation: NaN,
          peakRssBytes: null,
          notes: [],
        });
      }
    }
    return summarise(measurements);
  };

  /* ---------------------------------------------------------------- M1 */
  const m1 = await each("M1-whole", "Whole-object reconstruction (baseline)", async () => {
    const started = performance.now();
    const { value, sample } = await sampleResources(async () => {
      const artifact = await engine.wholeObject();
      const firstUsable = performance.now() - started;
      // The update path of a conventional pipeline is the whole pipeline.
      const updateStarted = performance.now();
      const updated = await engine.wholeObject();
      const updateLatency = performance.now() - updateStarted;
      return { artifact, updated, firstUsable, updateLatency };
    });
    const { artifact, updated, firstUsable, updateLatency } = value;
    const quality = measureQuality(artifact.voxels, reference, scorer(artifact.voxels));
    return {
      method: "M1-whole" as const,
      label: "Whole-object reconstruction (baseline)",
      success: true,
      error: null,
      timeToFirstUsableMs: firstUsable,
      timeToFinalMs: sample.wallMs,
      totalInferenceMs: artifact.inferenceMs + updated.inferenceMs,
      totalGeometryMs: artifact.geometryMs + updated.geometryMs,
      totalModelCalls: artifact.modelCalls + updated.modelCalls,
      componentsRegenerated: engine.components.length,
      componentsReused: 0,
      cells: quality.cells,
      triangles: quality.triangles,
      exportBytes: quality.exportBytes,
      silhouetteIou: quality.silhouetteIou,
      referenceIou: quality.referenceIou,
      informationLoss: quality.informationLoss,
      updateLatencyMs: updateLatency,
      updateModelCalls: updated.modelCalls,
      updateRegeneratedComponents: engine.components.length,
      updateReusedComponents: 0,
      computeExpenditureMs: sample.cpuUserMs + sample.cpuSystemMs,
      wallMs: sample.wallMs,
      cpuUtilisation: sample.cpuUtilisation,
      peakRssBytes: sample.peakRssBytes,
      notes: ["a localised change costs exactly what the first reconstruction cost: the model sees the whole image again"],
    };
  });

  /* ---------------------------------------------------------------- M2 */
  const m2 = await each("M2-components", "Component-based reconstruction (sequential)", async () => {
    const started = performance.now();
    const { value, sample } = await sampleResources(async () => {
      const { parts, combined } = await engine.componentWise(engine.components, 1);
      const firstUsable = performance.now() - started;
      const changed = engine.changedComponents();
      const updateStarted = performance.now();
      const regenerated: Partial<Record<ComponentId, SparseVoxels>> = {};
      let updateInference = 0;
      for (const component of changed) {
        const part = await engine.regenerate(component);
        regenerated[component] = part.voxels;
        updateInference += part.inferenceMs;
      }
      const merged: Partial<Record<ComponentId, SparseVoxels>> = {};
      for (const component of engine.components) merged[component] = regenerated[component] ?? parts[component]?.voxels;
      const recombined = await engine.compose(merged);
      const updateLatency = performance.now() - updateStarted;
      return { combined, parts, firstUsable, recombined, updateLatency, changed, updateInference };
    });
    const { combined, parts, firstUsable, recombined, updateLatency, changed } = value;
    const quality = measureQuality(combined.voxels, reference, scorer(combined.voxels));
    const modelCalls = Object.values(parts).reduce((sum, part) => sum + (part?.modelCalls ?? 0), 0);
    const inferenceMs = Object.values(parts).reduce((sum, part) => sum + (part?.inferenceMs ?? 0), 0);
    return {
      method: "M2-components" as const,
      label: "Component-based reconstruction (sequential)",
      success: true,
      error: null,
      timeToFirstUsableMs: firstUsable,
      timeToFinalMs: sample.wallMs,
      totalInferenceMs: inferenceMs,
      totalGeometryMs: Object.values(parts).reduce((sum, part) => sum + (part?.geometryMs ?? 0), 0),
      totalModelCalls: modelCalls,
      componentsRegenerated: engine.components.length,
      componentsReused: 0,
      cells: quality.cells,
      triangles: quality.triangles,
      exportBytes: quality.exportBytes,
      silhouetteIou: quality.silhouetteIou,
      referenceIou: quality.referenceIou,
      informationLoss: quality.informationLoss,
      updateLatencyMs: updateLatency,
      updateModelCalls: changed.length,
      updateRegeneratedComponents: changed.length,
      updateReusedComponents: engine.components.length - changed.length,
      computeExpenditureMs: sample.cpuUserMs + sample.cpuSystemMs,
      wallMs: sample.wallMs,
      cpuUtilisation: sample.cpuUtilisation,
      peakRssBytes: sample.peakRssBytes,
      notes: [
        `${modelCalls} model calls for ${engine.components.length} parts: a component pipeline pays per part, not per object`,
        `a localised change regenerates ${changed.length} of ${engine.components.length} parts and recombines them into ${voxelCount(recombined.voxels)} cells`,
      ],
    };
  });

  /* ---------------------------------------------------------------- M3 */
  const m3 = await each("M3-incremental", "Incremental reconstruction with accumulated observations", async () => {
    const started = performance.now();
    const { value, sample } = await sampleResources(async () => {
      const base = await engine.wholeObject();
      const firstUsable = performance.now() - started;
      const steps_ = engine.components.slice(0, steps);
      let cells = base.voxels;
      let geometry = 0;
      let updateLatency = 0;
      for (const component of steps_) {
        const t0 = performance.now();
        const refined = await engine.incremental(component);
        updateLatency = performance.now() - t0;
        geometry += refined.geometryMs;
        cells = refined.voxels;
      }
      return { base, firstUsable, cells, geometry, updateLatency, steps: steps_ };
    });
    const { base, firstUsable, cells, geometry, updateLatency, steps: refinedSteps } = value;
    const quality = measureQuality(cells, reference, scorer(cells));
    return {
      method: "M3-incremental" as const,
      label: "Incremental reconstruction with accumulated observations",
      success: true,
      error: null,
      timeToFirstUsableMs: firstUsable,
      timeToFinalMs: sample.wallMs,
      totalInferenceMs: base.inferenceMs,
      totalGeometryMs: base.geometryMs + geometry,
      totalModelCalls: base.modelCalls,
      componentsRegenerated: refinedSteps.length,
      componentsReused: engine.components.length - refinedSteps.length,
      cells: quality.cells,
      triangles: quality.triangles,
      exportBytes: quality.exportBytes,
      silhouetteIou: quality.silhouetteIou,
      referenceIou: quality.referenceIou,
      informationLoss: quality.informationLoss,
      updateLatencyMs: updateLatency,
      updateModelCalls: 0,
      updateRegeneratedComponents: refinedSteps.length,
      updateReusedComponents: engine.components.length - refinedSteps.length,
      computeExpenditureMs: sample.cpuUserMs + sample.cpuSystemMs,
      wallMs: sample.wallMs,
      cpuUtilisation: sample.cpuUtilisation,
      peakRssBytes: sample.peakRssBytes,
      notes: [
        `${refinedSteps.length} numeric refinements after the single base inference; zero additional model calls`,
        "incremental reconstruction cannot beat the cold start: it inherits it, and wins on everything after",
      ],
    };
  });

  /* ---------------------------------------------------------------- M4 */
  const m4 = await each("M4-adaptive-parallel", "Adaptive parallel reconstruction", async () => {
    // Give the scheduler real prices: measure each part's incremental cost.
    const priceStart = performance.now();
    const priceProbe = await engine.incremental(engine.components[0]);
    const unitCost = Math.max(0.5, performance.now() - priceStart);
    void priceProbe;

    const tasks: ScheduledTask[] = engine.components.map((component, index) => {
      const gain = expectedInformationGain({
        meanConfidence: 0.55,
        missingFraction: index < 4 ? 0.3 : 0.1,
        coverage: index < engine.observedComponents.length ? 0.8 : 0.4,
        reconstructionError: 0.2,
      });
      return {
        id: `refine:${component}`,
        label: `Refine ${component}`,
        component,
        dependsOn: [],
        expectedInformationGain: gain.gain,
        costMs: unitCost,
        gainBasis: gain.basis,
        costBasis: `priced from a measured incremental refinement of ${engine.components[0]} (${unitCost.toFixed(1)} ms)`,
      };
    });

    const started = performance.now();
    const { value, sample } = await sampleResources(async () => {
      // Cold start still runs in parallel: component inference is the expensive
      // operator, so this is where concurrency can actually pay.
      const { parts, combined } = await engine.componentWise(engine.components, concurrency);
      const firstUsable = performance.now() - started;
      const schedule = await runSchedule(tasks.slice(0, Math.min(steps, tasks.length)), {
        concurrency,
        runner: (task) => engine.incremental(task.component as ComponentId),
      });
      return { parts, combined, firstUsable, schedule };
    });
    const { parts, combined, firstUsable, schedule } = value;
    const quality = measureQuality(combined.voxels, reference, scorer(combined.voxels));
    const modelCalls = Object.values(parts).reduce((sum, part) => sum + (part?.modelCalls ?? 0), 0);
    return {
      method: "M4-adaptive-parallel" as const,
      label: "Adaptive parallel reconstruction",
      success: true,
      error: null,
      timeToFirstUsableMs: firstUsable,
      timeToFinalMs: sample.wallMs,
      totalInferenceMs: Object.values(parts).reduce((sum, part) => sum + (part?.inferenceMs ?? 0), 0),
      totalGeometryMs: Object.values(parts).reduce((sum, part) => sum + (part?.geometryMs ?? 0), 0),
      totalModelCalls: modelCalls,
      componentsRegenerated: schedule.order.length,
      componentsReused: engine.components.length - schedule.order.length,
      cells: quality.cells,
      triangles: quality.triangles,
      exportBytes: quality.exportBytes,
      silhouetteIou: quality.silhouetteIou,
      referenceIou: quality.referenceIou,
      informationLoss: quality.informationLoss,
      updateLatencyMs: schedule.sample.wallMs,
      updateModelCalls: 0,
      updateRegeneratedComponents: schedule.order.length,
      updateReusedComponents: engine.components.length - schedule.order.length,
      computeExpenditureMs: sample.cpuUserMs + sample.cpuSystemMs,
      wallMs: sample.wallMs,
      cpuUtilisation: sample.cpuUtilisation,
      peakRssBytes: schedule.sample.peakRssBytes ?? sample.peakRssBytes,
      notes: [
        `refinement order: ${schedule.order.join(" → ")}`,
        `waves: ${schedule.waves.map((wave) => `[${wave.join(", ")}]`).join(" ")}; concurrency ${concurrency}`,
        `scheduler CPU utilisation ${schedule.sample.cpuUtilisation.toFixed(2)} (1.0 = one core busy)`,
        ...schedule.errors.map((error) => `schedule error: ${error}`),
      ],
    };
  });

  const methods = [m1, m2, m3, m4];
  const byId = (id: BenchmarkMethodId) => methods.find((m) => m.method === id) as TrialSet;
  const m1s = byId("M1-whole").median;
  const m2s = byId("M2-components").median;
  const m3s = byId("M3-incremental").median;
  const m4s = byId("M4-adaptive-parallel").median;

  const safe = (a: number, b: number): number => (b > 0 ? a / b : 0);
  const incrementalSpeedup = safe(m1s.updateLatencyMs, m3s.updateLatencyMs);
  const componentFirstResultRatio = safe(m2s.timeToFirstUsableMs, m1s.timeToFirstUsableMs);
  const parallelSpeedup = safe(m2s.wallMs, m4s.wallMs);

  const qualityAtSpeed = methods.map((set) => ({ method: set.method, medianWallMs: set.median.wallMs, medianReferenceIou: set.median.referenceIou }));

  const statement =
    `Incremental updates are ${incrementalSpeedup.toFixed(1)}x faster than regenerating the object ` +
    `(${m3s.updateLatencyMs.toFixed(0)} ms vs ${m1s.updateLatencyMs.toFixed(0)} ms) but the cold start is inherited, not saved: ` +
    `M3 first usable ${m3s.timeToFirstUsableMs.toFixed(0)} ms vs M1 ${m1s.timeToFirstUsableMs.toFixed(0)} ms. ` +
    `Component-wise cold start took ${componentFirstResultRatio.toFixed(2)}x the whole-object time with ${engine.components.length} model calls instead of 1. ` +
    `Parallel/sequential wall-clock ratio ${parallelSpeedup.toFixed(2)}x.`;

  return {
    engine: engine.name,
    description: engine.description,
    trialsPerMethod: trials,
    coldStart: options.coldStart ?? true,
    methods,
    comparison: { incrementalUpdateSpeedup: incrementalSpeedup, componentFirstResultRatio, parallelSpeedup, qualityAtSpeed, statement },
    limitations: [
      "Model inference time is measured from the worker's own wall clock and includes process start-up; it is not a GPU benchmark.",
      "Geometry time is single-process JavaScript on the machine that ran the experiment; it is comparable between methods here and nowhere else.",
      "Peak RSS is sampled, not exact; the sampling interval bounds its resolution.",
      "Component reconstruction from a crop asks a whole-object model to see a part, which is a different task from the one it was trained on; lower quality is expected and reported rather than tuned away.",
    ],
  };
}

export { runPool };
export type { ResourceSample };
