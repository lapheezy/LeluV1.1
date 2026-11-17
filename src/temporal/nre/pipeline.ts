/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE — RECONSTRUCTION PIPELINE CONTRACT
 *
 * Experiment A's five hops, as explicit stages:
 *
 *   image → image analysis → numerical representation →
 *   spatial reconstruction → 3D geometry
 *
 * Only the middle and the end are engine work. Image analysis and 3D
 * generation belong to whichever model the registry routes to, and the
 * registry is where the licence and hardware facts live — including the
 * fact that a machine with no GPU, no Torch and no checkpoint cannot run
 * the step at all. The plan below says so in a `status`, before any work
 * is attempted, so nothing can report success it did not achieve.
 *
 * This module is pure and dependency-free. The process that actually
 * spawns a Python worker lives in scripts/temporal/, because spawning
 * has no business inside the engine or the browser bundle.
 * ==========================================================
 */

import type { AttributeChannel, ExperimentStatus, Observation, SpatialGrid, SparseVoxels } from "./types.ts";
import { capabilityById, selectForTask, needsNoAccount, isCommercialEligible, type CapabilityTask, type ModelCapability } from "../registry/modelCapability.ts";
import { voxelizeMesh, type TriangleMesh } from "./geometry.ts";
import { withConfidence } from "./voxels.ts";

export type PipelineStageId = "image-input" | "image-analysis" | "numerical-representation" | "spatial-reconstruction" | "geometry-export";

export interface PipelineStage {
  id: PipelineStageId;
  label: string;
  status: ExperimentStatus;
  /** What was actually established, in words, never a claim without evidence. */
  detail: string;
  ms: number | null;
}

export interface SingleImagePlanRequest {
  /** sha256 of the image bytes — the provenance anchor. */
  imageSha256: string;
  imageBytes: number | null;
  grid: SpatialGrid;
  /** Override the model; must still be licence- and hardware-eligible. */
  modelId?: string;
  /** Force CPU-only routing (this environment has no CUDA). */
  cpuOnly: boolean;
  availableVramGb: number;
  /** True when Torch and the checkpoint are present and importable. */
  modelAvailable?: boolean;
}

export interface SingleImagePlan {
  model: ModelCapability | null;
  candidates: ModelCapability[];
  stages: PipelineStage[];
  /** Machine-readable reasons the pipeline cannot proceed. */
  blockers: string[];
  /** Worker command an operator would run once the blockers are gone. */
  worker: { interpreter: string; script: string; argv: string[] } | null;
  /** Honest headline status for the whole experiment. */
  status: ExperimentStatus;
}

/**
 * Plan a single-image reconstruction from the registry, without running
 * anything. `status` is PARTIAL when the interface is ready but the
 * worker cannot run, BLOCKED when no eligible model fits the hardware.
 */
