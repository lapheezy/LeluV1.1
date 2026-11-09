import assert from "node:assert/strict";
import test from "node:test";

import SpatialIntentBus from "../src/core/spatial/SpatialIntentBus";
import SpatialSceneGraph from "../src/core/spatial/SpatialSceneGraph";
import SpatialResolver, {
  parseSpatialCommand,
} from "../src/core/router/SpatialResolver";
import type RouterContext from "../src/core/router/RouterContext";

const graph = SpatialSceneGraph.getInstance();

function context(prompt: string): RouterContext {
  return {
    request: { prompt, timestamp: Date.now() },
    started: Date.now(),
  } as unknown as RouterContext;
}

function fresh() {
  SpatialIntentBus.getInstance().resetForTests();
}

test("chat parser: create a red cube at explicit coordinates, by name", () => {
  const parsed = parseSpatialCommand("LÉLU, create a red cube at 2, 1, 3 called Nova");
  assert.ok(parsed);
  assert.equal(parsed.intent.op, "object.create");
  if (parsed.intent.op !== "object.create") return;
  assert.equal(parsed.intent.kind, "box");
  assert.equal(parsed.intent.color, "#ef4444");
  assert.deepEqual(parsed.intent.position, { x: 2, y: 1, z: 3 });
  assert.equal(parsed.intent.name, "Nova");
});

test("chat parser: material change is not mistaken for creation", () => {
  const parsed = parseSpatialCommand("make the cube metallic blue");
  assert.ok(parsed);
  assert.equal(parsed.intent.op, "material.set");
  if (parsed.intent.op !== "material.set") return;
  assert.equal(parsed.intent.target, "cube");
  assert.equal(parsed.intent.color, "#3b82f6");
  assert.equal(parsed.intent.metalness, 0.9);
});

test("chat parser: move, connect, delete and undo", () => {
  const move = parseSpatialCommand("move the cube up by 2");
  assert.ok(move);
  assert.equal(move.intent.op, "object.move");
  if (move.intent.op === "object.move") {
    assert.deepEqual(move.intent.delta, { y: 2 });
  }

  const connect = parseSpatialCommand("connect the cube to the sphere");
  assert.ok(connect);
  assert.equal(connect.intent.op, "object.connect");

  const remove = parseSpatialCommand("delete Nova");
  assert.ok(remove);
  assert.equal(remove.intent.op, "object.delete");

  const undo = parseSpatialCommand("undo that");
  assert.ok(undo);
  assert.equal(undo.intent.op, "scene.undo");
});

test("chat parser: an approval phrase is detected as an owner gesture", () => {
  const parsed = parseSpatialCommand("delete Nova, I approve");
  assert.ok(parsed);
  assert.equal(parsed.ownerApproval, true);
  assert.equal(parsed.intent.op, "object.delete");
  if (parsed.intent.op === "object.delete") {
    assert.equal(parsed.intent.target, "Nova");
  }
});

test("chat parser: unrelated requests are left to the rest of the chain", () => {
  assert.equal(parseSpatialCommand("create a project plan for the launch"), null);
  assert.equal(parseSpatialCommand("make me a sandwich"), null);
  const list = parseSpatialCommand("what is in the scene");
  assert.equal(list?.intent.op, "scene.list");
});

test("chat resolver: creation through the router interface mutates the real scene", async () => {
  fresh();
  const resolver = new SpatialResolver();
  const result = await resolver.execute(context("create a red cube called Nova"));

  assert.equal(result.handled, true);
  assert.ok(result.response);
  assert.match(result.response.text, /Created "Nova"/);
  assert.match(result.response.text, /revision 1/);
  assert.equal(result.response.provider, "spatial");
  assert.equal(result.response.metadata?.success, true);
  assert.equal(graph.snapshot().objects.length, 1);
  assert.equal(graph.snapshot().objects[0].material.color, "#ef4444");
});

test("chat resolver: delete without approval is refused and reports the unchanged revision", async () => {
  fresh();
  const resolver = new SpatialResolver();
  await resolver.execute(context("create a cube called Nova"));
  const before = graph.getRevision();

  const refused = await resolver.execute(context("delete the cube"));

  assert.equal(refused.handled, true);
  assert.ok(refused.response);
  assert.match(refused.response.text, /did not change the scene/i);
  assert.match(refused.response.text, new RegExp(`Revision is still ${before}`));
  assert.equal(refused.response.metadata?.success, false);
  assert.equal(graph.getRevision(), before);
  assert.equal(graph.snapshot().objects.length, 1);
});

test("chat resolver: the approval phrase performs the destructive action once", async () => {
  fresh();
  const resolver = new SpatialResolver();
  await resolver.execute(context("create a cube called Nova"));

  const deleted = await resolver.execute(context("delete Nova, I approve"));
  assert.equal(deleted.handled, true);
  assert.ok(deleted.response);
  assert.equal(deleted.response.metadata?.success, true);
  assert.equal(graph.snapshot().objects.length, 0);

  const again = await resolver.execute(context("delete Nova"));
  assert.equal(again.response?.metadata?.success, false, "the approval was single-use");
});

test("chat resolver: a scene listing reports real contents", async () => {
  fresh();
  const resolver = new SpatialResolver();
  await resolver.execute(context("create a cube at the left"));
  await resolver.execute(context("add a sphere called Comet"));

  const listed = await resolver.execute(context("what is in the scene"));
  assert.ok(listed.response);
  assert.match(listed.response.text, /Scene revision 2: 2 objects/);
  assert.match(listed.response.text, /"Comet"/);
});
