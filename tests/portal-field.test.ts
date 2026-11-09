/**
 * LÉLU — the portal field's placement model.
 *
 * Mission 5.3 proved that the registry persists and that the field is mounted.
 * These tests cover the layer that was only ever looked at in a screenshot:
 * which registry record becomes which drawn object, where, and whether a second
 * portal to the same environment hides behind the first.
 *
 * They use node:test because `bun run test` runs the suite with tsx/Node; a
 * `bun:test` import passes under `bun test` and crashes the file in the real
 * suite ("Received protocol 'bun:'").
 */

import test from "node:test";
import assert from "node:assert/strict";

import PortalRegistry, {
  PORTAL_STORAGE_KEY,
  RING_SCENES,
  builtinPortalId,
  type PortalPort,
} from "../src/app/scene/spatial/PortalRegistry";
import {
  MOUTH_SEPARATION,
  collidingPortalIds,
  duplicatePortalIds,
  overlappingHitIds,
  portalPlacements,
  ringSpacing,
} from "../src/app/scene/spatial/portalField";

function memoryPort(): PortalPort & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get<T>(key: string): T | null {
      return (data.get(key) as T) ?? null;
    },
    set(key: string, value: unknown): boolean {
      data.set(key, value);
      return true;
    },
  };
}

function seeded(): { registry: PortalRegistry; port: ReturnType<typeof memoryPort> } {
  const port = memoryPort();
  const registry = PortalRegistry.resetForTests(port);
  registry.seedRing(RING_SCENES);
  return { registry, port };
}

test("the field draws exactly the ring the registry seeded, one object per identity", () => {
  const { registry } = seeded();
  const placements = portalPlacements(registry.list());
  assert.equal(placements.length, RING_SCENES.length);
  assert.deepEqual(
    placements.map((placement) => placement.id).sort(),
    RING_SCENES.map((scene) => builtinPortalId(scene)).sort(),
  );
  // Every built-in portal owns exactly one slot on the ring, and no two slots
  // coincide — that is what makes each one aimable.
  for (const placement of placements) {
    assert.equal(placement.builtin, true);
    assert.equal(placement.orbitIndex, 0);
    assert.ok(
      Math.abs(Math.hypot(placement.offset.x, placement.offset.y / 0.6) - 7.2) < 0.01,
      "a built-in portal sits on the ring",
    );
  }
  assert.equal(
    new Set(placements.map((placement) => `${placement.offset.x.toFixed(4)}:${placement.offset.y.toFixed(4)}`)).size,
    placements.length,
    "no two built-in portals occupy the same point",
  );
  assert.deepEqual(collidingPortalIds(placements), []);
  assert.deepEqual(duplicatePortalIds(registry.list()), []);
});

test("a second portal to the same environment never stacks on the first", () => {
  const { registry } = seeded();
  const first = registry.create({ destination: "browser", label: "Research feed" });
  const second = registry.create({ destination: "browser", label: "Second feed" });
  assert.equal(first.ok && second.ok, true);
  if (!first.ok || !second.ok) return;

  const placements = portalPlacements(registry.list());
  const browser = placements.filter((placement) => placement.destination === "browser");
  assert.equal(browser.length, 3);
  const builtin = browser.find((placement) => placement.builtin);
  const extras = browser.filter((placement) => !placement.builtin);
  assert.ok(builtin);
  assert.deepEqual(extras.map((placement) => placement.orbitIndex).sort(), [0, 1]);
  assert.notDeepEqual(extras[0].offset, extras[1].offset);
  assert.notDeepEqual(extras[0].offset, builtin.offset);
  assert.notDeepEqual(extras[1].offset, builtin.offset);
  // Each mouth stays clear of its neighbour: the ring slot and both extras are
  // independently aimable, whatever their drawn size.
  assert.deepEqual(collidingPortalIds(placements), []);
  assert.deepEqual(overlappingHitIds(placements), []);
});

test("removing a portal removes its drawn object and leaves no stale placement", () => {
  const { registry } = seeded();
  const created = registry.create({ destination: "projects", label: "Sprint board" });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  assert.ok(portalPlacements(registry.list()).some((placement) => placement.id === created.portal.id));

  assert.equal(registry.remove(created.portal.id), true);
  const placements = portalPlacements(registry.list());
  assert.equal(placements.some((placement) => placement.id === created.portal.id), false);
  assert.equal(placements.length, RING_SCENES.length);
  assert.deepEqual(collidingPortalIds(placements), []);
});

