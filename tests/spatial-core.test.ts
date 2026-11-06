import assert from "node:assert/strict";
import test from "node:test";

import AgentEventBus from "../src/core/agent/AgentEvents";
import SpatialIntentBus from "../src/core/spatial/SpatialIntentBus";
import SpatialObjectRegistry from "../src/core/spatial/SpatialObjectRegistry";
import SpatialPresence from "../src/core/spatial/SpatialPresence";
import { spatialLinkModels, spatialMeshModel } from "../src/core/spatial/SpatialRenderModel";
import SpatialSceneGraph from "../src/core/spatial/SpatialSceneGraph";
import SpatialTierGuard from "../src/core/spatial/SpatialTierGuard";
import {
  SPATIAL_DEFAULT_MATERIAL,
  type SpatialObject,
} from "../src/core/spatial/SpatialTypes";

const graph = SpatialSceneGraph.getInstance();
const guard = SpatialTierGuard.getInstance();
const presence = SpatialPresence.getInstance();

function freshBus(): SpatialIntentBus {
  const bus = SpatialIntentBus.getInstance();
  bus.resetForTests();
  return bus;
}

function makeObject(id: string, name: string, scale = 1): SpatialObject {
  const now = Date.now();
  return {
    id,
    name,
    kind: "box",
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: scale, y: scale, z: scale },
    },
    material: { ...SPATIAL_DEFAULT_MATERIAL },
    visible: true,
    provenance: "agent",
    createdBy: "lelu",
    tags: [],
    createdAt: now,
    updatedAt: now,
  };
}

test("1. create commits a real object and a registry entry", async () => {
  const bus = freshBus();
  const result = await bus.apply({
    op: "object.create",
    kind: "box",
    name: "Aurora",
    color: "#ef4444",
  });

  assert.equal(result.ok, true);
  assert.equal(result.revision, 1);

  const snapshot = graph.snapshot();
  assert.equal(snapshot.objects.length, 1);
  const object = snapshot.objects[0];
  assert.equal(object.name, "Aurora");
  assert.equal(object.kind, "box");
  assert.equal(object.provenance, "agent");
  assert.equal(object.createdBy, "lelu");
  assert.equal(object.material.color, "#ef4444");
  assert.equal(SpatialObjectRegistry.getInstance().get(object.id)?.name, "Aurora");
  assert.equal(SpatialObjectRegistry.getInstance().findByName("Aurora")?.id, object.id);
});

test("2. move reaches the render projection at the committed position", async () => {
  const bus = freshBus();
  await bus.apply({ op: "object.create", kind: "sphere", name: "Orb" });

  const moved = await bus.apply({
    op: "object.move",
    target: "Orb",
    position: { x: 1.5, y: 2, z: -3 },
  });

  assert.equal(moved.ok, true);
  const object = graph.snapshot().objects[0];
  assert.deepEqual(spatialMeshModel(object).position, [1.5, 2, -3]);
});

test("3. material change reaches the rendered material", async () => {
  const bus = freshBus();
  await bus.apply({ op: "object.create", kind: "sphere", name: "Orb" });

  const result = await bus.apply({
    op: "material.set",
    target: "Orb",
    color: "#22c55e",
    metalness: 0.9,
    roughness: 0.1,
    opacity: 0.5,
  });

  assert.equal(result.ok, true);
  const model = spatialMeshModel(graph.snapshot().objects[0]);
  assert.equal(model.color, "#22c55e");
  assert.equal(model.metalness, 0.9);
  assert.equal(model.roughness, 0.1);
  assert.equal(model.opacity, 0.5);
  assert.equal(model.transparent, true);
});

test("4. connect creates a typed relationship that the renderer can draw", async () => {
  const bus = freshBus();
  await bus.apply({ op: "object.create", kind: "box", name: "Left" });
  await bus.apply({ op: "object.create", kind: "sphere", name: "Right" });

  const result = await bus.apply({
    op: "object.connect",
    from: "Left",
    to: "Right",
    kind: "orbits",
  });

  assert.equal(result.ok, true);
  const snapshot = graph.snapshot();
  assert.equal(snapshot.relationships.length, 1);
  assert.equal(snapshot.relationships[0].kind, "orbits");

  const links = spatialLinkModels(snapshot.objects, snapshot.relationships);
  assert.equal(links.length, 1);
  assert.deepEqual(links[0].from, [
    snapshot.objects[0].transform.position.x,
    snapshot.objects[0].transform.position.y,
    snapshot.objects[0].transform.position.z,
  ]);
});

