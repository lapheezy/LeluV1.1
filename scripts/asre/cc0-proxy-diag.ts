/**
 * Diagnostics for the placed CC0 proxies: bounds, vertex/triangle counts and
 * whether each surface is closed (every edge shared by exactly two triangles).
 * A closed mesh can be used as a solid field; an open one must be shelled.
 */
import { loadReference } from "./cc0-anatomy.ts";
import { HAIR_ASSETS } from "./cc0-anatomy.ts";

const ref = loadReference({ height: 1.7, hairStyles: Object.keys(HAIR_ASSETS), eyes: true, teeth: true });

for (const [name, p] of Object.entries(ref.proxies)) {
  const n = p.positions.length / 3;
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.positions.length; i += 3)
    for (let a = 0; a < 3; a++) {
      const v = p.positions[i + a];
      if (v < lo[a]) lo[a] = v;
      if (v > hi[a]) hi[a] = v;
    }
  // edge census
  let boundary = 0, nonManifold = 0;
  const edges = new Map<string, number>();
  for (let t = 0; t < p.indices.length; t += 3) {
    const tri = [p.indices[t], p.indices[t + 1], p.indices[t + 2]];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  for (const c of edges.values()) {
    if (c === 1) boundary++;
    else if (c > 2) nonManifold++;
  }
  const zeroed = p.positions.length ? [...p.positions].filter((_, i) => i % 3 === 0 && p.positions[i] === 0).length : 0;
  console.log(
    `${name.padEnd(26)} verts ${String(n).padStart(6)} tris ${String(p.indices.length / 3).padStart(6)} ` +
      `closed ${boundary === 0 && nonManifold === 0 ? "YES" : `no (boundary ${boundary}, nonmanifold ${nonManifold})`} ` +
      `bounds x[${lo[0].toFixed(2)},${hi[0].toFixed(2)}] y[${lo[1].toFixed(2)},${hi[1].toFixed(2)}] z[${lo[2].toFixed(2)},${hi[2].toFixed(2)}]` +
      (zeroed ? ` zeroX ${zeroed}` : ""),
  );
}
console.log("joints: eye", ref.joints.get("joint-l-eye"), "mouth", ref.joints.get("joint-mouth"));
