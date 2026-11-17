/**
 * ==========================================================
 * TEMPORAL STUDIO — NRE — GEOMETRY BRIDGE
 *
 * The numerical representation is a sparse lattice; the rest of the
 * world speaks triangles. This module is the only place the two meet:
 *
 *   mesh → voxels   surface sampling at half-cell density, then a
 *                   deterministic lattice binning. Every surface sample
 *                   marks the cell that contains it, so the result is the
 *                   set of cells the surface passes through.
 *
 *   voxels → mesh   one quad per EXPOSED face. Interior faces (between
 *                   two occupied cells) are not emitted: a surface mesh
 *                   is a boundary, and a solid's interior is not one.
 *                   That asymmetry is not a bug — it is exactly the
 *                   information loss Experiment B measures.
 *
 * The GLB writer is deliberately minimal (one mesh, POSITION + indices,
 * no materials) so its output can be fed straight to the existing
 * GlbInspector export gate and nothing else has to be trusted.
 * ==========================================================
 */

import type { SpatialGrid, SparseVoxels, Vec3 } from "./types.ts";
import { DEFAULT_CONFIDENCE_CHANNEL, buildSparseVoxels, denseIndexOf, isInside, occupancyMask, voxelCount } from "./voxels.ts";

export interface TriangleMesh {
  /** xyz triples in world space. */
  positions: Float32Array;
  /** Triangle vertex indices. */
  indices: Uint32Array;
}

export function emptyMesh(): TriangleMesh {
  return { positions: new Float32Array(0), indices: new Uint32Array(0) };
}

export function triangleCount(mesh: TriangleMesh): number {
  return Math.floor(mesh.indices.length / 3);
}

export function vertexCount(mesh: TriangleMesh): number {
  return Math.floor(mesh.positions.length / 3);
}

export interface VoxelizeOptions {
  /** Surface samples per cell edge. 2 = half-cell spacing (default). */
  samplesPerCell?: number;
  /** Upper bound on samples per triangle edge, to stop a long sliver exploding. */
  maxSamplesPerEdge?: number;
  occupancy?: "sparse-surface" | "sparse-volume";
}

/**
 * Surface-voxelise a triangle mesh onto a lattice.
 *
 * Barycentric sampling rather than triangle–box intersection: it is
 * exact in the limit of small cells, deterministic, and it never
 * produces a cell the surface does not actually enter.
 */
export function voxelizeMesh(mesh: TriangleMesh, grid: SpatialGrid, options: VoxelizeOptions = {}): SparseVoxels {
  const samplesPerCell = options.samplesPerCell ?? 2;
  const maxSamples = options.maxSamplesPerEdge ?? 64;
  const step = grid.cellSize / samplesPerCell;
  // A sample that lands exactly on a cell boundary is ambiguous (floor sends
  // it to the neighbour). Faces of a voxel-derived mesh sit exactly on those
  // planes, so sample points are nudged along the inward normal by a tiny
  // fraction of a cell: the sample then belongs to the cell the surface
  // bounds, which is what makes mesh → voxels → mesh stable.
  const epsilon = grid.cellSize * 1e-4;
  const bias = 1e-9;
  const cells = new Map<number, [number, number, number]>();

  const mark = (p: Vec3): void => {
    const i = Math.floor((p[0] - grid.origin[0]) / grid.cellSize + bias);
    const j = Math.floor((p[1] - grid.origin[1]) / grid.cellSize + bias);
    const k = Math.floor((p[2] - grid.origin[2]) / grid.cellSize + bias);
    if (!isInside(grid, i, j, k)) return;
    const key = denseIndexOf(grid, i, j, k);
    if (!cells.has(key)) cells.set(key, [i, j, k]);
  };

  for (let t = 0; t < mesh.indices.length; t += 3) {
    const ia = mesh.indices[t] * 3, ib = mesh.indices[t + 1] * 3, ic = mesh.indices[t + 2] * 3;
    const a: Vec3 = [mesh.positions[ia], mesh.positions[ia + 1], mesh.positions[ia + 2]];
    const b: Vec3 = [mesh.positions[ib], mesh.positions[ib + 1], mesh.positions[ib + 2]];
    const c: Vec3 = [mesh.positions[ic], mesh.positions[ic + 1], mesh.positions[ic + 2]];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const ac = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    const bc = Math.hypot(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
    const longest = Math.max(ab, ac, bc);
    if (!Number.isFinite(longest) || longest === 0) {
      // A zero-area triangle covers no cell. Marking one of its corners would
      // claim a cell on the strength of a point that bounds nothing.
      continue;
    }
    // Outward normal of the triangle: -normal points into the solid.
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    const inward: Vec3 = length > 0 ? [(-nx / length) * epsilon, (-ny / length) * epsilon, (-nz / length) * epsilon] : [0, 0, 0];
    const n = Math.max(1, Math.min(maxSamples, Math.ceil(longest / step)));
    // Sample STRICTLY INSIDE the triangle. Sampling on its edges puts points
    // exactly on cell boundaries, where floor() picks the neighbour: on a cube
    // that neighbour happens to be occupied too, but on a curved surface it
    // spills a false one-cell layer along the whole diagrid (measured: 416 in,
    // 924 out). The (i+1/3)/n offsets never land on an edge.
    for (let u = 0; u < n; u++) {
      for (let v = 0; v < n - u; v++) {
        const wa = (u + 1 / 3) / n;
        const wb = (v + 1 / 3) / n;
        const wc = 1 - wa - wb;
        mark([
          a[0] * wc + b[0] * wa + c[0] * wb + inward[0],
          a[1] * wc + b[1] * wa + c[1] * wb + inward[1],
          a[2] * wc + b[2] * wa + c[2] * wb + inward[2],
        ]);
      }
    }
  }

  return buildSparseVoxels(grid, [...cells.values()], { occupancy: options.occupancy ?? "sparse-surface" });
}

/** The six face directions with corner offsets chosen so winding points outward. */
const FACES: ReadonlyArray<{
  name: string;
  neighbour: readonly [number, number, number];
  corners: ReadonlyArray<readonly [number, number, number]>;
}> = [
  {
    name: "+x",
    neighbour: [1, 0, 0],
    corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
  },
  {
    name: "-x",
    neighbour: [-1, 0, 0],
    corners: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  },
  {
    name: "+y",
    neighbour: [0, 1, 0],
    corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]],
  },
  {
    name: "-y",
    neighbour: [0, -1, 0],
    corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  },
  {
    name: "+z",
    neighbour: [0, 0, 1],
    corners: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  },
  {
    name: "-z",
    neighbour: [0, 0, -1],
    corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]],
  },
];

