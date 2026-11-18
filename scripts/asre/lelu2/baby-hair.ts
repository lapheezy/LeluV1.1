/**
 * ==========================================================
 * LÉLU 2.3 — WP05 / WP06: HEAD + BABY HAIR, MEASURED
 *
 * One script, two variants, identical cameras and identical measurements:
 *
 *   baseline  her head as 2.1 built it, with the 2.1 hair
 *   youth     the same head with the youth/identity pass and the baby-hair
 *             system (see `character/youth.ts` and `hair/baby.ts`)
 *
 * Everything written here is read back from the build itself — the head mesh,
 * the hair diagnostics, the tube diagnostics, the baby-hair records — never
 * copied from an earlier report.
 *
 *   npx tsx scripts/asre/lelu2/baby-hair.ts --variant baseline|youth
 *   → artifacts/lelu2/m23/<variant>/lelu2-m23-<variant>.glb
 *     artifacts/lelu2/m23/<variant>/metrics-<variant>.json
 *     artifacts/lelu2/m23/<variant>/baby-hair-<variant>.json
 *     artifacts/lelu2/m23/<variant>/baby-hair-<variant>.svg
 * ==========================================================
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCharacter, ComponentCache, DEFAULT_LATTICE, placedMesh } from "../../../src/core/asre/character/build.ts";
import { leluCanon, LELU_IDENTITY } from "../../../src/core/asre/character/leluIdentity.ts";
import { withChanges } from "../../../src/core/asre/character/CharacterSpec.ts";
import { writeGlb } from "../../../src/core/asre/gltf/GlbWriter.ts";
import { bodyLandmarks, faceMasks, hairDiagnostics } from "../../../src/core/asre/reference/provider.ts";
import { tubeDiagnostics } from "../../../src/core/asre/hair/tubes.ts";
import { babyHairOverlaySvg, babyHairState, describeStrand } from "../../../src/core/asre/hair/baby.ts";
import { youthDiagnostics, youthGap } from "../../../src/core/asre/character/youth.ts";
import { loadReference } from "../cc0-anatomy.ts";

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};

const variant = arg("variant", "youth") as "baseline" | "youth";
const youth = variant === "youth";
const outDir = `artifacts/lelu2/m23/${variant}`;

const spec = withChanges(leluCanon(), {
  hair: { style: "long-wavy", length: 1, volume: 1.05 },
  geometry: { golden: true, hairTubes: true, hairLod: "high", youth },
});

const ref = loadReference({ height: spec.body.height, targets: spec.anatomy.targets, hairStyles: [spec.hair.style], eyes: true, teeth: true });
console.log(`foundation ${ref.digest} · variant ${variant}`);

const started = performance.now();
const build = buildCharacter(spec, new ComponentCache(), DEFAULT_LATTICE);
const ms = performance.now() - started;

const parts = build.components
  .filter((c) => c.local && c.local.mesh.indices.length)
  .map((c) => ({
    name: c.id,
    mesh: placedMesh(c),
    material: { name: `${c.id}-vertex-colour`, baseColor: [1, 1, 1, 1] as [number, number, number, number], roughness: c.id === "hair" ? 0.7 : 0.55 },
    extras: { component: c.id, key: c.key, identity: spec.identity.id, provenance: "SYNTHESIZED" },
  }));
let tris = 0;
for (const p of parts) tris += p.mesh.indices.length / 3;
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, `lelu2-m23-${variant}.glb`), writeGlb(parts, { generator: `LÉLU 2.3 — ${variant}` }));
writeFileSync(
  join(outDir, `lelu2-m23-${variant}-head.glb`),
  writeGlb(parts.filter((p) => ["head", "face", "hair", "accessories.head"].includes(p.name)), { generator: `LÉLU 2.3 — head close-up (${variant})` }),
);

/* --------------------------- head measurements --------------------------- */

const headPart = build.components.find((c) => c.id === "head");
if (!headPart?.local) throw new Error("head component did not build");
const head = placedMesh(headPart);
const bounds = (p: Float32Array) => {
  const b = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] } as Record<"x" | "y" | "z", [number, number]>;
  for (let i = 0; i < p.length; i += 3)
    (["x", "y", "z"] as const).forEach((k, a) => {
      b[k][0] = Math.min(b[k][0], p[i + a]);
      b[k][1] = Math.max(b[k][1], p[i + a]);
    });
  return b;
};
const b = bounds(head.positions);
const height = b.y[1] - b.y[0];
const width = b.x[1] - b.x[0];
const depth = b.z[1] - b.z[0];
const yAt = (f: number) => b.y[0] + height * f;

