#!/usr/bin/env node
/**
 * Locate the non-manifold edges of a component mesh, in world coordinates, so
 * a topology defect is fixed where it actually is instead of guessed at.
 *
 *   npx tsx scripts/asre/m58-diag-edges.ts [--component hands] [--curl 0.22]
 */
import { BASE_CHARACTER, withChanges } from "../../src/core/asre/character/CharacterSpec.ts";
import { DEFAULT_LATTICE, buildCharacter } from "../../src/core/asre/character/build.ts";
import type { ComponentId } from "../../src/core/asre/character/components.ts";

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const id = flag("component", "hands") as ComponentId;
const curl = Number(flag("curl", String(BASE_CHARACTER.hands.curl)));

const b = buildCharacter(withChanges(BASE_CHARACTER, { hands: { curl } }), null, DEFAULT_LATTICE, [id]);
const m = b.components[0].local!.mesh;
const p = m.positions, ix = m.indices;
const edges = new Map<string, number[]>();
for (let i = 0; i < ix.length; i += 3)
  for (let e = 0; e < 3; e++) {
    const u = ix[i + e], v = ix[i + ((e + 1) % 3)];
    const key = u < v ? `${u}_${v}` : `${v}_${u}`;
    const list = edges.get(key);
    if (list) list.push(i);
    else edges.set(key, [i]);
  }
const bad: Array<{ a: number[]; b: number[]; count: number }> = [];
for (const [key, tris] of edges) if (tris.length > 2) {
  const [u, v] = key.split("_").map(Number);
  bad.push({ a: [p[u * 3], p[u * 3 + 1], p[u * 3 + 2]].map((x) => +x.toFixed(4)), b: [p[v * 3], p[v * 3 + 1], p[v * 3 + 2]].map((x) => +x.toFixed(4)), count: tris.length });
}
console.log(`${id}: ${edges.size} edges, ${bad.length} non-manifold`);
for (const e of bad.slice(0, 40)) console.log(`  ${e.count}×  ${JSON.stringify(e.a)} — ${JSON.stringify(e.b)}`);
const groups: Record<string, number> = {};
for (const e of bad) {
  const mid = [(e.a[0] + e.b[0]) / 2, (e.a[1] + e.b[1]) / 2, (e.a[2] + e.b[2]) / 2];
  // coarse 5 cm clustering, enough to say WHERE on the body
  const key = mid.map((x) => Math.round(x / 0.05) * 0.05).join(",");
  groups[key] = (groups[key] ?? 0) + 1;
}
console.log("clusters (5 cm):", JSON.stringify(groups, null, 1));
