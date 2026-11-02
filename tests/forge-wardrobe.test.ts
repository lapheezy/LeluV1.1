/**
 * ==========================================================
 * LÉLU 3D FORGE — THE WARDROBE
 *
 * CATEGORY: integration. The real store and the real service.
 * Meshy is not involved: the wardrobe only ever names assets
 * that already finished and passed inspection, so it must be
 * able to dress her without spending a credit.
 *
 * What matters here:
 *
 *   - a look and a piece both come from a finished asset,
 *     and an unfinished or failed inspection cannot be worn
 *   - switching a look and swapping pieces is one decision:
 *     a bad id changes nothing at all
 *   - pieces in one slot replace each other; pieces in
 *     different slots stack
 *   - swapping is reversible without losing a placement or
 *     an asset
 * ==========================================================
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { buildGlb } from "./support/glbFixture";
import { inspectGlb } from "../src/core/forge/GlbInspector";
import { ForgeStore, type ForgeJob } from "../plugins/forgeStore";
import { MeshyForge } from "../plugins/meshyForge";

/** A finished, inspected job on disk — exactly what the wardrobe is allowed to wear. */
function seedFinishedJob(store: ForgeStore, character: string, options: { id: string; rigged?: boolean; meshValid?: boolean }): ForgeJob {
  const bytes = buildGlb({ textured: true, skinned: options.rigged === true });
  const report = inspectGlb(bytes);
  const dir = store.newVersionDir(character, "meshes", `image-to-3d_${options.id}`);
  const file = path.join(dir, "model.glb");
  writeFileSync(file, bytes);
  const job: ForgeJob = {
    id: options.id,
    character,
    kind: "image-to-3d",
    purpose: `seeded ${options.id}`,
    request: {},
    requestKey: options.id,
    estimatedCredits: 30,
    status: "SUCCEEDED",
    meshyTaskId: `task-${options.id}`,
    progress: 100,
    consumedCredits: 30,
    error: null,
    identityLock: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    submittedAt: Date.now(),
    finishedAt: Date.now(),
    output: { dir: store.relative(dir), files: [{ role: "model", file: store.relative(file), bytes: bytes.byteLength, sha256: "seeded" }] },
    validation: options.meshValid === false ? { ...report, ok: false, problems: ["seeded failure"], verdict: { ...report.verdict, meshValid: false } } : report,
  };
  store.saveJob(job);
  return job;
}

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "lelu-wardrobe-"));
  const store = new ForgeStore(root);
  mkdirSync(root, { recursive: true });
  const forge = new MeshyForge({ store, readEnv: () => undefined });
  const look = seedFinishedJob(store, "hero", { id: "fj_look_1" });
  const hair = seedFinishedJob(store, "hero", { id: "fj_hair_1" });
  return { root, store, forge, look, hair, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("a finished asset becomes a look or a worn piece; an unfinished one is refused", () => {
  const { store, forge, look, hair, cleanup } = setup();
  try {
    const empty = forge.wardrobeView("hero");
    assert.equal(empty.looks.length, 0);
    assert.equal(empty.slots.length, 0);

    forge.addWardrobeItem("hero", { id: "hooded", category: "look", jobId: look.id });
    assert.equal(store.manifest("hero").active["look:hooded"], look.id);

    const registered = forge.addWardrobeItem("hero", { id: "curls", category: "hair", jobId: hair.id });
    assert.equal(registered.item.bone, "Head", "hair follows the head unless told otherwise");
    assert.equal(registered.item.slot, "hair");

    const bad = seedFinishedJob(store, "hero", { id: "fj_bad_1", meshValid: false });
    assert.throws(() => forge.addWardrobeItem("hero", { id: "broken", category: "hair", jobId: bad.id }), /did not pass inspection/);
    assert.throws(() => forge.addWardrobeItem("hero", { id: "missing", category: "hair", jobId: "fj_nope" }), /No job/);
    assert.throws(() => forge.addWardrobeItem("hero", { id: "Bad Name", category: "hair", jobId: hair.id }), /lowercase/);
    assert.throws(() => forge.addWardrobeItem("hero", { id: "hat", category: "hats", jobId: hair.id }), /not a wardrobe category/);
  } finally {
    cleanup();
  }
});

test("dressing switches the look and puts pieces on their bones, spending nothing", () => {
  const { forge, store, look, hair, cleanup } = setup();
  try {
    forge.addWardrobeItem("hero", { id: "hooded", category: "look", jobId: look.id });
    forge.addWardrobeItem("hero", { id: "curls", category: "hair", jobId: hair.id, height: 0.34 });

    const jobsBefore = store.usage("hero").jobs;
    const result = forge.dressOutfit("hero", { look: "hooded", wear: { hair: "curls" } });

    assert.equal(result.manifest.currentLook, "hooded");
    assert.equal(store.usage("hero").jobs, jobsBefore, "dressing never files a job");
    const [placement] = store.placements();
    assert.equal(placement.attach?.bone, "Head");
    assert.equal(placement.attach?.character, "hero");
    assert.equal(placement.slot, "hair");
    assert.equal(placement.item, "curls");
    assert.equal(placement.worn, true);
    assert.equal(placement.height, 0.34);

    // The Cosmos would load her look from the rigged/as-approved look file.
    const active = forge.activeCharacter("hero");
    assert.equal(active.currentLook, "hooded");
    assert.match(active.model?.file ?? "", /model\.glb$/);
  } finally {
    cleanup();
  }
});

test("pieces in one slot replace each other; different slots stack; taking a slot off keeps the piece", () => {
  const { forge, store, look, hair, cleanup } = setup();
  try {
    const second = seedFinishedJob(store, "hero", { id: "fj_hair_2" });
    const bag = seedFinishedJob(store, "hero", { id: "fj_bag_1" });
    forge.addWardrobeItem("hero", { id: "hooded", category: "look", jobId: look.id });
    forge.addWardrobeItem("hero", { id: "curls", category: "hair", jobId: hair.id });
    forge.addWardrobeItem("hero", { id: "braids", category: "hair", jobId: second.id, height: 0.32 });
    forge.addWardrobeItem("hero", { id: "tote", category: "bag", jobId: bag.id, bone: "LeftHand", height: 0.22 });

    forge.dressOutfit("hero", { look: "hooded", wear: { hair: "curls" } });
    forge.dressOutfit("hero", { wear: { hair: "braids", bag: "tote" } });

    const placements = store.placements();
    const worn = placements.filter((p) => p.worn !== false);
    assert.deepEqual(worn.map((p) => p.slot).sort(), ["bag", "hair"]);
    assert.deepEqual(worn.map((p) => p.item).sort(), ["braids", "tote"]);
    assert.equal(placements.length, 3, "the curls placement is kept, just taken off");
    assert.equal(placements.find((p) => p.item === "curls")?.worn, false);
    assert.equal(placements.find((p) => p.item === "tote")?.attach?.bone, "LeftHand");

    forge.dressOutfit("hero", { wear: { hair: null } });
    assert.equal(store.placements().filter((p) => p.worn !== false).length, 1, "the bag stays on");
    assert.equal(store.wardrobeItems("hero").length, 3, "take-off never forgets a piece");
  } finally {
    cleanup();
  }
});

test("a bad id refuses the whole outfit: she is never left half-dressed", () => {
  const { forge, store, look, hair, cleanup } = setup();
  try {
    forge.addWardrobeItem("hero", { id: "hooded", category: "look", jobId: look.id });
    forge.addWardrobeItem("hero", { id: "curls", category: "hair", jobId: hair.id });
    forge.dressOutfit("hero", { look: "hooded", wear: { hair: "curls" } });
    const before = JSON.stringify(store.placements());

    assert.throws(() => forge.dressOutfit("hero", { look: null, wear: { hair: "nope" } }), /No wardrobe item/);
    assert.equal(JSON.stringify(store.placements()), before, "nothing moved");
    assert.equal(store.manifest("hero").currentLook, "hooded", "and the look did not change either");

    assert.throws(() => forge.dressOutfit("hero", { wear: { bag: "curls" } }), /belongs in slot/);
    assert.equal(JSON.stringify(store.placements()), before);
  } finally {
    cleanup();
  }
});

test("an unapproved look is refused by name, and the wardrobe reports what is on", () => {
  const { forge, look, hair, cleanup } = setup();
  try {
    forge.addWardrobeItem("hero", { id: "hooded", category: "look", jobId: look.id });
    forge.addWardrobeItem("hero", { id: "curls", category: "hair", jobId: hair.id });
    assert.throws(() => forge.dressOutfit("hero", { look: "gold_catsuit" }), (error: unknown) => {
      assert.match(String((error as Error).message), /No approved look "gold_catsuit"/);
      assert.match(String((error as { details?: string[] }).details?.join()), /Approved looks: hooded/);
      return true;
    });

    forge.dressOutfit("hero", { look: "hooded", wear: { hair: "curls" } });
    const wardrobe = forge.wardrobeView("hero");
    assert.equal(wardrobe.currentLook, "hooded");
    assert.deepEqual(wardrobe.looks.map((l) => [l.id, l.showing]), [["hooded", true]]);
    const hairSlot = wardrobe.slots.find((s) => s.slot === "hair");
    assert.equal(hairSlot?.wornId, "curls");
    assert.equal(hairSlot?.items[0].worn, true);
    assert.ok(hairSlot?.items[0].placementId, "the wardrobe names the placement the Cosmos renders");
  } finally {
    cleanup();
  }
});
