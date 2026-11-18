/**
 * LÉLU — build ONLY her head and eyes with a given set of anatomy targets,
 * for measurement (face fitting). Same pipeline as the canon build
 * (buildCharacter with `only`), a fraction of the work.
 *
 *   npx tsx scripts/asre/lelu-head-preview.ts --targets targets.json --out head.glb
 *
 * targets.json: an array of "path@weight" strings (replaces her face targets;
 * ancestry and expression are kept from leluTargets()).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { buildCharacter, ComponentCache, DEFAULT_LATTICE, glbParts } from "../../src/core/asre/character/build.ts";
import { leluCanon, leluTargets, LELU_FACE_TARGETS, LELU_IDENTITY } from "../../src/core/asre/character/leluIdentity.ts";
import { withChanges } from "../../src/core/asre/character/CharacterSpec.ts";
import { writeGlb } from "../../src/core/asre/gltf/GlbWriter.ts";
import { loadReference } from "./cc0-anatomy.ts";

const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : d;
};
const face: string[] = process.argv.includes("--targets") ? JSON.parse(readFileSync(arg("targets", ""), "utf8")) : LELU_FACE_TARGETS;
const base = leluTargets(arg("expression", "composed")).filter((t) => !LELU_FACE_TARGETS.includes(t));
const s = leluCanon();
const spec = withChanges(s, { anatomy: { ...s.anatomy, targets: [...base, ...face] }, identity: { id: LELU_IDENTITY.id, name: LELU_IDENTITY.name, leluLook: "canonical" } });
const t0 = performance.now();
loadReference({ height: spec.body.height, targets: spec.anatomy.targets, hairStyles: [spec.hair.style], eyes: true });
const b = buildCharacter(spec, new ComponentCache(), DEFAULT_LATTICE, ["head", "face", "neck"]);
writeFileSync(arg("out", "head.glb"), writeGlb(glbParts(b, spec), { compactColors: true }));
console.log(`head preview in ${((performance.now() - t0) / 1000).toFixed(1)} s`);
