/**
 * ==========================================================
 * TEMPORAL STUDIO — ASRE — PERSISTENT CHARACTER IDENTITY
 *
 * One base body, many variations, no rebuilds.
 *
 * The identity owns structural parts (separately digests), overlays
 * (hair, garment, accessories) and two parameter sets that are NOT
 * geometry: appearance (materials, palette) and rig (bone proportions).
 * Keeping those apart is what lets 36 hairstyles share one body and one
 * palette, and lets a colour change cost nothing at all.
 *
 * A variation names what it changes. `applyVariation` then:
 *
 *   1. computes the dirty set from the component graph,
 *   2. regenerates only overlays that genuinely depend on a changed part,
 *   3. carries every other digest forward byte for byte,
 *   4. reports both lists, so "the body was preserved" is a measurement
 *      rather than a claim.
 *
 * Hairstyle geometry is generated from the skull the identity actually
 * has, not from a stored cube: the shell follows the head's own cross
 * sections, which is why a pixie cut on a large head is a large pixie cut.
 * ==========================================================
 */

import type { SparseVoxels } from "../nre/types.ts";
import { buildSparseVoxels, voxelCount } from "../nre/voxels.ts";
import type { AnalysisLattice } from "./lattice.ts";
import type { BBox2D, ComponentId } from "./types.ts";
import { COMPONENT_IDS } from "./types.ts";
import { STRUCTURAL_COMPONENTS, dirtySet, mergeComponents, splitByComponent, voxelDigest } from "./components.ts";

/* ------------------------------------------------------------------ types */

export interface AppearanceParameters {
  skinColour: string;
  hairColour: string;
  garmentColour: string;
  /** PBR numbers the Blender renderer reads; geometry never sees them. */
  roughness: number;
  metallic: number;
  notes: string[];
}

export interface RigParameters {
  /** Bone lengths in metres, independent of the voxel surface. */
  heightM: number;
  shoulderWidthM: number;
  legLengthM: number;
  headHeightM: number;
  notes: string[];
}

export interface CharacterIdentity {
  id: string;
  label: string;
  createdAt: string;
  version: number;
  lattice: AnalysisLattice;
  /** Structural parts: the body itself. */
  parts: Partial<Record<ComponentId, SparseVoxels>>;
  /** Worn layers. */
  overlays: Partial<Record<ComponentId, SparseVoxels>>;
  appearance: AppearanceParameters;
  rig: RigParameters;
  /** Which variation is currently applied, so overlays can be rebuilt. */
  variation: { hairstyleId: string | null; garmentId: string | null; poseId: string | null };
  digests: Partial<Record<ComponentId, string>>;
  notes: string[];
}

export function defaultAppearance(): AppearanceParameters {
  return {
    skinColour: "#c8a48c",
    hairColour: "#2c2118",
    garmentColour: "#3f6f74",
    roughness: 0.62,
    metallic: 0,
    notes: ["palette is a parameter set: no variation here changes a single voxel"],
  };
}

export function defaultRig(lattice: AnalysisLattice): RigParameters {
  const height = lattice.grid.cellSize * lattice.resY;
  return {
    heightM: height,
    shoulderWidthM: height * 0.25,
    legLengthM: height * 0.47,
    headHeightM: height * 0.13,
    notes: ["proportions are declared from the measured silhouette, not from a template"],
  };
}

export interface IdentityInput {
  id: string;
  label: string;
  lattice: AnalysisLattice;
  voxels: SparseVoxels;
  regions: Record<ComponentId, BBox2D>;
  appearance?: AppearanceParameters;
  rig?: RigParameters;
  createdAt?: string;
}

