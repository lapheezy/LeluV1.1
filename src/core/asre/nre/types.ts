/**
 * ==========================================================
 * LÉLU ASRE — NUMERICAL RECONSTRUCTION ENGINE (NRE): SCHEMA
 *
 * Pure data types. No Node, no DOM: the same module runs in the
 * browser, the Bun server and the test runner.
 *
 * Every cell carries the CLASS of evidence behind it, so what was
 * seen is never confused with what was guessed:
 *
 *   OBSERVED      directly supported by a captured observation
 *                 (e.g. inside a silhouette seen by a camera)
 *   INFERRED      derived from observations by a measurement model
 *                 (e.g. estimated depth, filled interior)
 *   SYNTHESIZED   produced by a generative model with no direct
 *                 observation behind it (e.g. TripoSR's back side)
 *   INTERPOLATED  produced between two snapshots in time
 *
 * Classes are a bitmask: a cell can be OBSERVED by one source and
 * SYNTHESIZED by another; both facts survive.
 * ==========================================================
 */

export const Provenance = {
  OBSERVED: 1,
  INFERRED: 2,
  SYNTHESIZED: 4,
  INTERPOLATED: 8,
} as const;
export type ProvenanceFlag = (typeof Provenance)[keyof typeof Provenance];
export type ProvenanceName = keyof typeof Provenance;

export const PROVENANCE_ORDER: readonly ProvenanceName[] = ["OBSERVED", "INFERRED", "SYNTHESIZED", "INTERPOLATED"];

/** Strongest class present in a mask (OBSERVED beats INFERRED beats SYNTHESIZED beats INTERPOLATED). */
export function primaryProvenance(mask: number): ProvenanceName | null {
  for (const name of PROVENANCE_ORDER) if (mask & Provenance[name]) return name;
  return null;
}

export function provenanceNames(mask: number): ProvenanceName[] {
  return PROVENANCE_ORDER.filter((name) => (mask & Provenance[name]) !== 0);
}

export type Vec3 = [number, number, number];

/** Axis convention of the coordinates a grid's world positions are expressed in. */
export type CoordinateSystem = "y-up-right-handed" | "z-up-right-handed";

/**
 * Where a grid lives in the world. Cell (i,j,k) covers
 * [origin + i*resolution, origin + (i+1)*resolution) on each axis.
 */
export interface GridSpec {
  /** Edge length of one cell, in metres. */
  resolution: number;
  /** World position of cell (0,0,0)'s minimum corner, in metres. */
  origin: Vec3;
  /** Cells per axis. Each must be ≤ 65536 (16-bit Morton axis). */
  dims: Vec3;
  coordinateSystem: CoordinateSystem;
}

export type Modality =
  | "rgb-image"
  | "rgba-image"
  | "silhouette"
  | "depth-map"
  | "mesh"
  | "voxel-grid"
  | "generative-model"
  | "procedural"
  | "interpolation";

/** One captured or produced piece of evidence. Immutable once recorded. */
export interface Observation {
  /** Unique id (stable across serialization). */
  id: string;
  /** Capture/production time, epoch milliseconds. */
  capturedAt: number;
  /** What produced it: a camera, a file, a model ("triposr@107cefd"), a procedure. */
  source: string;
  modality: Modality;
  /** Class of evidence every cell contributed by this observation carries. */
  provenance: ProvenanceName;
  /** Prior confidence (0..1] each contributed cell starts from. */
  confidence: number;
  /** Parameters of the reconstruction that turned the source into cells. */
  parameters: Record<string, string | number | boolean>;
  /**
   * Content fingerprint (hex SHA-256 of the evidence). Two observations with
   * the same fingerprint are the SAME evidence and are never fused twice.
   */
  fingerprint: string;
  /** Free-form provenance chain (file paths, upstream ids, licences). */
  lineage: string[];
}

/** Per-cell evidence: which observation said "occupied", and how strongly. */
export interface CellEvidence {
  /** Index into the grid's observation table. */
  obs: number;
  /** Probability this observation assigns to "occupied". */
  p: number;
}

export interface Cell {
  /** Fused occupancy confidence (noisy-OR over independent evidence). */
  confidence: number;
  /** Bitmask of Provenance flags. */
  provenance: number;
  evidence: CellEvidence[];
}

export interface Aabb {
  min: Vec3;
  max: Vec3;
}
