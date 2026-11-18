/**
 * LÉLU — eye geometry probe.
 *
 * The rendered eyes read as round white balls, which means either the lid
 * opening is not where the eyeball is or the eyeball is not where the opening
 * is. This measures both, in world space, on the built field:
 *
 *   - where the head field is open (outside) along her eye line
 *   - the extent of the "face" (eyeball) geometry
 *
 *   npx tsx scripts/asre/lelu-eye-probe.ts
 */
import { leluCanon } from "../../src/core/asre/character/leluIdentity.ts";
import { FIELD_H } from "../../src/core/asre/reference/provider.ts";
import { faceMasks, referenceRegion } from "../../src/core/asre/reference/provider.ts";
import type { V3 } from "../../src/core/asre/character/shape.ts";
import { loadReference } from "./cc0-anatomy.ts";

const spec = leluCanon();
loadReference({ height: spec.body.height, targets: spec.anatomy.targets, hairStyles: ["long-wavy"], eyes: true, teeth: true });

const { eyes } = faceMasks();
const specEyeballZ = () => `placed ${(12 + 1.2).toFixed(1)} mm behind the skin front`;
const eL = eyes[0], eR = eyes[1];
const eyeY = (eL[1] + eR[1]) / 2;
console.log(`eye joints: L=[${eL.map((v) => v.toFixed(4))}] R=[${eR.map((v) => v.toFixed(4))}]`);
console.log(`eye line y=${eyeY.toFixed(4)}  span=${Math.abs(eL[0] - eR[0]).toFixed(4)}`);

const head = referenceRegion("head", spec, FIELD_H, "world")!;
const face = referenceRegion("face", spec, FIELD_H, "world")!;
console.log(`head lo=[${head.lo.map((v) => v.toFixed(3))}] hi=[${head.hi.map((v) => v.toFixed(3))}]`);
console.log(`face lo=[${face.lo.map((v) => v.toFixed(3))}] hi=[${face.hi.map((v) => v.toFixed(3))}]`);

/**
 * Front-most skin along a ray: march in from OUTSIDE the head. Marching in from
 * inside reported the skull's own interior as the surface, which is how an
 * earlier probe wrongly "verified" an aperture that was not cutting.
 */
const frontAt = (x: number, y: number): number => {
  for (let z = head.hi[2] + 0.01; z > head.lo[2]; z -= 0.0005) if (head.f(x, y, z) < 0) return z;
  return NaN;
};

// Where is her skin relative to the eye joint? Walk both ways, 2 mm at a time.
console.log("\nhead field along z from the eye joint (mm, + and -):");
for (const dir of [1, -1]) {
  const out: string[] = [];
  for (let d = -40; d <= 60; d += 2) {
    const z = eL[2] + dir * d * 0.001;
    out.push(`${d}:${head.f(eL[0], eyeY, z).toFixed(3)}`);
  }
  console.log(`  dir ${dir > 0 ? "+" : "-"}z  ${out.join("  ")}`);
}
const probePts: V3[] = [[eL[0], eyeY, 0.095], [eL[0], eyeY, 0.1], [eL[0], eyeY, 0.105], [eL[0], eyeY + 0.003, 0.1], [eL[0] + 0.008, eyeY, 0.1]];
console.log(`head field at her left eye: ${probePts.map((p) => head.f(p[0], p[1], p[2]).toFixed(4)).join("  ")}`);

const refZ = frontAt(eL[0], eyeY);
console.log(`\nskin front on her eye line: z=${refZ.toFixed(4)}`);

for (const [name, e] of [["L", eL], ["R", eR]] as const) {
  // vertical slice: the aperture is where the skin front drops back
  const col: string[] = [];
  for (let dy = -0.02; dy <= 0.02001; dy += 0.001) {
    const fz = frontAt(e[0], e[1] + dy);
    col.push(!isFinite(fz) ? "?" : fz > refZ - 0.012 ? "#" : fz > refZ - 0.03 ? "+" : ".");
  }
  console.log(`\n${name} vertical (dy -20..+20 mm, #=skin +-=part-open .=open):\n  ${col.join("")}`);

  const row: string[] = [];
  for (let dx = -0.03; dx <= 0.03001; dx += 0.001) {
    const fz = frontAt(e[0] + dx, eyeY);
    row.push(!isFinite(fz) ? "?" : fz > refZ - 0.012 ? "#" : fz > refZ - 0.03 ? "+" : ".");
  }
  console.log(`${name} horizontal (dx -30..+30 mm):\n  ${row.join("")}`);
}

// where does the eyeball geometry actually live?
let n = 0, sx = 0, sy = 0, sz = 0;
let minZ = Infinity, maxZ = -Infinity;
for (let x = face.lo[0]; x <= face.hi[0]; x += 0.002)
  for (let y = face.lo[1]; y <= face.hi[1]; y += 0.002)
    for (let z = face.lo[2]; z <= face.hi[2]; z += 0.002)
      if (face.f(x, y, z) < 0) { n++; sx += x; sy += y; sz += z; minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }
console.log(`\neye globes: ${specEyeballZ()}`);
console.log(`\nface solid samples=${n} centroid=[${(sx / n).toFixed(4)}, ${(sy / n).toFixed(4)}, (${(sz / n).toFixed(4)})] z=[${minZ.toFixed(4)}..${maxZ.toFixed(4)}]`);