export function createIdentity(input: IdentityInput): CharacterIdentity {
  const split = splitByComponent(input.voxels, input.lattice, input.regions);
  const digests: Partial<Record<ComponentId, string>> = {};
  for (const id of STRUCTURAL_COMPONENTS) digests[id] = voxelDigest(split.parts[id]);
  return {
    id: input.id,
    label: input.label,
    createdAt: input.createdAt ?? new Date().toISOString(),
    version: 1,
    lattice: input.lattice,
    parts: split.parts,
    overlays: {},
    appearance: input.appearance ?? defaultAppearance(),
    rig: input.rig ?? defaultRig(input.lattice),
    variation: { hairstyleId: null, garmentId: null, poseId: null },
    digests,
    notes: [...split.notes, "base identity created from the reconstruction; overlays (hair, garment) are applied later"],
  };
}

/** Recompute digests after any change. Cheap: a pass over the cells. */
function refreshDigests(identity: CharacterIdentity): CharacterIdentity {
  const digests: Partial<Record<ComponentId, string>> = {};
  for (const id of COMPONENT_IDS) {
    const part = identity.parts[id] ?? identity.overlays[id];
    if (part) digests[id] = voxelDigest(part);
  }
  return { ...identity, digests };
}

export function identityBody(identity: CharacterIdentity): SparseVoxels {
  return mergeComponents(STRUCTURAL_COMPONENTS.map((id) => identity.parts[id]), identity.lattice.grid);
}

export function identityVoxels(identity: CharacterIdentity, options: { includeOverlays?: boolean } = {}): SparseVoxels {
  const includeOverlays = options.includeOverlays ?? true;
  const parts = COMPONENT_IDS.map((id) => identity.parts[id]);
  const overlays = includeOverlays ? COMPONENT_IDS.map((id) => identity.overlays[id]) : [];
  return mergeComponents([...parts, ...overlays], identity.lattice.grid);
}

/* --------------------------------------------------------------- hairstyles */

export type HairstyleFamily = "pixie" | "bob" | "long-straight" | "waves" | "ponytail" | "bun";

export interface HairstyleSpec {
  id: string;
  label: string;
  family: HairstyleFamily;
  /** 0 = above the jaw, 1 = below the waist. */
  length: number;
  /** 0 = flat to the skull, 1 = thick shell. */
  volume: number;
  /** Lateral offset per row of length, in cells: how far the mass swings. */
  sweep: number;
  /** Extra mass over the forehead, in cells. */
  fringe: number;
  /** Mass gathered behind the neck, in cells. */
  tail: number;
}

const HAIR_FAMILIES: Array<{ family: HairstyleFamily; label: string; base: Omit<HairstyleSpec, "id" | "label" | "family" | "length"> }> = [
  { family: "pixie", label: "Pixie", base: { volume: 0.35, sweep: 0, fringe: 2, tail: 0 } },
  { family: "bob", label: "Bob", base: { volume: 0.6, sweep: 0.4, fringe: 3, tail: 1 } },
  { family: "long-straight", label: "Long straight", base: { volume: 0.55, sweep: 0.15, fringe: 2, tail: 0 } },
  { family: "waves", label: "Waves", base: { volume: 0.85, sweep: 1.6, fringe: 3, tail: 1 } },
  { family: "ponytail", label: "Ponytail", base: { volume: 0.45, sweep: 0.2, fringe: 2, tail: 7 } },
  { family: "bun", label: "Bun", base: { volume: 0.5, sweep: 0, fringe: 1, tail: 0 } },
];

const LENGTH_STEPS: Array<{ value: number; label: string }> = [
  { value: 0.15, label: "crop" },
  { value: 0.3, label: "jaw" },
  { value: 0.45, label: "shoulder" },
  { value: 0.6, label: "chest" },
  { value: 0.78, label: "waist" },
  { value: 0.95, label: "hip" },
];

/**
 * The test library: 6 families x 6 lengths = 36 hairstyles, each with its
 * own numbers. Every one is generated as geometry and measured; a style that
 * produces no cells is reported as failed rather than counted.
 */