/** Face width at a height: the FRONT half only, so ears are not "cheeks". */
function widthAt(y: number, tolerance = 0.006): number {
  let lo = Infinity, hi = -Infinity, count = 0;
  for (let i = 0; i < head.positions.length; i += 3) {
    if (Math.abs(head.positions[i + 1] - y) > tolerance) continue;
    if (head.positions[i + 2] < b.z[0] + depth * 0.35) continue;
    lo = Math.min(lo, head.positions[i]);
    hi = Math.max(hi, head.positions[i]);
    count++;
  }
  return count ? hi - lo : 0;
}

function slabVolume(y0: number, y1: number): number {
  const p = head.positions, idx = head.indices;
  let volume = 0;
  for (let t = 0; t + 2 < idx.length; t += 3) {
    const a = idx[t] * 3, b2 = idx[t + 1] * 3, c = idx[t + 2] * 3;
    if ((p[a + 1] + p[b2 + 1] + p[c + 1]) / 3 < y0 || (p[a + 1] + p[b2 + 1] + p[c + 1]) / 3 > y1) continue;
    const ax = p[a], ay = p[a + 1] - (y0 + y1) / 2, az = p[a + 2];
    const bx = p[b2], by = p[b2 + 1] - (y0 + y1) / 2, bz = p[b2 + 2];
    const cx = p[c], cy = p[c + 1] - (y0 + y1) / 2, cz = p[c + 2];
    volume += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  return Math.abs(volume);
}

/**
 * Her CHIN, measured on her face rather than on the component.
 *
 * The head component's bounding box ends at the neck cut ~35 mm below her chin,
 * so "eye height above the bottom" is eye-to-neck, not eye-to-chin, and it did
 * not move when the youth pass lifted her chin by 9 mm. The chin is the lowest
 * front surface on the midline (the front 40 % of the head's depth, |x| < 30 mm).
 * The 60 % cut was chosen by measuring: at 75 % no vertex of her chin qualifies
 * at all (her chin slopes back), and the value it produced was Infinity.
 */
const eyes = faceMasks().eyes;
let chinY = Infinity;
for (let i = 0; i < head.positions.length; i += 3) {
  if (Math.abs(head.positions[i]) > 0.03) continue;
  if (head.positions[i + 2] < b.z[0] + depth * 0.6) continue;
  chinY = Math.min(chinY, head.positions[i + 1]);
}
const faceHeight = eyes[0][1] - chinY;
/** Widths at fixed fractions of the FACE (chin → eye), so a lifted chin does not
 *  silently re-sample a different part of the jaw. */
const cheekAt = widthAt(chinY + faceHeight * 0.72);
const jawAt = widthAt(chinY + faceHeight * 0.36);
const chinAt = widthAt(chinY + 0.018);

const skullWidth = widthAt(yAt(0.78));
const cheekWidth = widthAt(yAt(0.52));
const jawWidth = widthAt(yAt(0.3));
const chinWidth = widthAt(yAt(0.08));
const cheekVolume = slabVolume(yAt(0.42), yAt(0.62));
const headVolume = slabVolume(b.y[0], b.y[1]);
const landmarks = bodyLandmarks();

const metrics = {
  variant,
  identity: LELU_IDENTITY.id,
  primaryReference: LELU_IDENTITY.primaryReference,
  foundation: ref.digest,
  buildMs: Math.round(ms),
  triangles: tris,
  head: {
    heightMm: height * 1000,
    widthMm: width * 1000,
    depthMm: depth * 1000,
    widthToHeight: width / height,
    skullWidthMm: skullWidth * 1000,
    cheekWidthMm: cheekWidth * 1000,
    jawWidthMm: jawWidth * 1000,
    chinWidthMm: chinWidth * 1000,
    jawToCheek: jawWidth / cheekWidth,
    chinToJaw: chinWidth / jawWidth,
    cheekVolumeCm3: cheekVolume * 1e6,
    headVolumeCm3: headVolume * 1e6,
    cheekShareOfHead: cheekVolume / headVolume,
  },
  eyes: {
    spacingMm: Math.abs(eyes[1][0] - eyes[0][0]) * 1000,
    centresMm: eyes.map((e) => ({ x: +(e[0] * 1000).toFixed(1), y: +(e[1] * 1000).toFixed(1), z: +(e[2] * 1000).toFixed(1) })),
    heightAboveChinMm: (eyes[0][1] - b.y[0]) * 1000,
    heightFraction: (eyes[0][1] - b.y[0]) / height,
  },
  /** How much of the head sits below the eye line: the age-reading proportion. */
  lowerFace: {
    /** The component's bottom — the neck cut, kept for continuity with 2.1. */
    chinHeightMm: b.y[0] * 1000,
    eyeHeightMm: eyes[0][1] * 1000,
    eyeToChinMm: (eyes[0][1] - b.y[0]) * 1000,
    shareOfHead: (eyes[0][1] - b.y[0]) / height,
  },
  /** Measured on the FACE: her actual chin, and the widths at face fractions. */
  face: {
    chinMmL: chinY * 1000,
    eyeToChinMm: faceHeight * 1000,
    crownToChinMm: (b.y[1] - chinY) * 1000,
    lowerThirdShare: faceHeight / (b.y[1] - chinY),
    cheekWidthMm: cheekAt * 1000,
    jawWidthMm: jawAt * 1000,
    chinWidthMm: chinAt * 1000,
    jawToCheek: cheekAt ? jawAt / cheekAt : 0,
    chinToJaw: jawAt ? chinAt / jawAt : 0,
  },
  hair: hairDiagnostics,
  tubes: tubeDiagnostics,
  youth: youthDiagnostics,
  babyHair: babyHairState.report
    ? {
        count: babyHairState.report.count,
        byRegion: babyHairState.report.byRegion,
        lengthMm: babyHairState.report.lengthMm,
        rootThicknessMm: babyHairState.report.rootThicknessMm,
        curvaturePerM: babyHairState.report.curvaturePerM,
        hairline: babyHairState.report.hairline,
        collision: babyHairState.report.collision,
        sample: babyHairState.report.strands.slice(0, 3).map(describeStrand),
      }
    : null,
  body: { totalHeightMm: (landmarks.totalHeight ?? 0) * 1000, headsTall: (landmarks.totalHeight ?? 0) / height },
};

writeFileSync(join(outDir, `metrics-${variant}.json`), JSON.stringify(metrics, null, 2));
if (babyHairState.report) {
  writeFileSync(join(outDir, `baby-hair-${variant}.json`), JSON.stringify(babyHairState.report, null, 1));
  writeFileSync(join(outDir, `baby-hair-${variant}.svg`), babyHairOverlaySvg(babyHairState.report, { title: `Baby hair placement — ${variant}` }));
}

/* --------------------------------- output -------------------------------- */

const m = metrics.head;
console.log(`build ${(ms / 1000).toFixed(1)} s · ${tris.toLocaleString()} tris`);
console.log(`head ${m.heightMm.toFixed(1)} mm tall, ${m.widthMm.toFixed(1)} wide · jaw/cheek ${m.jawToCheek.toFixed(3)} · chin/jaw ${m.chinToJaw.toFixed(3)} · cheek share ${(m.cheekShareOfHead * 100).toFixed(1)} %`);
console.log(
  `face: eye→chin ${metrics.face.eyeToChinMm.toFixed(1)} mm (${(metrics.face.lowerThirdShare * 100).toFixed(1)} % of crown→chin) · jaw/cheek ${metrics.face.jawToCheek.toFixed(3)} · chin/jaw ${metrics.face.chinToJaw.toFixed(3)} · chin at ${metrics.face.chinMmL.toFixed(1)} mm`,
);
if (metrics.babyHair) {
  const baby = metrics.babyHair;
  console.log(
    `baby hair ${baby.count} strands (${Object.entries(baby.byRegion).map(([k, v]) => `${k} ${v}`).join(", ")}) · ${baby.lengthMm.min.toFixed(1)}–${baby.lengthMm.max.toFixed(1)} mm · ` +
      `roots ${baby.rootThicknessMm.min.toFixed(2)}–${baby.rootThicknessMm.max.toFixed(2)} mm · hairline coverage ${baby.hairline.coveragePct.toFixed(0)} % · ` +
      `clear ${baby.collision.clear} / contact ${baby.collision.contact} / penetrating ${baby.collision.penetrating}`,
  );
}
if (youth) {
  console.log(`youth: chin lifted ${youthDiagnostics.chinLiftMm.toFixed(1)} mm, jaw narrowed ${youthDiagnostics.jawNarrowMm.toFixed(1)} mm; gaps ${youthGap({ head: m, eyes: metrics.eyes }).map((g) => `${g.ratio} ${g.measured.toFixed(3)} vs ${g.reference.toFixed(3)}`).join(" · ")}`);
}
console.log(`written: ${outDir}`);
