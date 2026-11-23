/**
 * LÉLU ASRE — meshing and GLB output, checked as geometry (watertight,
 * outward winding, volume, axis conversion) and re-read by LÉLU's own
 * GlbInspector.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { SparseVoxelGrid, iou, type Observation, type Vec3 } from "../src/core/asre/nre";
import { ballCells, boxCells } from "../src/core/asre/volume/shapes";
import { analyzeMesh, surfaceNets, voxelFaceMesh, voxelizeMesh } from "../src/core/asre/volume/mesh";
import { signedDistance, unionBox } from "../src/core/asre/volume/volumetric";
import { writeGlb, zUpToYUp } from "../src/core/asre/gltf/GlbWriter";
import { inspectGlb } from "../src/core/forge/GlbInspector";

const res = 0.00625;
const spec = { resolution: res, origin: [-0.2, -0.2, -0.2] as Vec3, dims: [64, 64, 64] as Vec3, coordinateSystem: "y-up-right-handed" as const };
const o: Observation = { id: "s", capturedAt: 0, source: "t", modality: "voxel-grid", provenance: "OBSERVED", confidence: 1, parameters: {}, fingerprint: "s", lineage: [] };
const gridOf = (cells: Vec3[]) => {
  const g = new SparseVoxelGrid(spec);
  g.fuse(o, cells);
  return g;
};

test("voxel-face mesh of a 12³ block is closed, outward, and has the block's exact volume", () => {
  const g = gridOf(boxCells([10, 10, 10], [12, 12, 12]));
  const r = analyzeMesh(voxelFaceMesh(g));
  assert.equal(r.watertight, true);
  assert.equal(r.consistentlyOriented, true);
  assert.equal(r.degenerateTriangles, 0);
  assert.equal(r.triangles, 6 * 144 * 2);
  assert.ok(Math.abs(r.signedVolume - 1728 * res ** 3) / (1728 * res ** 3) < 1e-4);
});

test("voxel-face mesh of a sphere voxelizes back to the same cells (IoU 1)", () => {
  const g = gridOf(ballCells([32, 32, 32], 12));
  const mesh = voxelFaceMesh(g);
  const r = analyzeMesh(mesh);
  assert.equal(r.watertight, true);
  assert.ok(r.signedVolume > 0);
  const back = gridOf(voxelizeMesh(mesh, () => true, spec.dims, spec.origin, res));
  assert.equal(iou(back, g), 1);
});

test("surface nets on a signed distance field: closed, outward, volume within 3% of the sphere", () => {
  const g = gridOf(ballCells([32, 32, 32], 14));
  const box = unionBox([g], 2)!;
  const sdf = signedDistance(g, box);
  const mesh = surfaceNets({ values: sdf, dims: box.dim, origin: [spec.origin[0] + (box.lo[0] + 0.5) * res, spec.origin[1] + (box.lo[1] + 0.5) * res, spec.origin[2] + (box.lo[2] + 0.5) * res], spacing: res });
  const r = analyzeMesh(mesh);
  assert.equal(r.watertight, true);
  assert.equal(r.consistentlyOriented, true);
  const truth = (4 / 3) * Math.PI * (14 * res) ** 3;
  assert.ok(r.signedVolume > 0);
  assert.ok(Math.abs(r.signedVolume - truth) / truth < 0.03, `volume ${r.signedVolume} vs ${truth}`);
});

test("GLB: LÉLU's inspector accepts it and measures exactly what was written", () => {
  const g = gridOf(ballCells([32, 32, 32], 10));
  const mesh = voxelFaceMesh(g, () => [0.9, 0.5, 0.3, 1]);
  const glb = writeGlb([{ name: "ball", mesh, material: { name: "clay", baseColor: [0.9, 0.5, 0.3, 1] }, extras: { provenance: "OBSERVED" } }], { extras: { snapshot: "s1" } });
  const report = inspectGlb(glb);
  assert.equal(report.ok, true, report.problems.join("; "));
  assert.equal(report.verdict.meshValid, true);
  assert.equal(report.geometry.vertices, mesh.positions.length / 3);
  assert.equal(report.geometry.triangles, mesh.indices.length / 3);
  assert.equal(glb.length % 4, 0);
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + new DataView(glb.buffer).getUint32(12, true))));
  assert.equal(json.nodes[0].extras.provenance, "OBSERVED");
  assert.equal(json.scenes[0].extras.snapshot, "s1");
});

test("Z-up → glTF Y-up is a proper rotation: up stays up, winding stays outward", () => {
  // a tall box in Z-up (taller along z)
  const zspec = { ...spec, coordinateSystem: "z-up-right-handed" as const };
  const g = new SparseVoxelGrid(zspec);
  g.fuse(o, boxCells([20, 20, 10], [4, 4, 30]));
  const mesh = voxelFaceMesh(g);
  const converted = { positions: zUpToYUp(mesh.positions), indices: mesh.indices };
  const r = analyzeMesh(converted);
  const size = r.bounds.max.map((v, i) => v - r.bounds.min[i]);
  assert.ok(size[1] > size[0] * 5 && size[1] > size[2] * 5, `height must be on +Y after conversion: ${size}`);
  assert.ok(r.signedVolume > 0, "winding is still outward (det = +1)");
  const report = inspectGlb(writeGlb([{ name: "tall", mesh }], { sourceAxes: "z-up-right-handed" }));
  const s = report.geometry.bounds!.size;
  assert.ok(s[1] > s[0] * 5, `inspector sees the height on Y: ${s}`);
});
