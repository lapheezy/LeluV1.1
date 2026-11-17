/**
 * TripoSR worker output → NRE grid (with provenance) → .lnre container,
 * GLB (validated), re-voxelization IoU checks, Blender renders, report.
 *
 *   npx tsx scripts/asre/triposr-ingest.ts <worker out_dir>
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { SparseVoxelGrid, decodeGrid, encodeGrid, iou, naiveByteSize, sha256Hex, type Vec3 } from "../../src/core/asre/nre/index.ts";
import { analyzeMesh, voxelizeMesh, vertexNormals, type Mesh } from "../../src/core/asre/volume/mesh.ts";
import { volumeStats } from "../../src/core/asre/volume/volumetric.ts";
import { writeGlb } from "../../src/core/asre/gltf/GlbWriter.ts";
import { inspectGlb } from "../../src/core/forge/GlbInspector.ts";
import { readGlbMesh, readNpy } from "./io.ts";
import { renderGlb } from "./runtime.ts";

export const deflate = {
  name: "deflate-raw",
  compress: (b: Uint8Array) => new Uint8Array(deflateRawSync(b, { level: 9 })),
  decompress: (b: Uint8Array) => new Uint8Array(inflateRawSync(b)),
};

export async function ingest(dir: string, options: { render?: boolean } = {}) {
  const r = JSON.parse(readFileSync(path.join(dir, "result.json"), "utf8"));
  const vs: number = r.voxel_size;
  const lo: Vec3 = r.lattice_origin_cells;
  const dims: Vec3 = r.lattice_dims;
  const spec = { resolution: vs, origin: [lo[0] * vs, lo[1] * vs, lo[2] * vs] as Vec3, dims, coordinateSystem: "z-up-right-handed" as const };
  const cells = readNpy(path.join(dir, "cells.npy")).data as Int32Array;
  const density = readNpy(path.join(dir, "cell_density.npy")).data as Float32Array;
  const front = readNpy(path.join(dir, "cell_front_visible.npy")).data as Uint8Array;
  const imageHash = sha256Hex(readFileSync(r.image));
  const preHash = sha256Hex(readFileSync(path.join(dir, "preprocessed.png")));
  const t0 = performance.now();
  const grid = new SparseVoxelGrid(spec);
  const synth = grid.addObservation({
    id: `triposr:${preHash.slice(0, 12)}`,
    capturedAt: Date.parse("2026-11-17T00:00:00Z"),
    source: "triposr@107cefdc244c39106fa830359024f6a2f1c78871+stabilityai/TripoSR@5b521936",
    modality: "generative-model",
    provenance: "SYNTHESIZED",
    confidence: 0.5,
    parameters: { threshold: r.threshold, mcResolution: r.mc_resolution, voxelSize: vs, densityToP: "1-2^(-d/threshold)" },
    fingerprint: `triposr-density:${preHash}:${vs}`,
    lineage: [r.image, `sha256:${imageHash}`, "MIT (code and weights)"],
  }).index;
  const seen = grid.addObservation({
    id: `silhouette:${preHash.slice(0, 12)}`,
    capturedAt: Date.parse("2026-11-17T00:00:00Z"),
    source: "input-image:conditioning-camera(az0,el0,d1.9,fov40)",
    modality: "silhouette",
    provenance: "OBSERVED",
    confidence: 0.9,
    parameters: { rule: "front-visible cell projecting inside the input alpha mask" },
    fingerprint: `silhouette-front:${preHash}:${vs}`,
    lineage: [r.image],
  }).index;
  for (let k = 0; k < density.length; k++) {
    const x = cells[3 * k], y = cells[3 * k + 1], z = cells[3 * k + 2];
    grid.addEvidence(x, y, z, synth, 1 - 2 ** (-density[k] / r.threshold));
    if (front[k]) grid.addEvidence(x, y, z, seen);
  }
  const buildMs = performance.now() - t0;
  const raw = encodeGrid(grid);
  const packed = encodeGrid(grid, { codec: deflate });
  writeFileSync(path.join(dir, "reconstruction.lnre"), packed);
  const roundTrip = iou(decodeGrid(packed, { codecs: [deflate] }).grid, grid);

  // mesh → GLB (Z-up source, converted by the writer), then read back what was exported
  const v = readNpy(path.join(dir, "mesh_vertices.npy")).data as Float32Array;
  const f = readNpy(path.join(dir, "mesh_faces.npy")).data as Int32Array;
  const c = readNpy(path.join(dir, "mesh_colors.npy")).data as Float32Array;
  const colors = new Float32Array((v.length / 3) * 4);
  // TripoSR predicts display (sRGB) colours; glTF COLOR_0 is linear.
  const lin = (u: number) => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4);
  for (let i = 0; i < v.length / 3; i++) colors.set([lin(c[3 * i]), lin(c[3 * i + 1]), lin(c[3 * i + 2]), 1], 4 * i);
  // Canonical LÉLU orientation: TripoSR's front faces +X (Z-up); LÉLU assets face −Y in
  // Z-up (= +Z in glTF). Rotation about Z by −90°: (x, y, z) → (y, −x, z). Recorded in extras.
  const canon = new Float32Array(v.length);
  for (let i = 0; i < v.length; i += 3) canon.set([v[i + 1], -v[i], v[i + 2]], i);
  const mesh: Mesh = { positions: canon, indices: new Uint32Array(f), colors };
  mesh.normals = vertexNormals(mesh);
  const glb = writeGlb([{ name: "triposr", mesh, extras: { provenance: "SYNTHESIZED", source: "triposr", canonicalRotation: "Rz(-90deg) applied to TripoSR Z-up frame; NRE grid stays in the source frame" } }], { sourceAxes: "z-up-right-handed", extras: { asre: "triposr-ingest" } });
  writeFileSync(path.join(dir, "reconstruction.glb"), glb);
  const report = inspectGlb(glb);
  const back = readGlbMesh(glb);
  // exported geometry is Y-up; bring it back to the grid's Z-up frame: (x, y, z)_gltf → (x, −z, y)
  const exported = new Float32Array(back.positions.length);
  // then undo the canonical rotation: (x', y', z') = (y, −x, z) ⇒ (x, y, z) = (−y', x', z')
  for (let i = 0; i < exported.length; i += 3) {
    const xc = back.positions[i], yc = -back.positions[i + 2], zc = back.positions[i + 1];
    exported.set([-yc, xc, zc], i);
  }
  const reGrid = new SparseVoxelGrid(spec);
  reGrid.fuse({ id: "revox", capturedAt: 0, source: "voxelizeMesh(reconstruction.glb)", modality: "mesh", provenance: "INFERRED", confidence: 1, parameters: {}, fingerprint: "revox", lineage: [] }, voxelizeMesh({ positions: exported, indices: back.indices }, () => true, dims, spec.origin, vs));
  const out: Record<string, unknown> = {
    cells: grid.size,
    provenance: grid.countByProvenance(),
    volume: volumeStats(grid),
    buildMs: Math.round(buildMs),
    container: { rawBytes: raw.length, deflatedBytes: packed.length, naiveBytes: naiveByteSize(grid), ratioRaw: +(naiveByteSize(grid) / raw.length).toFixed(2), ratioDeflated: +(naiveByteSize(grid) / packed.length).toFixed(2), roundTripIou: roundTrip },
    glb: { bytes: glb.length, ok: report.ok, meshValid: report.verdict.meshValid, vertices: report.geometry.vertices, triangles: report.geometry.triangles, boundsYUp: report.geometry.bounds, problems: report.problems },
    mesh: analyzeMesh(mesh),
    worker: { timings: r.timings, vertices: r.vertices, triangles: r.triangles, cameraSilhouetteIou: r.camera_silhouette_iou, frontVisibleCells: r.front_visible_cells },
    iouNreVsReVoxelizedGlb: iou(grid, reGrid),
  };
  try {
    const uv = readNpy(path.join(dir, "upstream_vertices.npy")).data as Float32Array;
    const uf = readNpy(path.join(dir, "upstream_faces.npy")).data as Int32Array;
    const upGrid = new SparseVoxelGrid(spec);
    upGrid.fuse({ id: "up", capturedAt: 0, source: "upstream", modality: "mesh", provenance: "SYNTHESIZED", confidence: 1, parameters: {}, fingerprint: "up", lineage: [] }, voxelizeMesh({ positions: uv, indices: new Uint32Array(uf) }, () => true, dims, spec.origin, vs));
    out.upstream = { iouReVoxelizedOursVsUpstream: iou(reGrid, upGrid), upstreamMesh: analyzeMesh({ positions: uv, indices: new Uint32Array(uf) }) };
  } catch {
    out.upstream = null;
  }
  if (options.render !== false) {
    out.renders = [];
    for (const view of ["front", "three-quarter", "side"] as const) {
      (out.renders as unknown[]).push(await renderGlb({ inputs: [path.join(dir, "reconstruction.glb")], output: path.join(dir, `render_${view}.png`), resolution: [512, 512], samples: 24, view }));
    }
  }
  writeFileSync(path.join(dir, "ingest.json"), JSON.stringify(out, null, 1));
  return out;
}

if (process.argv[1]?.endsWith("triposr-ingest.ts")) {
  const res = await ingest(path.resolve(process.argv[2]));
  console.log(JSON.stringify(res, (k, v) => (k === "renders" ? undefined : v), 1));
}
