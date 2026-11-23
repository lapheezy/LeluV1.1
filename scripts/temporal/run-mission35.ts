/**
 * ==========================================================
 * TEMPORAL STUDIO — MISSION 3.5 RUNNER
 *
 * Runs the four Mission 3.5 experiments, writes their reports, and
 * exports the geometry assets WP4 asks for: a real GLB of a dense
 * solid written two ways — boundary only, and every occupied cell —
 * so the difference can be rendered rather than asserted.
 *
 *   npx tsx scripts/temporal/run-mission35.ts
 * ==========================================================
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createGrid } from "../../src/temporal/nre/voxels.ts";
import { voxelCount } from "../../src/temporal/nre/voxels.ts";
import { filledSphere } from "../../src/temporal/nre/shapes.ts";
import { voxelsFromCoords } from "../../src/temporal/nre/voxels.ts";
import { boundaryOf, encodeGlb, meshFromVoxels, type TriangleMesh } from "../../src/temporal/nre/geometry.ts";
import { measureVolume } from "../../src/temporal/nre/volume.ts";
import { analyseRepresentation } from "../../src/temporal/nre/select.ts";
import { inspectGlb } from "../../src/core/forge/GlbInspector.ts";
import {
  runInterpolationExperiment,
  runPerformance35,
  runRepresentationExperiment,
  runVolumeExperiment,
} from "../../src/temporal/nre/experiments/mission35.ts";

const outDir = path.join(process.cwd(), "artifacts", "mission35");
mkdirSync(outDir, { recursive: true });

const write = (name: string, value: unknown): string => {
  const file = path.join(outDir, name);
  writeFileSync(file, `${JSON.stringify(value, null, 1)}\n`);
  return file;
};

/* --------------------------------------------------------------- WP4 assets */

/**
 * Every occupied cell as a closed cube. meshFromVoxels deliberately skips
 * faces between two occupied cells, which is correct for a surface and
 * exactly what deletes the interior; this emits those faces too.
 */
