/**
 * ==========================================================
 * LÉLU ASRE — COMPONENT BUILD, REUSE AND PLACEMENT
 *
 * A component is sampled in its own frame (cell centres at (j + ½)·h),
 * meshed with surface nets and stored under its content key. Placing it =
 * offsetting by its anchor cell: no resampling, no remeshing. A build
 * reports, per component, whether it was regenerated or reused, and how
 * long it took.
 *
 * TWO RESOLUTIONS (Mission 5.8). A body is not uniformly detailed: a face
 * needs ~2 mm cells to hold eyelids and lips, a torso does not. So the MESH
 * of a component is sampled at its own detail resolution (`Lattice.detail`,
 * default `DETAIL_RESOLUTION`), while its OCCUPANCY cells stay on the one
 * shared lattice `resolution`. That keeps every cell-indexed thing — the
 * NRE grid, component hashes, version diffs, temporal snapshots, the
 * "components add up to the whole object" invariant — exactly as it was,
 * and spends triangles where they can be seen.
 *
 * The whole-object baseline samples ONE implicit function (the union
 * of every component) over the whole character box at the shared
 * resolution — what a conventional single-mesh pipeline does on every
 * change.
 * ==========================================================
 */

import { mortonEncode } from "../nre/morton.ts";
import { SparseVoxelGrid } from "../nre/SparseVoxelGrid.ts";
import type { Vec3 } from "../nre/types.ts";
import { surfaceNets, vertexNormals, type Mesh } from "../volume/mesh.ts";
import type { GlbPart } from "../gltf/GlbWriter.ts";
import type { CharacterSpec } from "./CharacterSpec.ts";
import { COMPONENTS, COMPONENT_ORDER, anchorCells, componentKeys, contextFor, skeleton, type ComponentId, type Skeleton } from "./components.ts";
import type { Shape } from "./shape.ts";

export interface Lattice {
  /** Occupancy-cell size (metres) of the ONE shared lattice. */
  resolution: number;
  /** Absolute cell index of lattice cell (0,0,0). */
  originCells: Vec3;
  dims: Vec3;
  /**
   * Per-component MESH resolution, in metres. Absent or a size equal to
   * `resolution` means "sample the mesh on the shared lattice too".
   * Occupancy cells are never affected.
   */
  detail?: Partial<Record<ComponentId, number>>;
}

/**
 * Where a finer mesh earns its triangles. Chosen from the 5.8 audit: the
 * face held only 224 cells and the hands 4,640 at 6 mm, while the two
 * clothing shells alone were 39 % of every triangle. Values are ~2× finer
 * on the parts a viewer reads as "a person" and no finer on the rest.
 */
export const DETAIL_RESOLUTION: Partial<Record<ComponentId, number>> = {
  face: 0.0022,
  hands: 0.0022,
  head: 0.003,
  feet: 0.003,
  "accessories.head": 0.003,
  hair: 0.004,
  arms: 0.004,
  legs: 0.0045,
  neck: 0.004,
  "clothing.shoes": 0.004,
  torso: 0.005,
  pelvis: 0.005,
  "clothing.top": 0.005,
  "clothing.bottom": 0.005,
  "accessories.body": 0.005,
};

export const DEFAULT_LATTICE: Lattice = { resolution: 0.006, originCells: [-160, -12, -110], dims: [320, 360, 220], detail: DETAIL_RESOLUTION };

/** Mesh resolution of one component (never finer than the caller asked for). */
export function meshResolution(id: ComponentId, lattice: Lattice): number {
  const d = lattice.detail?.[id];
  return d && d > 0 ? d : lattice.resolution;
}

export interface LocalComponent {
  key: string;
  /** Local OCCUPANCY cell indices j at `hCells` (absolute lattice index = j + anchor). */
  cells: Int32Array;
  /** Mesh in the local frame, sampled at `hMesh`. */
  mesh: Mesh;
  samples: number;
  buildMs: number;
  /** Resolution the mesh was sampled at (metres). */
  hMesh?: number;
  /** Resolution the occupancy cells are expressed in (metres). */
  hCells?: number;
}

