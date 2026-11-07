/**
 * Portals must be identity, not decoration. A portal that names a
 * destination the world does not have is refused; the same portal keeps its
 * id across reloads; travelling keeps the one scene and camera.
 */
import assert from "node:assert/strict";
import test from "node:test";
import PortalRegistry, {
  PORTAL_STORAGE_KEY,
  RING_SCENES,
  builtinPortalId,
  isBuiltinPortal,
  readPortals,
} from "../src/app/scene/spatial/PortalRegistry";
import { SPATIAL_DESTINATIONS } from "../src/app/scene/spatial/SpatialScenes";

function memoryPort() {
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

test("the built-in ring is seeded once, with stable namespaced ids and no duplicates", () => {
  const port = memoryPort();
  const registry = PortalRegistry.resetForTests(port);
  const scenes = ["galaxy", "browser", "studio"] as const;
  assert.equal(registry.seedRing(scenes), 3);
  assert.equal(registry.seedRing(scenes), 0, "seeding again adds nothing");
  assert.equal(registry.list().length, 3);
  const galaxy = registry.get(builtinPortalId("galaxy"));
  assert.ok(galaxy);
  assert.equal(galaxy!.destination, "galaxy");
  assert.equal(isBuiltinPortal(galaxy!), true);

  // A user portal to the same environment is a DIFFERENT identity, so the ring
  // can draw both without one replacing the other.
  const created = registry.create({ destination: "galaxy", label: "Mine" });
  assert.ok(created.ok);
  assert.notEqual(created.portal.id, galaxy!.id);
  assert.equal(isBuiltinPortal(created.portal), false);
  assert.equal(registry.list().length, 4);
  assert.equal(PortalRegistry.resetForTests(port).list().length, 4, "both survive a reload");
});

test("a portal that cannot be saved is refused instead of reported as created", () => {
  let failWrites = false;
  const data = new Map<string, unknown>();
  const registry = PortalRegistry.resetForTests({
    get<T>(key: string): T | null {
      return (data.get(key) as T) ?? null;
    },
    set(key: string, value: unknown): boolean {
      if (failWrites) throw new Error("quota");
      data.set(key, value);
      return true;
    },
  });
  failWrites = true;
  const refused = registry.create({ destination: "studio" });
  assert.equal(refused.ok, false);
  assert.ok(!refused.ok);
  assert.match(refused.reason, /could not be saved/);
  assert.equal(registry.list().length, 0, "a portal that was not saved is not in the ring");
  assert.equal(registry.seedRing(["studio"]), 0, "seeding reports the failure too");
  failWrites = false;
  assert.equal(registry.create({ destination: "studio" }).ok, true, "and it works once storage does");
});

test("a portal's name and destination can change without losing its identity", () => {
  const registry = PortalRegistry.resetForTests(memoryPort());
  const created = registry.create({ destination: "studio", label: "Atelier" });
  assert.ok(created.ok);
  const updated = registry.update(created.portal.id, { label: "Bright atelier", destination: "files" });
  assert.ok(updated.ok);
  assert.equal(updated.portal.id, created.portal.id);
  assert.equal(updated.portal.label, "Bright atelier");
  assert.equal(updated.portal.destination, "files");
  assert.equal(registry.resolve(created.portal.id)?.id, "files");
  const refused = registry.update(created.portal.id, { destination: "atlantis" });
  assert.equal(refused.ok, false, "a destination that does not exist is refused");
  assert.equal(registry.get(created.portal.id)?.destination, "files", "and the old destination stays");
  assert.equal(registry.update("portal_missing", { label: "x" }).ok, false);
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

test("a backend that swallows the failure cannot be mistaken for a saved portal", () => {
  // The real store used to return nothing, so a write the browser dropped was
  // indistinguishable from a successful one. That is how a portal was reported
  // as created and then vanished on reload.
  const data = new Map<string, unknown>();
  const silent = PortalRegistry.resetForTests({
    get<T>(key: string): T | null {
      return (data.get(key) as T) ?? null;
    },
    set(): boolean {
      return false;
    },
  });
  const refused = silent.create({ destination: "studio" });
  if (refused.ok) assert.fail("a portal that was not saved must not be reported as created");
  assert.match(refused.reason, /could not be saved/);
  assert.equal(silent.list().length, 0, "nothing enters the ring");
  assert.equal(silent.seedRing(RING_SCENES), 0, "seeding reports the failure instead of pretending");
  assert.equal(silent.getMigrationReport().portals, 0);
});

test("the built-in ring is every real destination except the world itself", () => {
  const ids: readonly string[] = RING_SCENES;
  assert.ok(ids.length >= 8, "the ring holds the environments, not two entries");
  for (const id of ["core", "cosmos"]) {
    assert.ok(!ids.includes(id), `${id} is the world the ring hangs in, not a portal`);
  }
  for (const id of ids) {
    assert.ok(
      SPATIAL_DESTINATIONS.some((destination) => destination.id === id),
      `${id} exists in the scene graph`,
    );
  }
});

test("the built-in ring survives a reload exactly once", () => {
  const port = memoryPort();
  const registry = PortalRegistry.resetForTests(port);
  assert.equal(registry.seedRing(RING_SCENES), RING_SCENES.length);

  // A reload: the same storage, a fresh registry, nothing duplicated.
  const reloaded = PortalRegistry.resetForTests(port);
  assert.equal(reloaded.list().length, RING_SCENES.length);
  assert.equal(reloaded.seedRing(RING_SCENES), 0, "seeding after a reload adds nothing");
  assert.equal(reloaded.list().length, RING_SCENES.length);

  const user = reloaded.create({ destination: "files", label: "Client files" });
  assert.ok(user.ok);
  const afterCreate = PortalRegistry.resetForTests(port);
  assert.equal(afterCreate.list().length, RING_SCENES.length + 1);
  assert.equal(afterCreate.get(user.portal.id)?.destination, "files", "the same identity comes back");
  assert.equal(afterCreate.remove(user.portal.id), true);
  assert.equal(
    PortalRegistry.resetForTests(port).get(user.portal.id),
    null,
    "the removal survives the reload too",
  );
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