function solidMeshFromVoxels(voxels: ReturnType<typeof filledSphere>): TriangleMesh {
  const grid = voxels.grid;
  const n = voxelCount(voxels);
  const positions = new Float64Array(n * 8 * 3);
  const indices = new Uint32Array(n * 12 * 3);
  // Corner order 0..7 is (x,y,z) with z slowest: 0=(0,0,0) 1=(1,0,0)
  // 2=(1,1,0) 3=(0,1,0) 4=(0,0,1) 5=(1,0,1) 6=(1,1,1) 7=(0,1,1).
  // Each triangle is wound counter-clockwise seen from outside, so renderers
  // shade the visible face rather than the back of it.
  const CUBE_FACES = [
    [0, 2, 1], [0, 3, 2], // -z
    [4, 5, 6], [4, 6, 7], // +z
    [0, 1, 5], [0, 5, 4], // -y
    [3, 7, 6], [3, 6, 2], // +y
    [0, 4, 7], [0, 7, 3], // -x
    [1, 2, 6], [1, 6, 5], // +x
  ];
  const s = grid.cellSize;
  let p = 0;
  let q = 0;
  for (let v = 0; v < n; v++) {
    const x = grid.origin[0] + voxels.coords[v * 3] * s;
    const y = grid.origin[1] + voxels.coords[v * 3 + 1] * s;
    const z = grid.origin[2] + voxels.coords[v * 3 + 2] * s;
    const base = v * 8;
    for (const [dx, dy, dz] of [
      [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
      [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
    ] as Array<[number, number, number]>) {
      positions[p++] = x + dx * s;
      positions[p++] = y + dy * s;
      positions[p++] = z + dz * s;
    }
    for (const face of CUBE_FACES) {
      indices[q++] = base + face[0];
      indices[q++] = base + face[1];
      indices[q++] = base + face[2];
    }
  }
  return { positions: new Float32Array(positions), indices };
}

const G24 = createGrid({ cellSize: 0.05, resolution: [24, 24, 24] });
const solid = filledSphere(G24, [0.6, 0.6, 0.6], 0.44);
const boundaryOnly = meshFromVoxels(solid);
const everyCell = solidMeshFromVoxels(solid);
const boundaryGlb = encodeGlb(boundaryOnly, { name: "nre-solid-boundary", generator: "nre-mission35" });
const solidGlb = encodeGlb(everyCell, { name: "nre-solid-all-cells", generator: "nre-mission35" });
writeFileSync(path.join(outDir, "nre_solid_boundary.glb"), boundaryGlb);
writeFileSync(path.join(outDir, "nre_solid_all_cells.glb"), solidGlb);

// Cutaway variants, built here rather than in Blender: cutting by whole
// cells keeps every cube closed and correctly wound, so the exposed cross
// section is real geometry instead of an open shell that shades to black.
const cutCells = (voxels: typeof solid, keepBelowY: number) => {
  const kept: number[] = [];
  for (let v = 0; v < voxelCount(voxels); v++) {
    if (voxels.coords[v * 3 + 1] <= keepBelowY) kept.push(voxels.coords[v * 3], voxels.coords[v * 3 + 1], voxels.coords[v * 3 + 2]);
  }
  return voxelsFromCoords(G24, Int32Array.from(kept), { confidence: 0.7 });
};

const halfway = 11;
const cutSolid = cutCells(solid, halfway);
const cutBoundary = cutCells(boundaryOf(solid), halfway);
const cutBoundaryGlb = encodeGlb(meshFromVoxels(cutBoundary), { name: "nre-solid-boundary-cut", generator: "nre-mission35" });
const cutSolidGlb = encodeGlb(solidMeshFromVoxels(cutSolid), { name: "nre-solid-all-cells-cut", generator: "nre-mission35" });
writeFileSync(path.join(outDir, "nre_solid_boundary_cut.glb"), cutBoundaryGlb);
writeFileSync(path.join(outDir, "nre_solid_all_cells_cut.glb"), cutSolidGlb);

const solidMetrics = measureVolume(solid);
const solidDecision = analyseRepresentation(solid);
const assetReport = {
  shape: "filled sphere, radius 0.44 m, 5 cm cells",
  cells: solidMetrics.cells,
  boundaryCells: solidMetrics.boundaryCells,
  interiorCells: solidMetrics.interiorCells,
  interiorFraction: solidMetrics.interiorFraction,
  decision: solidDecision.kind,
  storage: solidDecision.storage,
  exports: [
    {
      file: "nre_solid_boundary.glb",
      bytes: boundaryGlb.byteLength,
      triangles: boundaryOnly.indices.length / 3,
      accepted: inspectGlb(boundaryGlb).ok,
      keepsInterior: false,
      note: "boundary extraction: interior faces are skipped by definition, so the interior is gone",
    },
    {
      file: "nre_solid_all_cells.glb",
      bytes: solidGlb.byteLength,
      triangles: everyCell.indices.length / 3,
      accepted: inspectGlb(solidGlb).ok,
      keepsInterior: true,
      note: "one closed cube per occupied cell: the interior is real geometry, not a shading effect",
    },
    {
      file: "nre_solid_boundary_cut.glb",
      bytes: cutBoundaryGlb.byteLength,
      triangles: cutBoundaryGlb.byteLength > 0 ? (meshFromVoxels(cutBoundary).indices.length / 3) : 0,
      accepted: inspectGlb(cutBoundaryGlb).ok,
      keepsInterior: false,
      note: `cutaway at cell row ${halfway}: same solid, boundary export only`,
    },
    {
      file: "nre_solid_all_cells_cut.glb",
      bytes: cutSolidGlb.byteLength,
      triangles: solidMeshFromVoxels(cutSolid).indices.length / 3,
      accepted: inspectGlb(cutSolidGlb).ok,
      keepsInterior: true,
      note: `cutaway at cell row ${halfway}: same solid, every cell kept`,
    },
  ],
  trianglesRatio: (everyCell.indices.length / 3) / Math.max(1, boundaryOnly.indices.length / 3),
  bytesRatio: solidGlb.byteLength / Math.max(1, boundaryGlb.byteLength),
};
write("wp4_assets.json", assetReport);

/* ------------------------------------------------------------------ reports */

const volume = await runVolumeExperiment();
write("wp1_volume.json", volume);

const representation = await runRepresentationExperiment();
write("wp2_representation.json", representation);

const interpolation = await runInterpolationExperiment();
write("wp3_interpolation.json", interpolation);

const performance = await runPerformance35();
write("wp7_performance.json", performance);

const rows = [
  ["WP1 volumetric preservation", volume.summary.status, `${volume.cases.length} cases`],
  ["WP2 adaptive representation", representation.summary.status, `${representation.summary.passed}/${representation.summary.cases} classified as measured`],
  ["WP3 temporal interpolation", interpolation.summary.status, `${interpolation.cases.length} interpolants, all labelled interpolated`],
  ["WP4 3D assets", assetReport.exports.every((e) => e.accepted) ? "VERIFIED" : "PARTIAL", `${assetReport.cells} cells → ${assetReport.exports[1].triangles} triangles`],
  ["WP7 performance", performance.status, `${performance.rows.length} measured operations`],
] as const;

console.log("\nMISSION 3.5\n");
for (const [name, status, detail] of rows) console.log(`  ${status.padEnd(9)} ${name.padEnd(30)} ${detail}`);
console.log(`\n  reports → artifacts/mission35/`);
