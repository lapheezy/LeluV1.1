/**
 * WP21 — the world engine's pure rules: schema validation and edits,
 * family composition, persistence, export/import, and Time & Place
 * worlds that always carry their sources and confidence.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { allFamilies, composeWorld, FAMILIES } from "../src/core/worlds/ThemeFamilies";
import { PLACES, placeWorld } from "../src/core/worlds/Places";
import { editWorld, LAYER_KINDS, normaliseLayer, SLOTS, validateWorld } from "../src/core/worlds/WorldSchema";
import { activeWorld, applyEdit, combineInto, createWorld, deleteWorld, duplicateWorld, exportWorld, importWorld, resetWorld, savedWorlds, setWorldStorage } from "../src/core/worlds/WorldStore";
import { terrainHeight } from "../src/core/worlds/noise";

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

test("every family composes into a valid world whose layers all have a renderer kind", () => {
  for (const f of FAMILIES) {
    const w = composeWorld([f.id]);
    assert.ok(w.layers.length >= 3, f.id);
    for (const l of w.layers) assert.ok((LAYER_KINDS[l.slot] as readonly string[]).includes(l.kind), `${f.id}: ${l.slot}/${l.kind}`);
    assert.equal(new Set(w.layers.map((l) => l.id)).size, w.layers.length, `${f.id}: unique ids`);
    assert.ok(f.research.length > 0, `${f.id} cites the atlas`);
  }
});

test("there are at least twelve families across nature, celestial, seasonal, urban, illustrated, culture, science and abstract", () => {
  assert.ok(FAMILIES.length >= 12);
  assert.deepEqual(new Set(FAMILIES.map((f) => f.group)), new Set(["nature", "celestial", "seasonal", "urban", "illustrated", "culture", "science", "abstract"]));
});

test("composition: the primary keeps its sky, ground, frames and motion; the second adds what it brings", () => {
  const w = composeWorld(["underwater", "celestial"]);
  assert.deepEqual(w.families, ["underwater", "celestial"]);
  assert.equal(w.layers.filter((l) => l.kind === "sky").length, 1);
  assert.equal(w.layers.find((l) => l.kind === "sky")!.family, "underwater");
  assert.ok(w.layers.some((l) => l.kind === "seabed"));
  assert.ok(w.layers.some((l) => l.kind === "zodiac-wheel" && l.family === "celestial"));
  assert.ok(w.layers.some((l) => l.kind === "stars" && l.family === "celestial"));
  assert.equal(w.layers.filter((l) => l.slot === "spatialUI").length, 1);
  assert.equal(w.layers.filter((l) => l.slot === "motion").length, 1);
  assert.equal(w.palette.accent, FAMILIES.find((f) => f.id === "underwater")!.palette.accent);
});

test("validation clamps and drops what cannot be rendered", () => {
  const issues: string[] = [];
  assert.equal(normaliseLayer({ slot: "foundation", kind: "volcano" }, issues), null);
  assert.equal(normaliseLayer({ slot: "nowhere", kind: "sky" }, issues), null);
  const l = normaliseLayer({ slot: "atmosphere", kind: "rain", opacity: 7, params: { count: 1e9, bad: { x: 1 } as unknown as number } })!;
  assert.equal(l.opacity, 1);
  assert.equal(l.params.count, 1e4);
  assert.ok(!("bad" in l.params));
  const v = validateWorld({ name: "x", palette: { sky: ["red", "#000000", "#111111"] }, quality: "ultra", mode: "4d", motion: 9 }).world!;
  assert.equal(v.palette.sky[0], "#0b0620");
  assert.equal(v.quality, "auto");
  assert.equal(v.mode, "combined");
  assert.equal(v.motion, 2);
  assert.equal(validateWorld(null).world, null);
});

test("edits toggle, change, add and remove layers and world settings", () => {
  let w = composeWorld(["celestial"]);
  w = editWorld(w, { op: "toggle", id: "celestial-zodiac-wheel-4" }).world;
  assert.equal(w.layers.find((l) => l.id === "celestial-zodiac-wheel-4")!.enabled, false);
  w = editWorld(w, { op: "set", id: "celestial-stars-1", changes: { opacity: 0.4, params: { count: 300 } } }).world;
  assert.equal(w.layers.find((l) => l.id === "celestial-stars-1")!.params.count, 300);
  w = editWorld(w, { op: "add", layer: { slot: "atmosphere", kind: "snow" } }).world;
  assert.ok(w.layers.some((l) => l.kind === "snow" && l.family === "user"));
  w = editWorld(w, { op: "remove", id: "celestial-planet-2" }).world;
  assert.ok(!w.layers.some((l) => l.id === "celestial-planet-2"));
  w = editWorld(w, { op: "world", changes: { mode: "2d", density: 0.5, palette: { accent: "#123456" } } }).world;
  assert.equal(w.mode, "2d");
  assert.equal(w.palette.accent, "#123456");
  assert.ok(editWorld(w, { op: "toggle", id: "nope" }).issues.length);
});

test("store: create, combine, duplicate, reset, delete; everything persists", () => {
  const s = memory();
  setWorldStorage(s);
  const w = createWorld(["volcano"], "Mine", 1);
  combineInto(w.id, "holo-hud", 2);
  applyEdit(w.id, { op: "toggle", id: "volcano-ash-4" }, 3);
  const copy = duplicateWorld(w.id, 4)!;
  assert.equal(activeWorld()!.id, copy.id);
  setWorldStorage(s); // a reload
  assert.equal(savedWorlds().length, 2);
  assert.equal(activeWorld()!.id, copy.id);
  const orig = savedWorlds().find((x) => x.id === w.id)!;
  assert.deepEqual(orig.families, ["volcano", "holo-hud"]);
  assert.equal(orig.layers.find((l) => l.id === "volcano-ash-4")!.enabled, false);
  resetWorld(w.id, 5);
  const reset = savedWorlds().find((x) => x.id === w.id)!;
  assert.equal(reset.layers.find((l) => l.id === "volcano-ash-4")!.enabled, true);
  assert.equal(reset.name, "Mine");
  deleteWorld(copy.id);
  assert.equal(activeWorld(), null);
  assert.equal(savedWorlds().length, 1);
});

test("export and import round-trip; foreign or broken files are refused", () => {
  setWorldStorage(memory());
  const w = createWorld(["kemet", "quantum"]);
  const json = exportWorld(w.id)!;
  const r = importWorld(json);
  assert.ok(r.world);
  assert.notEqual(r.world!.id, w.id);
  assert.deepEqual(r.world!.layers, w.layers);
  assert.equal(importWorld("{not json").world, null);
  assert.equal(importWorld(JSON.stringify({ format: "other", world: w })).world, null);
});

test("every place era builds a world that names its location, era, confidence and sources", () => {
  for (const p of PLACES)
    for (const e of p.eras) {
      const w = placeWorld(p.id, e.id)!;
      assert.ok(w.place, `${p.id}/${e.id}`);
      assert.ok(w.place!.sources.length >= 2);
      assert.match(w.place!.confidence, /massing illustrative/);
      if (e.speculative) assert.match(w.place!.confidence, /speculative/);
      assert.ok(w.place!.sources.every((s) => /^\[(documented|approximate|illustrative|speculative)\]/.test(s)));
      assert.ok(w.layers.some((l) => l.kind === "city"));
    }
  assert.equal(placeWorld("atlantis", "present"), null);
});

test("Tampa's eras grow: more and taller buildings from c.1920 to the imagined 2060", () => {
  const scale = (era: string) => {
    const c = placeWorld("tampa", era)!.layers.find((l) => l.kind === "city")!;
    return (c.params.blocks as number) * (c.params.height as number) * (c.params.fill as number);
  };
  const order = ["c1920", "1958", "1999", "present", "2060"].map(scale);
  for (let i = 1; i < order.length; i++) assert.ok(order[i] > order[i - 1], `era ${i}`);
});

test("terrain is deterministic and the river runs low", () => {
  assert.equal(terrainHeight(10, -40, 8), terrainHeight(10, -40, 8));
  assert.ok(terrainHeight(Math.sin(-40 * 0.045) * 14 + Math.sin(-40 * 0.11) * 4, -40, 8) < terrainHeight(40, -40, 8));
});

test("slots cover the six layers the mission names", () => {
  assert.deepEqual([...SLOTS].sort(), ["atmosphere", "foundation", "graphics2d", "motion", "objects3d", "spatialUI"]);
  assert.ok(allFamilies().length >= FAMILIES.length);
});
