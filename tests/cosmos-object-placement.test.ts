/**
 * Mission 17, WP02 — where an object sits.
 *
 * The ring maths packed the depth inside the rounding factor, so every ring in
 * every version collapsed onto z ≈ 0, inside the core's cluster. These tests
 * pin the corrected slot maths, the legacy signature that normalisation
 * recognises, the rule that leaves a person's own placement alone, and the
 * placement itself: out of the reported hazard volumes, clear of the objects
 * already there, measured from real bounds.
 */

import assert from "node:assert/strict";
import test from "node:test";
import CosmosObjectStore, { needsPlacementNormalization } from "../src/core/cosmos/objects/CosmosObjectStore";
import {
  PLACEMENT_VERSION,
  RING_DEPTH,
  RING_HEIGHT,
  RING_RADIUS,
  isLegacyRingPosition,
  ringSlot,
  type CosmosObject,
  type Scene3DProgram,
  type Vec3,
} from "../src/core/cosmos/objects/CosmosObjectTypes";

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

function box(width: number, height: number, depth: number): Scene3DProgram {
  return {
    objects: [
      {
        id: "body",
        shape: "box",
        position: [0, height / 2, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#c99a6a",
        metalness: 0.1,
        roughness: 0.6,
        size: { width, height, depth },
      },
    ],
    lights: [],
    animated: [],
  } as unknown as Scene3DProgram;
}

function provenance(action: string) {
  return [{ at: 1, action, detail: "" }];
}

/* ------------------------------------------------------------------ */
/* the ring maths                                                      */
/* ------------------------------------------------------------------ */

test("the ring keeps its depth: slots sit in front of the core, not on it", () => {
  // The bug: Math.round((z + sin * r * 100) / 100) / 100 divides z by 100.
  for (let index = 0; index < 6; index += 1) {
    const [, y, z] = ringSlot(index);
    assert.equal(y, RING_HEIGHT);
    assert.ok(z >= RING_DEPTH - RING_RADIUS - 0.01 && z <= RING_DEPTH + RING_RADIUS + 0.01, `slot ${index} depth ${z}`);
    assert.ok(z > 0, `slot ${index} must be in front of the origin, not inside the cluster (z ${z})`);
  }
  // Six distinct slots, and each is a ring radius from the ring's centre.
  const slots = Array.from({ length: 6 }, (_, index) => ringSlot(index));
  assert.equal(new Set(slots.map((slot) => slot.join(","))).size, 6);
  for (const [x, , z] of slots) {
    const fromCentre = Math.hypot(x, z - RING_DEPTH);
    assert.ok(Math.abs(fromCentre - RING_RADIUS) < 0.02, `slot is ${fromCentre} from the ring centre`);
  }
});

test("wrapping past the sixth slot is a ring of its own, not a pile at index 0", () => {
  assert.deepEqual(ringSlot(6), ringSlot(0));
  assert.deepEqual(ringSlot(-1), ringSlot(5));
});

/* ------------------------------------------------------------------ */
/* the legacy signature                                                */
/* ------------------------------------------------------------------ */

test("the values the broken maths produced are recognised as legacy", () => {
  // Straight from the old implementation, for the three rings it was called with.
  const legacy = [
    [3.2, 0.9, 0], // index 0
    [1.6, 0.9, 2.59], // index 1
    [-1.6, 0.9, 2.59], // index 2
    [-3.2, 0.9, 0], // index 3
    [1.6, 0.9, 0.03], // a slot the old maths left at the origin's depth
  ] as Vec3[];
  for (const position of legacy) {
    assert.ok(isLegacyRingPosition(position), `${position.join(",")} should read as a legacy slot`);
  }
});

test("a corrected slot, a raised object and a placed object are not legacy", () => {
  for (let index = 0; index < 6; index += 1) {
    assert.equal(isLegacyRingPosition(ringSlot(index)), false, `corrected slot ${index} must not look legacy`);
  }
  assert.equal(isLegacyRingPosition([2, 4.5, 1]), false, "an object lifted by hand is not a legacy slot");
  assert.equal(isLegacyRingPosition([0, 0.9, 0]), false, "the origin itself is not a ring slot");
  assert.equal(isLegacyRingPosition([12, 0.9, 12]), false, "far from the cluster is not legacy");
});

test("normalisation is one-time and never touches a person's placement", () => {
  const legacyFrame = { position: [3.2, 0.9, 0] as Vec3, rotation: [0, 0, 0] as Vec3, scale: 4 };
  assert.equal(needsPlacementNormalization({ frame: legacyFrame, provenance: provenance("spawned") }), true);
  // Already migrated: the corrected slot is outside the signature anyway.
  assert.equal(
    needsPlacementNormalization({ frame: { ...legacyFrame, position: ringSlot(0) }, provenance: provenance("spawned") }),
    false,
  );
  // A user who moved it keeps it where they put it, even inside the cluster.
  for (const action of ["moved", "nudged", "relocated", "positioned", "transformed"]) {
    assert.equal(needsPlacementNormalization({ frame: legacyFrame, provenance: provenance(action) }), false, action);
  }
  // The version field is the belt to the signature's braces.
  assert.equal(needsPlacementNormalization({ frame: legacyFrame, provenance: provenance("spawned"), placementVersion: PLACEMENT_VERSION }), false);
});

/* ------------------------------------------------------------------ */
/* placement                                                           */
/* ------------------------------------------------------------------ */

test("two objects do not spawn in the same place, and keep identical geometry", () => {
  const store = CosmosObjectStore.createIsolated();
  const a = store.spawn({ name: "chair a", scene: box(0.46, 0.86, 0.48) });
  const b = store.spawn({ name: "chair b", scene: box(0.46, 0.86, 0.48) });
  assert.ok(a.ok && b.ok);
  assert.notDeepEqual(a.value.frame.position, b.value.frame.position, "the second must not land on the first");
  assert.deepEqual(a.value.scene.objects.map((part) => part.id), b.value.scene.objects.map((part) => part.id));
  // Different ids, same frame scale: identity is the only difference.
  assert.notEqual(a.value.id, b.value.id);
  assert.equal(a.value.frame.scale, b.value.frame.scale);
});

test("placement honours the hazard volumes the scene reports", () => {
  const store = CosmosObjectStore.createIsolated();
  store.setHazards([{ id: "core", center: [0, 0, 0], radius: RING_DEPTH + RING_RADIUS + 4 }]);
  const spawned = store.spawn({ name: "chair", scene: box(0.46, 0.86, 0.48) });
  assert.ok(spawned.ok);
  const [x, y, z] = spawned.value.frame.position;
  const distance = Math.hypot(x, y, z);
  assert.ok(distance > RING_DEPTH + RING_RADIUS + 4, `landed ${distance} from the core, inside the ${RING_DEPTH + RING_RADIUS + 4} hazard`);
  // And with nothing reported, it is back on the near ring.
  const free = CosmosObjectStore.createIsolated();
  free.setHazards([]);
  const near = free.spawn({ name: "chair", scene: box(0.46, 0.86, 0.48) });
  assert.ok(near.ok);
  assert.equal(Math.hypot(near.value.frame.position[0], near.value.frame.position[2] - RING_DEPTH) <= RING_RADIUS + 0.02, true);
});

test("a large object is placed by its bounds, not by its centre", () => {
  const store = CosmosObjectStore.createIsolated();
  const wide = store.spawn({ name: "wide", scene: box(6, 1, 1), frame: { scale: 2 } });
  const other = store.spawn({ name: "other", scene: box(1, 1, 1) });
  assert.ok(wide.ok && other.ok);
  const [ax, ay, az] = wide.value.frame.position;
  const [bx, by, bz] = other.value.frame.position;
  // Half extents: the wide one is 12 m across at scale 2, so the two boxes
  // cannot share any axis without overlapping.
  const halfA = 6;
  const halfB = 0.5;
  const overlaps = Math.abs(ax - bx) < halfA + halfB && Math.abs(ay - by) < 1 && Math.abs(az - bz) < halfB + 2;
  assert.equal(overlaps, false, `wide ${wide.value.frame.position} overlaps other ${other.value.frame.position}`);
});

test("relocate brings an object out and undo puts it back exactly", () => {
  const store = CosmosObjectStore.createIsolated();
  const spawned = store.spawn({ name: "chair", scene: box(0.46, 0.86, 0.48) });
  assert.ok(spawned.ok);
  const id = spawned.value.id;
  // Where the broken ring would have put it.
  store.transform(id, { position: [3.2, 0.9, 0] });
  const before = [...store.get(id)!.frame.position] as Vec3;
  const scene = JSON.stringify(store.get(id)!.scene);

  const moved = store.relocate(id);
  assert.ok(moved.ok);
  const after = [...moved.value.frame.position] as Vec3;
  assert.notDeepEqual(after, before);
  assert.ok(after[2] > 0, `must come out in front of the cluster, got z ${after[2]}`);
  assert.equal(JSON.stringify(moved.value.scene), scene, "geometry is untouched");
  assert.equal(moved.value.id, id, "identity is untouched");

  assert.ok(store.undo().ok);
  assert.deepEqual([...store.get(id)!.frame.position], before, "undo restores the exact previous transform");
  assert.ok(store.redo().ok);
  assert.deepEqual([...store.get(id)!.frame.position], after, "redo restores the relocation");
});

test("a locked object is not relocated behind the user's back", () => {
  const store = CosmosObjectStore.createIsolated();
  const spawned = store.spawn({ name: "chair", scene: box(0.46, 0.86, 0.48) });
  assert.ok(spawned.ok);
  store.lock(spawned.value.id, true);
  const result = store.relocate(spawned.value.id);
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /locked/);
});