export interface BuiltComponent {
  id: ComponentId;
  key: string;
  /** Key of the geometry alone (materials neutralised). */
  geometryKey: string;
  anchor: Vec3;
  /** Resolution of this component's mesh (metres). */
  hMesh: number;
  /** Resolution of the shared occupancy lattice (metres). */
  hCells: number;
  /** True only when the component was sampled and meshed again. */
  regenerated: boolean;
  action: "regenerated" | "recolored" | "reused";
  ms: number;
  local: LocalComponent | null;
}

const srgbToLinear = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);

/**
 * Occupied cells at `h`, inside the shape's bounds — the same convention
 * `sampleShape` uses, so occupancy is identical whichever mesh resolution
 * a component is drawn at.
 */
export function occupancyCellsOf(shape: Shape, h: number): Int32Array {
  const j0 = shape.lo.map((v) => Math.floor(v / h - 0.5) - 1);
  const j1 = shape.hi.map((v) => Math.ceil(v / h - 0.5) + 1);
  const cells: number[] = [];
  for (let x = j0[0]; x <= j1[0]; x++) {
    const px = (x + 0.5) * h;
    for (let y = j0[1]; y <= j1[1]; y++) {
      const py = (y + 0.5) * h;
      for (let z = j0[2]; z <= j1[2]; z++) if (shape.f(px, py, (z + 0.5) * h) < 0) cells.push(x, y, z);
    }
  }
  return new Int32Array(cells);
}

/**
 * Sample one component: mesh at `hMesh`, occupancy cells at `hCells`. When
 * they are equal this is exactly `sampleShape`.
 */
export function sampleComponent(shape: Shape, hMesh: number, hCells: number, key = ""): LocalComponent {
  const local = sampleShape(shape, hMesh, key);
  local.hMesh = hMesh;
  local.hCells = hCells;
  if (hMesh !== hCells) {
    // A fine mesh still needs coarse occupancy: sampled on the shared lattice
    // so every cell-indexed subsystem is unchanged. Counted, so the cost is visible.
    local.cells = occupancyCellsOf(shape, hCells);
    const lo = shape.lo.map((v) => Math.floor(v / hCells - 0.5) - 1);
    const hi = shape.hi.map((v) => Math.ceil(v / hCells - 0.5) + 1);
    local.samples += (hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1);
  }
  return local;
}

/** Sample a shape on lattice cell centres within its bounds; mesh it; colour vertices. */
export function sampleShape(shape: Shape, h: number, key = ""): LocalComponent {
  const t0 = performance.now();
  const j0 = shape.lo.map((v) => Math.floor(v / h - 0.5) - 1) as Vec3;
  const j1 = shape.hi.map((v) => Math.ceil(v / h - 0.5) + 1) as Vec3;
  const dims: Vec3 = [j1[0] - j0[0] + 1, j1[1] - j0[1] + 1, j1[2] - j0[2] + 1];
  const values = new Float32Array(dims[0] * dims[1] * dims[2]);
  const cells: number[] = [];
  let i = 0;
  for (let x = 0; x < dims[0]; x++) {
    const px = (j0[0] + x + 0.5) * h;
    for (let y = 0; y < dims[1]; y++) {
      const py = (j0[1] + y + 0.5) * h;
      for (let z = 0; z < dims[2]; z++, i++) {
        const v = shape.f(px, py, (j0[2] + z + 0.5) * h);
        values[i] = v;
        if (v < 0) cells.push(j0[0] + x, j0[1] + y, j0[2] + z);
      }
    }
  }
  const mesh = surfaceNets({ values, dims, origin: [(j0[0] + 0.5) * h, (j0[1] + 0.5) * h, (j0[2] + 0.5) * h], spacing: h });
  const colors = new Float32Array((mesh.positions.length / 3) * 4);
  for (let v = 0; v < mesh.positions.length / 3; v++) {
    const c = shape.color(mesh.positions[3 * v], mesh.positions[3 * v + 1], mesh.positions[3 * v + 2]);
    colors.set([srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]), 1], 4 * v);
  }
  mesh.colors = colors;
  return { key, cells: new Int32Array(cells), mesh, samples: values.length, buildMs: performance.now() - t0 };
}