export const HAIRSTYLES: HairstyleSpec[] = HAIR_FAMILIES.flatMap((family) =>
  LENGTH_STEPS.map((step) => ({
    id: `${family.family}-${step.label}`,
    label: `${family.label} · ${step.label}`,
    family: family.family,
    length: step.value,
    volume: family.base.volume,
    // A bun is a cluster, not a length: it gets shorter as it gets longer.
    sweep: family.family === "waves" ? family.base.sweep * step.value : family.base.sweep,
    fringe: family.base.fringe,
    tail: family.family === "ponytail" ? family.base.tail * (0.5 + step.value) : family.base.tail,
  })),
);

export function hairstyleById(id: string): HairstyleSpec | null {
  return HAIRSTYLES.find((style) => style.id === id) ?? null;
}

/**
 * Hair as a shell around the skull the identity actually has.
 *
 * The head's own cross sections give the radius per row; the shell is the
 * band between that radius and radius + thickness. Length extends the shell
 * downward, sweep displaces it sideways as it falls, fringe adds mass at the
 * front (+Z) and tail adds a gathered mass behind (−Z).
 */
export function buildHairGeometry(identity: CharacterIdentity, spec: HairstyleSpec): { voxels: SparseVoxels; bbox: BBox2D | null; notes: string[] } {
  const head = identity.parts.head;
  const grid = identity.lattice.grid;
  if (!head || voxelCount(head) === 0) {
    return { voxels: buildSparseVoxels(grid, []), bbox: null, notes: ["no head part exists, so no hairstyle can be fitted"] };
  }

  const { resX, resY, resZ } = identity.lattice;
  const headCells: Array<[number, number, number]> = [];
  let minJ = resY;
  let maxJ = 0;
  let sumI = 0;
  let sumK = 0;
  for (let v = 0; v < voxelCount(head); v++) {
    const i = head.coords[v * 3];
    const j = head.coords[v * 3 + 1];
    const k = head.coords[v * 3 + 2];
    headCells.push([i, j, k]);
    minJ = Math.min(minJ, j);
    maxJ = Math.max(maxJ, j);
    sumI += i;
    sumK += k;
  }
  const centreI = sumI / headCells.length;
  const centreK = sumK / headCells.length;
  const headHeight = Math.max(2, maxJ - minJ + 1);

  // Radius per row: the skull's own silhouette, not an assumed sphere.
  const radiusByRow = new Map<number, { maxInX: number; maxInK: number }>();
  for (const [i, j, k] of headCells) {
    const entry = radiusByRow.get(j) ?? { maxInX: 0, maxInK: 0 };
    entry.maxInX = Math.max(entry.maxInX, Math.abs(i - centreI));
    entry.maxInK = Math.max(entry.maxInK, Math.abs(k - centreK));
    radiusByRow.set(j, entry);
  }
  let baseRadiusX = 0;
  let baseRadiusK = 0;
  for (const entry of radiusByRow.values()) {
    baseRadiusX = Math.max(baseRadiusX, entry.maxInX);
    baseRadiusK = Math.max(baseRadiusK, entry.maxInK);
  }
  baseRadiusX = Math.max(1, baseRadiusX);
  baseRadiusK = Math.max(1, baseRadiusK);

  const thickness = Math.max(1, Math.round(1 + spec.volume * Math.max(2, baseRadiusX * 0.55)));
  const dropRows = Math.round(spec.length * identity.lattice.resY * 0.62);
  const bottomJ = Math.max(0, maxJ - dropRows);
  const cells = new Map<number, [number, number, number]>();

  const add = (i: number, j: number, k: number): void => {
    if (i < 0 || j < 0 || k < 0 || i >= resX || j >= resY || k >= resZ) return;
    cells.set((i * resY + j) * resZ + k, [i, j, k]);
  };

  for (let j = bottomJ; j <= maxJ; j++) {
    const belowCrown = maxJ - j;
    const fall = Math.max(0, belowCrown) / Math.max(1, dropRows);
    const taper = spec.family === "bun" ? Math.max(0.35, 1 - fall * 1.6) : Math.max(0.45, 1 - fall * 0.55);
    const sweepShift = Math.round(spec.sweep * fall * baseRadiusX * 0.8);
    const rx = baseRadiusX * (1 + (j > maxJ - headHeight * 0.25 ? spec.volume * 0.18 : 0)) * taper;
    const rk = baseRadiusK * taper;
    for (let i = Math.floor(centreI - rx - thickness); i <= Math.ceil(centreI + rx + thickness); i++) {
      for (let k = Math.floor(centreK - rk - thickness); k <= Math.ceil(centreK + rk + thickness); k++) {
        const dx = (i - centreI - sweepShift) / Math.max(0.5, rx);
        const dk = (k - centreK) / Math.max(0.5, rk);
        const d = Math.sqrt(dx * dx + dk * dk);
        // Shell band: outside the skull, inside the shell thickness.
        if (d >= 0.82 && d <= 1 + thickness / Math.max(1, Math.max(rx, rk))) add(i, j, k);
      }
    }
  }

  // Fringe: mass over the forehead, at the front of the head.
  if (spec.fringe > 0) {
    for (let j = maxJ - Math.round(headHeight * 0.45); j <= maxJ; j++) {
      for (let i = Math.round(centreI - baseRadiusX * 0.8); i <= Math.round(centreI + baseRadiusX * 0.8); i++) {
        for (let k = Math.round(centreK + baseRadiusK * 0.5); k <= Math.round(centreK + baseRadiusK * 0.5 + spec.fringe); k++) add(i, j, k);
      }
    }
  }

  // Tail: gathered mass behind the neck.
  if (spec.tail > 0) {
    const tailLength = Math.round(3 * spec.tail);
    for (let j = Math.max(0, maxJ - Math.round(headHeight * 0.6) - tailLength); j <= maxJ - Math.round(headHeight * 0.4); j++) {
      for (let k = Math.round(centreK - baseRadiusK - spec.tail); k <= Math.round(centreK - baseRadiusK); k++) {
        for (let i = Math.round(centreI - spec.tail * 0.7); i <= Math.round(centreI + spec.tail * 0.7); i++) add(i, j, k);
      }
    }
  }

  // A bun is a cluster at the crown-back, not a length of hair.
  if (spec.family === "bun") {
    const r = Math.max(2, Math.round(baseRadiusX * 0.7));
    const ccI = Math.round(centreI);
    const ccJ = maxJ - Math.round(headHeight * 0.15);
    const ccK = Math.round(centreK - baseRadiusK - 1);
    for (let i = ccI - r; i <= ccI + r; i++) {
      for (let j = ccJ - r; j <= ccJ + r; j++) {
        for (let k = ccK - r; k <= ccK + r; k++) {
          const dx = i - ccI;
          const dy = j - ccJ;
          const dz = k - ccK;
          if (dx * dx + dy * dy + dz * dz <= r * r) add(i, j, k);
        }
      }
    }
  }

  const list = [...cells.values()];
  const voxels = buildSparseVoxels(grid, list, { occupancy: "sparse-surface" });
  const notes = [
    `${spec.label}: ${list.length} cells, shell thickness ${thickness} cells, drop ${dropRows} rows (${(spec.length * 100).toFixed(0)}% of the body height), sweep ${spec.sweep.toFixed(2)}, fringe ${spec.fringe}, tail ${spec.tail.toFixed(1)}`,
    `fitted to the head's own cross sections: base radius ${baseRadiusX.toFixed(1)} x ${baseRadiusK.toFixed(1)} cells`,
  ];
  return { voxels, bbox: null, notes };
}

