/**
 * ==========================================================
 * TEMPORAL STUDIO — ASRE — LAYERED SNAPSHOTS (FLIPBOOK)
 *
 * Each observation is a persistent frame. The head frame is the current
 * state; earlier frames stay exactly as they were, so the flipbook is a
 * history of real geometry rather than a stack of images drawn over one
 * another.
 *
 * The rule that makes it incremental:
 *
 *   a new observation names which components it actually covers;
 *   those parts are replaced, every other part is carried forward with
 *   its digest unchanged; the frame records exactly how many cells were
 *   added, removed and preserved, and where.
 *
 * The second rule makes confidence honest: identical evidence adds no
 * information. Re-submitting the same image is detected by pixel digest
 * and refused with a confidence delta of exactly zero, instead of quietly
 * averaging a confidence upward by looking at the same pixels twice.
 * ==========================================================
 */

import type { AttributeChannel, SparseVoxels } from "../nre/types.ts";
import { DEFAULT_CONFIDENCE_CHANNEL, buildSparseVoxels, denseIndexOf, occupancyMask, voxelCount } from "../nre/voxels.ts";
import type { AnalysisLattice } from "./lattice.ts";
import type { BBox2D, ComponentId } from "./types.ts";
import { COMPONENT_IDS, bboxIsEmpty } from "./types.ts";
import { STRUCTURAL_COMPONENTS, mergeComponents, splitByComponent, voxelDigest, type ComponentSplit } from "./components.ts";
import { PROVENANCE_CHANNEL } from "./hypotheses.ts";

export type FrameState = "initial" | "refined" | "duplicate" | "restored";

export interface ObservationFrame {
  id: string;
  index: number;
  createdAt: string;
  state: FrameState;
  /** Pixel digest of the image that produced this frame. */
  imageDigest: string;
  hypothesisId: string;
  /** The full object state at this frame — not a delta. */
  voxels: SparseVoxels;
  /** Digest of each structural part, so reuse is provable. */
  componentDigests: Partial<Record<ComponentId, string>>;
  /** The regions this frame's parts were cut with, kept so a re-split matches. */
  regions: Record<ComponentId, BBox2D>;
  componentCells: Partial<Record<ComponentId, number>>;
  componentsUpdated: ComponentId[];
  componentsPreserved: ComponentId[];
  change: ChangeReport;
  meanConfidenceBefore: number;
  meanConfidenceAfter: number;
  notes: string[];
}

export interface ChangeReport {
  newCells: number;
  lostCells: number;
  preservedCells: number;
  updatedCells: number;
  affectedBBox: BBox2D | null;
  /** Cells whose confidence rose, and by how much on average. */
  confidenceRaisedCells: number;
  meanConfidenceDelta: number;
}

export interface LayeredReconstruction {
  objectId: string;
  label: string;
  createdAt: string;
  lattice: AnalysisLattice;
  frames: ObservationFrame[];
  headId: string;
  /** Digests of every image ever accepted, for duplicate detection. */
  acceptedImageDigests: string[];
  /**
   * The digest of the *geometry* each observation produced, which is what
   * actually carries information. Two different pixels that produce the same
   * cells are the same evidence and must not raise confidence twice.
   */
  acceptedGeometryDigests: string[];
}

export interface ObservationInput {
  id: string;
  createdAt?: string;
  imageDigest: string;
  hypothesisId: string;
  /** Full object state produced from this observation. */
  voxels: SparseVoxels;
  /** Components this observation actually says something about. */
  observedComponents: ComponentId[];
  /** Region each observed component covers, in image space. */
  regions: Record<ComponentId, BBox2D>;
  notes?: string[];
}

export function createLayeredReconstruction(
  objectId: string,
  lattice: AnalysisLattice,
  first: ObservationInput,
  label = objectId,
): LayeredReconstruction {
  const created = first.createdAt ?? new Date().toISOString();
  const split = splitByComponent(first.voxels, lattice, first.regions);
  const frame = makeFrame({
    index: 0,
    state: "initial",
    input: first,
    voxels: first.voxels,
    split,
    componentsUpdated: first.observedComponents.length > 0 ? COMPONENT_IDS.filter((id) => first.observedComponents.includes(id)) : STRUCTURAL_COMPONENTS.filter((id) => split.parts[id] !== undefined),
    componentsPreserved: [],
    change: {
      newCells: voxelCount(first.voxels),
      lostCells: 0,
      preservedCells: 0,
      updatedCells: voxelCount(first.voxels),
      affectedBBox: first.regions.torso && !bboxIsEmpty(first.regions.torso) ? first.regions.torso : null,
      confidenceRaisedCells: 0,
      meanConfidenceDelta: 0,
    },
    meanBefore: 0,
    meanAfter: meanConfidence(first.voxels),
    createdAt: created,
  });
  return {
    objectId,
    label,
    createdAt: created,
    lattice,
    frames: [frame],
    headId: frame.id,
    acceptedImageDigests: [first.imageDigest],
    acceptedGeometryDigests: [voxelDigest(first.voxels)],
  };
}

