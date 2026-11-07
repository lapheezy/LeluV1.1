/**
 * ==========================================================
 * LÉLU 3D FORGE — BOARD DECOMPOSITION + INVENTORY
 *
 * CATEGORY: unit. No network, no credits, no Meshy.
 *
 * A board may never become a garment, so the pipeline needs
 * a way to cut one asset out of it that keeps provenance and
 * refuses nonsense rectangles. And an inventory needs to say
 * honestly what can be built now, what it costs, and what is
 * still blocked on a reference that does not exist.
 * ==========================================================
 */

import assert from "node:assert/strict";
import test from "node:test";

import { cropPng, regionToPixels, solidPng, decodeToRgba } from "../plugins/forgeCrop";
import { buildRecords } from "../plugins/forgeReferences";
import { planInventory, totalise, validateInventory, type InventoryAsset, type WardrobeInventory } from "../plugins/wardrobeInventory";

function asset(overrides: Partial<InventoryAsset> & Pick<InventoryAsset, "id" | "category" | "slot">): InventoryAsset {
  return {
    name: overrides.id,
    references: [],
    generation: { kind: "image-to-3d" },
    ...overrides,
  };
}

test("a crop keeps the sheet's pixels and its rectangle is a fraction of the sheet", () => {
  const sheet = solidPng(400, 300, [10, 20, 30, 255]);
  const cropped = cropPng(sheet, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  assert.deepEqual([cropped.width, cropped.height], [200, 150]);
  const back = decodeToRgba(cropped.png);
  assert.deepEqual([...back.pixels.subarray(0, 4)], [10, 20, 30, 255], "the cropped pixels survive the round trip");

  // The same rectangle survives a re-export at another resolution.
  assert.deepEqual(regionToPixels(800, 600, { x: 0.25, y: 0.25, w: 0.5, h: 0.5 }), { x: 200, y: 150, w: 400, h: 300 });
});

test("a crop refuses what could not drive geometry", () => {
  assert.throws(() => regionToPixels(400, 300, { x: 0.98, y: 0.98, w: 0.5, h: 0.5 }), /too small/, "a rectangle running off the sheet is clamped, then refused for being a sliver");
  assert.throws(() => regionToPixels(400, 300, { x: 1.4, y: 0, w: 0.2, h: 0.2 }), /fraction between 0 and 1/);
  assert.throws(() => regionToPixels(400, 300, { x: 0, y: 0, w: 0.001, h: 0.5 }), /too small/);
});

test("the inventory refuses a record the wardrobe could not hold", () => {
  const base = { version: 1, character: "hero", looks: [{ id: "look_a", title: "A", authority: [], boards: [], assets: [asset({ id: "coat", category: "outerwear", slot: "outerwear", bone: "Spine02" })] }] };
  assert.doesNotThrow(() => validateInventory(base));

  assert.throws(() => validateInventory({ ...base, looks: [{ ...base.looks[0], assets: [asset({ id: "coat", category: "hats", slot: "hats", bone: "Head" })] }] }), /not a wardrobe category/);
  assert.throws(() => validateInventory({ ...base, looks: [{ ...base.looks[0], assets: [asset({ id: "coat", category: "outerwear", slot: "outerwear" })] }] }), /needs the bone/);
  assert.throws(
    () => validateInventory({ ...base, looks: [{ ...base.looks[0], assets: [asset({ id: "coat", category: "outerwear", slot: "outerwear", bone: "Spine02" }), asset({ id: "coat", category: "bag", slot: "bag", bone: "RightHand" })] }] }),
    /used more than once/,
  );
});

test("planning prices what can be built now and names what blocks the rest", () => {
  const png = solidPng(512, 512, [120, 90, 60, 255]);
  const references = buildRecords([{ classification: { id: "photo_front", sourceName: "photo.png", category: "body", view: "front full-body", outfitVariant: "A", intendedUse: "authority", uses: ["geometry"] }, file: "photo.png", bytes: png }], []);

  const inventory: WardrobeInventory = {
    version: 1,
    character: "hero",
    looks: [
      {
        id: "look_a",
        title: "A",
        authority: ["photo_front"],
        boards: [],
        assets: [
          asset({ id: "coat", category: "look", slot: "look", references: ["photo_front"], generation: { kind: "image-to-3d", geometry: "2k", polycount: 90000 }, rig: true, isLook: true }),
          asset({ id: "belt", category: "accessory", slot: "belt", bone: "Hips", references: ["photo_front"], generation: { kind: "image-to-3d", geometry: "2k" } }),
          asset({ id: "bag", category: "bag", slot: "bag", bone: "RightHand", references: ["board_bag"], generation: { kind: "image-to-3d" } }),
          asset({ id: "hair", category: "headwear", slot: "hair-accessory", bone: "Head", references: [], generation: { kind: "image-to-3d" } }),
        ],
      },
    ],
  };

  const planned = planInventory(inventory, references);
  const by = Object.fromEntries(planned.map((p) => [p.asset.id, p]));

  assert.equal(by.coat.blockers.length, 0);
  assert.equal(by.coat.estimate, 35, "textured 2k geometry image-to-3d");
  assert.equal(by.coat.rigEstimate, 5);
  assert.deepEqual(by.coat.body.image_url, "ref:photo_front");
  assert.equal(by.belt.estimate, 35);

  assert.deepEqual(by.bag.blockers, ['reference "board_bag" is not ingested', "none of its references exist on disk"]);
  assert.equal(by.bag.estimate, 0, "a blocked asset is never priced as if it could run");

  assert.deepEqual(by.hair.blockers, ["no reference assigned: a crop of the board or the original photograph must be chosen first"]);

  const totals = totalise(planned);
  assert.deepEqual(totals, { ready: 2, blocked: 2, generation: 70, rigging: 5 });
});

test("a multi-image asset needs at least two references that exist", () => {
  const png = solidPng(256, 256, [30, 30, 30, 255]);
  const references = buildRecords([{ classification: { id: "front", sourceName: "f.png", category: "body", view: "front", outfitVariant: "A", intendedUse: "authority", uses: ["geometry"] }, file: "f.png", bytes: png }], []);
  const inventory: WardrobeInventory = {
    version: 1,
    character: "hero",
    looks: [
      {
        id: "look_a",
        title: "A",
        authority: ["front"],
        boards: [],
        assets: [asset({ id: "coat", category: "look", slot: "look", references: ["front", "board_rear"], generation: { kind: "multi-image-to-3d" }, isLook: true })],
      },
    ],
  };
  const [planned] = planInventory(inventory, references);
  assert.ok(planned.blockers.some((b) => /at least 2 usable references/.test(b)));
  assert.equal(planned.estimate, 0);
});