export class ComponentCache {
  private readonly map = new Map<string, LocalComponent>();
  hits = 0;
  misses = 0;
  get(key: string): LocalComponent | undefined {
    const v = this.map.get(key);
    if (v) this.hits++;
    return v;
  }
  set(key: string, v: LocalComponent): void {
    this.misses++;
    this.map.set(key, v);
  }
  get size(): number {
    return this.map.size;
  }
}

export interface BuildPlan {
  spec: CharacterSpec;
  sk: Skeleton;
  keys: Record<ComponentId, string>;
  geometryKeys: Record<ComponentId, string>;
}

const NEUTRAL: [number, number, number] = [0.5, 0.5, 0.5];
function neutralMaterials(spec: CharacterSpec): CharacterSpec {
  const m = Object.fromEntries(Object.keys(spec.materials).map((k) => [k, NEUTRAL])) as unknown as CharacterSpec["materials"];
  return { ...spec, materials: m };
}

export function plan(spec: CharacterSpec, lattice = DEFAULT_LATTICE): BuildPlan {
  const sk = skeleton(spec, lattice.resolution);
  return { spec, sk, keys: componentKeys(spec, sk), geometryKeys: componentKeys(neutralMaterials(spec), sk) };
}

function recolor(shape: Shape, geometry: LocalComponent, key: string): LocalComponent {
  const t0 = performance.now();
  const m = geometry.mesh;
  const colors = new Float32Array((m.positions.length / 3) * 4);
  for (let v = 0; v < m.positions.length / 3; v++) {
    const c = shape.color(m.positions[3 * v], m.positions[3 * v + 1], m.positions[3 * v + 2]);
    colors.set([srgbToLinear(c[0]), srgbToLinear(c[1]), srgbToLinear(c[2]), 1], 4 * v);
  }
  return { key, cells: geometry.cells, mesh: { ...m, colors }, samples: 0, buildMs: performance.now() - t0, hMesh: geometry.hMesh, hCells: geometry.hCells };
}

/**
 * Build (or reuse) one component. Same full key → reuse. Same geometry but
 * different materials → recolour the cached mesh (no sampling). Otherwise
 * sample and mesh. Empty components (no hat, no top…) have no cells.
 */
export function buildComponent(id: ComponentId, p: BuildPlan, cache: ComponentCache | null, lattice = DEFAULT_LATTICE): BuiltComponent {
  const def = COMPONENTS[id];
  const key = p.keys[id];
  const geometryKey = p.geometryKeys[id];
  const anchor = anchorCells(def, p.sk, lattice.resolution);
  const hMesh = meshResolution(id, lattice);
  const hCells = lattice.resolution;
  const at = { hMesh, hCells };
  // The cache entry also depends on the resolution the mesh was sampled at: the
  // same content key at another resolution is different geometry.
  const cacheKey = `${key}@${hMesh}`;
  const t0 = performance.now();
  const hit = cache?.get(cacheKey);
  if (hit) return { id, key, geometryKey, anchor, ...at, regenerated: false, action: "reused", ms: performance.now() - t0, local: hit };
  const shape = def.build(contextFor(p.spec, p.sk));
  const geo = cache?.get(`geo:${geometryKey}@${hMesh}`);
  if (geo && !shape) return { id, key, geometryKey, anchor, ...at, regenerated: false, action: "reused", ms: performance.now() - t0, local: geo };
  if (geo && shape) {
    const local = recolor(shape, geo, key);
    cache!.set(cacheKey, local);
    return { id, key, geometryKey, anchor, ...at, regenerated: false, action: "recolored", ms: performance.now() - t0, local };
  }
  const local = shape ? sampleComponent(shape, hMesh, hCells, key) : { key, cells: new Int32Array(0), mesh: { positions: new Float32Array(0), indices: new Uint32Array(0) }, samples: 0, buildMs: 0, hMesh, hCells };
  cache?.set(cacheKey, local);
  cache?.set(`geo:${geometryKey}@${hMesh}`, local);
  return { id, key, geometryKey, anchor, ...at, regenerated: true, action: "regenerated", ms: performance.now() - t0, local };
}