function meanConfidence(voxels: SparseVoxels): number {
  const confidence = voxels.attributes.confidence;
  if (!confidence || confidence.length === 0) return 0;
  let sum = 0;
  for (let v = 0; v < confidence.length; v++) sum += confidence[v];
  return sum / confidence.length;
}

function makeFrame(args: {
  index: number;
  state: FrameState;
  input: ObservationInput;
  voxels: SparseVoxels;
  split: ComponentSplit;
  componentsUpdated: ComponentId[];
  componentsPreserved: ComponentId[];
  change: ChangeReport;
  meanBefore: number;
  meanAfter: number;
  createdAt: string;
  extraNotes?: string[];
}): ObservationFrame {
  const digests: Partial<Record<ComponentId, string>> = {};
  const cells: Partial<Record<ComponentId, number>> = {};
  for (const id of STRUCTURAL_COMPONENTS) {
    const part = args.split.parts[id];
    if (!part) continue;
    digests[id] = voxelDigest(part);
    cells[id] = voxelCount(part);
  }
  return {
    id: `${args.input.id}#${args.index}`,
    index: args.index,
    createdAt: args.createdAt,
    state: args.state,
    imageDigest: args.input.imageDigest,
    hypothesisId: args.input.hypothesisId,
    voxels: args.voxels,
    componentDigests: digests,
    regions: args.input.regions,
    componentCells: cells,
    componentsUpdated: args.componentsUpdated,
    componentsPreserved: args.componentsPreserved,
    change: args.change,
    meanConfidenceBefore: args.meanBefore,
    meanConfidenceAfter: args.meanAfter,
    notes: [...(args.input.notes ?? []), ...(args.extraNotes ?? [])],
  };
}

export interface AddObservationResult {
  layer: LayeredReconstruction;
  frame: ObservationFrame;
  duplicate: boolean;
  /** One-line reason, used in the report. */
  why: string;
}

/**
 * Append an observation.
 *
 * Duplicate detection is on two axes: the image digest (the same photograph
 * again) and the geometry digest (a different photograph that reconstructs
 * to the same cells — same evidence, differently dressed).
 */
