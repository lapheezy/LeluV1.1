/**
 * ==========================================================
 * LÉLU — MEASURED DIAGNOSTICS OF A GENERATED CHARACTER
 *
 * What a render cannot prove, measured:
 *
 *   topology   per component: triangles, vertices, open (boundary) edges,
 *              non-manifold edges, degenerate triangles, edge-length spread;
 *              and the union of her skin components welded into one surface
 *              (0 open edges = one continuous, closed skin)
 *   coverage   for every skin vertex in an anatomical zone (bust, pelvis
 *              front, crotch, seat, thighs, shins), whether a garment solid
 *              lies over it along its outward normal within 6 cm
 *   occupancy  IoU of the per-component build against the conventional
 *              whole-object build on the shared lattice (must be 1.000000)
 *
 *   npx tsx scripts/asre/lelu-diagnostics.ts --out <dir> [--no-iou]
 * ==========================================================
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCharacter, buildWholeObject, codesIou, ComponentCache, DEFAULT_LATTICE, occupancyCodes, placedMesh } from "../../src/core/asre/character/build.ts";
import { COMPONENTS, contextFor, skeleton } from "../../src/core/asre/character/components.ts";
import { leluCanon, LELU_IDENTITY } from "../../src/core/asre/character/leluIdentity.ts";
import { withChanges, type CharacterSpec } from "../../src/core/asre/character/CharacterSpec.ts";
import { bodySurface, BODY_LABEL } from "../../src/core/asre/reference/provider.ts";
import { edgeStats } from "../../src/core/asre/reference/surface.ts";
import { loadReference } from "./cc0-anatomy.ts";

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const outDir = arg("out", "artifacts/lelu/diagnostics");
const doIou = !process.argv.includes("--no-iou");
mkdirSync(outDir, { recursive: true });

export function leluBuildSpec(): CharacterSpec {
  const s = leluCanon();
  return withChanges(s, { identity: { id: LELU_IDENTITY.id, name: LELU_IDENTITY.name, leluLook: "canonical" } });
}

const spec = leluBuildSpec();
const ref = loadReference({ height: spec.body.height, targets: spec.anatomy.targets, hairStyles: [spec.hair.style], eyes: true, teeth: true });
const J = (n: string) => ref.joints.get(n)!;
const L = DEFAULT_LATTICE;

const t0 = performance.now();
const build = buildCharacter(spec, new ComponentCache(), L);
const buildMs = performance.now() - t0;

/* ------------------------------- topology -------------------------------- */
function weld(positions: Float32Array, indices: Uint32Array, eps = 1e-6): Uint32Array {
  const map = new Map<string, number>();
  const remap = new Uint32Array(positions.length / 3);
  for (let v = 0; v < remap.length; v++) {
    const k = `${Math.round(positions[3 * v] / eps)},${Math.round(positions[3 * v + 1] / eps)},${Math.round(positions[3 * v + 2] / eps)}`;
    let r = map.get(k);
    if (r === undefined) map.set(k, (r = map.size));
    remap[v] = r;
  }
  return indices.map((i) => remap[i]);
}

function meshStats(positions: Float32Array, indices: Uint32Array) {
  const welded = weld(positions, indices);
  const e = edgeStats(welded);
  let degenerate = 0;
  const lens: number[] = [];
  for (let t = 0; t < indices.length; t += 3) {
    const p = [0, 1, 2].map((k) => [positions[3 * indices[t + k]], positions[3 * indices[t + k] + 1], positions[3 * indices[t + k] + 2]]);
    const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2];
    const vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
    if (Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) < 1e-12) degenerate++;
    if (t % 30 === 0) lens.push(Math.hypot(ux, uy, uz));
  }
  lens.sort((a, b) => a - b);
  const q = (f: number) => +(lens[Math.floor(f * (lens.length - 1))] * 1000).toFixed(2);
  return { triangles: indices.length / 3, vertices: positions.length / 3, boundaryEdges: e.boundary, nonManifoldEdges: e.nonManifold, degenerate, edgeMm: { p5: q(0.05), median: q(0.5), p95: q(0.95) } };
}

const components: Record<string, ReturnType<typeof meshStats>> = {};
for (const c of build.components) {
  if (!c.local?.mesh.indices.length) continue;
  const m = placedMesh(c);
  components[c.id] = meshStats(m.positions, m.indices);
}

// her whole skin, welded across the components it was split into
const skinIds = Object.keys(BODY_LABEL);
{
  const parts = build.components.filter((c) => skinIds.includes(c.id) && c.local?.mesh.indices.length).map(placedMesh);
  let nv = 0, ni = 0;
  for (const m of parts) [nv, ni] = [nv + m.positions.length, ni + m.indices.length];
  const P = new Float32Array(nv), I = new Uint32Array(ni);
  let ov = 0, oi = 0;
  for (const m of parts) {
    P.set(m.positions, ov);
    for (let i = 0; i < m.indices.length; i++) I[oi + i] = m.indices[i] + ov / 3;
    ov += m.positions.length;
    oi += m.indices.length;
  }
  components["skin (welded union)"] = meshStats(P, I);
}

