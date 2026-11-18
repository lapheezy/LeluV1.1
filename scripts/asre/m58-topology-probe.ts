/**
 * ==========================================================
 * MISSION 5.8 / WP04.2 — LOCATE THE NON-MANIFOLD EDGES
 *
 * Counting them is not enough: the fix depends on WHERE they are. This probe
 * meshes the hand at a state, finds every edge shared by more than two
 * triangles, attributes it to the nearest joint marker, and repeats at two
 * sampling resolutions. If the count collapses when the field gets finer, the
 * cause is a thin gap (under one cell) between two surfaces — not a hole, and
 * not a defect in the articulation itself.
 *
 *   npx tsx scripts/asre/m58-topology-probe.ts
 * ==========================================================
 */
import { analyzeMesh } from "../../src/core/asre/volume/mesh.ts";
import { sampleShape } from "../../src/core/asre/character/build.ts";
import { BASE_CHARACTER, withChanges, type CharacterSpec } from "../../src/core/asre/character/CharacterSpec.ts";
import { loadReference, BODY_TARGETS, HAIR_ASSETS } from "./cc0-anatomy.ts";
import { installReference, referenceRegion } from "../../src/core/asre/reference/provider.ts";

const ref = loadReference({ height: 1.7, targets: [BODY_TARGETS.femaleYoung], hairStyles: [Object.keys(HAIR_ASSETS)[0]], eyes: true, teeth: true });
installReference(ref);

const base: CharacterSpec = withChanges(BASE_CHARACTER, {
  anatomy: { source: "reference", targets: [BODY_TARGETS.femaleYoung] },
  hair: { style: "long-straight", length: 1, volume: 1 },
  clothing: { top: "none", bottom: "none", shoes: false },
});

const joints = [...ref.joints.entries()].filter(([n]) => /finger|hand|wrist|toe|ankle|foot/.test(n));

/** Every edge of the mesh, and the faces that use it. */
function nonManifoldEdges(positions: Float32Array, indices: Uint32Array) {
  const seen = new Map<number, number[]>();
  const key = (a: number, b: number) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);
  const nv = positions.length / 3;
  for (let t = 0; t < indices.length; t += 3) {
    const f = [indices[t], indices[t + 1], indices[t + 2]];
    for (let e = 0; e < 3; e++) {
      const a = f[e], b = f[(e + 1) % 3];
      if (a >= nv || b >= nv) continue;
      const k = key(a, b);
      const arr = seen.get(k);
      if (arr) arr.push(t / 3);
      else seen.set(k, [t / 3]);
    }
  }
  const out: { x: number; y: number; z: number; faces: number }[] = [];
  for (const [k, faces] of seen) {
    if (faces.length <= 2) continue;
    const a = Math.floor(k / 4294967296), b = k % 4294967296;
    out.push({ x: (positions[3 * a] + positions[3 * b]) / 2, y: (positions[3 * a + 1] + positions[3 * b + 1]) / 2, z: (positions[3 * a + 2] + positions[3 * b + 2]) / 2, faces: faces.length });
  }
  return out;
}

function attribute(p: { x: number; y: number; z: number }) {
  let best = "", bd = Infinity;
  for (const [n, j] of joints) {
    const d = Math.hypot(p.x - j[0], p.y - j[1], p.z - j[2]);
    if (d < bd) [bd, best] = [d, n];
  }
  return `${best} (${(bd * 1000).toFixed(0)} mm)`;
}

for (const H of [0.003, 0.002]) {
  for (const curl of [0, 1.3, 1.6, 1.9, 2.2]) {
    const spec = withChanges(base, { hands: { curl, spread: 0.5, opposition: 0.6 } });
    const shape = referenceRegion("hands", spec, H);
    if (!shape) continue;
    const local = sampleShape(shape, H);
    const d = analyzeMesh({ positions: local.mesh.positions, indices: local.mesh.indices });
    const bad = nonManifoldEdges(local.mesh.positions, local.mesh.indices);
    const tally: Record<string, number> = {};
    for (const e of bad) {
      const k = attribute(e);
      tally[k] = (tally[k] ?? 0) + 1;
    }
    const top = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}×${v}`).join(", ");
    console.log(`h ${H}  curl ${String(curl).padEnd(4)} tris ${String(d.triangles).padStart(6)} nonmanifold ${String(d.nonManifoldEdges).padStart(4)}  ${top}`);
  }
}
