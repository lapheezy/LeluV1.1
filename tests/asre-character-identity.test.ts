/**
 * Mission 5 WP04 — persistent character identity: one identity, immutable
 * versions, independently replaceable components, dependency-aware
 * regeneration, a verified persistent component cache, and the link to
 * LeluCharacterStore. Real lattice (6 mm), real builds.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { AsreCharacterStore, builderHash } from "../plugins/asreCharacters";
import { buildCharacter } from "../src/core/asre/character/build";
import { componentRecord, impactOf } from "../src/core/asre/character/identity";
import { BASE_CHARACTER, withChanges } from "../src/core/asre/character/CharacterSpec";
import { DEFAULT_LATTICE } from "../src/core/asre/character/build";
import { COMPONENT_ORDER } from "../src/core/asre/character/components";
import LeluCharacterStore from "../src/core/avatar/LeluCharacterStore";

const BODY = ["torso", "pelvis", "neck", "arms", "hands", "legs", "feet"] as const;

test("impact analysis says what an edit will rebuild, and why, before anything is built", () => {
  const L = DEFAULT_LATTICE;
  const hair = impactOf(BASE_CHARACTER, withChanges(BASE_CHARACTER, { hair: { style: "afro" } }), L);
  assert.deepEqual(hair.filter((c) => c.action !== "keep").map((c) => [c.id, c.action, c.reason]), [["hair", "rebuild", "own parameters"]]);
  const mat = impactOf(BASE_CHARACTER, withChanges(BASE_CHARACTER, { materials: { top: [0.9, 0.1, 0.1] } }), L);
  assert.deepEqual(mat.filter((c) => c.action !== "keep").map((c) => [c.id, c.action]), [["clothing.top", "recolor"]]);
  const body = impactOf(BASE_CHARACTER, withChanges(BASE_CHARACTER, { body: { shoulderWidth: 0.46 } }), L);
  const by = Object.fromEntries(body.map((c) => [c.id, c]));
  assert.equal(by.torso.reason, "own parameters");
  assert.equal(by["clothing.top"].action, "rebuild");
  assert.match(by["clothing.top"].reason, /depends on (torso|arms)/, "the shirt is refitted because the body under it changed");
  assert.equal(by.face.action, "keep");
  assert.equal(by.hair.action, "keep");
});

test("persistent identity: hair, outfit, materials, body and pose edits rebuild only what they must", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "asre-char-"));
  try {
    const store = new AsreCharacterStore({ root });
    const v1 = await store.create({ id: "lelu", name: "LÉLU", leluLook: "gothic" });
    assert.equal(v1.id, "v0001");
    assert.equal(v1.spec.identity.id, "lelu");
    assert.equal(v1.glb.meshValid, true);

    // hairstyle: rebuild hair only; face and body byte-identical
    const v2 = await store.edit("lelu", { hair: { style: "bob" } });
    assert.deepEqual(v2.build.regenerated, ["hair"]);
    assert.equal(v2.components.face.geometrySha, v1.components.face.geometrySha);
    assert.equal(v2.components.face.materialSha, v1.components.face.materialSha);
    assert.equal(v2.components.head.geometrySha, v1.components.head.geometrySha);
    for (const id of BODY) assert.equal(v2.components[id].geometrySha, v1.components[id].geometrySha, id);
    assert.notEqual(v2.components.hair.geometrySha, v1.components.hair.geometrySha);
    assert.equal(v2.spec.identity.id, v1.spec.identity.id);

    // shirt: only the affected clothing
    const v3 = await store.edit("lelu", { clothing: { top: "jacket" } });
    assert.deepEqual(v3.build.regenerated, ["clothing.top"]);
    for (const id of COMPONENT_ORDER) if (id !== "clothing.top") assert.equal(v3.components[id].geometrySha, v2.components[id].geometrySha, id);

    // material: geometry reused (no resampling), colours change
    const v4 = await store.edit("lelu", { materials: { top: [0.8, 0.1, 0.2], skin: [0.5, 0.35, 0.28] } });
    assert.deepEqual(v4.build.regenerated, [], "a material change samples nothing");
    assert.ok(v4.build.recolored.includes("clothing.top") && v4.build.recolored.includes("torso"));
    for (const id of BODY) assert.equal(v4.components[id].geometrySha, v3.components[id].geometrySha, `${id} geometry identical under a material change`);
    assert.notEqual(v4.components.torso.materialSha, v3.components.torso.materialSha);

    // body proportions: anatomy rebuilt, dependent clothing refitted, head/face/hair preserved
    const v5 = await store.edit("lelu", { body: { shoulderWidth: 0.46, build: 1.12 } });
    for (const id of ["torso", "arms", "clothing.top"] as const) assert.ok(v5.build.regenerated.includes(id), `${id} rebuilt`);
    for (const id of ["face", "hair", "head", "accessories.head"] as const) assert.equal(v5.components[id].geometrySha, v4.components[id].geometrySha, `${id} preserved`);
    assert.notEqual(v5.components["clothing.top"].geometrySha, v4.components["clothing.top"].geometrySha, "the jacket was refitted");

    // pose: limbs move, head identity preserved
    const v6 = await store.edit("lelu", { pose: "wave" });
    assert.ok(v6.build.regenerated.includes("arms"));
    assert.equal(v6.components.face.geometrySha, v5.components.face.geometrySha);
    assert.equal(store.verify("lelu").length, 0, "every stored version verifies");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("restoration returns the right version; repeated edits accumulate no corruption; equals a fresh build", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "asre-char-"));
  try {
    const store = new AsreCharacterStore({ root });
    const v1 = await store.create({ id: "c" });
    let last = v1;
    for (let i = 0; i < 6; i++) last = await store.edit("c", { hair: { style: i % 2 ? "long-straight" : "afro" }, materials: { top: i % 2 ? BASE_CHARACTER.materials.top : [0.2, 0.6, 0.3] } });
    // after an even number of round trips the spec is back to the base
    assert.equal(last.specHash, v1.specHash);
    assert.equal(last.glb.sha256, v1.glb.sha256, "the same spec gives byte-identical output after 6 edits");
    for (const id of COMPONENT_ORDER) assert.equal(last.components[id].geometrySha, v1.components[id].geometrySha, id);
    // a cold build with no cache gives the same component bytes
    const fresh = buildCharacter(withChanges(BASE_CHARACTER, {}), null);
    for (const c of fresh.components) assert.equal(componentRecord(c).geometrySha, v1.components[c.id].geometrySha, `fresh ${c.id}`);

    const afro = await store.edit("c", { hair: { style: "afro" } });
    const restored = await store.restore("c", v1.id);
    assert.equal(restored.operation.kind, "restore");
    assert.equal(restored.specHash, v1.specHash);
    assert.equal(restored.glb.sha256, v1.glb.sha256);
    assert.equal(restored.parentId, afro.id, "a restore is a new version on top of the head, not a rewrite");
    // the original files are untouched
    assert.equal(store.version("c", v1.id).recordHash, v1.recordHash);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the persistent cache survives restarts, and never serves stale or damaged geometry", async () => {
  const root = mkdtempSync(path.join(tmpdir(), "asre-char-"));
  try {
    const a = new AsreCharacterStore({ root });
    const v1 = await a.create({ id: "p" });
    // restart: a new process-level store reuses every component from disk
    const b = new AsreCharacterStore({ root });
    const v2 = await b.edit("p", { hair: { style: "pixie" } });
    assert.deepEqual(v2.build.regenerated, ["hair"]);
    assert.equal(b.cache.diskHits, 14, "14 components came from the disk cache");
    // damage one cached component on disk: it is refused and rebuilt identically
    const dir = path.join(root, "characters", "_components", b.builder);
    const files = readdirSync(dir).filter((f) => f.endsWith(".bin"));
    for (const f of files) {
      const buf = readFileSync(path.join(dir, f));
      buf[buf.length - 1] ^= 0xff;
      writeFileSync(path.join(dir, f), buf);
    }
    const c = new AsreCharacterStore({ root });
    const v3 = await c.edit("p", { hair: { style: "bun" } });
    assert.ok(c.cache.rejected > 0, "damaged entries were refused");
    assert.equal(c.cache.diskHits, 0);
    for (const id of COMPONENT_ORDER) if (id !== "hair") assert.equal(v3.components[id].geometrySha, v1.components[id].geometrySha, `${id} rebuilt identically`);
    // a different builder (code changed) never sees the old entries
    const d = new AsreCharacterStore({ root, builder: "0000000000000000" });
    await d.edit("p", { hair: { style: "afro" } });
    assert.equal(d.cache.diskHits, 0);
    assert.notEqual(builderHash(), "0000000000000000");
    // a tampered version record is reported and refused
    const vf = path.join(root, "characters", "p", "versions", "v0001.json");
    const rec = JSON.parse(readFileSync(vf, "utf8"));
    rec.label = "tampered";
    writeFileSync(vf, JSON.stringify(rec));
    assert.equal(d.verify("p")[0].version, "v0001");
    assert.throws(() => d.version("p", "v0001"), /failed verification/);
    await assert.rejects(() => d.create({ id: "p" }), /already exists/);
    await assert.rejects(() => d.edit("p", { identity: { id: "x" } } as never), /identity cannot be edited/);
    await assert.rejects(() => d.edit("p", { body: { height: 9 } }), /height must be/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("LeluCharacterStore links her to a persistent ASRE character version", () => {
  // the same browser-storage shim the other LeluCharacterStore tests use
  if (typeof globalThis.window === "undefined") (globalThis as Record<string, unknown>).window = globalThis;
  if (typeof localStorage === "undefined") {
    const kv: Record<string, string> = {};
    (globalThis as Record<string, unknown>).localStorage = { getItem: (k: string) => kv[k] ?? null, setItem: (k: string, v: string) => void (kv[k] = v), removeItem: (k: string) => void delete kv[k], clear: () => {}, length: 0, key: () => null };
  }
  LeluCharacterStore.resetForTests();
  const s = LeluCharacterStore.getInstance();
  assert.equal(s.get().asre, null);
  s.setAsreCharacter({ characterId: "lelu", version: "v0003" });
  assert.deepEqual(s.get().asre, { characterId: "lelu", version: "v0003" });
  s.setAsreCharacter({ characterId: "../x", version: "v1" });
  assert.deepEqual(s.get().asre, { characterId: "lelu", version: "v0003" }, "invalid links are ignored");
  LeluCharacterStore.resetForTests();
  assert.deepEqual(LeluCharacterStore.getInstance().get().asre, { characterId: "lelu", version: "v0003" }, "persisted");
  LeluCharacterStore.getInstance().setAsreCharacter(null);
  assert.equal(LeluCharacterStore.getInstance().get().asre, null);
});