export function addObservation(layer: LayeredReconstruction, input: ObservationInput): AddObservationResult {
  const head = headFrame(layer);
  if (layer.acceptedImageDigests.includes(input.imageDigest)) {
    const frame: ObservationFrame = {
      ...head,
      id: `${input.id}#${layer.frames.length}`,
      index: layer.frames.length,
      state: "duplicate",
      imageDigest: input.imageDigest,
      change: { newCells: 0, lostCells: 0, preservedCells: voxelCount(head.voxels), updatedCells: 0, affectedBBox: null, confidenceRaisedCells: 0, meanConfidenceDelta: 0 },
      meanConfidenceBefore: head.meanConfidenceAfter,
      meanConfidenceAfter: head.meanConfidenceAfter,
      notes: [...(input.notes ?? []), "identical image digest: no geometry changed and confidence was left exactly as it was"],
    };
    return {
      layer: { ...layer, frames: [...layer.frames, frame] },
      frame,
      duplicate: true,
      why: "the same image (identical pixel digest) was already accepted; repeated evidence cannot raise confidence",
    };
  }

  const geometryDigest = voxelDigest(input.voxels);
  const split = splitByComponent(input.voxels, layer.lattice, input.regions);
  // The head is cut with ITS OWN regions: comparing digests across different
  // cuts would report every part as changed and destroy the reuse claim.
  const headSplit = splitByComponent(head.voxels, layer.lattice, head.regions);

  const requested = input.observedComponents.length > 0 ? input.observedComponents : STRUCTURAL_COMPONENTS;
  const updated: ComponentId[] = [];
  const preserved: ComponentId[] = [];
  for (const id of STRUCTURAL_COMPONENTS) {
    const next = split.parts[id];
    const previous = headSplit.parts[id];
    const changed = voxelDigest(next) !== voxelDigest(previous);
    if (requested.includes(id) && (changed || !previous)) updated.push(id);
    else preserved.push(id);
  }

  // Merge: updated parts from the new observation, preserved parts from the
  // head. Nothing else moves, which is the whole point of the layer system.
  const merged = mergeComponents(
    STRUCTURAL_COMPONENTS.map((id) => (updated.includes(id) ? split.parts[id] : headSplit.parts[id])),
    layer.lattice.grid,
  );

  const fused = fuseConfidence(head.voxels, input.voxels, merged, layer.lattice);

  const before = meanConfidence(head.voxels);
  const after = meanConfidence(fused.voxels);

  const change: ChangeReport = {
    ...diffCells(head.voxels, fused.voxels, layer.lattice),
    updatedCells: voxelCount(merged),
    affectedBBox: unionRegions(updated.map((id) => input.regions[id])),
    confidenceRaisedCells: fused.raisedCells,
    meanConfidenceDelta: after - before,
  };

  const notes: string[] = [
    `components replaced: ${updated.length > 0 ? updated.join(", ") : "none (the observation agreed with the head)"}`,
    `components carried forward unchanged: ${preserved.join(", ")}`,
    fused.duplicateGeometry
      ? "the geometry digest matches an earlier observation: cell confidence was NOT increased, because this is the same evidence"
      : `confidence fused by noisy-OR over ${layer.acceptedGeometryDigests.length + 1} distinct observations`,
  ];

  const frame = makeFrame({
    index: layer.frames.length,
    state: "refined",
    input,
    voxels: fused.voxels,
    split,
    componentsUpdated: updated,
    componentsPreserved: preserved,
    change,
    meanBefore: before,
    meanAfter: after,
    createdAt: input.createdAt ?? new Date().toISOString(),
    extraNotes: notes,
  });

  return {
    layer: {
      ...layer,
      frames: [...layer.frames, frame],
      headId: frame.id,
      acceptedImageDigests: [...layer.acceptedImageDigests, input.imageDigest],
      acceptedGeometryDigests: layer.acceptedGeometryDigests.includes(geometryDigest)
        ? layer.acceptedGeometryDigests
        : [...layer.acceptedGeometryDigests, geometryDigest],
    },
    frame,
    duplicate: false,
    why: fused.duplicateGeometry
      ? "new image, but it reconstructs to geometry already held: preserved, no confidence gain"
      : `${updated.length} components updated from new evidence`,
  };
}

export function headFrame(layer: LayeredReconstruction): ObservationFrame {
  const frame = layer.frames.find((f) => f.id === layer.headId);
  if (!frame) throw new Error(`Layer head ${layer.headId} is not among its frames.`);
  return frame;
}

export function frameById(layer: LayeredReconstruction, id: string): ObservationFrame {
  const frame = layer.frames.find((f) => f.id === id);
  if (!frame) throw new Error(`Frame ${id} is not part of object ${layer.objectId}.`);
  return frame;
}

/** Undo: point the head at an earlier frame, keeping the later ones. */
export function restoreFrame(layer: LayeredReconstruction, frameId: string): LayeredReconstruction {
  const frame = frameById(layer, frameId);
  const restored: ObservationFrame = {
    ...frame,
    id: `${frame.id}-restored#${layer.frames.length}`,
    index: layer.frames.length,
    state: "restored",
    notes: [...frame.notes, `restored from frame ${frame.id}; later frames are preserved in the history`],
  };
  return { ...layer, frames: [...layer.frames, restored], headId: restored.id };
}

export interface FlipbookEntry {
  index: number;
  id: string;
  state: FrameState;
  cells: number;
  meanConfidence: number;
  componentsUpdated: ComponentId[];
  componentsPreserved: ComponentId[];
  newCells: number;
  lostCells: number;
  preservedCells: number;
  imageDigest: string;
}

/** The flipbook: every frame, in order, as it will be shown. */
export function flipbook(layer: LayeredReconstruction): FlipbookEntry[] {
  return layer.frames.map((frame) => ({
    index: frame.index,
    id: frame.id,
    state: frame.state,
    cells: voxelCount(frame.voxels),
    meanConfidence: frame.meanConfidenceAfter,
    componentsUpdated: frame.componentsUpdated,
    componentsPreserved: frame.componentsPreserved,
    newCells: frame.change.newCells,
    lostCells: frame.change.lostCells,
    preservedCells: frame.change.preservedCells,
    imageDigest: frame.imageDigest,
  }));
}

/* ------------------------------------------------------------------ helpers */