/* ------------------------------- coverage -------------------------------- */
const sk = skeleton(spec, L.resolution);
const cloth = (["clothing.top", "clothing.bottom", "clothing.shoes"] as const)
  .map((id) => COMPONENTS[id].build(contextFor(spec, sk, L.resolution)))
  .filter((s): s is NonNullable<typeof s> => !!s);
const covered = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => {
  for (let t = 0.0015; t <= 0.06; t += 0.003) {
    const px = x + nx * t, py = y + ny * t, pz = z + nz * t;
    for (const s of cloth) {
      if (px < s.lo[0] || py < s.lo[1] || pz < s.lo[2] || px > s.hi[0] || py > s.hi[1] || pz > s.hi[2]) continue;
      if (s.f(px, py, pz) < 0) return true;
    }
  }
  return false;
};
const pelY = J("joint-pelvis")[1], kneeY = J("joint-l-knee")[1], ankY = J("joint-l-ankle")[1], chestY = J("joint-spine-1")[1];
const zones: Record<string, (x: number, y: number, z: number) => boolean> = {
  bust: (x, y, z) => y > chestY - 0.09 && y < chestY + 0.02 && z > 0.03 && Math.abs(x) < 0.14,
  "pelvis-front": (x, y, z) => y > pelY - 0.13 && y < pelY + 0.08 && z > 0,
  crotch: (x, y) => Math.abs(x) < 0.06 && y > pelY - 0.18 && y < pelY - 0.06,
  seat: (x, y, z) => y > pelY - 0.15 && y < pelY + 0.08 && z < 0,
  thighs: (x, y) => y > kneeY && y < pelY - 0.13 && Math.abs(x) > 0.02,
  shins: (_x, y) => y > ankY + 0.1 && y < kneeY,
};
const body = bodySurface(spec);
const legal = new Set([BODY_LABEL.torso, BODY_LABEL.pelvis, BODY_LABEL.legs]);
const onSkin = new Uint8Array(body.positions.length / 3);
for (let t = 0; t < body.labels.length; t++) if (legal.has(body.labels[t])) for (let k = 0; k < 3; k++) onSkin[body.indices[3 * t + k]] = 1;
const coverage: Record<string, { vertices: number; covered: number; percent: number }> = {};
for (const [name, inZone] of Object.entries(zones)) {
  let n = 0, c = 0;
  for (let v = 0; v < onSkin.length; v += 2) {
    if (!onSkin[v]) continue;
    const x = body.positions[3 * v], y = body.positions[3 * v + 1], z = body.positions[3 * v + 2];
    if (!inZone(x, y, z)) continue;
    n++;
    if (covered(x, y, z, body.normals[3 * v], body.normals[3 * v + 1], body.normals[3 * v + 2])) c++;
  }
  coverage[name] = { vertices: n, covered: c, percent: n ? +((100 * c) / n).toFixed(2) : 100 };
}

/* ------------------------------- occupancy ------------------------------- */
let occupancy: Record<string, number> | null = null;
if (doIou) {
  const parts = occupancyCodes(build, L);
  const whole = buildWholeObject(spec, L);
  let inter = 0;
  for (const c of parts) if (whole.codes.has(c)) inter++;
  occupancy = { componentCells: parts.size, wholeCells: whole.codes.size, intersection: inter, iou: codesIou(parts, whole.codes) };
}

let tris = 0;
for (const c of Object.entries(components)) if (!c[0].startsWith("skin")) tris += c[1].triangles;
const report = { character: LELU_IDENTITY.id, referenceDigest: ref.digest, buildMs: Math.round(buildMs), triangles: tris, components, coverage, occupancy };
writeFileSync(join(outDir, "diagnostics.json"), JSON.stringify(report, null, 1));
console.log(`build ${(buildMs / 1000).toFixed(1)} s, ${tris.toLocaleString()} triangles`);
for (const [k, v] of Object.entries(components)) console.log(`  ${k.padEnd(22)} tris ${String(v.triangles).padStart(8)}  open ${String(v.boundaryEdges).padStart(6)}  nonmanifold ${String(v.nonManifoldEdges).padStart(5)}  edge mm ${v.edgeMm.p5}/${v.edgeMm.median}/${v.edgeMm.p95}`);
for (const [k, v] of Object.entries(coverage)) console.log(`  coverage ${k.padEnd(14)} ${v.percent.toFixed(2).padStart(7)} %  (${v.covered}/${v.vertices})`);
if (occupancy) console.log(`  occupancy IoU ${occupancy.iou.toFixed(6)}  (${occupancy.componentCells} vs ${occupancy.wholeCells} cells)`);
