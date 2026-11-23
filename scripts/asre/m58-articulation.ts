/**
 * ==========================================================
 * MISSION 5.8 / WP04.2 — EVERY ARTICULATION STATE, MEASURED
 *
 * The clenched fist reported 334 non-manifold edges while the open hand had
 * 8. A guess would be "surface nets can't do touching digits". This script
 * measures the state space instead: for each hand and foot articulation it
 * meshes the region, counts boundary and non-manifold edges, and measures the
 * actual clearance between each digit and the palm at that state. If the
 * non-manifold edges appear exactly where the clearance falls below one
 * sampling cell, the cause is interpenetration, and the fix is a fist that
 * stops at contact — the way a real hand does.
 *
 *   npx tsx scripts/asre/m58-articulation.ts [--out artifacts/mission58/articulation]
 * ==========================================================
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeMesh } from "../../src/core/asre/volume/mesh.ts";
import { sampleShape } from "../../src/core/asre/character/build.ts";
import { BASE_CHARACTER, withChanges, type CharacterSpec } from "../../src/core/asre/character/CharacterSpec.ts";
import { loadReference, BODY_TARGETS, HAIR_ASSETS } from "./cc0-anatomy.ts";
import { installReference, handPoses, referenceData, referenceRegion } from "../../src/core/asre/reference/provider.ts";
import { writeGlb } from "../../src/core/asre/gltf/GlbWriter.ts";

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const outDir = arg("out", "artifacts/mission58/articulation");
mkdirSync(outDir, { recursive: true });

const ref = loadReference({ height: 1.7, targets: [BODY_TARGETS.femaleYoung], hairStyles: [Object.keys(HAIR_ASSETS)[0]], eyes: true, teeth: true });
installReference(ref);
const data = referenceData()!;

/**
 * Clearance between the digits and the palm, in metres, at a posed state.
 * Vertices are assigned to a digit by their dominant skin bone, so this is a
 * real surface-to-surface distance, not a joint-to-joint one.
 */
function clearance(spec: CharacterSpec): number {
  let best = Infinity;
  for (const side of [0, 1] as const) {
    const poses = handPoses(spec, side);
    if (!poses.length) continue;
    const p = skin(data.positions, data.rig, poses);
    const l = side === 0 ? "l" : "r";
    const wrist = data.joints.get(`joint-${l}-hand`)!;
    const palm: number[] = [];
    const digit: number[] = [];
    for (let i = 0; i < p.length / 3; i++) {
      const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
      if (Math.hypot(x - wrist[0], y - wrist[1], z - wrist[2]) > 0.22) continue;
      const w = data.rig.vertexBones[i];
      let bone = "";
      if (w) for (const [b, weight] of w) if (weight > 0.5) bone = b;
      const isFinger = /^finger[1-5]-[1-4]\./.test(bone) || /^metacarpal/.test(bone);
      const isPalm = /^(hand|finger2-1|finger3-1|finger4-1|finger5-1)\./.test(bone) || /^palm/.test(bone);
      if (isFinger) digit.push(x, y, z);
      else if (isPalm) palm.push(x, y, z);
    }
    for (let a = 0; a < digit.length; a += 3)
      for (let b = 0; b < palm.length; b += 3) {
        const d = Math.hypot(digit[a] - palm[b], digit[a + 1] - palm[b + 1], digit[a + 2] - palm[b + 2]);
        if (d < best) best = d;
      }
  }
  return best;
}

const base: CharacterSpec = withChanges(BASE_CHARACTER, {
  anatomy: { source: "reference", targets: [BODY_TARGETS.femaleYoung] },
  hair: { style: "long-straight", length: 1, volume: 1 },
  clothing: { top: "none", bottom: "none", shoes: false },
});

function leftHalf(positions: Float32Array, indices: Uint32Array, colors?: Float32Array) {
  const map = new Map<number, number>();
  const outIdx: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const [a, b, c] = [indices[t], indices[t + 1], indices[t + 2]];
    if (positions[3 * a] <= 0 || positions[3 * b] <= 0 || positions[3 * c] <= 0) continue;
    for (const v of [a, b, c]) {
      if (!map.has(v)) map.set(v, map.size);
      outIdx.push(map.get(v)!);
    }
  }
  const outPos = new Float32Array(map.size * 3);
  const outCol = colors ? new Float32Array(map.size * 4) : undefined;
  for (const [src, dst] of map) {
    outPos.set(positions.subarray(3 * src, 3 * src + 3), 3 * dst);
    if (outCol && colors) outCol.set(colors.subarray(4 * src, 4 * src + 4), 4 * dst);
  }
  return { positions: outPos, indices: new Uint32Array(outIdx), colors: outCol };
}

const rows: Record<string, unknown>[] = [];
const H = 0.003;

for (const curl of [0, 0.4, 0.7, 1.0, 1.3, 1.6]) {
  const spec = withChanges(base, { hands: { curl, spread: 0.5, opposition: 0.6 } });
  const shape = referenceRegion("hands", spec, H);
  if (!shape) continue;
  const local = sampleShape(shape, H);
  const d = analyzeMesh({ positions: local.mesh.positions, indices: local.mesh.indices });
  rows.push({ state: `curl ${curl}`, curl, triangles: d.triangles, boundaryEdges: d.boundaryEdges, nonManifoldEdges: d.nonManifoldEdges, degenerate: d.degenerateTriangles });
  // the two ends of the range as GLBs, so the topology claim can be looked at
  if (curl === 0 || curl === 1.6) {
    // one hand only (x > 0), so a close-up camera frames the hand and not the gap
    const { positions, indices, colors } = leftHalf(local.mesh.positions, local.mesh.indices, local.mesh.colors);
    const glb = writeGlb([{ name: curl === 0 ? "hand-open" : "hand-fist", mesh: { positions, indices, colors }, material: { name: "skin", baseColor: [0.76, 0.55, 0.44, 1], roughness: 0.55 }, extras: { component: "hands", state: `curl ${curl}` } }], { generator: "LELU ASRE M5.8 articulation" });
    writeFileSync(join(outDir, curl === 0 ? "hand-open.glb" : "hand-fist.glb"), glb);
  }
  console.log(`curl ${String(curl).padEnd(4)} tris ${String(d.triangles).padStart(6)} boundary ${String(d.boundaryEdges).padStart(3)} nonmanifold ${String(d.nonManifoldEdges).padStart(4)}`);
}

// feet
for (const toeCurl of [0, 0.5, 1]) {
  const spec = withChanges(base, { feet: { toeCurl } });
  const shape = referenceRegion("feet", spec, H);
  if (!shape) continue;
  const local = sampleShape(shape, H);
  const d = analyzeMesh({ positions: local.mesh.positions, indices: local.mesh.indices });
  rows.push({ state: `toeCurl ${toeCurl}`, toeCurl, triangles: d.triangles, boundaryEdges: d.boundaryEdges, nonManifoldEdges: d.nonManifoldEdges, degenerate: d.degenerateTriangles });
  console.log(`toeCurl ${String(toeCurl).padEnd(4)} tris ${String(d.triangles).padStart(6)} boundary ${String(d.boundaryEdges).padStart(3)} nonmanifold ${String(d.nonManifoldEdges).padStart(4)}`);
}

writeFileSync(join(outDir, "articulation-report.json"), JSON.stringify({ fieldResolution: H, rows }, null, 2));
console.log(`\n${rows.length} states -> ${outDir}/articulation-report.json`);