/**
 * Extract the boundary surface of an occupied voxel set as triangles.
 *
 * Only exposed faces are emitted. A solid's interior contributes no
 * surface, which is why a dense volume cannot be recovered from its own
 * boundary mesh — the engine reports that difference instead of hiding it.
 */
export function meshFromVoxels(voxels: SparseVoxels): TriangleMesh {
  const n = voxelCount(voxels);
  if (n === 0) return emptyMesh();
  const grid = voxels.grid;
  const mask = occupancyMask(voxels);
  const positions: number[] = [];
  const indices: number[] = [];
  const vertexIndex = new Map<string, number>();

  const vertexFor = (x: number, y: number, z: number): number => {
    const key = `${x},${y},${z}`;
    const existing = vertexIndex.get(key);
    if (existing !== undefined) return existing;
    const index = positions.length / 3;
    positions.push(
      grid.origin[0] + x * grid.cellSize,
      grid.origin[1] + y * grid.cellSize,
      grid.origin[2] + z * grid.cellSize,
    );
    vertexIndex.set(key, index);
    return index;
  };

  for (let v = 0; v < n; v++) {
    const i = voxels.coords[v * 3], j = voxels.coords[v * 3 + 1], k = voxels.coords[v * 3 + 2];
    for (const face of FACES) {
      const ni = i + face.neighbour[0], nj = j + face.neighbour[1], nk = k + face.neighbour[2];
      const neighbourKey = denseIndexOf(grid, ni, nj, nk);
      if (neighbourKey !== -1 && mask[neighbourKey] === 1) continue; // interior face
      const quad = face.corners.map(([dx, dy, dz]) => vertexFor(i + dx, j + dy, k + dz));
      indices.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]);
    }
  }

  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;

function pad4(length: number): number {
  return (4 - (length % 4)) % 4;
}

/**
 * Write a single-mesh GLB. Indices are uint32 and POSITION carries
 * min/max, because the export gate reads bounds from the accessor and a
 * mesh without them is reported as unmeasurable rather than valid.
 */
export function encodeGlb(mesh: TriangleMesh, options: { generator?: string; name?: string } = {}): Uint8Array {
  const name = options.name ?? "nre-surface";
  const positions = mesh.positions;
  const indices = mesh.indices;
  const nVerts = vertexCount(mesh);
  const nIndices = indices.length;

  let min: [number, number, number] = [0, 0, 0];
  let max: [number, number, number] = [0, 0, 0];
  if (nVerts > 0) {
    min = [Infinity, Infinity, Infinity];
    max = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < nVerts; v++) {
      for (let a = 0; a < 3; a++) {
        const value = positions[v * 3 + a];
        if (value < min[a]) min[a] = value;
        if (value > max[a]) max[a] = value;
      }
    }
  }

  const positionBytes = nVerts * 12;
  const indexBytes = nIndices * 4;
  const bin = new Uint8Array(positionBytes + indexBytes);
  new Uint8Array(bin.buffer, 0, positionBytes).set(new Uint8Array(positions.buffer, positions.byteOffset, positionBytes));
  const indexView = new Uint32Array(bin.buffer, positionBytes, nIndices);
  indexView.set(indices);

  const gltf = {
    asset: { version: "2.0", generator: options.generator ?? "nre-v1" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: nVerts, type: "VEC3", min, max },
      { bufferView: 1, componentType: 5125, count: nIndices, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes, target: 34962 },
      { buffer: 0, byteOffset: positionBytes, byteLength: indexBytes, target: 34963 },
    ],
    buffers: [{ byteLength: bin.byteLength }],
  };

  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPadded = jsonBytes.byteLength + pad4(jsonBytes.byteLength);
  const binPadded = bin.byteLength + pad4(bin.byteLength);
  const total = 12 + 8 + jsonPadded + 8 + binPadded;
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  view.setUint32(0, 0x46546c67, true); // "glTF"
  view.setUint32(4, 2, true);
  view.setUint32(8, total, true);
  view.setUint32(12, jsonPadded, true);
  view.setUint32(16, GLB_JSON_CHUNK, true);
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonPadded); // JSON chunk pads with spaces
  const binHeader = 20 + jsonPadded;
  view.setUint32(binHeader, binPadded, true);
  view.setUint32(binHeader + 4, GLB_BIN_CHUNK, true);
  out.set(bin, binHeader + 8);
  return out;
}

