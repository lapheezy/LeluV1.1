/**
 * ==========================================================
 * LÉLU — BUILD HER, FROM HER OWN FILES
 *
 * Loads the CC0 anatomy foundation with HER ancestry and build, applies her
 * locked identity (colours, marks, piercings, jewelry, hair), and builds the
 * full character through her own component pipeline.
 *
 *   npx tsx scripts/asre/lelu-canon.ts --out artifacts/lelu/canon
 *
 * Authority:
 *   leluverse/assets/characters/lelu_character/identity/identity.json
 *   leluverse/assets/characters/lelu_character/references/ref10_face_primary.png
 * ==========================================================
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCharacter, ComponentCache, DEFAULT_LATTICE, glbParts, occupancyCodes } from "../../src/core/asre/character/build.ts";
import { leluCanon, leluTargets, LELU_EXPRESSIONS, LELU_IDENTITY, LELU_COLOURS } from "../../src/core/asre/character/leluIdentity.ts";
import { withChanges, type CharacterSpec } from "../../src/core/asre/character/CharacterSpec.ts";
import { writeGlb } from "../../src/core/asre/gltf/GlbWriter.ts";
import { loadReference } from "./cc0-anatomy.ts";
import { leluHairArch, referenceProxies } from "../../src/core/asre/reference/provider.ts";
import { encodeStrands } from "./hair-sidecar.ts";

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};

const outDir = arg("out", "artifacts/lelu/canon");
const hair = arg("hair", "long-wavy");
const expression = arg("expression", "composed");
if (!LELU_EXPRESSIONS[expression]) throw new Error(`unknown expression ${expression}: ${Object.keys(LELU_EXPRESSIONS).join(", ")}`);
mkdirSync(outDir, { recursive: true });

const spec: CharacterSpec = (() => {
  const s = leluCanon();
  return withChanges(s, {
    hair: { ...s.hair, style: hair as CharacterSpec["hair"]["style"] },
    anatomy: { ...s.anatomy, targets: leluTargets(expression) },
    identity: { id: LELU_IDENTITY.id, name: LELU_IDENTITY.name, leluLook: "canonical" },
  });
})();

const ref = loadReference({ height: spec.body.height, targets: spec.anatomy.targets, hairStyles: [hair], eyes: true, teeth: true });
console.log(`LÉLU anatomy foundation: ${ref.digest} — ${ref.stats.triangles} body triangles, ${ref.rig.heads.size} bones`);

const t0 = performance.now();
const build = buildCharacter(spec, new ComponentCache(), DEFAULT_LATTICE);
const ms = performance.now() - t0;

const parts = glbParts(build, spec);
let tris = 0;
for (const p of parts) tris += p.mesh.indices.length / 3;
const glb = writeGlb(parts, { generator: "LÉLU canonical avatar — ASRE", compactColors: true });
writeFileSync(join(outDir, "lelu-canon.glb"), glb);
// full-resolution strands as curves (the GLB's hair is their realtime LOD)
const arch = leluHairArch(spec);
const lhc = encodeStrands(arch.strands);
writeFileSync(join(outDir, "lelu-canon.hair.lhc"), lhc);

const report = {
  character: LELU_IDENTITY.id,
  name: LELU_IDENTITY.name,
  identity: LELU_IDENTITY,
  palette: LELU_COLOURS,
  expression,
  spec: { hair: spec.hair, clothing: spec.clothing, body: spec.body, anatomy: spec.anatomy, hands: spec.hands, pose: spec.pose },
  reference: ref.stats,
  proxies: referenceProxies(),
  ms: Math.round(ms),
  triangles: tris,
  glbBytes: glb.length,
  hair: { ...arch.stats, sidecar: "lelu-canon.hair.lhc", sidecarBytes: lhc.length },
  occupancyCells: occupancyCodes(build, DEFAULT_LATTICE).size,
  components: build.components.map((c) => ({ id: c.id, action: c.action, triangles: c.local ? c.local.mesh.indices.length / 3 : 0 })),
  emptyComponents: build.components.filter((c) => !c.local?.mesh.indices.length).map((c) => c.id),
};
writeFileSync(join(outDir, "lelu-canon-report.json"), JSON.stringify(report, null, 2));

console.log(`built in ${(ms / 1000).toFixed(1)} s — ${tris.toLocaleString()} triangles, ${(glb.length / 1e6).toFixed(1)} MB, ${report.occupancyCells} cells`);
console.log(report.components.map((c) => `${c.id}:${c.triangles}`).join("  "));
if (report.emptyComponents.length) console.log(`empty: ${report.emptyComponents.join(", ")}`);