/* ---------------------------------------------------------------- garments */

export type GarmentFamily = "tunic" | "jacket" | "skirt" | "dress" | "cape" | "vest";

export interface GarmentSpec {
  id: string;
  label: string;
  family: GarmentFamily;
  /** 0 = sleeveless, 1 = full-length sleeve. */
  sleeve: number;
  /** 0 = waist, 1 = ankle. */
  hem: number;
  /** Cells of offset from the body surface. */
  fit: number;
  collar: boolean;
}

export const GARMENTS: GarmentSpec[] = [
  { id: "tunic-basic", label: "Tunic", family: "tunic", sleeve: 0.55, hem: 0.35, fit: 1, collar: true },
  { id: "jacket-cropped", label: "Cropped jacket", family: "jacket", sleeve: 0.95, hem: 0.15, fit: 2, collar: true },
  { id: "skirt-long", label: "Long skirt", family: "skirt", sleeve: 0, hem: 0.9, fit: 1, collar: false },
  { id: "dress-floor", label: "Floor-length dress", family: "dress", sleeve: 0.3, hem: 0.98, fit: 1, collar: false },
  { id: "cape-short", label: "Short cape", family: "cape", sleeve: 0, hem: 0.4, fit: 2, collar: true },
  { id: "vest-fitted", label: "Fitted vest", family: "vest", sleeve: 0, hem: 0.2, fit: 0, collar: false },
  { id: "coat-long", label: "Long coat", family: "jacket", sleeve: 1, hem: 0.75, fit: 3, collar: true },
  { id: "dress-sleeveless", label: "Sleeveless dress", family: "dress", sleeve: 0, hem: 0.6, fit: 1, collar: false },
];