export interface CharacterBuild {
  components: BuiltComponent[];
  regenerated: ComponentId[];
  recolored: ComponentId[];
  reused: ComponentId[];
  ms: number;
}

export function buildCharacter(spec: CharacterSpec, cache: ComponentCache | null, lattice = DEFAULT_LATTICE, only?: ComponentId[]): CharacterBuild {
  const t0 = performance.now();
  const p = plan(spec, lattice);
  const components = (only ?? COMPONENT_ORDER).map((id) => buildComponent(id, p, cache, lattice));
  return {
    components,
    regenerated: components.filter((c) => c.regenerated).map((c) => c.id),
    recolored: components.filter((c) => c.action === "recolored").map((c) => c.id),
    reused: components.filter((c) => c.action === "reused").map((c) => c.id),
    ms: performance.now() - t0,
  };
}

/**
 * Mesh of a placed component in world coordinates. The anchor is expressed in
 * OCCUPANCY cells, so it is scaled by the component's cell resolution — never
 * by its mesh resolution, or a fine part would be displaced by the ratio.
 */
export function placedMesh(c: BuiltComponent): Mesh {
  const m = c.local!.mesh;
  const h = c.hCells;
  const positions = new Float32Array(m.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] = m.positions[i] + c.anchor[0] * h;
    positions[i + 1] = m.positions[i + 1] + c.anchor[1] * h;
    positions[i + 2] = m.positions[i + 2] + c.anchor[2] * h;
  }
  return { positions, indices: m.indices, colors: m.colors, normals: m.normals ?? vertexNormals(m) };
}

export function glbParts(build: CharacterBuild, spec: CharacterSpec): GlbPart[] {
  return build.components
    .filter((c) => c.local && c.local.mesh.indices.length)
    .map((c) => ({
      name: c.id,
      mesh: placedMesh(c),
      material: { name: `${c.id}-vertex-colour`, baseColor: [1, 1, 1, 1] as [number, number, number, number], roughness: c.id === "hair" ? 0.7 : 0.55 },
      extras: { component: c.id, key: c.key, regenerated: c.regenerated, identity: spec.identity.id, provenance: "SYNTHESIZED" },
    }));
}

/** Absolute-lattice Morton codes of the union of all placed components. */
export function occupancyCodes(build: CharacterBuild, lattice = DEFAULT_LATTICE): Set<number> {
  const out = new Set<number>();
  for (const c of build.components) {
    const cells = c.local?.cells;
    if (!cells) continue;
    for (let i = 0; i < cells.length; i += 3) {
      const x = cells[i] + c.anchor[0] - lattice.originCells[0];
      const y = cells[i + 1] + c.anchor[1] - lattice.originCells[1];
      const z = cells[i + 2] + c.anchor[2] - lattice.originCells[2];
      if (x >= 0 && y >= 0 && z >= 0 && x < lattice.dims[0] && y < lattice.dims[1] && z < lattice.dims[2]) out.add(mortonEncode(x, y, z));
    }
  }
  return out;
}

/** Cells of one component on the absolute lattice (for per-component identity checks). */
export function componentCodes(c: BuiltComponent, lattice = DEFAULT_LATTICE): number[] {
  const out: number[] = [];
  const cells = c.local?.cells ?? new Int32Array(0);
  for (let i = 0; i < cells.length; i += 3) out.push(mortonEncode(cells[i] + c.anchor[0] - lattice.originCells[0], cells[i + 1] + c.anchor[1] - lattice.originCells[1], cells[i + 2] + c.anchor[2] - lattice.originCells[2]));
  return out.sort((a, b) => a - b);
}

/**
 * Conventional whole-object reconstruction: one implicit function — the
 * union of every component placed in world space — sampled over the whole
 * character box, one mesh. Nothing is reused between calls.
 */