test("5 + 6. an unapproved delete is refused and the scene is byte-identical", async () => {
  const bus = freshBus();
  await bus.apply({ op: "object.create", kind: "box", name: "Aurora" });

  const before = structuredClone(graph.snapshot());
  const refused = await bus.apply({ op: "object.delete", target: "Aurora" });
  const after = graph.snapshot();

  assert.equal(refused.ok, false);
  assert.equal(refused.refusal?.code, "approval-required");
  assert.equal(refused.revision, before.revision);
  assert.equal(after.revision, before.revision);
  assert.deepEqual(structuredClone(after.objects), before.objects);
  assert.match(refused.message, /did not change the scene/i);
});

test("5b. an approved delete executes exactly once", async () => {
  const bus = freshBus();
  await bus.apply({ op: "object.create", kind: "box", name: "Aurora" });

  const approval = guard.requestApproval(["object.delete"], "test owner approval");
  const deleted = await bus.apply(
    { op: "object.delete", target: "Aurora" },
    { approvalId: approval.approvalId },
  );
  assert.equal(deleted.ok, true);
  assert.equal(graph.snapshot().objects.length, 0);

  // The approval was single-use: a second delete cannot reuse it.
  const reused = await bus.apply(
    { op: "object.delete", target: "Aurora" },
    { approvalId: approval.approvalId },
  );
  assert.equal(reused.ok, false);
});

test("7. a stale revision is refused, never applied", async () => {
  const bus = freshBus();
  await bus.apply({ op: "object.create", kind: "box", name: "Aurora" });
  const staleRevision = graph.getRevision();

  await bus.apply({ op: "object.create", kind: "sphere", name: "Comet" });

  const stale = await bus.apply(
    { op: "object.move", target: "Aurora", delta: { x: 1 } },
    { expectedRevision: staleRevision },
  );

  assert.equal(stale.ok, false);
  assert.equal(stale.refusal?.code, "stale-revision");
  assert.equal(graph.getRevision(), staleRevision + 1);
});

test("8. concurrent intents serialize without corrupting the scene", async () => {
  const bus = freshBus();
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      bus.apply({ op: "object.create", kind: "cone", name: `Cone ${index + 1}` }),
    ),
  );

  assert.equal(results.every((result) => result.ok), true);
  assert.equal(graph.getRevision(), 5);
  const snapshot = graph.snapshot();
  assert.equal(snapshot.objects.length, 5);
  assert.equal(new Set(snapshot.objects.map((object) => object.id)).size, 5);
  assert.equal(new Set(snapshot.objects.map((object) => object.name)).size, 5);
});

test("9. each accepted commit increments the revision by exactly one", async () => {
  const bus = freshBus();
  const first = await bus.apply({ op: "object.create", kind: "box", name: "One" });
  const second = await bus.apply({ op: "object.move", target: "One", delta: { y: 1 } });
  const third = await bus.apply({ op: "object.scale", target: "One", factor: 1.5 });

  assert.deepEqual([first.revision, second.revision, third.revision], [1, 2, 3]);
});

test("9b. one atomic commit carrying three mutations is still a single revision", () => {
  freshBus();
  const authorization = guard.authorize(["object.create"]);
  assert.equal(authorization.ok, true);
  if (!authorization.ok) return;

  const result = graph.commit(
    [
      { type: "create", object: makeObject("spatial-box-901", "Batch A") },
      { type: "create", object: makeObject("spatial-box-902", "Batch B") },
      { type: "create", object: makeObject("spatial-box-903", "Batch C") },
    ],
    { expectedRevision: 0, authorization: authorization.authorization, label: "batch of three" },
  );

  assert.equal(result.ok, true);
  assert.equal(graph.getRevision(), 1);
  assert.equal(graph.snapshot().objects.length, 3);
});

test("9c. a rejected batch leaves no partial scene", () => {
  freshBus();
  const authorization = guard.authorize(["object.create"]);
  assert.equal(authorization.ok, true);
  if (!authorization.ok) return;

  const result = graph.commit(
    [
      { type: "create", object: makeObject("spatial-box-904", "Valid") },
      { type: "create", object: makeObject("spatial-box-905", "Invalid", 500) },
    ],
    { expectedRevision: 0, authorization: authorization.authorization },
  );

  assert.equal(result.ok, false);
  assert.equal(result.refusal?.code, "validation-failed");
  assert.equal(graph.getRevision(), 0);
  assert.equal(graph.snapshot().objects.length, 0);
});

