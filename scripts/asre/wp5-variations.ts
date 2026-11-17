/**
 * WP5 — one persistent character, many variations, real geometry, real renders.
 *
 *   npx tsx scripts/asre/wp5-variations.ts [--res 0.006] [--samples 12]
 *
 * Every variation is built through ONE component cache, so the manifest
 * records exactly what each variation regenerated and what it reused, and
 * the identity components (head + face) are checked cell-for-cell.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { BASE_CHARACTER, BODY_VARIANTS, OUTFITS, hairVariations, withChanges, type CharacterSpec, type PoseId } from "../../src/core/asre/character/CharacterSpec";
import { ComponentCache, DEFAULT_LATTICE, buildCharacter, componentCodes, glbParts, type CharacterBuild } from "../../src/core/asre/character/build";
import type { ComponentId } from "../../src/core/asre/character/components";
import { writeGlb } from "../../src/core/asre/gltf/GlbWriter";
import { inspectGlb } from "../../src/core/forge/GlbInspector";
import { sha256Hex } from "../../src/core/asre/nre";
import { ROOT, renderGlb } from "./runtime";

const arg = (k: string, d: string) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const samples = Number(arg("--samples", "12"));
const OUT = path.join(ROOT, "artifacts/asre/character/variations");
mkdirSync(OUT, { recursive: true });
const h = DEFAULT_LATTICE.resolution;
const cache = new ComponentCache();
const BUST: ComponentId[] = ["torso", "neck", "head", "face", "hair", "clothing.top", "accessories.head", "accessories.body"];

const identityHash = (b: CharacterBuild) => {
  const local = (id: ComponentId) => b.components.find((c) => c.id === id)!;
  // identity = head + face geometry in their own frame (independent of where the body puts them)
  return sha256Hex(JSON.stringify(["head", "face"].map((id) => {
    const c = local(id as ComponentId);
    return componentCodes({ ...c, anchor: [0, 0, 0] }, { ...DEFAULT_LATTICE, originCells: [-200, -200, -200], dims: [400, 400, 400] });
  }))).slice(0, 16);
};

interface Entry { group: string; label: string; regenerated: string[]; reused: string[]; buildMs: number; identity: string; triangles: number; render: string; renderSeconds: number }
const manifest: Entry[] = [];

async function variation(group: string, label: string, spec: CharacterSpec, opts: { bust?: boolean; view?: "front" | "three-quarter" } = {}) {
  const b = buildCharacter(spec, cache);
  const parts = glbParts(b, h, spec).filter((p) => !opts.bust || BUST.includes(p.name as ComponentId));
  const glb = writeGlb(parts, { extras: { identity: spec.identity.id, variation: `${group}/${label}` } });
  const rep = inspectGlb(glb);
  if (!rep.verdict.meshValid) throw new Error(`${label}: ${rep.problems.join("; ")}`);
  const dir = path.join(OUT, group);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${label}.glb`);
  writeFileSync(file, glb);
  const r = await renderGlb({ inputs: [file], output: path.join(dir, `${label}.png`), resolution: opts.bust ? [256, 256] : [256, 384], samples, view: opts.view ?? "three-quarter" });
  manifest.push({ group, label, regenerated: b.regenerated, reused: b.reused, buildMs: Math.round(b.ms), identity: identityHash(b), triangles: rep.geometry.triangles, render: path.relative(ROOT, r.output), renderSeconds: r.render_seconds });
  console.log(`${group}/${label}: regen ${b.regenerated.length} reuse ${b.reused.length} ${Math.round(b.ms)} ms, render ${r.render_seconds}s`);
}

await variation("base", "base", BASE_CHARACTER, { view: "front" });
for (const v of hairVariations(40)) await variation("hair", v.label, withChanges(BASE_CHARACTER, { hair: v.hair, materials: { hair: v.color } }), { bust: true });
for (const o of OUTFITS) await variation("outfits", o.label, withChanges(BASE_CHARACTER, { clothing: o.clothing, materials: { top: o.top, bottom: o.bottom } }));
for (const b of BODY_VARIANTS) await variation("bodies", b.label, withChanges(BASE_CHARACTER, { body: b.body }), { view: "front" });
for (const p of ["relaxed", "a-pose", "t-pose", "wave", "stride"] as PoseId[]) await variation("poses", p, withChanges(BASE_CHARACTER, { pose: p }), { view: "front" });
const ACC: Array<[string, CharacterSpec["accessories"]]> = [["glasses", { head: ["glasses"], body: [] }], ["hat", { head: ["hat"], body: [] }], ["earrings-necklace", { head: ["earrings"], body: ["necklace"] }], ["backpack", { head: [], body: ["backpack"] }], ["all", { head: ["glasses", "earrings"], body: ["necklace", "backpack"] }]];
for (const [label, acc] of ACC) await variation("accessories", label, withChanges(BASE_CHARACTER, { accessories: acc }));
const MATS: Array<[string, Partial<CharacterSpec["materials"]>]> = [["skin-light", { skin: [0.9, 0.72, 0.6] }], ["skin-deep", { skin: [0.36, 0.22, 0.15] }], ["monochrome", { top: [0.9, 0.9, 0.9], bottom: [0.9, 0.9, 0.9], shoes: [0.9, 0.9, 0.9] }], ["neon", { top: [0.1, 0.9, 0.6], bottom: [0.9, 0.1, 0.6], hair: [0.9, 0.2, 0.8] }]];
for (const [label, mat] of MATS) await variation("materials", label, withChanges(BASE_CHARACTER, { materials: mat }));

const ids = new Map<string, number>();
for (const e of manifest) ids.set(e.identity, (ids.get(e.identity) ?? 0) + 1);
const summary = {
  variations: manifest.length,
  byGroup: Object.fromEntries([...new Set(manifest.map((e) => e.group))].map((g) => [g, manifest.filter((e) => e.group === g).length])),
  identityHashes: Object.fromEntries(ids),
  cache: { entries: cache.size, hits: cache.hits, misses: cache.misses },
  componentBuildsIfNoReuse: manifest.length * 15,
  componentBuildsActual: manifest.reduce((s, e) => s + e.regenerated.length, 0),
};
writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify({ summary, manifest }, null, 1));
console.log(JSON.stringify(summary, null, 1));
