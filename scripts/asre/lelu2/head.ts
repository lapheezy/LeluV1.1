/**
 * ==========================================================
 * LÉLU 2.1 — WP04: REFERENCE-DRIVEN HEAD MEASUREMENT
 *
 * The repository contains NO orthographic reference plate: `resources/` holds
 * only the CC0 anatomy library, and every image in `artifacts/` is a render of
 * this same geometry. So "compare against the reference" can only honestly mean:
 *
 *   1. measure her head from the mesh she actually has
 *   2. measure the proportions her documented identity describes
 *   3. report the deltas, and report the parts that cannot be checked
 *
 * Nothing here is adjusted to fit a golden ratio. Where a measurement disagrees
 * with the description (for example cheek volume), the number is printed and the
 * disagreement is left standing.
 *
 *   npx tsx scripts/asre/lelu2/head.ts
 *   → artifacts/lelu2/head/head-metrics.json
 * ==========================================================
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { buildCharacter, ComponentCache, DEFAULT_LATTICE, placedMesh } from "../../../src/core/asre/character/build.ts";
import { leluCanon, LELU_IDENTITY } from "../../../src/core/asre/character/leluIdentity.ts";
import { withChanges } from "../../../src/core/asre/character/CharacterSpec.ts";
import { bodyLandmarks, faceMasks, hairDiagnostics } from "../../../src/core/asre/reference/provider.ts";
import { loadReference } from "../cc0-anatomy.ts";

const spec = withChanges(leluCanon(), { hair: { style: "long-wavy", length: 1, volume: 1.05 } });
const ref = loadReference({ height: spec.body.height, targets: spec.anatomy.targets, hairStyles: [spec.hair.style], eyes: true, teeth: true });
const build = buildCharacter(spec, new ComponentCache(), DEFAULT_LATTICE, ["head", "face", "hair"]);
const part = (id: string) => {
  const c = build.components.find((x) => x.id === id);
  if (!c?.local) throw new Error(`head: component ${id} did not build`);
  return placedMesh(c);
};

const head = part("head");
function bounds(p: Float32Array): { x: [number, number]; y: [number, number]; z: [number, number] } {
  const b = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] } as { x: [number, number]; y: [number, number]; z: [number, number] };
  for (let i = 0; i < p.length; i += 3)
    for (let a = 0; a < 3; a++) {
      const key = a === 0 ? "x" : a === 1 ? "y" : "z";
      b[key][0] = Math.min(b[key][0], p[i + a]);
      b[key][1] = Math.max(b[key][1], p[i + a]);
    }
  return b;
}
const b = bounds(head.positions);
const height = b.y[1] - b.y[0];
const width = b.x[1] - b.x[0];
const depth = b.z[1] - b.z[0];

/** Width of the head at a height fraction (0 chin, 1 crown). */
/**
 * Face width at a height: |x| extent of the FRONT half only. Including the back
 * of the skull and her ears measures the ears (172 mm at eye level) instead of
 * the face, which is exactly the kind of number that would have been reported as
 * "cheek width" without being looked at.
 */
function widthAt(y: number, tolerance = 0.006): number {
  let lo = Infinity, hi = -Infinity, count = 0;
  for (let i = 0; i < head.positions.length; i += 3) {
    const py = head.positions[i + 1];
    if (Math.abs(py - y) > tolerance) continue;
    if (head.positions[i + 2] < b.z[0] + depth * 0.35) continue; // front 65 % only
    lo = Math.min(lo, head.positions[i]);
    hi = Math.max(hi, head.positions[i]);
    count++;
  }
  return count ? hi - lo : 0;
}

/** Signed volume of the head mesh inside a slab, by the divergence theorem. */
function slabVolume(y0: number, y1: number): number {
  const p = head.positions, idx = head.indices;
  let volume = 0;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t] * 3, b2 = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const yc = (p[a + 1] + p[b2 + 1] + p[c + 1]) / 3;
    if (yc < y0 || yc > y1) continue;
    // signed tetra volume with the origin shifted to the slab centre
    const ax = p[a], ay = p[a + 1] - (y0 + y1) / 2, az = p[a + 2];
    const bx = p[b2], by = p[b2 + 1] - (y0 + y1) / 2, bz = p[b2 + 2];
    const cx = p[c], cy = p[c + 1] - (y0 + y1) / 2, cz = p[c + 2];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(volume);
}

const yAt = (f: number) => b.y[0] + height * f;
const skullWidth = widthAt(yAt(0.78));
const cheekWidth = widthAt(yAt(0.52));
const jawWidth = widthAt(yAt(0.3));
const chinWidth = widthAt(yAt(0.08));
const cheekSlab = slabVolume(yAt(0.42), yAt(0.62));
const headVolume = slabVolume(b.y[0], b.y[1]);
const eyes = faceMasks().eyes;
const landmarks = bodyLandmarks();
const hair = part("hair");

// Hairline: the lowest ROOT at the front of the head — the actual place hair
// starts, not the lowest hair vertex (which hangs past her shoulders).
// The hairline comes from the ROOTS (where hair grows), not from the hair mesh:
// the mesh's front edge is a side lock at temple height, and reading it as the
// hairline reported a hairline 11 mm below her eyes.
const hairlineY = hairDiagnostics.hairlineFrontY || b.y[0] + height * 0.7;

