/**
 * Portals must be identity, not decoration. A portal that names a
 * destination the world does not have is refused; the same portal keeps its
 * id across reloads; travelling keeps the one scene and camera.
 */
import assert from "node:assert/strict";
import test from "node:test";
import PortalRegistry, { PORTAL_STORAGE_KEY, readPortals } from "../src/app/scene/spatial/PortalRegistry";
import { SPATIAL_DESTINATIONS } from "../src/app/scene/spatial/SpatialScenes";

function memoryPort() {
  const data = new Map<string, unknown>();
  return {
    data,
    get<T>(key: string): T | null {
      return (data.get(key) as T) ?? null;
    },
    set(key: string, value: unknown): void {
      data.set(key, value);
    },
  };
}

test("a portal is created with a stable id and a real destination", () => {
  const port = memoryPort();
  const registry = PortalRegistry.resetForTests(port);
  const created = registry.create({ destination: "studio", label: "The Atelier", createdBy: "agent" });
  assert.equal(created.ok, true);
  assert.ok(created.ok);
  const portal = created.portal;
  assert.equal(portal.destination, "studio");
  assert.equal(portal.label, "The Atelier");
  assert.equal(portal.createdBy, "agent");
  assert.ok(registry.resolve(portal.id), "the destination resolves");

  // A fresh registry over the same port sees the same portal: identity is persistent.
  const reloaded = PortalRegistry.resetForTests(port);
  assert.equal(reloaded.get(portal.id)?.destination, "studio");
  assert.equal(reloaded.list().length, 1);
});

test("a portal to nowhere is refused with a reason and nothing is stored", () => {
  const port = memoryPort();
  const registry = PortalRegistry.resetForTests(port);
  const refused = registry.create({ destination: "moon-base" });
  assert.equal(refused.ok, false);
  assert.ok(!refused.ok);
  assert.match(refused.reason, /not a destination in the scene graph/);
  assert.equal(registry.list().length, 0);
  assert.equal(port.get(PORTAL_STORAGE_KEY), null, "the store was never written");
});

test("travelling keeps the one scene, the existing camera ownership and the context", () => {
  const registry = PortalRegistry.resetForTests(memoryPort());
  const created = registry.create({ destination: "browser" });
  assert.ok(created.ok);
  const plan = registry.planTravel(created.portal.id);
  assert.ok(plan);
  assert.equal(plan!.cameraOwnership, "cinematic", "the existing cinematic camera drives the transition");
  assert.equal(plan!.scene, SPATIAL_DESTINATIONS.find((item) => item.id === "browser")!.kind);
  assert.equal(plan!.preservesConversation, true);
  assert.equal(plan!.preservesWorkspace, true);
  assert.equal(registry.planTravel("portal_missing"), null);
});

test("a removed portal stops resolving, and a replaced one keeps its creation time", () => {
  const registry = PortalRegistry.resetForTests(memoryPort());
  const created = registry.create({ destination: "projects" });
  assert.ok(created.ok);
  const id = created.portal.id;
  const replaced = registry.create({ destination: "projects", label: "My projects", id });
  assert.ok(replaced.ok);
  assert.equal(replaced.portal.createdAt, created.portal.createdAt);
  assert.equal(replaced.portal.label, "My projects");
  assert.equal(registry.remove(id), true);
  assert.equal(registry.resolve(id), null);
  assert.equal(registry.remove(id), false, "removing twice is not an error, just false");
});

test("legacy portal lists migrate only real destinations, counting the rest", () => {
  const migrated = readPortals([
    { id: "p1", destination: "studio", createdBy: "user", label: "Studio" },
    { id: "p2", destination: "atlantis" },
    { destination: "cosmos" },
    "garbage",
  ]);
  assert.equal(migrated.portals.length, 1);
  assert.equal(migrated.portals[0].destination, "studio");
  assert.equal(migrated.skipped, 3, "an unknown destination, a missing id and a non-object are reported");
  assert.deepEqual(readPortals(null), { portals: [], skipped: 0 });
});
