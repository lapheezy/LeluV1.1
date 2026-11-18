/**
 * Inspect a MakeHuman reference mesh: bounds, scale, vertex groups and the
 * anatomical landmarks those groups encode. Read-only reconnaissance; the
 * real loader is src/core/asre/reference/.
 */
import { readFileSync } from "node:fs";

const path = process.argv[2];
const text = readFileSync(path, "utf8");
const pos = [];
const groups = new Map();
let cur = null;
const faces = [];
for (const line of text.split("\n")) {
  if (line.startsWith("v ")) {
    const [x, y, z] = line.slice(2).trim().split(/\s+/).map(Number);
    pos.push([x, y, z]);
  } else if (line.startsWith("g ")) {
    cur = line.slice(2).trim();
    groups.set(cur, []);
  } else if (line.startsWith("f ")) {
    const idx = line.slice(2).trim().split(/\s+/).map((t) => parseInt(t.split("/")[0], 10) - 1);
    faces.push(idx);
    if (cur) groups.get(cur).push(...idx);
  }
}
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const p of pos) for (let a = 0; a < 3; a++) { lo[a] = Math.min(lo[a], p[a]); hi[a] = Math.max(hi[a], p[a]); }
const size = hi.map((v, i) => +(v - lo[i]).toFixed(4));
console.log("vertices", pos.length, "faces", faces.length, "groups", groups.size);
console.log("bounds lo", lo.map((v) => +v.toFixed(4)), "hi", hi.map((v) => +v.toFixed(4)), "size", size);
console.log("height axis size", size[1], "-> scale to 1.70 m =", (1.7 / size[1]).toFixed(5));

const centre = (name) => {
  const idx = [...new Set(groups.get(name) ?? [])];
  if (!idx.length) return null;
  const c = [0, 0, 0];
  for (const i of idx) for (let a = 0; a < 3; a++) c[a] += pos[i][a];
  return c.map((v) => +(v / idx.length).toFixed(4));
};

// Every joint group, ordered by Y, so the skeleton can be read off the mesh.
const joints = [...groups.keys()].filter((g) => g.startsWith("joint-"));
const rows = joints.map((g) => ({ g, c: centre(g), n: new Set(groups.get(g)).size })).filter((r) => r.c);
rows.sort((a, b) => b.c[1] - a.c[1]);
console.log("\n--- joint groups (top to bottom) ---");
for (const r of rows) console.log(r.g.padEnd(30), "y", String(r.c[1]).padStart(8), "x", String(r.c[0]).padStart(8), "z", String(r.c[2]).padStart(8), "verts", r.n);

const nonJoint = [...groups.keys()].filter((g) => !g.startsWith("joint-"));
console.log("\n--- non-joint groups ---", nonJoint.join(", "));