export function planSingleImageReconstruction(request: SingleImagePlanRequest): SingleImagePlan {
  const candidates = request.modelId
    ? [capabilityById(request.modelId)].filter((m): m is ModelCapability => Boolean(m))
    : selectForTask("image-to-3d", {
        availableVramGb: request.availableVramGb,
        cpuOnly: request.cpuOnly,
        commercial: true,
      });

  const blockers: string[] = [];
  const chosen = candidates[0] ?? null;
  if (!chosen) {
    blockers.push(
      `No commercial-eligible image-to-3d model fits ${request.cpuOnly ? "a CPU-only worker" : `${request.availableVramGb} GB of VRAM`}.`,
    );
  } else {
    if (!needsNoAccount(chosen)) blockers.push(`${chosen.displayName} requires an account or approval; the core workflow may not depend on one.`);
    if (!isCommercialEligible(chosen)) {
      blockers.push(`${chosen.displayName} is not commercial-eligible under the verified licences (${chosen.codeLicence.id} / ${chosen.weightsLicence.id}).`);
    }
    if (request.cpuOnly && chosen.runsOnCpu === false) {
      blockers.push(`${chosen.displayName} has no CPU path; this worker has no CUDA device.`);
    }
    if (request.modelAvailable !== true) {
      blockers.push(
        `The ${chosen.displayName} worker is not installed on this machine (Torch and the checkpoint are absent), so no reconstruction can be attempted here.`,
      );
    }
  }

  const stage = (id: PipelineStageId, label: string, status: ExperimentStatus, detail: string): PipelineStage => ({ id, label, status, detail, ms: null });
  const stages: PipelineStage[] = [
    stage(
      "image-input",
      "Image input",
      request.imageSha256 ? "VERIFIED" : "BLOCKED",
      request.imageSha256
        ? `image bytes hashed (sha256 ${request.imageSha256.slice(0, 16)}…${request.imageBytes ? `, ${request.imageBytes} bytes` : ""})`
        : "no image bytes were supplied or hashed",
    ),
    stage(
      "image-analysis",
      "Image analysis",
      chosen && request.modelAvailable === true ? "VERIFIED" : chosen ? "BLOCKED" : "BLOCKED",
      chosen
        ? request.modelAvailable === true
          ? `handled by the ${chosen.displayName} worker`
          : `requires the ${chosen.displayName} worker, which is not installed here`
        : "no eligible model",
    ),
    stage(
      "numerical-representation",
      "Numerical representation",
      "VERIFIED",
      "NRE sparse lattice available: voxelisation, Morton ordering, serialisation and checksums are implemented and measured (see Experiment B).",
    ),
    stage(
      "spatial-reconstruction",
      "Spatial reconstruction",
      chosen && request.modelAvailable === true ? "PARTIAL" : "BLOCKED",
      chosen && request.modelAvailable === true
        ? "the worker can run, but nothing has been reconstructed yet in this process"
        : "depends on the image-analysis stage",
    ),
    stage(
      "geometry-export",
      "3D geometry export",
      "VERIFIED",
      "GLB writer and GlbInspector gate are implemented; output is validated before it is offered (see Experiment B).",
    ),
  ];

  const status: ExperimentStatus =
    chosen && request.modelAvailable === true ? "PARTIAL" : blockers.length > 0 ? "BLOCKED" : "BLOCKED";

  return {
    model: chosen,
    candidates,
    stages,
    blockers,
    worker: chosen
      ? {
          interpreter: "python3",
          script: "scripts/foundry/triposr_to_glb.py",
          argv: ["--image", "<path>", "--out", "<path>.glb", "--mc-resolution", "256", "--grid-size", "0.5"],
        }
      : null,
    status,
  };
}

/**
 * The last hop every reconstruction model shares: a triangle mesh in
 * world space becomes an NRE numerical representation.
 *
 * Confidence is the model's own trust in the output, clamped and passed
 * in explicitly — a model that cannot state a confidence contributes
 * 0.5 and says so in the observation notes, rather than defaulting to 1.
 */
export function numericalFromGeometry(
  geometry: TriangleMesh,
  grid: SpatialGrid,
  options: { confidence: number; channels?: AttributeChannel[]; samplesPerCell?: number } ,
): SparseVoxels {
  const voxels = voxelizeMesh(geometry, grid, { samplesPerCell: options.samplesPerCell ?? 2 });
  const clamped = Math.min(1, Math.max(0, options.confidence));
  return withConfidence(voxels, clamped);
}

export interface ObservationInput {
  id: string;
  sequence?: number;
  sourceId: string;
  sourceKind: Observation["sourceKind"];
  modality: string;
  capturedAt: string;
  confidence: number;
  producer: string;
  producerKind: Observation["provenance"]["producerKind"];
  licence: string | null;
  inputs: Array<{ id: string; sha256: string | null; note?: string }>;
  parameters?: Record<string, string | number | boolean>;
  notes?: string[];
  bbox?: Observation["bbox"];
}

/**
 * Build an observation record. Confidence must be stated by the caller:
 * there is no default, because "we forgot to say" must not serialise as
 * "we are confident".
 */
export function makeObservation(input: ObservationInput, now: string = new Date().toISOString()): Observation {
  if (!(input.confidence >= 0 && input.confidence <= 1)) {
    throw new Error(`Observation confidence ${input.confidence} is outside [0,1]; it must be measured, not assumed.`);
  }
  return {
    id: input.id,
    sequence: input.sequence ?? 0,
    sourceId: input.sourceId,
    sourceKind: input.sourceKind,
    modality: input.modality,
    capturedAt: input.capturedAt,
    recordedAt: now,
    confidence: input.confidence,
    provenance: {
      producer: input.producer,
      producerKind: input.producerKind,
      licence: input.licence,
      inputs: input.inputs,
      parameters: input.parameters ?? {},
      notes: input.notes ?? [],
    },
    representationSha256: null,
    bbox: input.bbox ?? null,
  };
}

/** Which registry entries could serve a task, for the report. */
export function eligibleFor(task: CapabilityTask): ModelCapability[] {
  return selectForTask(task, { availableVramGb: 0, cpuOnly: true, commercial: true });
}
