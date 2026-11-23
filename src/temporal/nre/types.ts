/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE (NUMERICAL RECONSTRUCTION ENGINE)
 * VERSIONED NUMERICAL SCHEMA
 *
 * Everything the engine remembers about a reconstruction is described
 * here, once: where voxels sit in space, which observation produced
 * them, how confident that observation was, who produced it and from
 * what inputs, and how each snapshot relates to the one before it.
 *
 * Three rules shape the schema:
 *
 *   1. Nothing is inferred that was not observed. Optional fields are
 *      `null` rather than plausible defaults, so "unknown" and "zero"
 *      never look the same in a stored file.
 *   2. A snapshot is atomic. It carries its own grid, attributes,
 *      observations and lineage, so any single snapshot can be
 *      recovered from its own bytes without reading any other file.
 *   3. Versioned in the container, not in the payload. The schema
 *      version lives in the .vxz header so an unknown version is
 *      rejected before a single byte of payload is interpreted.
 *
 * Dependency-free: importable by a browser inspector, a Node CLI
 * worker, or a test, with no framework attached.
 * ==========================================================
 */

/**
 * Container schema version written by this build.
 *
 *   0 — O-Voxel's own native .vxz (no NRE fields). Read-only, migrated
 *       on load to version 1 semantics.
 *   1 — NRE v1: sparse voxel payload, observations, confidence, lineage.
 *
 * A reader accepts any version in SUPPORTED_INPUT_VERSIONS and rejects
 * everything else with NreVersionError; it never guesses.
 */
export const NRE_SCHEMA_VERSION = 1 as const;
export const SUPPORTED_INPUT_VERSIONS: readonly number[] = [0, 1];

/** Container framings. O-Voxel documented the layout; NRE reuses it. */
export const VXZ_MAGIC = "VXZ";
export const VXZ_VERSION_BYTE = NRE_SCHEMA_VERSION;
export const VXZ_CHUNK_VOXELS = 256;

/** Morton packing is 21 bits per axis: 2^21 = 2,097,152 cells per axis. */
export const MORTON_BITS_PER_AXIS = 21;
export const MORTON_MAX_AXIS = 2 ** MORTON_BITS_PER_AXIS;

export type Vec3 = [number, number, number];
export type Axis = "x" | "y" | "z";
export type Handedness = "right" | "left";
export type LengthUnit = "metre" | "centimetre" | "millimetre" | "unitless";

/**
 * The frame a reconstruction lives in. Stored explicitly because two
 * numerically identical voxel sets in different frames are different
 * objects, and a silent frame swap is indistinguishable from a
 * rotation once the geometry is meshed.
 */
export interface CoordinateSystem {
  /** Stable identifier, e.g. "lelu-world-y-up" or "blender-z-up". */
  id: string;
  up: Axis;
  forward: Axis;
  hand: Handedness;
  units: LengthUnit;
}

export interface BoundingVolume {
  min: Vec3;
  max: Vec3;
}

/**
 * The addressable lattice. `resolution` is the number of cells per axis;
 * cell coordinates are integer indices in [0, resolution). World space is
 * origin + (index + 0.5) * cellSize, so the grid is a half-open box and
 * every cell centre is unambiguous.
 */
export interface SpatialGrid {
  origin: Vec3;
  /** Edge length of one cell in `units`. Preserved exactly as a float64. */
  cellSize: number;
  /** Integer cell counts per axis. */
  resolution: Vec3;
  coordinateSystem: CoordinateSystem;
}

/** Storage width of an attribute channel. */
export type AttributeKind = "f32" | "f64" | "u8" | "u16" | "i32";

/**
 * Quantisation actually applied when a value was written. Present only
 * when narrowing happened, and it states the bound rather than a
 * reassurance: the engine reports loss, it never hides it.
 */
export interface Quantisation {
  /** Wide type the value had before storage. */
  source: AttributeKind;
  /** Stored value = clamp(round((source - offset) / scale)) for integers. */
  scale: number;
  offset: number;
  /** Worst-case absolute error implied by the narrowing. */
  maxAbsoluteError: number;
  note: string;
}

export interface AttributeChannel {
  /** "confidence" | "density" | "curvature" | "red"… Free-form but recorded. */
  name: string;
  kind: AttributeKind;
  /** 1..4 components per voxel. */
  components: number;
  quantisation: Quantisation | null;
  /** Per-component meaning, e.g. ["r","g","b"] or ["confidence"]. */
  componentsMeaning: string[];
}

/** How an observation came to exist. */
export type SourceKind = "image" | "multiview" | "mesh" | "scan" | "synthetic" | "derived";

export type ProducerKind = "model" | "tool" | "fixture" | "human";

export interface ProvenanceInput {
  /** What the input was, e.g. "reference:A-pose-front.png". */
  id: string;
  /** sha256 of the bytes, when the producer had the bytes. */
  sha256: string | null;
  note?: string;
}

/**
 * Who made this numerical representation, from what, with which
 * parameters, under which licence. Reproduced verbatim on every export
 * so a geometry can never drift away from the evidence behind it.
 */
