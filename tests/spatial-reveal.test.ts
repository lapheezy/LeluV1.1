import assert from "node:assert/strict";
import test from "node:test";

import SpatialIntentBus from "../src/core/spatial/SpatialIntentBus";
import SpatialRevealIntent from "../src/core/spatial/SpatialRevealIntent";
import SpatialTierGuard from "../src/core/spatial/SpatialTierGuard";
import SpatialSceneGraph from "../src/core/spatial/SpatialSceneGraph";
import { spatialMeshModel } from "../src/core/spatial/SpatialRenderModel";

const bus = SpatialIntentBus.getInstance();
const guard = SpatialTierGuard.getInstance();
const graph = SpatialSceneGraph.getInstance();

function fresh(): void {
  bus.resetForTests();
  SpatialRevealIntent.getInstance().resetForTests();
}

test("a creation requests the world and carries identity", () => {
  fresh();
  const intent = SpatialRevealIntent.getInstance();
  const seen: string[][] = [];
  const unsubscribe = intent.subscribe((request) => seen.push(request.objectNames));

  intent.request(["spatial-1"], ["Nova"]);

  assert.deepEqual(seen, [["Nova"]]);
  assert.deepEqual(intent.latestRequest()?.objectIds, ["spatial-1"]);
  assert.deepEqual(intent.latestRequest()?.objectNames, ["Nova"]);
  unsubscribe();
});

test("only the most recent change is the reveal target", () => {
  fresh();
  const intent = SpatialRevealIntent.getInstance();
  intent.request(["a"], ["Nova"]);
  intent.request(["b"], ["Comet"]);
  assert.deepEqual(intent.latestRequest()?.objectNames, ["Comet"]);
});

test("a request without an id or a name reveals nothing", () => {
  fresh();
  const intent = SpatialRevealIntent.getInstance();
  let calls = 0;
  intent.subscribe(() => {
    calls += 1;
  });
  intent.request([], ["Nova"]);
  intent.request(["a"], []);
  intent.request(["a"], [""]);
  assert.equal(calls, 0);
  assert.equal(intent.latestRequest(), null);
});

test("duplicate ids and names are collapsed", () => {
  fresh();
  const intent = SpatialRevealIntent.getInstance();
  intent.request(["a", "a", "b"], ["Nova", "Nova"]);
  assert.deepEqual(intent.latestRequest()?.objectIds, ["a", "b"]);
  assert.deepEqual(intent.latestRequest()?.objectNames, ["Nova"]);
});

test("unsubscribing stops a reveal that is no longer wanted", () => {
  fresh();
  const intent = SpatialRevealIntent.getInstance();
  let calls = 0;
  const unsubscribe = intent.subscribe(() => {
    calls += 1;
  });
  unsubscribe();
  intent.request(["a"], ["Nova"]);
  assert.equal(calls, 0);
});

test("a verified create asks for its object to be seen", async () => {
  fresh();
  const result = await bus.apply({ op: "object.create", kind: "box", name: "Nova" });
  assert.equal(result.ok, true);
  assert.deepEqual(SpatialRevealIntent.getInstance().latestRequest()?.objectNames, ["Nova"]);
});

test("a move, a resize and a recolour each ask to be seen, not just a create", async () => {
  fresh();
  await bus.apply({ op: "object.create", kind: "box", name: "Nova" });
  SpatialRevealIntent.getInstance().resetForTests();

  const moved = await bus.apply({ op: "object.move", target: "Nova", delta: { x: 1 } });
  assert.equal(moved.ok, true);
  assert.deepEqual(SpatialRevealIntent.getInstance().latestRequest()?.objectNames, ["Nova"]);

  SpatialRevealIntent.getInstance().resetForTests();
  const resized = await bus.apply({ op: "object.scale", target: "Nova", factor: 1.5 });
  assert.equal(resized.ok, true);
  assert.deepEqual(SpatialRevealIntent.getInstance().latestRequest()?.objectNames, ["Nova"]);

  SpatialRevealIntent.getInstance().resetForTests();
  const recoloured = await bus.apply({ op: "material.set", target: "Nova", color: "#22c55e" });
  assert.equal(recoloured.ok, true);
  assert.deepEqual(SpatialRevealIntent.getInstance().latestRequest()?.objectNames, ["Nova"]);
});

test("a delete asks for nothing: there is no subject left to frame", async () => {
  fresh();
  await bus.apply({ op: "object.create", kind: "box", name: "Nova" });
  const before = SpatialRevealIntent.getInstance().latestRequest();
  assert.ok(before);

  // A delete is destructive, so it needs the owner's single-use approval;
  // the point here is what it does to the reveal, not the approval rule.
  const approval = guard.requestApproval(["object.delete"], "test owner approval");
  const deleted = await bus.apply(
    { op: "object.delete", target: "Nova" },
    { approvalId: approval.approvalId },
  );
  assert.equal(deleted.ok, true);
  assert.equal(SpatialRevealIntent.getInstance().latestRequest()?.requestedAt, before.requestedAt);
});

test("a recolour reaches the mesh the layer draws, not just the graph", async () => {
  fresh();
  await bus.apply({ op: "object.create", kind: "box", name: "Nova" });
  await bus.apply({ op: "material.set", target: "Nova", color: "#22c55e" });
  const object = graph.snapshot().objects.find((candidate) => candidate.name === "Nova");
  assert.ok(object);
  // What SpatialMesh passes to meshStandardMaterial: revealing a change is
  // pointless if the drawn material is still the old one, and the glow has to
  // follow the colour or the object still renders violet on screen.
  const model = spatialMeshModel(object);
  assert.equal(model.color, "#22c55e");
  assert.equal(model.emissive, "#22c55e");
});

test("a refused change asks for nothing, so a rollback never moves the surface", async () => {
  fresh();
  const refused = await bus.apply({ op: "object.create", kind: "box", name: "Too big", scale: 99 });
  assert.equal(refused.ok, false);
  assert.equal(SpatialRevealIntent.getInstance().latestRequest(), null);
});
