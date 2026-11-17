/**
 * ==========================================================
 * TEMPORAL STUDIO — WP3 VISUAL ASSETS
 *
 * Two observed snapshots and one interpolated midpoint, written as GLB so
 * they can be rendered and compared. The midpoint carries
 * `state: "interpolated"` in the report below: it is a generated state and
 * is never passed off as an observation.
 *
 *   npx tsx scripts/temporal/export-interpolation-assets.ts
 * ==========================================================
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { createGrid, voxelCount } from "../../src/temporal/nre/voxels.ts";
import { sphereShell, translationMatrix, withUniformConfidence } from "../../src/temporal/nre/shapes.ts";
import { transformVoxels } from "../../src/temporal/nre/voxels.ts";
import { encodeGlb, meshFromVoxels } from "../../src/temporal/nre/geometry.ts";
import { MemorySnapshotStore, createTemporalObject, recordSnapshot, restoreSnapshot } from "../../src/temporal/nre/snapshot.ts";
import { interpolateSnapshots } from "../../src/temporal/nre/interpolate.ts";
import { inspectGlb } from "../../src/core/forge/GlbInspector.ts";

const outDir = path.join(process.cwd(), "artifacts", "mission35");
mkdirSync(outDir, { recursive: true });

const grid = createGrid({ cellSize: 0.05, resolution: [32, 32, 32] });
const start = withUniformConfidence(sphereShell(grid, [0.5, 0.5, 0.5], 0.3, 0.1), 0.55);
const end = withUniformConfidence(
  transformVoxels(start, translationMatrix(7 * grid.cellSize, 0, 0), {}).voxels,
  0.9,
);

const store = new MemorySnapshotStore();
let object = createTemporalObject({ objectId: "wp3-visual", createdAt: "2026-11-17T00:00:00.000Z" });

const record = async (voxels: typeof start, ordinal: number, confidence: number) => {
  const result = await recordSnapshot(
    object,
    {
      voxels,
      observations: [],
      state: "observed",
      createdAt: `2026-11-17T00:00:0${ordinal}.000Z`,
      observedAt: `2026-11-17T00:00:0${ordinal}.000Z`,
      summary: `observed state ${ordinal}`,
    },
    store,
  );
  object = result.object;
  return restoreSnapshot(object, result.record.id, store);
};

const a = await record(start, 1, 0.55);
const b = await record(end, 2, 0.9);

const midpoint = interpolateSnapshots(a.snapshot, b.snapshot, 0.5, { method: "correspondence" });

const exportSet = (name: string, voxels: typeof start) => {
  const mesh = meshFromVoxels(voxels);
  const glb = encodeGlb(mesh, { name, generator: "nre-mission35-wp3" });
  writeFileSync(path.join(outDir, `${name}.glb`), glb);
  return {
    file: `${name}.glb`,
    cells: voxelCount(voxels),
    triangles: mesh.indices.length / 3,
    bytes: glb.byteLength,
    accepted: inspectGlb(glb).ok,
  };
};

const assets = [
  { ...exportSet("wp3_state_t0_observed", start), label: "t=0 observed", confidence: 0.55, state: "observed" },
  { ...exportSet("wp3_state_t05_interpolated", midpoint.voxels), label: "t=0.5 generated", confidence: null, state: midpoint.state },
  { ...exportSet("wp3_state_t1_observed", end), label: "t=1 observed", confidence: 0.9, state: "observed" },
];

// All three states in one mesh at fixed offsets, so a single render shows the
// motion in a common frame. Framing each state separately would centre every
// one of them and make a translation look like no change at all.
const combinedOffset = 0.75;
const combined = (() => {
  const positions: number[] = [];
  const indices: number[] = [];
  [start, midpoint.voxels, end].forEach((voxels, index) => {
    const mesh = meshFromVoxels(voxels);
    const base = positions.length / 3;
    const shift = (index - 1) * combinedOffset;
    for (let p = 0; p < mesh.positions.length; p += 3) {
      positions.push(mesh.positions[p] + shift, mesh.positions[p + 1], mesh.positions[p + 2]);
    }
    for (const i of mesh.indices) indices.push(base + i);
  });
  return { positions: new Float32Array(positions), indices: new Uint32Array(indices) };
})();
const combinedGlb = encodeGlb(combined, { name: "wp3-states", generator: "nre-mission35-wp3" });
writeFileSync(path.join(outDir, "wp3_states_combined.glb"), combinedGlb);

const report = {
  combined: {
    file: "wp3_states_combined.glb",
    bytes: combinedGlb.byteLength,
    triangles: combined.indices.length / 3,
    accepted: inspectGlb(combinedGlb).ok,
    order: ["t=0 observed", "t=0.5 interpolated", "t=1 observed"],
    spacingMetres: combinedOffset,
  },
  method: midpoint.method,
  midpointState: midpoint.state,
  sources: midpoint.sources,
  uncertainty: midpoint.summary ?? null,
  assets,
  statement:
    "Only t=0 and t=1 are observations. The midpoint is generated from them, is labelled interpolated, and carries the uncertainty its two sources cannot resolve.",
};

writeFileSync(path.join(outDir, "wp3_visual.json"), `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify(report, null, 1));