test("restore keeps the object's placement, so nothing duplicates on the way back", () => {
  const store = CosmosObjectStore.createIsolated();
  const spawned = store.spawn({ name: "chair", scene: box(0.46, 0.86, 0.48) });
  assert.ok(spawned.ok);
  const id = spawned.value.id;
  const placed = [...spawned.value.frame.position] as Vec3;
  const removed = store.remove(id);
  assert.ok(removed.ok);
  assert.equal(store.list().length, 0);
  const restored = store.restore(id);
  assert.ok(restored.ok);
  assert.equal(store.list().length, 1, "exactly one object comes back");
  assert.deepEqual([...store.get(id)!.frame.position], placed);
});

test("an object that was already placed by hand keeps its slot through a relocation of another", () => {
  const store = CosmosObjectStore.createIsolated();
  const kept = store.spawn({ name: "kept", scene: box(1, 1, 1), frame: { position: [1.5, 2, -3] } });
  const moved = store.spawn({ name: "moved", scene: box(1, 1, 1) });
  assert.ok(kept.ok && moved.ok);
  store.relocate(moved.value.id);
  assert.deepEqual([...store.get(kept.value.id)!.frame.position], [1.5, 2, -3]);
});

test("hazard reporting is sanitised: no NaN or negative radii reach placement", () => {
  const store = CosmosObjectStore.createIsolated();
  store.setHazards([
    { id: "bad", center: [Number.NaN, 0, 0], radius: 5 },
    { id: "negative", center: [0, 0, 0], radius: -2 },
    { id: "good", center: [0, 0, 0], radius: 3 } as { id: string; center: Vec3; radius: number },
  ]);
  assert.deepEqual(store.hazards_().map((hazard) => hazard.id), ["good"]);
});

test("objects are placed as CosmosObject records that keep their provenance trail", () => {
  const store = CosmosObjectStore.createIsolated();
  const spawned = store.spawn({ name: "chair", scene: box(0.46, 0.86, 0.48) });
  assert.ok(spawned.ok);
  const object: CosmosObject = store.get(spawned.value.id)!;
  assert.ok(object.provenance.some((entry) => entry.action === "spawned"));
  store.relocate(object.id);
  const after = store.get(object.id)!;
  assert.ok(after.provenance.some((entry) => entry.action === "relocated"), "the move says so in its history");
});