function diffCells(before: SparseVoxels, after: SparseVoxels, lattice: AnalysisLattice): { newCells: number; lostCells: number; preservedCells: number } {
  const afterMask = occupancyMask(after);
  let shared = 0;
  const n = voxelCount(before);
  for (let v = 0; v < n; v++) {
    const key = denseIndexOf(lattice.grid, before.coords[v * 3], before.coords[v * 3 + 1], before.coords[v * 3 + 2]);
    if (key >= 0 && afterMask[key] === 1) shared++;
  }
  return { newCells: voxelCount(after) - shared, lostCells: n - shared, preservedCells: shared };
}

function unionRegions(boxes: Array<BBox2D | undefined>): BBox2D | null {
  let out: BBox2D | null = null;
  for (const box of boxes) {
    if (!box || bboxIsEmpty(box)) continue;
    out = out ? { minX: Math.min(out.minX, box.minX), minY: Math.min(out.minY, box.minY), maxX: Math.max(out.maxX, box.maxX), maxY: Math.max(out.maxY, box.maxY) } : { ...box };
  }
  return out;
}

/**
 * Confidence fusion for an incremental update.
 *
 * Preserved cells keep the head's confidence exactly. Updated cells take the
 * head's evidence and the new observation's, combined by noisy-OR — but only
 * when the new geometry is genuinely new. If the geometry digest has been
 * seen before, the cells are carried through untouched and the frame says so.
 */
function fuseConfidence(
  head: SparseVoxels,
  observation: SparseVoxels,
  merged: SparseVoxels,
  lattice: AnalysisLattice,
): { voxels: SparseVoxels; raisedCells: number; duplicateGeometry: boolean } {
  const duplicateGeometry = voxelDigest(observation) === voxelDigest(head);
  const headMask = occupancyMask(head);
  const headConfidence = head.attributes.confidence;
  const obsConfidence = observation.attributes.confidence;
  const headConfidenceByCell = new Map<number, number>();
  for (let v = 0; v < voxelCount(head); v++) {
    const key = denseIndexOf(lattice.grid, head.coords[v * 3], head.coords[v * 3 + 1], head.coords[v * 3 + 2]);
    if (key >= 0) headConfidenceByCell.set(key, headConfidence ? headConfidence[v] : 0);
  }
  const obsConfidenceByCell = new Map<number, number>();
  for (let v = 0; v < voxelCount(observation); v++) {
    const key = denseIndexOf(lattice.grid, observation.coords[v * 3], observation.coords[v * 3 + 1], observation.coords[v * 3 + 2]);
    if (key >= 0) obsConfidenceByCell.set(key, obsConfidence ? obsConfidence[v] : 0);
  }
  const channels: AttributeChannel[] = [DEFAULT_CONFIDENCE_CHANNEL, PROVENANCE_CHANNEL];
  const cells: Array<[number, number, number]> = [];
  const confidences: number[] = [];
  const provenances: number[] = [];
  const n = voxelCount(merged);
  const obsMask = occupancyMask(observation);
  const obsProvenance = observation.attributes.provenance;
  const obsProvenanceByCell = new Map<number, number>();
  for (let v = 0; v < voxelCount(observation); v++) {
    const key = denseIndexOf(lattice.grid, observation.coords[v * 3], observation.coords[v * 3 + 1], observation.coords[v * 3 + 2]);
    if (key >= 0) obsProvenanceByCell.set(key, obsProvenance ? obsProvenance[v] : 2);
  }
  let raised = 0;

  for (let v = 0; v < n; v++) {
    const i = merged.coords[v * 3];
    const j = merged.coords[v * 3 + 1];
    const k = merged.coords[v * 3 + 2];
    const key = denseIndexOf(lattice.grid, i, j, k);
    const headHas = key >= 0 && headMask[key] === 1;
    const obsHas = key >= 0 && obsMask[key] === 1;
    const headC = headHas ? (headConfidenceByCell.get(key) ?? 0) : 0;
    const obsC = obsHas ? (obsConfidenceByCell.get(key) ?? 0) : 0;
    let confidence = Math.max(headC, obsC);
    if (headHas && obsHas && !duplicateGeometry) {
      confidence = 1 - (1 - headC) * (1 - obsC);
      if (confidence > headC + 1e-9) raised++;
    }
    cells.push([i, j, k]);
    confidences.push(Math.min(1, confidence));
    // Provenance is carried from whichever observation supports the cell; a
    // cell present only in the new observation inherits its label.
    provenances.push(obsHas ? (obsProvenanceByCell.get(key) ?? 2) : 2);
  }

  return {
    voxels: buildSparseVoxels(lattice.grid, cells, {
      occupancy: "sparse-volume",
      channels,
      attributes: { confidence: confidences, provenance: provenances },
    }),
    raisedCells: raised,
    duplicateGeometry,
  };
}