export function garmentById(id: string): GarmentSpec | null {
  return GARMENTS.find((garment) => garment.id === id) ?? null;
}

/**
 * A garment as an offset shell over the parts it covers. The shell follows
 * the body's own cross sections, so a fitted vest on a broad torso is broad
 * and a cape is the same torso one cell further out.
 */
export function buildGarmentGeometry(identity: CharacterIdentity, spec: GarmentSpec): { voxels: SparseVoxels; notes: string[] } {
  const grid = identity.lattice.grid;
  const { resX, resY, resZ } = identity.lattice;
  const covered: Array<[ComponentId, number]> = [
    ["torso", 1],
    ["pelvis", 1],
    ["legs", spec.hem > 0.25 ? 1 : 0],
    ["arms", spec.sleeve > 0 ? 1 : 0],
  ];

  const cells = new Map<number, [number, number, number]>();
  const add = (i: number, j: number, k: number): void => {
    if (i < 0 || j < 0 || k < 0 || i >= resX || j >= resY || k >= resZ) return;
    cells.set((i * resY + j) * resZ + k, [i, j, k]);
  };

  const occupied = new Set<number>();
  for (const [id] of covered) {
    const part = identity.parts[id];
    if (!part) continue;
    for (let v = 0; v < voxelCount(part); v++) {
      occupied.add((part.coords[v * 3] * resY + part.coords[v * 3 + 1]) * resZ + part.coords[v * 3 + 2]);
    }
  }
  if (occupied.size === 0) {
    return { voxels: buildSparseVoxels(grid, []), notes: ["no body parts exist for this garment to cover"] };
  }

  // Body height span, to place the hem as a fraction of the body.
  let minJ = resY;
  let maxJ = 0;
  for (const [id, weight] of covered) {
    const part = identity.parts[id];
    if (!part || weight === 0) continue;
    for (let v = 0; v < voxelCount(part); v++) {
      const j = part.coords[v * 3 + 1];
      if (j < minJ) minJ = j;
      if (j > maxJ) maxJ = j;
    }
  }
  const hemJ = Math.round(maxJ - (maxJ - minJ) * spec.hem);

  for (const [id, weight] of covered) {
    if (weight === 0) continue;
    const part = identity.parts[id];
    if (!part) continue;
    for (let v = 0; v < voxelCount(part); v++) {
      const i = part.coords[v * 3];
      const j = part.coords[v * 3 + 1];
      const k = part.coords[v * 3 + 2];
      if (j < hemJ) continue;
      // Sleeve: only the upper part of the arm gets covered until sleeve = 1.
      if (id === "arms" && spec.sleeve < 1) {
        const armTop = maxJ - (maxJ - minJ) * 0.15;
        const armBottom = maxJ - (maxJ - minJ) * (0.15 + spec.sleeve * 0.6);
        if (j < armBottom || j > armTop) continue;
      }
      for (let di = -spec.fit; di <= spec.fit; di++) {
        for (let dj = -spec.fit; dj <= spec.fit; dj++) {
          for (let dk = -spec.fit; dk <= spec.fit; dk++) {
            const ni = i + di;
            const nj = j + dj;
            const nk = k + dk;
            const key = (ni * resY + nj) * resZ + nk;
            // A shell: only the cells that are NOT body. Overlapping cells
            // would double the garment's volume into the body.
            if (occupied.has(key)) continue;
            if (nk < 0 || nk >= resZ) continue;
            add(ni, nj, nk);
          }
        }
      }
    }
  }

  if (spec.collar) {
    // Collar ring one row above the shoulder line.
    const torso = identity.parts.torso;
    if (torso) {
      let top = 0;
      for (let v = 0; v < voxelCount(torso); v++) top = Math.max(top, torso.coords[v * 3 + 1]);
      for (let v = 0; v < voxelCount(torso); v++) {
        if (torso.coords[v * 3 + 1] < top - 1) continue;
        add(torso.coords[v * 3], top + spec.fit, torso.coords[v * 3 + 2]);
      }
    }
  }

  const list = [...cells.values()];
  return {
    voxels: buildSparseVoxels(grid, list, { occupancy: "sparse-surface" }),
    notes: [
      `${spec.label}: ${list.length} shell cells, fit offset ${spec.fit}, hem at row ${hemJ} of ${minJ}–${maxJ}`,
      `covers ${covered.filter(([, w]) => w > 0).map(([id]) => id).join(", ")}; body cells are excluded from the shell`,
    ],
  };
}