/**
 * The boundary subset of an occupied set: cells with at least one empty
 * or out-of-lattice face neighbour. A surface mesh can only ever encode
 * this subset, so experiments measure dense inputs against it instead of
 * pretending the interior survived.
 */
export function boundaryOf(voxels: SparseVoxels): SparseVoxels {
  const grid = voxels.grid;
  const n = voxelCount(voxels);
  if (n === 0) return buildSparseVoxels(grid, []);
  const mask = occupancyMask(voxels);
  const confidence = voxels.attributes.confidence;
  const cells: Array<[number, number, number]> = [];
  const confidences: number[] = [];
  for (let v = 0; v < n; v++) {
    const i = voxels.coords[v * 3], j = voxels.coords[v * 3 + 1], k = voxels.coords[v * 3 + 2];
    let exposed = false;
    for (const face of FACES) {
      const key = denseIndexOf(grid, i + face.neighbour[0], j + face.neighbour[1], k + face.neighbour[2]);
      if (key === -1 || mask[key] === 0) {
        exposed = true;
        break;
      }
    }
    if (exposed) {
      cells.push([i, j, k]);
      // Confidence travels with the cell into every derived representation:
      // dropping it here would make the surface look like an unobserved shape.
      if (confidence) confidences.push(confidence[v]);
    }
  }
  if (!confidence) return buildSparseVoxels(grid, cells, { occupancy: voxels.occupancy });
  return buildSparseVoxels(grid, cells, {
    occupancy: voxels.occupancy,
    channels: [DEFAULT_CONFIDENCE_CHANNEL],
    attributes: { confidence: confidences },
  });
}

/** Analytic helpers used by the experiment fixtures (no voxelisation involved). */
export function boxMesh(min: Vec3, max: Vec3): TriangleMesh {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const p: number[] = [
    x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0,
    x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1,
  ];
  const faces = [
    [0, 2, 1, 0, 3, 2], // -z
    [4, 5, 6, 4, 6, 7], // +z
    [0, 1, 5, 0, 5, 4], // -y
    [3, 7, 6, 3, 6, 2], // +y
    [0, 4, 7, 0, 7, 3], // -x
    [1, 2, 6, 1, 6, 5], // +x
  ].flat();
  return { positions: new Float32Array(p), indices: new Uint32Array(faces) };
}

export function sphereMesh(center: Vec3, radius: number, segments = 24, rings = 16): TriangleMesh {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI;
    for (let s = 0; s <= segments; s++) {
      const theta = (s / segments) * Math.PI * 2;
      positions.push(
        center[0] + radius * Math.sin(phi) * Math.cos(theta),
        center[1] + radius * Math.cos(phi),
        center[2] + radius * Math.sin(phi) * Math.sin(theta),
      );
    }
  }
  const row = segments + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < segments; s++) {
      const a = r * row + s;
      const b = a + row;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
}

/** A deliberately irregular, non-convex body: a sphere displaced by a seeded wave. */
export function irregularMesh(center: Vec3, radius: number, amp = 0.28, seed = 7, segments = 32, rings = 20): TriangleMesh {
  const base = sphereMesh(center, radius, segments, rings);
  const positions = new Float32Array(base.positions);
  for (let v = 0; v < positions.length; v += 3) {
    const x = positions[v] - center[0];
    const y = positions[v + 1] - center[1];
    const z = positions[v + 2] - center[2];
    const theta = Math.atan2(z, x);
    const phi = Math.acos(Math.min(1, Math.max(-1, y / radius)));
    const warp =
      1 +
      amp * 0.5 * Math.sin(3 * theta + seed) * Math.sin(2 * phi) +
      amp * 0.3 * Math.sin(5 * phi + seed * 1.7) +
      amp * 0.2 * Math.cos(4 * theta - seed);
    positions[v] = center[0] + x * warp;
    positions[v + 1] = center[1] + y * warp;
    positions[v + 2] = center[2] + z * warp;
  }
  return { positions, indices: base.indices };
}
