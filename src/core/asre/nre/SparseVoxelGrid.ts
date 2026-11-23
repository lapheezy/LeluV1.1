/**
 * ==========================================================
 * LÉLU ASRE — SPARSE VOXEL GRID
 *
 * The NRE's numerical body: occupied cells only, keyed by Morton
 * code, each holding its evidence. Confidence is never stored as
 * a free number — it is DERIVED from the evidence list by noisy-OR
 * over independent observations:
 *
 *     c = 1 − Π (1 − p_i)       (one term per distinct fingerprint)
 *
 * so 0.55 ⊕ 0.80 = 0.91, and presenting the same observation twice
 * changes nothing: identical evidence is not independent evidence.
 *
 * Observations are frozen when recorded. Accumulation produces new
 * cell evidence; it never edits an observation.
 * ==========================================================
 */

import { mortonDecode, mortonEncode } from "./morton.ts";
import { Provenance, type Aabb, type Cell, type GridSpec, type Observation, type Vec3 } from "./types.ts";

export function noisyOr(probabilities: Iterable<number>): number {
  let miss = 1;
  for (const p of probabilities) miss *= 1 - clamp01(p);
  return 1 - miss;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export interface FuseResult {
  /** True when the observation's fingerprint was already present: nothing changed. */
  duplicate: boolean;
  added: number;
  reinforced: number;
}

export class SparseVoxelGrid {
  readonly spec: GridSpec;
  private readonly cells = new Map<number, Cell>();
  private readonly observations: Observation[] = [];
  private readonly byFingerprint = new Map<string, number>();

  constructor(spec: GridSpec) {
    for (const d of spec.dims) if (!Number.isInteger(d) || d < 1 || d > 65536) throw new RangeError(`grid dims must be 1..65536, got ${spec.dims.join("x")}`);
    if (!(spec.resolution > 0)) throw new RangeError("grid resolution must be > 0");
    this.spec = { ...spec, origin: [...spec.origin] as Vec3, dims: [...spec.dims] as Vec3 };
  }

  get size(): number {
    return this.cells.size;
  }

  /* ------------------------------ observations ------------------------------ */

  /** Record an observation (frozen). Returns its index; an existing fingerprint returns the existing index. */
  addObservation(observation: Observation): { index: number; duplicate: boolean } {
    const existing = this.byFingerprint.get(observation.fingerprint);
    if (existing !== undefined) return { index: existing, duplicate: true };
    const frozen = Object.freeze({ ...observation, parameters: Object.freeze({ ...observation.parameters }), lineage: Object.freeze([...observation.lineage]) }) as Observation;
    this.observations.push(frozen);
    const index = this.observations.length - 1;
    this.byFingerprint.set(observation.fingerprint, index);
    return { index, duplicate: false };
  }

  getObservations(): readonly Observation[] {
    return this.observations;
  }

  observationIndex(id: string): number {
    return this.observations.findIndex((o) => o.id === id);
  }

  /* --------------------------------- cells ---------------------------------- */

  inBounds(x: number, y: number, z: number): boolean {
    const [dx, dy, dz] = this.spec.dims;
    return x >= 0 && y >= 0 && z >= 0 && x < dx && y < dy && z < dz;
  }

  has(x: number, y: number, z: number): boolean {
    return this.inBounds(x, y, z) && this.cells.has(mortonEncode(x, y, z));
  }

  get(x: number, y: number, z: number): Cell | undefined {
    return this.inBounds(x, y, z) ? this.cells.get(mortonEncode(x, y, z)) : undefined;
  }

  getByCode(code: number): Cell | undefined {
    return this.cells.get(code);
  }

  /** Add one piece of evidence to one cell (used by fuse and by builders). */
  addEvidence(x: number, y: number, z: number, obsIndex: number, p = this.observations[obsIndex]?.confidence ?? 1): boolean {
    if (!this.inBounds(x, y, z)) return false;
    const obs = this.observations[obsIndex];
    if (!obs) throw new RangeError(`no observation #${obsIndex}`);
    const code = mortonEncode(x, y, z);
    let cell = this.cells.get(code);
    if (!cell) {
      cell = { confidence: 0, provenance: 0, evidence: [] };
      this.cells.set(code, cell);
    }
    const prior = cell.evidence.find((e) => e.obs === obsIndex);
    if (prior) {
      if (p <= prior.p) return false;
      prior.p = p;
    } else {
      cell.evidence.push({ obs: obsIndex, p: clamp01(p) });
    }
    cell.provenance |= Provenance[obs.provenance];
    cell.confidence = noisyOr(cell.evidence.map((e) => e.p));
    return true;
  }

  /** Remove a cell outright (used by carving with free-space evidence and by restore). */
  delete(x: number, y: number, z: number): boolean {
    return this.cells.delete(mortonEncode(x, y, z));
  }

  setCellByCode(code: number, cell: Cell): void {
    this.cells.set(code, { confidence: cell.confidence, provenance: cell.provenance, evidence: cell.evidence.map((e) => ({ ...e })) });
  }

  deleteByCode(code: number): boolean {
    return this.cells.delete(code);
  }

  /** All Morton codes, ascending (deterministic iteration order). */
  codes(): number[] {
    return [...this.cells.keys()].sort((a, b) => a - b);
  }

  *entries(): IterableIterator<[number, Cell]> {
    for (const code of this.codes()) yield [code, this.cells.get(code)!];
  }

  *coords(): IterableIterator<Vec3> {
    for (const code of this.codes()) yield mortonDecode(code);
  }

  /**
   * Fuse a set of occupied cells from one observation. A duplicate fingerprint
   * is refused before any cell is touched.
   */
  fuse(observation: Observation, cells: Iterable<Vec3 | { x: number; y: number; z: number; p?: number }>): FuseResult {
    const { index, duplicate } = this.addObservation(observation);
    if (duplicate) return { duplicate: true, added: 0, reinforced: 0 };
    let added = 0;
    let reinforced = 0;
    for (const c of cells) {
      const [x, y, z, p] = Array.isArray(c) ? [c[0], c[1], c[2], undefined] : [c.x, c.y, c.z, c.p];
      const existed = this.has(x, y, z);
      if (!this.addEvidence(x, y, z, index, p ?? observation.confidence)) continue;
      if (existed) reinforced++;
      else added++;
    }
    return { duplicate: false, added, reinforced };
  }

  /* -------------------------------- geometry -------------------------------- */

  worldCenter(x: number, y: number, z: number): Vec3 {
    const { origin, resolution } = this.spec;
    return [origin[0] + (x + 0.5) * resolution, origin[1] + (y + 0.5) * resolution, origin[2] + (z + 0.5) * resolution];
  }

  worldToCell(p: Vec3): Vec3 {
    const { origin, resolution } = this.spec;
    return [Math.floor((p[0] - origin[0]) / resolution), Math.floor((p[1] - origin[1]) / resolution), Math.floor((p[2] - origin[2]) / resolution)];
  }

  /** Cell-index bounding box of occupied cells (null when empty). */
  cellBounds(): Aabb | null {
    if (this.cells.size === 0) return null;
    const min: Vec3 = [Infinity, Infinity, Infinity];
    const max: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const code of this.cells.keys()) {
      const c = mortonDecode(code);
      for (let a = 0; a < 3; a++) {
        if (c[a] < min[a]) min[a] = c[a];
        if (c[a] > max[a]) max[a] = c[a];
      }
    }
    return { min, max };
  }

  /** World-space bounding volume of occupied cells. */
  worldBounds(): Aabb | null {
    const b = this.cellBounds();
    if (!b) return null;
    const { origin, resolution } = this.spec;
    return {
      min: [origin[0] + b.min[0] * resolution, origin[1] + b.min[1] * resolution, origin[2] + b.min[2] * resolution],
      max: [origin[0] + (b.max[0] + 1) * resolution, origin[1] + (b.max[1] + 1) * resolution, origin[2] + (b.max[2] + 1) * resolution],
    };
  }

  centroid(): Vec3 | null {
    if (this.cells.size === 0) return null;
    const s: Vec3 = [0, 0, 0];
    for (const code of this.cells.keys()) {
      const c = mortonDecode(code);
      s[0] += c[0];
      s[1] += c[1];
      s[2] += c[2];
    }
    return [s[0] / this.cells.size, s[1] / this.cells.size, s[2] / this.cells.size];
  }

  /** Deep copy (observations are shared: they are frozen). */
  clone(): SparseVoxelGrid {
    const g = new SparseVoxelGrid(this.spec);
    for (const o of this.observations) g.addObservation(o);
    for (const [code, cell] of this.cells) g.setCellByCode(code, cell);
    return g;
  }

  countByProvenance(): Record<string, number> {
    const out: Record<string, number> = { OBSERVED: 0, INFERRED: 0, SYNTHESIZED: 0, INTERPOLATED: 0 };
    for (const cell of this.cells.values()) for (const name of Object.keys(out)) if (cell.provenance & Provenance[name as keyof typeof Provenance]) out[name]++;
    return out;
  }
}

/** Occupancy IoU between two grids over the same cell lattice. */
export function iou(a: SparseVoxelGrid, b: SparseVoxelGrid): number {
  let inter = 0;
  const bCodes = new Set(b.codes());
  for (const code of a.codes()) if (bCodes.has(code)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

/** Build a fingerprint-bearing observation in one call. */
export function makeObservation(partial: Omit<Observation, "lineage" | "parameters"> & Partial<Pick<Observation, "lineage" | "parameters">>): Observation {
  return { parameters: {}, lineage: [], ...partial };
}