export function buildWholeObject(spec: CharacterSpec, lattice = DEFAULT_LATTICE): { codes: Set<number>; mesh: Mesh; samples: number; ms: number } {
  const t0 = performance.now();
  const p = plan(spec, lattice);
  const h = lattice.resolution;
  const shapes: Shape[] = [];
  for (const id of COMPONENT_ORDER) {
    const def = COMPONENTS[id];
    const s = def.build(contextFor(spec, p.sk));
    if (!s) continue;
    const a = anchorCells(def, p.sk, h).map((v) => v * h) as Vec3;
    shapes.push({ f: (x, y, z) => s.f(x - a[0], y - a[1], z - a[2]), lo: s.lo.map((v, i) => v + a[i]) as Vec3, hi: s.hi.map((v, i) => v + a[i]) as Vec3, color: (x, y, z) => s.color(x - a[0], y - a[1], z - a[2]) });
  }
  const lo: Vec3 = [Infinity, Infinity, Infinity], hi: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const s of shapes) for (let a = 0; a < 3; a++) [lo[a], hi[a]] = [Math.min(lo[a], s.lo[a]), Math.max(hi[a], s.hi[a])];
  // Bounding-box culling (a fair monolithic baseline): a component is only
  // evaluated near its own box; elsewhere it cannot change the sign.
  const m = 2 * h;
  const all: Shape = {
    f: (x, y, z) => {
      let d = 1;
      for (const s of shapes) {
        if (x < s.lo[0] - m || y < s.lo[1] - m || z < s.lo[2] - m || x > s.hi[0] + m || y > s.hi[1] + m || z > s.hi[2] + m) continue;
        d = Math.min(d, s.f(x, y, z));
      }
      return d;
    },
    lo,
    hi,
    color: (x, y, z) => {
      let best = shapes[0], d = Infinity;
      for (const s of shapes) {
        const v = s.f(x, y, z);
        if (v < d) [d, best] = [v, s];
      }
      return best.color(x, y, z);
    },
  };
  const local = sampleShape(all, h);
  const codes = new Set<number>();
  for (let i = 0; i < local.cells.length; i += 3) {
    const x = local.cells[i] - lattice.originCells[0], y = local.cells[i + 1] - lattice.originCells[1], z = local.cells[i + 2] - lattice.originCells[2];
    if (x >= 0 && y >= 0 && z >= 0 && x < lattice.dims[0] && y < lattice.dims[1] && z < lattice.dims[2]) codes.add(mortonEncode(x, y, z));
  }
  return { codes, mesh: local.mesh, samples: local.samples, ms: performance.now() - t0 };
}

export function codesIou(a: Set<number>, b: Set<number>): number {
  let inter = 0;
  for (const c of a) if (b.has(c)) inter++;
  const u = a.size + b.size - inter;
  return u === 0 ? 1 : inter / u;
}

/** NRE grid of a character build (one SYNTHESIZED procedural observation per component key). */
export function characterGrid(build: CharacterBuild, lattice = DEFAULT_LATTICE): SparseVoxelGrid {
  const g = new SparseVoxelGrid({ resolution: lattice.resolution, origin: lattice.originCells.map((v) => v * lattice.resolution) as Vec3, dims: lattice.dims, coordinateSystem: "y-up-right-handed" });
  for (const c of build.components) {
    if (!c.local?.cells.length) continue;
    const { index } = g.addObservation({ id: `${c.id}@${c.key}`, capturedAt: 0, source: `asre.character:${c.id}`, modality: "procedural", provenance: "SYNTHESIZED", confidence: 1, parameters: { component: c.id }, fingerprint: `component:${c.key}`, lineage: [] });
    const cells = c.local.cells;
    for (let i = 0; i < cells.length; i += 3) g.addEvidence(cells[i] + c.anchor[0] - lattice.originCells[0], cells[i + 1] + c.anchor[1] - lattice.originCells[1], cells[i + 2] + c.anchor[2] - lattice.originCells[2], index);
  }
  return g;
}
