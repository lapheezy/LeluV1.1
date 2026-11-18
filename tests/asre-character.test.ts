/**
 * LÉLU ASRE — WP3 component-based character: what a change regenerates,
 * what it reuses, and that the parts still add up to the whole.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { BASE_CHARACTER, hairVariations, withChanges } from "../src/core/asre/character/CharacterSpec";
import { ComponentCache, buildCharacter, buildWholeObject, codesIou, componentCodes, glbParts, occupancyCodes, type Lattice } from "../src/core/asre/character/build";
import { writeGlb } from "../src/core/asre/gltf/GlbWriter";
import { inspectGlb } from "../src/core/forge/GlbInspector";

const L: Lattice = { resolution: 0.012, originCells: [-80, -6, -55], dims: [160, 180, 110] };
const base = BASE_CHARACTER;

function rebuild(change: Parameters<typeof withChanges>[1]) {
  const cache = new ComponentCache();
  const first = buildCharacter(base, cache, L);
  const second = buildCharacter(withChanges(base, change), cache, L);
  return { first, second };
}
const byId = (b: ReturnType<typeof buildCharacter>, id: string) => b.components.find((c) => c.id === id)!;

test("changing hair regenerates the hair only; every other component is reused unchanged", () => {
  const { first, second } = rebuild({ hair: { style: "afro" } });
  assert.deepEqual(second.regenerated, ["hair"]);
  for (const c of second.components) if (c.id !== "hair") assert.deepEqual(componentCodes(c, L), componentCodes(byId(first, c.id), L), c.id);
});

test("changing sleeves regenerates the top only — never the face", () => {
  const { second } = rebuild({ clothing: { top: "longsleeve" } });
  assert.deepEqual(second.regenerated, ["clothing.top"]);
  assert.ok(second.reused.includes("face"));
});

test("changing body proportions updates the body and dependent clothing; head, face and hair are moved, not rebuilt", () => {
  const { first, second } = rebuild({ body: { height: 1.84, legRatio: 0.5 } });
  for (const id of ["torso", "pelvis", "neck", "arms", "hands", "legs", "feet", "clothing.top", "clothing.bottom", "clothing.shoes"]) assert.ok(second.regenerated.includes(id as never), `${id} must follow the body`);
  for (const id of ["head", "face", "hair"]) assert.ok(second.reused.includes(id as never), `${id} must be reused`);
  const f1 = byId(first, "face"), f2 = byId(second, "face");
  assert.equal(f1.local, f2.local, "same cached geometry object");
  assert.notDeepEqual(f1.anchor, f2.anchor, "placed higher");
  const dy = f2.anchor[1] - f1.anchor[1];
  assert.ok(dy > 0);
  const moved = componentCodes(f1, L).length;
  assert.equal(componentCodes(f2, L).length, moved);
});

test("a pose change follows the limbs; a tank top and a skirt do not depend on them", () => {
  const sleeveless = withChanges(base, { clothing: { top: "tank", bottom: "skirt" } });
  const cache = new ComponentCache();
  buildCharacter(sleeveless, cache, L);
  const posed = buildCharacter(withChanges(sleeveless, { pose: "wave" }), cache, L);
  assert.deepEqual(posed.regenerated.sort(), ["arms", "hands", "legs", "feet", "clothing.shoes"].sort());
  const trousers = buildCharacter(withChanges(base, { pose: "wave" }), new ComponentCache(), L);
  assert.ok(trousers.regenerated.includes("clothing.top") && trousers.regenerated.includes("clothing.bottom"));
});

test("components add up to the whole object exactly (IoU 1) on the shared lattice", () => {
  for (const spec of [base, withChanges(base, { hair: { style: "spiky" }, accessories: { head: ["glasses", "hat"], body: ["backpack", "necklace"] }, pose: "t-pose" })]) {
    const parts = buildCharacter(spec, null, L);
    const whole = buildWholeObject(spec, L);
    assert.equal(codesIou(occupancyCodes(parts, L), whole.codes), 1);
  }
});

test("every hairstyle variation produces real, distinct geometry", () => {
  const vars = hairVariations(40);
  assert.equal(vars.length, 40);
  const sizes = new Set<number>();
  const cache = new ComponentCache();
  for (const v of vars) {
    const b = buildCharacter(withChanges(base, { hair: v.hair, materials: { hair: v.color } }), cache, L, ["head", "hair"]);
    const n = byId(b, "hair").local!.cells.length / 3;
    assert.ok(n > 50, `${v.label}: ${n} cells`);
    sizes.add(n);
  }
  assert.ok(sizes.size >= 36, `distinct hair volumes: ${sizes.size}`);
});

test("GLB: one node per component, inspected valid, extras carry identity and keys", () => {
  const b = buildCharacter(base, null, L);
  const glb = writeGlb(glbParts(b, base));
  const r = inspectGlb(glb);
  assert.equal(r.verdict.meshValid, true, r.problems.join("; "));
  const json = JSON.parse(new TextDecoder().decode(glb.subarray(20, 20 + new DataView(glb.buffer, glb.byteOffset).getUint32(12, true))));
  assert.equal(json.nodes.length, b.components.filter((c) => c.local?.mesh.indices.length).length);
  assert.ok(json.nodes.every((n: { extras: { identity: string; key: string } }) => n.extras.identity === base.identity.id && n.extras.key.length === 16));
});

test("a material-only change recolours cached geometry instead of regenerating it", () => {
  const cache = new ComponentCache();
  const first = buildCharacter(base, cache, L);
  const second = buildCharacter(withChanges(base, { materials: { skin: [0.9, 0.72, 0.6] } }), cache, L);
  assert.deepEqual(second.regenerated, []);
  assert.ok(second.recolored.includes("head") && second.recolored.includes("torso"));
  const h1 = byId(first, "head").local!, h2 = byId(second, "head").local!;
  assert.equal(h1.cells, h2.cells, "same geometry buffers");
  assert.notDeepEqual(h1.mesh.colors, h2.mesh.colors);
});