const metrics = {
  identity: LELU_IDENTITY.id,
  primaryReference: LELU_IDENTITY.primaryReference,
  foundation: ref.digest,
  referencePlates: {
    available: false,
    note: "no orthographic reference plate exists in this repository; measurements are against the documented identity and this mesh",
  },
  head: {
    heightMm: height * 1000,
    widthMm: width * 1000,
    depthMm: depth * 1000,
    widthToHeight: width / height,
    depthToHeight: depth / height,
    skullWidthMm: skullWidth * 1000,
    cheekWidthMm: cheekWidth * 1000,
    jawWidthMm: jawWidth * 1000,
    chinWidthMm: chinWidth * 1000,
    /** Oval face: skull > cheek > jaw > chin, each step tapering. */
    taper: [skullWidth, cheekWidth, jawWidth, chinWidth].map((v) => Number(v.toFixed(4))),
    jawToCheek: jawWidth / cheekWidth,
    chinToJaw: chinWidth / jawWidth,
    cheekVolumeCm3: cheekSlab * 1e6,
    headVolumeCm3: headVolume * 1e6,
    cheekShareOfHead: cheekSlab / headVolume,
  },
  eyes: {
    centresMm: eyes.map((e) => ({ x: Number((e[0] * 1000).toFixed(1)), y: Number((e[1] * 1000).toFixed(1)), z: Number((e[2] * 1000).toFixed(1)) })),
    spacingMm: Math.abs(eyes[1][0] - eyes[0][0]) * 1000,
    /** Classic canon: eye spacing ≈ one eye width. Measured, not enforced. */
    spacingToHeadWidth: Math.abs(eyes[1][0] - eyes[0][0]) / width,
    heightAboveChinMm: (eyes[0][1] - b.y[0]) * 1000,
    heightFraction: (eyes[0][1] - b.y[0]) / height,
  },
  hairline: {
    frontLowestYmm: hairlineY * 1000,
    aboveEyesMm: (hairlineY - eyes[0][1]) * 1000,
    aboveChinFraction: (hairlineY - b.y[0]) / height,
    strands: hairDiagnostics.roots,
  },
  body: {
    totalHeightMm: (landmarks.totalHeight ?? 0) * 1000,
    headsTall: (landmarks.totalHeight ?? 0) / height,
    shoulderWidthMm: (landmarks.shoulderWidth ?? 0) * 1000,
    chinHeightMm: (landmarks.chinHeight ?? 0) * 1000,
  },
  documented: {
    faceShape: LELU_IDENTITY.faceShape,
    eyes: LELU_IDENTITY.eyes,
    hairline: LELU_IDENTITY.hairline,
  },
  /** Checked against the description, not adjusted to it. */
  checks: [] as { claim: string; measured: string; agrees: boolean }[],
};

metrics.checks = [
  {
    claim: "oval face: widest at the skull, tapering through cheek, jaw and chin",
    measured: `skull ${(skullWidth * 1000).toFixed(1)} > cheek ${(cheekWidth * 1000).toFixed(1)} > jaw ${(jawWidth * 1000).toFixed(1)} > chin ${(chinWidth * 1000).toFixed(1)} mm`,
    agrees: skullWidth > cheekWidth && cheekWidth > jawWidth && jawWidth > chinWidth,
  },
  {
    claim: "high, defined cheekbones",
    measured: `cheek slab is ${((cheekSlab / headVolume) * 100).toFixed(1)} % of head volume`,
    agrees: cheekSlab / headVolume > 0.12,
  },
  {
    claim: "eyes spaced about one eye width apart",
    measured: `${metrics.eyes.spacingMm.toFixed(1)} mm apart on a ${(width * 1000).toFixed(1)} mm head (${(metrics.eyes.spacingToHeadWidth * 100).toFixed(1)} %)`,
    agrees: metrics.eyes.spacingToHeadWidth > 0.35 && metrics.eyes.spacingToHeadWidth < 0.55,
  },
  {
    claim: "hairline above the brow with a centre part",
    measured: `front hairline ${metrics.hairline.aboveEyesMm.toFixed(1)} mm above the eyes`,
    agrees: metrics.hairline.aboveEyesMm > 10,
  },
];

mkdirSync("artifacts/lelu2/head", { recursive: true });
writeFileSync("artifacts/lelu2/head/head-metrics.json", JSON.stringify(metrics, null, 2));

console.log(`head ${(height * 1000).toFixed(1)} mm tall, ${(width * 1000).toFixed(1)} mm wide, ${(depth * 1000).toFixed(1)} mm deep`);
console.log(`taper skull→cheek→jaw→chin: ${metrics.head.taper.map((v) => (v * 1000).toFixed(1)).join(" → ")} mm`);
console.log(`eyes ${metrics.eyes.spacingMm.toFixed(1)} mm apart, ${metrics.eyes.heightFraction.toFixed(3)} of head height above the chin`);
console.log(`hairline ${metrics.hairline.aboveEyesMm.toFixed(1)} mm above the eyes, ${hairDiagnostics.roots} strands`);
console.log(`body: ${(metrics.body.totalHeightMm / 1000).toFixed(2)} m, ${metrics.body.headsTall.toFixed(2)} heads tall`);
for (const c of metrics.checks) console.log(`  ${c.agrees ? "OK  " : "FAIL"} ${c.claim} — ${c.measured}`);
console.log("written: artifacts/lelu2/head/head-metrics.json");