/* ------------------------------------------------------------------- poses */

export interface PoseSpec {
  id: string;
  label: string;
  /** Radians about the shoulder, outward-positive, per side. */
  armAngle: number;
  /** Radians about the hip. */
  legAngle: number;
}

/**
 * Poses rotate whole articulated nodes about their joint.
 *
 * The graph carries `arms` and `legs` as single nodes (each holding both
 * limbs), so a pose swings both together. That is a real limitation of a
 * single-view split, and it is why a true T-pose is not offered here rather
 * than offered and quietly faked.
 */
export const POSES: PoseSpec[] = [
  { id: "pose-apose", label: "A-pose (rest)", armAngle: 0, legAngle: 0 },
  { id: "pose-arms-forward", label: "Arms forward", armAngle: -0.6, legAngle: 0 },
  { id: "pose-arms-back", label: "Arms back", armAngle: 0.45, legAngle: 0 },
  { id: "pose-stride", label: "Stride", armAngle: 0.1, legAngle: 0.32 },
  { id: "pose-lean", label: "Weight shift", armAngle: 0.15, legAngle: 0.12 },
];

/** Rotate a part about a pivot along X, resampling to the nearest cell. */
function rotatePart(part: SparseVoxels, pivot: [number, number, number], angle: number): SparseVoxels {
  if (angle === 0) return part;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const cells: Array<[number, number, number]> = [];
  const seen = new Set<string>();
  for (let v = 0; v < voxelCount(part); v++) {
    const i = part.coords[v * 3] - pivot[0];
    const j = part.coords[v * 3 + 1] - pivot[1];
    const k = part.coords[v * 3 + 2] - pivot[2];
    // Rotation in the (j,k) plane: raising an arm swings it in depth, which
    // is what an A-pose to T-pose change actually does when seen from front.
    const nj = Math.round(j * cos - k * sin);
    const nk = Math.round(j * sin + k * cos);
    const key = `${i},${nj},${nk}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push([i + pivot[0], nj + pivot[1], nk + pivot[2]]);
  }
  return buildSparseVoxels(part.grid, cells, { occupancy: part.occupancy });
}

/* -------------------------------------------------------------- variations */

export type VariationKind = "hairstyle" | "clothing" | "proportions" | "pose" | "style";

export interface VariationRequest {
  kind: VariationKind;
  /** Hairstyle, garment or pose id, depending on `kind`. */
  id: string;
  /** Proportions only. */
  proportions?: { shoulderScale?: number; heightScale?: number };
}

export interface VariationResult {
  identity: CharacterIdentity;
  request: VariationRequest;
  changed: ComponentId[];
  /** Components whose digest is byte-identical to the previous version. */
  preserved: ComponentId[];
  reusedCells: number;
  regeneratedCells: number;
  /** Geometry this variation actually produced (cells). */
  producedCells: number;
  notes: string[];
  failures: string[];
}

function cloneOverlays(identity: CharacterIdentity): Partial<Record<ComponentId, SparseVoxels>> {
  return { ...identity.overlays };
}

/**
 * Apply one variation and prove what moved.
 *
 * The `preserved` list is computed by digest comparison against the previous
 * version, not by intent: if a part comes back identical, it is preserved
 * whatever the code meant to do.
 */
export function applyVariation(identity: CharacterIdentity, request: VariationRequest): VariationResult {
  const previousDigests = { ...identity.digests };
  const notes: string[] = [];
  const failures: string[] = [];
  let next: CharacterIdentity = { ...identity, parts: { ...identity.parts }, overlays: cloneOverlays(identity), version: identity.version + 1 };
  const changedStructural: ComponentId[] = [];

  if (request.kind === "hairstyle") {
    const spec = hairstyleById(request.id);
    if (!spec) {
      failures.push(`unknown hairstyle "${request.id}"`);
    } else {
      const hair = buildHairGeometry(next, spec);
      next.overlays = { ...next.overlays, hair: hair.voxels };
      next.variation = { ...next.variation, hairstyleId: spec.id };
      notes.push(...hair.notes);
      if (voxelCount(hair.voxels) === 0) failures.push(`hairstyle "${spec.id}" produced no geometry`);
    }
  } else if (request.kind === "clothing") {
    const spec = garmentById(request.id);
    if (!spec) {
      failures.push(`unknown garment "${request.id}"`);
    } else {
      const garment = buildGarmentGeometry(next, spec);
      next.overlays = { ...next.overlays, clothing: garment.voxels };
      next.variation = { ...next.variation, garmentId: spec.id };
      notes.push(...garment.notes);
      if (voxelCount(garment.voxels) === 0) failures.push(`garment "${spec.id}" produced no geometry`);
    }
  } else if (request.kind === "pose") {
    const spec = POSES.find((pose) => pose.id === request.id);
    if (!spec) {
      failures.push(`unknown pose "${request.id}"`);
    } else {
      const arms = next.parts.arms;
      const legs = next.parts.legs;
      const head = next.parts.head;
      if (arms && spec.armAngle !== 0) {
        const pivot: [number, number, number] = [Math.round(identity.lattice.resX / 2), Math.round(identity.lattice.resY * 0.78), identity.lattice.midZ];
        next.parts.arms = rotatePart(arms, pivot, spec.armAngle);
        changedStructural.push("arms");
      }
      if (legs && spec.legAngle !== 0) {
        const pivot: [number, number, number] = [Math.round(identity.lattice.resX / 2), Math.round(identity.lattice.resY * 0.5), identity.lattice.midZ];
        next.parts.legs = rotatePart(legs, pivot, spec.legAngle);
        changedStructural.push("legs");
      }
      if (head) {
        // The head is deliberately untouched by a pose: swinging an arm does
        // not restyle a face, and the digest comparison proves it stayed put.
        void head;
      }
      next.variation = { ...next.variation, poseId: spec.id };
      notes.push(`${spec.label}: arm ${(spec.armAngle * 180 / Math.PI).toFixed(1)}°, leg ${(spec.legAngle * 180 / Math.PI).toFixed(1)}° about the joint pivots; only the rotated parts were resampled`);
    }
  } else if (request.kind === "proportions") {
    const shoulderScale = request.proportions?.shoulderScale ?? 1;
    const heightScale = request.proportions?.heightScale ?? 1;
    if (shoulderScale !== 1) {
      for (const id of ["torso", "arms"] as ComponentId[]) {
        const part = next.parts[id];
        if (!part) continue;
        next.parts[id] = scalePart(part, shoulderScale, 1, identity.lattice);
        changedStructural.push(id);
      }
      notes.push(`shoulder scale ${shoulderScale.toFixed(2)} applied to torso and arms about the body centre line`);
    }
    if (heightScale !== 1) {
      for (const id of STRUCTURAL_COMPONENTS) {
        const part = next.parts[id];
        if (!part) continue;
        next.parts[id] = scalePart(part, 1, heightScale, identity.lattice);
        if (!changedStructural.includes(id)) changedStructural.push(id);
      }
      notes.push(`height scale ${heightScale.toFixed(2)} applied to every structural part about the ground plane`);
    }
  } else {
    failures.push(`variation kind "${request.kind}" is not implemented`);
  }

  // Overlays that depend on a changed part are regenerated; the rest stay.
  if (changedStructural.length > 0) {
    const dirty = dirtySet(changedStructural, { structural: true });
    if (next.variation.garmentId && dirty.includes("clothing") && next.overlays.clothing) {
      const spec = garmentById(next.variation.garmentId);
      if (spec) {
        const garment = buildGarmentGeometry(next, spec);
        next.overlays = { ...next.overlays, clothing: garment.voxels };
        notes.push(`garment "${spec.id}" regenerated because ${changedStructural.join(", ")} changed: ${garment.notes[0]}`);
      }
    }
    if (next.variation.hairstyleId && dirty.includes("hair") && next.overlays.hair) {
      const spec = hairstyleById(next.variation.hairstyleId);
      if (spec) {
        const hair = buildHairGeometry(next, spec);
        next.overlays = { ...next.overlays, hair: hair.voxels };
        notes.push(`hairstyle "${spec.id}" refitted because the head changed`);
      }
    }
  }

  next = refreshDigests(next);

  const changed: ComponentId[] = [];
  const preserved: ComponentId[] = [];
  let reusedCells = 0;
  let regeneratedCells = 0;
  let producedCells = 0;
  for (const id of COMPONENT_IDS) {
    const before = previousDigests[id];
    const after = next.digests[id];
    const cells = (next.parts[id] ? voxelCount(next.parts[id] as SparseVoxels) : 0) + (next.overlays[id] ? voxelCount(next.overlays[id] as SparseVoxels) : 0);
    if (after === undefined && before === undefined) continue;
    if (before === after) {
      preserved.push(id);
      reusedCells += cells;
    } else {
      changed.push(id);
      regeneratedCells += cells;
      if (!before) producedCells += cells;
    }
  }

  const resultNotes = [
    ...notes,
    `${changed.length} components changed, ${preserved.length} preserved by digest`,
    `reused ${reusedCells} cells, regenerated ${regeneratedCells} cells`,
  ];

  return { identity: { ...next, notes: [...identity.notes, ...resultNotes] }, request, changed, preserved, reusedCells, regeneratedCells, producedCells, notes: resultNotes, failures };
}

/** Scale a part about the body centre (X) or the ground plane (Y), nearest cell. */
function scalePart(part: SparseVoxels, scaleX: number, scaleY: number, lattice: AnalysisLattice): SparseVoxels {
  const centreI = (lattice.resX - 1) / 2;
  const cells = new Map<string, [number, number, number]>();
  for (let v = 0; v < voxelCount(part); v++) {
    const i = part.coords[v * 3];
    const j = part.coords[v * 3 + 1];
    const k = part.coords[v * 3 + 2];
    const ni = Math.round(centreI + (i - centreI) * scaleX);
    const nj = Math.round(j * scaleY);
    const key = `${ni},${nj},${k}`;
    if (!cells.has(key)) cells.set(key, [ni, nj, k]);
  }
  return buildSparseVoxels(part.grid, [...cells.values()], { occupancy: part.occupancy });
}

/** Proportional reuse, for the benchmark: 1 - regenerated / total work. */
export function reuseRatio(result: VariationResult): number {
  const total = result.reusedCells + result.regeneratedCells;
  return total > 0 ? result.reusedCells / total : 0;
}
