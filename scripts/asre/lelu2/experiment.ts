/**
 * ==========================================================
 * LÉLU 2 — CONTROLLED EXPERIMENT: BASELINE vs GOLDEN GEOMETRY
 *
 * One character, one set of assets, one pipeline. The ONLY difference between the
 * two runs is `spec.geometry.golden`:
 *
 *   baseline  hair roots from the reference asset's own vertex distribution,
 *             curls as constant-radius helices, her original jewelry
 *   golden    root positions from a Fibonacci-sphere distribution projected onto
 *             her real scalp, ringlets on a golden logarithmic spiral (radius
 *             decaying by 1/φ), Fibonacci bead work on her hoops and a bead
 *             cascade whose spacing shrinks by φ
 *
 * Everything measured is read from the build that produced the GLB: triangle
 * counts, timings, occupancy cells, the builder's own hair diagnostics, her real
 * joint landmarks, and a proportion analysis that is allowed to fail.
 *
 *   npx tsx scripts/asre/lelu2/experiment.ts --variant baseline
 *   npx tsx scripts/asre/lelu2/experiment.ts --variant golden
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCharacter, ComponentCache, DEFAULT_LATTICE, glbParts, occupancyCodes } from "../../../src/core/asre/character/build.ts";
import { leluCanon, LELU_IDENTITY } from "../../../src/core/asre/character/leluIdentity.ts";
import { withChanges, type CharacterSpec } from "../../../src/core/asre/character/CharacterSpec.ts";
import { writeGlb } from "../../../src/core/asre/gltf/GlbWriter.ts";
import { bodyLandmarks, hairDiagnostics, referenceProxies } from "../../../src/core/asre/reference/provider.ts";
import { loadReference } from "../cc0-anatomy.ts";
import { analyseProportions, geometricSignature, nearestFibonacci, selectConstraints, acceptedConstraints, GOLDEN_ANGLE_DEG, PHI } from "../../../src/core/geometry/golden/index.ts";

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};

const variant = arg("variant", "baseline") as "baseline" | "golden";
const outDir = arg("out", `artifacts/lelu2/${variant}`);

const spec: CharacterSpec = withChanges(leluCanon(), {
  hair: { style: "long-wavy", length: 1, volume: 1.05 },
  geometry: { golden: variant === "golden" },
});

const ref = loadReference({ height: spec.body.height, targets: spec.anatomy.targets, hairStyles: [spec.hair.style], eyes: true, teeth: true });
console.log(`foundation ${ref.digest} — ${ref.stats.triangles} body triangles`);

const t0 = performance.now();
const build = buildCharacter(spec, new ComponentCache(), DEFAULT_LATTICE);
const ms = performance.now() - t0;

const parts = glbParts(build, spec);
let tris = 0;
for (const p of parts) tris += p.mesh.indices.length / 3;
const glb = writeGlb(parts, { generator: `LÉLU 2 — golden geometry experiment (${variant})` });
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `lelu2-${variant}.glb`), glb);

// The builder's own measurement of the roots it used.
const hair = { ...hairDiagnostics };
const landmarks = bodyLandmarks();
const proportions = analyseProportions(landmarks, { tolerance: 0.02 });

// The Fibonacci count question, answered rather than asserted: what would the
// nearest Fibonacci number to her strand count cost in density?
const fib = nearestFibonacci(1350);
const constraints = selectConstraints({
  count: 1350,
  fibonacciCount: fib.value,
  supportedRatios: proportions.supported.map((m) => ({ a: m.a, b: m.b, ratio: m.ratio, power: m.power, relativeError: m.relativeError })),
});

// A signature of a Fibonacci-sphere root cloud, for the report's comparison table.
const signature = geometricSignature(
  Array.from({ length: 600 }, (_, i) => {
    const z = 1 - (2 * (i + 0.5)) / 600;
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const t = i * GOLDEN_ANGLE_DEG * (Math.PI / 180);
    return { x: Math.cos(t) * r * 0.1, y: z * 0.1, z: Math.sin(t) * r * 0.1 };
  }),
);

const report = {
  variant,
  identity: LELU_IDENTITY.id,
  hairStyle: spec.hair.style,
  geometry: spec.geometry,
  ms: Math.round(ms),
  triangles: tris,
  glbBytes: glb.length,
  occupancyCells: occupancyCodes(build, DEFAULT_LATTICE).size,
  components: build.components.map((c) => ({ id: c.id, triangles: c.local ? c.local.mesh.indices.length / 3 : 0 })),
  emptyComponents: build.components.filter((c) => !c.local?.mesh.indices.length).map((c) => c.id),
  hair,
  proxies: referenceProxies().length,
  landmarks,
  proportions: {
    pairsTested: proportions.matches.length,
    supported: proportions.supported.map((m) => ({ pair: `${m.a}/${m.b}`, ratio: Number(m.ratio.toFixed(4)), phiPower: m.power, relativeError: Number(m.relativeError.toFixed(5)) })),
    shareWithinTolerance: Number(proportions.shareWithinTolerance.toFixed(3)),
    medianRelativeError: Number(proportions.medianRelativeError.toFixed(4)),
  },
  fibonacciCount: fib,
  constraints,
  acceptedConstraints: acceptedConstraints(constraints).map((c) => c.id),
  phi: PHI,
  goldenAngleDeg: GOLDEN_ANGLE_DEG,
  sphereSignature: {
    spacingCv: Number(signature.points.cv.toFixed(4)),
    divergenceDeg: Number(signature.divergence.dominantDeg.toFixed(2)),
    radialExponent: Number(signature.radial.exponent.toFixed(4)),
  },
};

writeFileSync(join(outDir, `lelu2-${variant}-metrics.json`), JSON.stringify(report, null, 2));
console.log(
  `${variant}: ${(ms / 1000).toFixed(1)} s — ${tris.toLocaleString()} tris, ${(glb.length / 1e6).toFixed(1)} MB, ${report.occupancyCells} cells`,
);
console.log(`hair: golden=${hair.golden} roots=${hair.roots} cv=${hair.rootCv.toFixed(4)} spacing=${(hair.meanSpacing * 1000).toFixed(2)} mm curl=${hair.curl}`);
console.log(`proportions: ${proportions.supported.length}/${proportions.matches.length} pairs within 2 % of a φ power`);
if (report.emptyComponents.length) console.log(`empty: ${report.emptyComponents.join(", ")}`);