test("a rename follows the identity without moving or re-creating it", () => {
  const { registry } = seeded();
  const created = registry.create({ destination: "files", label: "Before" });
  assert.equal(created.ok, true);
  if (!created.ok) return;
  const updated = registry.update(created.portal.id, { label: "After" });
  assert.equal(updated.ok, true);
  const placement = portalPlacements(registry.list()).find((entry) => entry.id === created.portal.id);
  assert.equal(placement?.label, "After");
  assert.equal(placement?.destination, "files");
});

test("a reloaded field is exactly the field that was saved", () => {
  const port = memoryPort();
  const live = PortalRegistry.resetForTests(port);
  live.seedRing(RING_SCENES);
  const created = live.create({ destination: "media", label: "Moodboard", createdBy: "agent" });
  assert.equal(created.ok, true);
  const before = portalPlacements(live.list());

  // The same stored bytes, read by a fresh registry over the same port.
  const reloaded = PortalRegistry.resetForTests(port);
  reloaded.seedRing(RING_SCENES);
  const after = portalPlacements(reloaded.list());
  assert.deepEqual(after, before);
  assert.ok(after.some((placement) => placement.label === "Moodboard"));
  assert.deepEqual(duplicatePortalIds(reloaded.list()), []);
});

test("the Core and the Cosmos are the world, not portals in it", () => {
  const { registry } = seeded();
  const placements = portalPlacements([
    ...registry.list(),
    { id: "scene:core", destination: "core", label: "Core", createdBy: "user", createdAt: 0, workspace: "default" },
    { id: "scene:cosmos", destination: "cosmos", label: "Cosmos", createdBy: "user", createdAt: 0, workspace: "default" },
  ]);
  assert.equal(placements.some((placement) => placement.destination === "core"), false);
  assert.equal(placements.some((placement) => placement.destination === "cosmos"), false);
});

/**
 * Mission 5.4B's failure in measurable form: a click on `files` travelled to
 * `portal` because two coplanar interactive mouths covered the same pointer
 * position, and the raycast tie was decided by traversal order. These cases
 * assert the geometric guarantee at the sizes the app really reaches.
 */
test("no two interactive mouths ever overlap, at any portal count", () => {
  const cases: Array<{ builtins: number; extras: number; radius: number }> = [
    { builtins: 11, extras: 0, radius: 3 },
    { builtins: 11, extras: 11, radius: 3 },
    { builtins: 11, extras: 30, radius: 2.2 },
    { builtins: 11, extras: 53, radius: 1.6 },
    { builtins: 2, extras: 0, radius: 6 },
  ];
  for (const testCase of cases) {
    const port = memoryPort();
    const registry = PortalRegistry.resetForTests(port);
    registry.seedRing(RING_SCENES.slice(0, testCase.builtins));
    for (let index = 0; index < testCase.extras; index += 1) {
      const created = registry.create({
        destination: RING_SCENES[index % testCase.builtins],
        label: `Extra ${index}`,
      });
      assert.equal(created.ok, true);
    }
    const placements = portalPlacements(registry.list(), { radius: testCase.radius });
    assert.deepEqual(
      overlappingHitIds(placements),
      [],
      `${testCase.builtins}+${testCase.extras} at radius ${testCase.radius} must have no overlapping mouths`,
    );
  }
});

test("each mouth is measured against its nearest neighbour, not its own size", () => {
  const { registry } = seeded();
  const placements = portalPlacements(registry.list(), { radius: 3 });
  const spacing = ringSpacing(3, placements.length);
  for (const placement of placements) {
    assert.equal(placement.builtin, true);
    assert.ok(
      placement.hitRadius <= MOUTH_SEPARATION * spacing + 1e-6,
      "a mouth may not be wider than the gap to the next slot",
    );
    assert.ok(placement.hitRadius > placement.radius, "the mouth covers the seam it belongs to");
  }
  // Every mouth is comfortably wider than a pointer: at a framed ring of
  // radius 3 the slots are ~1.7 units apart, so the mouth keeps a real target.
  assert.ok(placements[0].hitRadius > 0.15);
});

test("a portrait viewport shrinks the ring instead of pushing portals off screen", () => {
  // The component fits the ring to the narrower axis; the model must keep the
  // same guarantee at the smaller radius that produces.
  const { registry } = seeded();
  const portrait = portalPlacements(registry.list(), { radius: 1.2 });
  const desktop = portalPlacements(registry.list(), { radius: 3.4 });
  assert.deepEqual(overlappingHitIds(portrait), []);
  assert.deepEqual(overlappingHitIds(desktop), []);
  assert.ok(portrait.every((placement) => Math.abs(placement.offset.x) <= 1.2 + 1e-6));
});

test("the field is fed by the storage key the registry actually writes", () => {
  const { port } = seeded();
  assert.equal(port.data.has(PORTAL_STORAGE_KEY), true);
});
