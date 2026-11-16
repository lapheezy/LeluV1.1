import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";

import SpatialIntentBus from "../src/core/spatial/SpatialIntentBus";
import SpatialRevealIntent from "../src/core/spatial/SpatialRevealIntent";
import SpatialSceneGraph from "../src/core/spatial/SpatialSceneGraph";
import { placeInWorld } from "../src/core/spatial/placeInWorld";

beforeEach(() => {
  SpatialIntentBus.getInstance().resetForTests();
  SpatialRevealIntent.getInstance().resetForTests();
});

test("placing creates a real object in the one scene graph", async () => {
  const outcome = await placeInWorld({ name: "Roadmap", color: "#a78bfa", scale: 0.8 });
  assert.equal(outcome.ok, true);
  const snapshot = SpatialSceneGraph.getInstance().snapshot();
  const placed = snapshot.objects.find((object) => object.name === "Roadmap");
  assert.ok(placed, "the placed object is in the graph");
  assert.equal(placed!.material.color, "#a78bfa");
  assert.equal(placed!.transform.scale.x, 0.8);
  assert.equal(snapshot.revision, outcome.revision);
});

test("placing asks for a reveal of the object it just committed", async () => {
  const outcome = await placeInWorld({ name: "Deck" });
  const request = SpatialRevealIntent.getInstance().latestRequest();
  assert.ok(request, "a reveal was requested");
  assert.deepEqual(request!.objectNames, ["Deck"]);
  assert.equal(request!.objectIds.length, 1);
  const placed = SpatialSceneGraph.getInstance()
    .snapshot()
    .objects.find((object) => object.name === "Deck");
  assert.equal(request!.objectIds[0], placed!.id, "the reveal targets the committed object, not a name lookup");
  assert.equal(outcome.revision, SpatialSceneGraph.getInstance().getRevision());
});

test("two surfaces placing the same title make two distinct objects", async () => {
  const first = await placeInWorld({ name: "Report" });
  const second = await placeInWorld({ name: "Report" });
  const names = SpatialSceneGraph.getInstance().snapshot().objects.map((object) => object.name);
  assert.equal(names.length, 2);
  assert.equal(new Set(names).size, 2, "identity is unique, not a second copy of one object");
  assert.notEqual(first.objectName, second.objectName);
});

test("a refused placement reports the refusal and changes nothing", async () => {
  const before = SpatialSceneGraph.getInstance().snapshot();
  const outcome = await placeInWorld({ name: "Too big", scale: 999 });
  assert.equal(outcome.ok, false);
  assert.equal(SpatialSceneGraph.getInstance().snapshot().revision, before.revision);
  assert.equal(SpatialSceneGraph.getInstance().snapshot().objects.length, before.objects.length);
});
