/**
 * ==========================================================
 * MISSION 5.8 / WP04.1 — WHERE DOES THE OCCUPANCY REGRESSION COME FROM?
 *
 * The invariant is that a per-component character build and the conventional
 * whole-object build occupy exactly the same lattice cells: IoU 1.000. The
 * procedural path holds it. The reference path measured 0.975.
 *
 * This attributes every disagreeing cell to the component that claims it and
 * to the distance from the reference surface, so the cause is measured rather
 * than assumed.
 *
 *   npx tsx scripts/asre/m58-iou.ts [--height 1.7]
 * ==========================================================
 */
import { buildCharacter, buildWholeObject, ComponentCache, DEFAULT_LATTICE, occupancyCodes } from "../../src/core/asre/character/build.ts";
import { BASE_CHARACTER, withChanges, type CharacterSpec } from "../../src/core/asre/character/CharacterSpec.ts";
import { loadReference, BODY_TARGETS, HAIR_ASSETS } from "./cc0-anatomy.ts";
import { fieldFromMesh, fieldSdf } from "../../src/core/asre/reference/field.ts";

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};

const height = Number(arg("height", "1.7"));
const L = DEFAULT_LATTICE;
const ref = loadReference({ height, targets: [BODY_TARGETS.femaleYoung], hairStyles: Object.keys(HAIR_ASSETS), eyes: true, teeth: true });

const spec: CharacterSpec = withChanges(BASE_CHARACTER, {
  anatomy: { source: "reference", targets: [BODY_TARGETS.femaleYoung] },
  hair: { style: "long-straight", length: 1, volume: 1 },
  clothing: { top: "tshirt", bottom: "pants", shoes: true },
});

const build = buildCharacter(spec, new ComponentCache(), L);
const whole = buildWholeObject(spec, L);

/** code → owning component (the per-component build sees the same cell twice, first owner wins). */
const owner = new Map<number, string>();
const per = occupancyCodes(build, L);
for (const c of build.components) {
  const cells = c.local?.cells ?? new Int32Array(0);
  for (let i = 0; i < cells.length; i += 3) {
    const x = cells[i] + c.anchor[0] - L.originCells[0];
    const y = cells[i + 1] + c.anchor[1] - L.originCells[1];
    const z = cells[i + 2] + c.anchor[2] - L.originCells[2];
    if (x < 0 || y < 0 || z < 0 || x >= L.dims[0] || y >= L.dims[1] || z >= L.dims[2]) continue;
    const code = morton(x, y, z);
    per.add(code);
    if (!owner.has(code)) owner.set(code, c.id);
  }
}

let inter = 0;
for (const c of per) if (whole.codes.has(c)) inter++;
const union = per.size + whole.codes.size - inter;
console.log(`per-component ${per.size} cells, whole-object ${whole.codes.size} cells`);
console.log(`IoU ${(inter / union).toFixed(6)}  (intersection ${inter}, union ${union})`);
const onlyPer = [...per].filter((c) => !whole.codes.has(c));
const onlyWhole = [...whole.codes].filter((c) => !per.has(c));
console.log(`only in per-component build ${onlyPer.length}, only in whole-object build ${onlyWhole.length}`);

// distance from each disagreeing cell to the real body surface, in cells
const bodyField = fieldFromMesh(ref.positions, ref.indices, 0.003, 3, 4);
const sd = fieldSdf(bodyField);
const histogram = (codes: number[]) => {
  const bins = [0.25, 0.5, 1, 1.5, 2, 3, 5, Infinity];
  const counts = new Array(bins.length).fill(0);
  const byComponent: Record<string, number> = {};
  for (const code of codes) {
    const [x, y, z] = unmorton(code);
    const X = (x + L.originCells[0]) * L.resolution;
    const Y = (y + L.originCells[1]) * L.resolution;
    const Z = (z + L.originCells[2]) * L.resolution;
    const cells = Math.abs(sd(X, Y, Z)) / L.resolution;
    const b = bins.findIndex((t) => cells <= t);
    counts[b]++;
    const o = owner.get(code) ?? "whole-only";
    byComponent[o] = (byComponent[o] ?? 0) + 1;
  }
  return { counts, bins, byComponent };
};

for (const [label, codes] of [["per-only", onlyPer], ["whole-only", onlyWhole]] as const) {
  if (!codes.length) continue;
  const { counts, bins, byComponent } = histogram(codes);
  console.log(`\n${label}: distance to the reference surface, in cells`);
  bins.forEach((t, i) => counts[i] && console.log(`  ≤ ${String(t).padStart(4)} cells: ${String(counts[i]).padStart(6)}`));
  console.log(`  by component: ${Object.entries(byComponent).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
}

// the same question for the procedural path, which must stay at 1.000
const proc = withChanges(spec, { anatomy: { source: "procedural", targets: [] } });
const pb = buildCharacter(proc, new ComponentCache(), L);
const pw = buildWholeObject(proc, L);
let pi = 0;
const pset = occupancyCodes(pb, L);
for (const c of pset) if (pw.codes.has(c)) pi++;
const pu = pset.size + pw.codes.size - pi;
console.log(`\nprocedural control: IoU ${(pi / pu).toFixed(6)} (${pset.size} vs ${pw.codes.size} cells)`);

function morton(x: number, y: number, z: number): number {
  return mortonBits(x) | (mortonBits(y) << 1) | (mortonBits(z) << 2);
}
function mortonBits(v: number): number {
  let x = v & 0x3ff;
  x = (x | (x << 16)) & 0x030000ff;
  x = (x | (x << 8)) & 0x0300f00f;
  x = (x | (x << 4)) & 0x030c30c3;
  x = (x | (x << 2)) & 0x09249249;
  return x >>> 0;
}
function unmorton(code: number): [number, number, number] {
  const un = (c: number) => {
    let x = c & 0x09249249;
    x = (x ^ (x >>> 2)) & 0x030c30c3;
    x = (x ^ (x >>> 4)) & 0x0300f00f;
    x = (x ^ (x >>> 8)) & 0x030000ff;
    x = (x ^ (x >>> 16)) & 0x03ff;
    return x;
  };
  return [un(code), un(code >>> 1), un(code >>> 2)];
}
