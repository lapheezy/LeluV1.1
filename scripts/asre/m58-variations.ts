/**
 * ==========================================================
 * MISSION 5.8 / WP03 — VARIATIONS AND ARTICULATION ON REFERENCE ANATOMY
 *
 * LÉLU generates a set of characters from the CC0 reference library, proves
 * the hands and feet actually articulate, and writes one GLB per variation
 * plus a metrics report. Every variation goes through the same component
 * pipeline; only what changed is regenerated.
 *
 *   npx tsx scripts/asre/m58-variations.ts --out artifacts/mission58/variations
 * ==========================================================
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCharacter, ComponentCache, DEFAULT_LATTICE, glbParts, occupancyCodes, placedMesh } from "../../src/core/asre/character/build.ts";
import { BASE_CHARACTER, withChanges, type CharacterSpec } from "../../src/core/asre/character/CharacterSpec.ts";
import { writeGlb } from "../../src/core/asre/gltf/GlbWriter.ts";
import { analyzeMesh } from "../../src/core/asre/volume/mesh.ts";
import { loadReference, BODY_TARGETS, HAIR_ASSETS } from "./cc0-anatomy.ts";

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const OUT = arg("out", "artifacts/mission58/variations");
mkdirSync(OUT, { recursive: true });

const ref = loadReference({ height: 1.7, targets: [BODY_TARGETS.femaleYoung], hairStyles: Object.keys(HAIR_ASSETS), eyes: true });
console.log(`reference ${ref.digest} ${ref.stats.triangles} tris, ${ref.stats.proxies.length} proxies`);

const base = (height = 1.7) => withChanges(BASE_CHARACTER, { body: { ...BASE_CHARACTER.body, height }, anatomy: { source: "reference", targets: [BODY_TARGETS.femaleYoung] } });

interface Variation {
  label: string;
  spec: CharacterSpec;
}

const variations: Variation[] = [
  { label: "v1-long", spec: withChanges(base(), { hair: { style: "long-straight", length: 1, volume: 1 } }) },
  { label: "v2-bob", spec: withChanges(base(), { hair: { style: "bob", length: 1, volume: 1.1 }, materials: { ...BASE_CHARACTER.materials, top: [0.55, 0.1, 0.12] } }) },
  { label: "v3-ponytail", spec: withChanges(base(1.74), { hair: { style: "ponytail", length: 1.1, volume: 1 } }) },
  { label: "v4-braids-petite", spec: withChanges(base(1.58), { hair: { style: "braids", length: 1, volume: 1 }, body: { ...BASE_CHARACTER.body, height: 1.58, build: 0.94 } }) },
  { label: "v5-afro-broad", spec: withChanges(base(), { hair: { style: "afro", length: 1, volume: 1.05 }, body: { ...BASE_CHARACTER.body, shoulderWidth: 0.43 } }) },
];

const report: Record<string, unknown>[] = [];
const cache = new ComponentCache();

for (const v of variations) {
  // each variation starts from the previous cache, so reuse is measurable
  const t0 = performance.now();
  const build = buildCharacter(v.spec, cache, DEFAULT_LATTICE);
  const ms = performance.now() - t0;
  const parts = glbParts(build, v.spec);
  let tris = 0;
  for (const p of parts) tris += p.mesh.indices.length / 3;
  const glb = writeGlb(parts, { generator: "LELU ASRE M5.8 reference anatomy" });
  writeFileSync(join(OUT, `${v.label}.glb`), glb);
  report.push({
    label: v.label,
    height: v.spec.body.height,
    hair: v.spec.hair.style,
    ms: Math.round(ms),
    regenerated: build.regenerated,
    reused: build.reused.length,
    triangles: tris,
    glbBytes: glb.length,
    cells: occupancyCodes(build, DEFAULT_LATTICE).size,
  });
  console.log(`${v.label.padEnd(18)} ${String(Math.round(ms)).padStart(5)} ms  regenerated ${String(build.regenerated.length).padStart(2)}  reused ${String(build.reused.length).padStart(2)}  tris ${tris}  ${(glb.length / 1e6).toFixed(1)} MB`);
}

/* ---------------- articulation: the same body, really moved ---------------- */

function measureHand(spec: CharacterSpec, label: string) {
  const build = buildCharacter(spec, null, DEFAULT_LATTICE, ["hands"]);
  const c = build.components[0];
  if (!c.local?.mesh.indices.length) return null;
  const m = placedMesh(c);
  // lateral extents of the hand mesh, and the tip travel between variants
  let lo = Infinity, hi = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < m.positions.length; i += 3) {
    lo = Math.min(lo, m.positions[i]);
    hi = Math.max(hi, m.positions[i]);
    minY = Math.min(minY, m.positions[i + 1]);
    maxY = Math.max(maxY, m.positions[i + 1]);
  }
  const glb = writeGlb([{ name: "hands", mesh: m, material: { name: "skin", baseColor: [1, 1, 1, 1], roughness: 0.55 }, extras: { provenance: "SYNTHESIZED" } }], { generator: "LELU ASRE" });
  writeFileSync(join(OUT, `hands-${label}.glb`), glb);
  return { label, width: +(hi - lo).toFixed(4), verticalSpan: +(maxY - minY).toFixed(4), tris: m.indices.length / 3, bytes: glb.length };
}

const hands = [
  { label: "open", hands: { curl: 0, spread: 1, opposition: 0 } },
  { label: "relaxed", hands: { curl: 0.22, spread: 0.45, opposition: 0.5 } },
  { label: "fist", hands: { curl: 1.6, spread: 0, opposition: 1 } },
].map((h) => measureHand(withChanges(base(), { hands: h.hands, anatomy: { source: "reference", targets: [BODY_TARGETS.femaleYoung] } }), h.label));
console.log("hands:", hands);

const feet = [
  { label: "flat", toeCurl: 0 },
  { label: "grip", toeCurl: 1 },
].map((f) => {
  const spec = withChanges(base(), { feet: { toeCurl: f.toeCurl }, anatomy: { source: "reference", targets: [BODY_TARGETS.femaleYoung] } });
  const build = buildCharacter(spec, null, DEFAULT_LATTICE, ["feet"]);
  const c = build.components[0];
  const m = placedMesh(c);
  const glb = writeGlb([{ name: "feet", mesh: m, material: { name: "skin", baseColor: [1, 1, 1, 1], roughness: 0.55 }, extras: {} }], { generator: "LELU ASRE" });
  writeFileSync(join(OUT, `feet-${f.label}.glb`), glb);
  let maxZ = -Infinity;
  for (let i = 2; i < m.positions.length; i += 3) maxZ = Math.max(maxZ, m.positions[i]);
  return { label: f.label, toeReach: +maxZ.toFixed(4), tris: m.indices.length / 3 };
});
console.log("feet:", feet);

// topology of the articulated hands (the 5.8 non-manifold question, re-asked)
const diag = ["hands-open", "hands-fist"].map((n) => {
  const c = buildCharacter(withChanges(base(), { hands: n.endsWith("fist") ? { curl: 1.6, spread: 0, opposition: 1 } : { curl: 0, spread: 1, opposition: 0 }, anatomy: { source: "reference", targets: [BODY_TARGETS.femaleYoung] } }), null, DEFAULT_LATTICE, ["hands"]).components[0];
  const d = analyzeMesh(placedMesh(c));
  return { variant: n, ...d };
});
console.log("hand topology:", diag);

writeFileSync(join(OUT, "variations-report.json"), JSON.stringify({ reference: ref.stats, digest: ref.digest, variations: report, hands, feet, handTopology: diag }, null, 2));
