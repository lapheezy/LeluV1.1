/**
 * ==========================================================
 * MISSION 5.8 / WP03 — BUILD LÉLU FROM REFERENCE ANATOMY
 *
 * Loads the CC0 MakeHuman body, fits it, and builds LÉLU's character from it
 * through her own component pipeline: same lattice, same surface nets, same
 * occupancy, same content keys. Writes the GLB and the measurement report.
 *
 *   npx tsx scripts/asre/m58-reference.ts --out artifacts/mission58/reference
 * ==========================================================
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCharacter, buildWholeObject, codesIou, occupancyCodes, ComponentCache, DEFAULT_LATTICE, glbParts, placedMesh } from "../../src/core/asre/character/build.ts";
import { BASE_CHARACTER, withChanges, type CharacterSpec } from "../../src/core/asre/character/CharacterSpec.ts";
import { writeGlb } from "../../src/core/asre/gltf/GlbWriter.ts";
import { analyzeMesh } from "../../src/core/asre/volume/mesh.ts";
import { loadReference, BODY_TARGETS, HAIR_ASSETS } from "./cc0-anatomy.ts";
import { referenceProxies } from "../../src/core/asre/reference/provider.ts";

const arg = (name: string, dflt: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
};

const outDir = arg("out", "artifacts/mission58/reference");
mkdirSync(outDir, { recursive: true });

const height = Number(arg("height", "1.7"));
const hairStyle = arg("hair", "long-straight");
const ref = loadReference({ height, targets: [BODY_TARGETS.femaleYoung], hairStyles: Object.keys(HAIR_ASSETS), eyes: true, teeth: true });
console.log(`reference ${ref.digest}: ${ref.stats.triangles} body triangles, ${ref.rig.heads.size} bones, proxies [${ref.stats.proxies.join(", ")}]`);

const spec: CharacterSpec = withChanges(BASE_CHARACTER, {
  anatomy: { source: "reference", targets: [BODY_TARGETS.femaleYoung] },
  hair: { style: hairStyle as CharacterSpec["hair"]["style"], length: 1, volume: 1 },
  clothing: { top: "tshirt", bottom: "pants", shoes: true },
  pose: arg("pose", "relaxed") as CharacterSpec["pose"],
});

const t0 = performance.now();
const cache = new ComponentCache();
const build = buildCharacter(spec, cache, DEFAULT_LATTICE);
const ms = performance.now() - t0;
console.log(`built in ${(ms / 1000).toFixed(1)} s; regenerated ${build.regenerated.length}, reused ${build.reused.length}`);

const parts = glbParts(build, spec);
const glb = writeGlb(parts, { generator: "LELU ASRE M5.8 reference anatomy" });
writeFileSync(join(outDir, "reference-base.glb"), glb);

let tris = 0;
for (const p of parts) tris += p.mesh.indices.length / 3;
const whole = buildWholeObject(spec, DEFAULT_LATTICE);
const iou = codesIou(occupancyCodes(build, DEFAULT_LATTICE), whole.codes);

const report = {
  digest: ref.digest,
  height,
  hairStyle,
  pose: spec.pose,
  ms: Math.round(ms),
  glbBytes: glb.length,
  triangles: tris,
  components: build.components.map((c) => ({ id: c.id, action: c.action, triangles: c.local ? c.local.mesh.indices.length / 3 : 0, ms: Math.round(c.ms) })),
  emptyComponents: build.components.filter((c) => !c.local?.mesh.indices.length).map((c) => c.id),
  occupancy: { cells: occupancyCodes(build, DEFAULT_LATTICE).size, iouVsWholeObject: +iou.toFixed(4) },
  reference: ref.stats,
  proxies: referenceProxies(),
};
writeFileSync(join(outDir, "reference-report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.components.map((c) => `${c.id}:${c.action}:${c.triangles}`), null, 0));
console.log(`occupancy ${report.occupancy.cells} cells, IoU vs whole object ${iou}, GLB ${(glb.length / 1e6).toFixed(1)} MB`);
if (report.emptyComponents.length) console.log(`EMPTY: ${report.emptyComponents.join(", ")}`);

// per-component topology of the body parts only (cheap; see 5.8 note on OOM)
for (const id of ["head", "face", "hands", "feet", "torso", "pelvis", "arms", "legs"]) {
  const c = build.components.find((x) => x.id === id);
  if (!c?.local?.mesh.indices.length) continue;
  const d = analyzeMesh(placedMesh(c));
  console.log(`${id.padEnd(6)} tris ${String(d.triangles).padStart(7)} boundary ${d.boundaryEdges} nonmanifold ${d.nonManifoldEdges} degenerate ${d.degenerateTriangles}`);
}