test("10. undo restores the previous state as a new revision", async () => {
  const bus = freshBus();
  await bus.apply({ op: "object.create", kind: "box", name: "Aurora" });
  const created = graph.snapshot().objects[0].transform.position;
  await bus.apply({ op: "object.move", target: "Aurora", delta: { y: 2 } });

  const undone = await bus.apply({ op: "scene.undo" });
  assert.equal(undone.ok, true);
  assert.equal(undone.revision, 3);
  const restored = graph.snapshot().objects[0].transform.position;
  assert.deepEqual(restored, created);
});

test("10b. recovery restores a validated snapshot after an approved change", async () => {
  const bus = freshBus();
  await bus.apply({ op: "object.create", kind: "box", name: "Aurora" });
  await bus.apply({ op: "object.create", kind: "sphere", name: "Comet" });
  const snapshot = structuredClone(graph.snapshot());

  const deleteApproval = guard.requestApproval(["object.delete"], "test delete");
  await bus.apply(
    { op: "object.delete", target: "Comet" },
    { approvalId: deleteApproval.approvalId },
  );
  assert.equal(graph.snapshot().objects.length, 1);

  guard.grant(4);
  const recoverApproval = guard.requestApproval(["scene.recover"], "test recovery");
  const authorization = guard.authorize(["scene.recover"], {
    approvalId: recoverApproval.approvalId,
  });
  assert.equal(authorization.ok, true);
  if (!authorization.ok) return;

  const recovered = graph.recover(snapshot, authorization.authorization);
  assert.equal(recovered.ok, true);
  assert.equal(graph.snapshot().objects.length, 2);
  // The approved delete and the recovery are both real revisions.
  assert.equal(graph.getRevision(), snapshot.revision + 2);
});

test("11. direct writes cannot bypass the tier guard", async () => {
  const bus = freshBus();
  await bus.apply({ op: "object.create", kind: "box", name: "Aurora" });
  const revision = graph.getRevision();

  const forgedSeal = { revision: 99, ops: ["object.delete"], issuedAt: Date.now() };
  const forgedCommit = graph.commit([{ type: "delete", id: "spatial-box-1" }], {
    expectedRevision: revision,
    authorization: { ops: ["object.delete"], seal: forgedSeal },
  });
  assert.equal(forgedCommit.ok, false);
  assert.equal(forgedCommit.refusal?.code, "unauthorized");
  assert.equal(graph.getRevision(), revision);
  assert.equal(graph.snapshot().objects.length, 1);

  const registryWrite = SpatialObjectRegistry.getInstance().write(new Map(), {
    revision: 1,
    ops: ["object.delete"],
    issuedAt: Date.now(),
  });
  assert.equal(registryWrite, false);
  assert.equal(graph.snapshot().objects.length, 1);

  guard.revoke(2);
  const tierRefusal = await bus.apply({ op: "object.move", target: "Aurora", delta: { x: 1 } });
  assert.equal(tierRefusal.ok, false);
  assert.equal(tierRefusal.refusal?.code, "tier-insufficient");
  assert.equal(tierRefusal.revision, revision);
});

test("12. presence records only verified commits", async () => {
  const bus = freshBus();
  await bus.apply({ op: "object.create", kind: "box", name: "Aurora" });
  const afterCreate = presence.get();
  assert.match(afterCreate.lastAction, /object\.create/);
  assert.equal(afterCreate.attention?.name, "Aurora");
  assert.equal(afterCreate.revision, 1);

  const refused = await bus.apply({ op: "object.delete", target: "Aurora" });
  assert.equal(refused.ok, false);
  const afterRefusal = presence.get();
  assert.equal(afterRefusal.lastAction, afterCreate.lastAction);
  assert.equal(afterRefusal.lastActionAt, afterCreate.lastActionAt);
  assert.equal(afterRefusal.revision, afterCreate.revision);
});

test("13. a committed spatial event reaches the existing agent bus", async () => {
  const bus = freshBus();
  const events: string[] = [];
  const unsubscribe = AgentEventBus.getInstance().subscribe((event) => {
    events.push(event.type);
  });
  try {
    await bus.apply({ op: "object.create", kind: "torus", name: "Halo" });
  } finally {
    unsubscribe();
  }

  assert.ok(events.includes("tool_started"));
  assert.ok(events.includes("spatial_event"));
  assert.ok(events.includes("tool_result"));
});

test("14. validation refuses out-of-bounds values without changing anything", async () => {
  const bus = freshBus();
  const refused = await bus.apply({ op: "object.create", kind: "box", scale: 999 });
  assert.equal(refused.ok, false);
  assert.equal(refused.refusal?.code, "validation-failed");
  assert.equal(graph.getRevision(), 0);
  assert.equal(graph.snapshot().objects.length, 0);
});