export interface ObservationProvenance {
  /** e.g. "triposr@0.1.0", "nre.experiment-b", "mesh-voxelizer@1". */
  producer: string;
  producerKind: ProducerKind;
  /** Licence of the producer's code AND weights, as verified. */
  licence: string | null;
  inputs: ProvenanceInput[];
  /** Parameters that affect the numbers. Stable key order when serialised. */
  parameters: Record<string, string | number | boolean>;
  notes: string[];
}

export interface Observation {
  id: string;
  /** Monotonic within a temporal object; 0 for a standalone snapshot. */
  sequence: number;
  /** Identity of the thing observed, so two looks are never merged blindly. */
  sourceId: string;
  sourceKind: SourceKind;
  /** What modality was captured, e.g. "single-image", "reference-mesh". */
  modality: string;
  /** When the capture happened (ISO 8601). */
  capturedAt: string;
  /** When the engine recorded it (ISO 8601) — may be later than the capture. */
  recordedAt: string;
  /** 0..1. 0 means "produced but untrusted", never "unknown". */
  confidence: number;
  provenance: ObservationProvenance;
  /** sha256 of the numerical payload this observation produced. */
  representationSha256: string | null;
  /** Observed extent in world space, when the producer reported one. */
  bbox: BoundingVolume | null;
}

/**
 * What a snapshot IS:
 *   observed     — measured from at least one observation, unmodified.
 *   accumulated  — evidence fusion of two or more observed snapshots.
 *   interpolated — synthesised between two snapshots. Never ground truth.
 */
export type SnapshotState = "observed" | "accumulated" | "interpolated";

export interface TransformRecord {
  id: string;
  kind: "identity" | "rigid" | "affine";
  /** Column-major 4x4, as glTF stores matrices. */
  matrix: number[];
  note: string;
}

export interface SnapshotLineage {
  /** Stable identity of the observed object across snapshots. */
  objectId: string;
  /** null for the first snapshot of the object. */
  parentSnapshotId: string | null;
  /** Evidence this snapshot was fused/synthesised from (empty when observed). */
  sourceSnapshotIds: string[];
  /** 0-based position in the object's history. */
  ordinal: number;
}

export interface SnapshotManifest {
  id: string;
  state: SnapshotState;
  createdAt: string;
  observedAt: string | null;
  /** Aggregate confidence of the snapshot; 1 - Π(1 - c_i) over its evidence. */
  confidence: number;
  lineage: SnapshotLineage;
  transform: TransformRecord;
  observations: Observation[];
  /** Number of occupied cells. */
  voxelCount: number;
  /** Occupied extent in world space. */
  bbox: BoundingVolume;
  /** Where the representation came from, in one line, for humans. */
  summary: string;
}

/** Everything the container needs to describe one snapshot. */
export interface NreContainerManifest {
  format: "nre-vxz";
  schemaVersion: number;
  /** Content id of this snapshot: "nre-" + first 16 hex of the payload digest. */
  id: string;
  createdAt: string;
  chunkSize: number;
  /** Morton ordering is mandatory and verified on read. */
  mortonOrder: true;
  occupancy: "sparse-surface" | "sparse-volume";
  grid: SpatialGrid;
  attributes: AttributeChannel[];
  voxelCount: number;
  chunkCount: number;
  snapshot: SnapshotManifest;
  /** Bytes of the binary payload (compressed, as stored). */
  payloadBytes: number;
  /** Raw bytes before compression. */
  payloadRawBytes: number;
  codec: string;
  payloadSha256: string;
  /**
   * Digest of the payload BEFORE compression. Snapshot identity is taken
   * from this, so the same numbers serialised with a different codec keep
   * one identity while the container digest changes with the bytes.
   */
  payloadRawSha256: string;
  /** sha256 over the canonical manifest with this field emptied. */
  metadataSha256: string;
}

/** A loaded snapshot: manifest + the voxel set it describes. */
export interface NreSnapshot {
  manifest: NreContainerManifest;
  voxels: SparseVoxels;
  /** Bytes as they were stored, for byte-exact preservation checks. */
  containerBytes: number;
  containerSha256: string;
}

/**
 * Sparse voxel set. Coordinates are integer lattice indices; attributes
 * are parallel arrays aligned with `coords`, so `attribute[i]` belongs to
 * voxel `i`. Index 0 of the attribute array is the first component.
 *
 * Everything is stored in Morton order, which makes spatial locality a
 * property of the array rather than something the reader has to rebuild.
 */
export interface SparseVoxels {
  grid: SpatialGrid;
  /** length 3n: x0,y0,z0, x1,y1,z1, … (Int32, exact). */
  coords: Int32Array;
  /** Morton code per voxel, ascending. Derived from coords, re-verified on read. */
  morton: BigUint64Array;
  /** name → flat array (n * components). Absent channel = not recorded. */
  attributes: Record<string, Float64Array>;
  /** Channel descriptors, in the order channels are written to the payload. */
  channels: AttributeChannel[];
  /** Occupied extent in world space. */
  bbox: BoundingVolume;
  occupancy: "sparse-surface" | "sparse-volume";
}

/** Per-voxel attribute value before encoding (used by ingestion). */
export interface VoxelInput {
  i: number;
  j: number;
  k: number;
  attributes?: Record<string, ArrayLike<number>>;
}

/** Outcome classification the engine is allowed to report. */
export type ExperimentStatus = "VERIFIED" | "PARTIAL" | "BLOCKED" | "NOT IMPLEMENTED";
