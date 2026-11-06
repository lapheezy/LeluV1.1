import assert from "node:assert/strict";
import test from "node:test";

import WorldRegistry from "../src/app/scene/genesis/WorldRegistry";
import CosmosEntityRegistry from "../src/core/cosmos/CosmosEntityRegistry";
import { parseSpatialCommand } from "../src/core/router/SpatialResolver";
import SpatialAdapter from "../src/core/spatial/SpatialAdapter";
import SpatialCameraApplier, {
  effectiveHalfFov,
  frameSubjects,
  framingPose,
} from "../src/core/spatial/SpatialCameraApplier";
import SpatialComposition from "../src/core/spatial/SpatialComposition";
import SpatialIntentBus from "../src/core/spatial/SpatialIntentBus";
import {
  registerLiveSceneProvider,
  resetLiveSceneProvider,
  type LiveCameraState,
  type LiveSceneNode,
} from "../src/core/spatial/SpatialLiveScene";
import SpatialObjectRegistry from "../src/core/spatial/SpatialObjectRegistry";
import SpatialSceneGraph from "../src/core/spatial/SpatialSceneGraph";
import SpatialTierGuard, { SPATIAL_OPERATIONS } from "../src/core/spatial/SpatialTierGuard";
import { summarize, verifyCamera, verifyRenderer } from "../src/core/spatial/SpatialVerification";

const bus = SpatialIntentBus.getInstance();
const graph = SpatialSceneGraph.getInstance();
const guard = SpatialTierGuard.getInstance();
const composition = SpatialComposition.getInstance();
const adapter = SpatialAdapter.getInstance();
const registry = SpatialObjectRegistry.getInstance();
const world = WorldRegistry.getInstance();

function fresh(): void {
  bus.resetForTests();
  composition.resetForTests();
  SpatialCameraApplier.getInstance().resetForTests();
  resetLiveSceneProvider();
}

function node(
  name: string,
  options: {
    position?: [number, number, number];
    local?: [number, number, number];
    color?: string;
    radius?: number;
    visible?: boolean;
  } = {},
): LiveSceneNode {
  const position = options.position ?? [0, 0, 0];
  return {
    id: name,
    name,
    worldPosition: position,
    localPosition: options.local ?? position,
    visible: options.visible ?? true,
    color: options.color,
    radius: options.radius,
    geometry: "BoxGeometry",
    parentName: "Genesis",
  };
}

function providerFor(nodes: LiveSceneNode[]) {
  return {
    listNodes: () => nodes,
    findNode: (reference: string) =>
      nodes.find((entry) => entry.name === reference || entry.name === `spatial:${reference}`) ?? null,
    camera: () => null,
  };
}

/* ===================== Gate B/C — adapter ===================== */

test("adapter discovers authored, Cosmos, world and live scene entities without duplicating any", async () => {
  fresh();
  await bus.apply({ op: "object.create", kind: "box", name: "Nova" });
  const object = graph.snapshot().objects[0];

  const cosmos = CosmosEntityRegistry.getInstance().register("tab", "adapter-test-1", "Alpha Tab", "🔷");
  world.register({ key: "adapter-test-workspace", label: "Adapter Workspace", kind: "workspace", weight: 0.5, scale: "medium" });

  const live = new SpatialAdapter({
    liveNodes: () => [
      node("spatial:" + object.id, { position: [1, 2, 3], local: [1, 2, 3], color: object.material.color }),
      node("Core", { position: [0, 2, 0], radius: 2.2 }),
      node("Planet Prime", { position: [6, 0, 0], radius: 1.4 }),
    ],
  });

  const all = live.list();
  assert.equal(new Set(all.map((entity) => entity.ref)).size, all.length, "every reference is unique");

  const authored = all.find((entity) => entity.source === "authored");
  assert.equal(authored?.id, object.id);
  assert.deepEqual(authored?.position, { x: 1, y: 2, z: 3 }, "authored position comes from the live mesh");
  assert.equal(authored?.radius && authored.radius > 0, true);

  assert.ok(all.some((entity) => entity.ref === `cosmos:${cosmos.id}`), "cosmos entity discovered");
  assert.ok(all.some((entity) => entity.ref === "world:adapter-test-workspace"), "world destination discovered");
  assert.ok(all.some((entity) => entity.ref === "scene:Core"), "live Core node discovered");
  assert.equal(
    all.some((entity) => entity.ref === `scene:spatial:${object.id}`),
    false,
    "the authored mesh is not reported twice as a scene node",
  );

  world.unregister("adapter-test-workspace");
});

test("adapter resolution is stable and refuses ambiguity instead of guessing", async () => {
  fresh();
  await bus.apply({ op: "object.create", kind: "sphere", name: "Comet" });
  const object = graph.snapshot().objects[0];
  const live = new SpatialAdapter({ liveNodes: () => [node("Core", { position: [0, 2, 0] })] });

  assert.equal(live.resolve(object.id)?.ref, object.id, "resolves by id");
  assert.equal(live.resolve("Comet")?.ref, object.id, "resolves by name");
  assert.equal(live.resolve("comet")?.ref, object.id, "resolution is case-insensitive");
  assert.equal(live.resolve("scene:Core")?.name, "Core", "resolves a namespaced scene ref");
  assert.equal(live.resolve("nothing-like-this"), null);
  assert.deepEqual(live.candidates("Core").length > 0, true);
});

test("a registered world destination missing from the live scene is reported stale, not dropped", async () => {
  fresh();
  world.register({ key: "adapter-test-stale", label: "Ghost Workspace", kind: "workspace", weight: 0.2, scale: "medium" });
  const live = new SpatialAdapter({ liveNodes: () => [node("Core", { position: [0, 0, 0] })] });
  const ghost = live.list().find((entity) => entity.ref === "world:adapter-test-stale");
  assert.ok(ghost);
  assert.equal(ghost?.stale, true, "absent live node marks the destination stale");
  assert.equal(live.stats().stale >= 1, true);
  world.unregister("adapter-test-stale");
});

test("discovery is read-only: no revision, no object and no foreign registry changes", async () => {
  fresh();
  await bus.apply({ op: "object.create", kind: "box", name: "Anchor" });
  const before = graph.snapshot();
  const registryBefore = registry.count();
  const cosmosBefore = CosmosEntityRegistry.getInstance().getAll().length;

  const live = new SpatialAdapter({ liveNodes: () => [node("Core", { position: [0, 2, 0] })] });
  live.list();
  live.inspect("Anchor");
  live.stats();

  const after = graph.snapshot();
  assert.equal(after.revision, before.revision, "adapter never bumps the revision");
  assert.equal(after.objects.length, before.objects.length);
  assert.equal(registry.count(), registryBefore);
  assert.equal(CosmosEntityRegistry.getInstance().getAll().length, cosmosBefore);
  assert.equal(live.isAuthored(after.objects[0].id), true);
});

/* ===================== Gate D/E — composition ===================== */

test("planning a composition writes nothing and reports the plan", async () => {
  fresh();
  await bus.apply({ op: "object.create", kind: "sphere", name: "Nova" });
  const before = graph.snapshot();

  const prepared = await bus.apply({
    op: "scene.compose",
    request: "build a research station beside Nova",
    anchor: "Nova",
  });

  assert.equal(prepared.ok, true, prepared.message);
  assert.ok(prepared.planId);
  assert.match(prepared.message, /Nothing is committed yet/);
  assert.equal(graph.snapshot().revision, before.revision, "plan is not a commit");
  assert.equal(graph.snapshot().objects.length, before.objects.length);
  assert.equal(composition.pending()?.planId, prepared.planId, "the plan is pending approval");
});

test("an unapproved composition commit is refused and changes nothing", async () => {
  fresh();
  await bus.apply({ op: "object.create", kind: "sphere", name: "Nova" });
  const prepared = await bus.apply({ op: "scene.compose", request: "build a research station beside Nova", anchor: "Nova" });
  const before = graph.snapshot();

  const refused = await bus.apply({ op: "scene.commit", planId: prepared.planId });

  assert.equal(refused.ok, false);
  assert.equal(refused.refusal?.code, "approval-required");
  assert.deepEqual(graph.snapshot().objects.map((object) => object.id), before.objects.map((object) => object.id));
  assert.equal(graph.snapshot().revision, before.revision);
});

test("an approved composition commits every object and link as exactly one revision", async () => {
  fresh();
  await bus.apply({ op: "object.create", kind: "sphere", name: "Nova" });
  const before = graph.snapshot();
  const prepared = await bus.apply({ op: "scene.compose", request: "build a research station beside Nova", anchor: "Nova" });

  const approvalId = guard.requestApproval(["scene.commit"], "test approval").approvalId;
  const committed = await bus.apply({ op: "scene.commit", planId: prepared.planId }, { approvalId });

  assert.equal(committed.ok, true, committed.message);
  assert.equal(committed.revision, before.revision + 1, "one batch is one revision");
  assert.equal(committed.objectIds?.length, 3);
  assert.equal(graph.snapshot().objects.length, before.objects.length + 3);
  assert.equal(graph.snapshot().relationships.length, 2, "the station, mast and dish are linked");
  assert.equal(committed.verification?.layers.graph, "pass");
  assert.equal(committed.verification?.layers.renderer, "skipped", "no renderer in this context is skipped, not faked");

  const names = graph.snapshot().objects.map((object) => object.name);
  assert.ok(names.includes("Research Station"), names.join(","));
  for (const name of names) {
    if (name === "Nova") continue;
    assert.match(name, /Research Station/, "every composed object carries the requested name");
  }
});

test("a plan built against an older revision is refused instead of overwriting the newer scene", async () => {
  fresh();
  await bus.apply({ op: "object.create", kind: "sphere", name: "Nova" });
  const prepared = await bus.apply({ op: "scene.compose", request: "build a research station beside Nova", anchor: "Nova" });
  await bus.apply({ op: "object.create", kind: "box", name: "Interloper" });

  const approvalId = guard.requestApproval(["scene.commit"], "test approval").approvalId;
  const refused = await bus.apply({ op: "scene.commit", planId: prepared.planId }, { approvalId });

  assert.equal(refused.ok, false);
  assert.equal(refused.refusal?.code, "stale-revision");
  assert.equal(graph.snapshot().objects.some((object) => object.name === "Research Station"), false);
});

test("a renderer that disagrees with the commit causes a rollback, not a claim of success", async () => {
  fresh();
  await bus.apply({ op: "object.create", kind: "sphere", name: "Nova" });
  registerLiveSceneProvider({
    listNodes: () =>
      graph.snapshot().objects.map((object) =>
        node(`spatial:${object.id}`, {
          position: [0, 0, 0],
          local: [object.transform.position.x, object.transform.position.y, object.transform.position.z],
          color: "#010203",
        }),
      ),
    findNode: (reference: string) => {
      const object = graph.snapshot().objects.find((candidate) => reference.includes(candidate.id));
      return object
        ? node(`spatial:${object.id}`, {
            local: [object.transform.position.x, object.transform.position.y, object.transform.position.z],
            color: "#010203",
          })
        : null;
    },
    camera: () => null,
  });

  const prepared = await bus.apply({ op: "scene.compose", request: "build a research station beside Nova", anchor: "Nova" });
  const approvalId = guard.requestApproval(["scene.commit"], "test approval").approvalId;
  const result = await bus.apply({ op: "scene.commit", planId: prepared.planId }, { approvalId });

  assert.equal(result.ok, false, "a failing renderer check must not report success");
  assert.equal(result.refusal?.code, "verification-failed");
  assert.match(result.message, /rolled that back/i);
  assert.equal(graph.snapshot().objects.length, 1, "the batch is gone again");
  assert.equal(graph.snapshot().objects[0].name, "Nova");
});

test("planetary composition produces a star, its planets and orbit links", async () => {
  fresh();
  const prepared = await bus.apply({
    op: "scene.compose",
    request: "create a planetary system with a central star and five orbiting planets",
  });
  assert.equal(prepared.ok, true, prepared.message);
  const plan = composition.get(prepared.planId ?? "");
  assert.ok(plan);
  assert.equal(plan?.objects.length, 6);
  assert.equal(plan?.links.length, 5);
  assert.equal(plan?.links.every((link) => link.kind === "orbits"), true);
});

/* ===================== Gate F — camera ===================== */

test("framing distance follows object size, not a fixed radius", () => {
  const small = frameSubjects([{ name: "Orb", position: { x: 0, y: 0, z: 0 }, radius: 0.6 }]);
  const large = frameSubjects([{ name: "System", position: { x: 0, y: 0, z: 0 }, radius: 20 }]);
  assert.ok(large.radius > small.radius);

  const smallPose = framingPose([{ name: "Orb", position: { x: 0, y: 0, z: 0 }, radius: 0.6 }], { fov: 46, aspect: 1.7 });
  const largePose = framingPose([{ name: "System", position: { x: 0, y: 0, z: 0 }, radius: 20 }], { fov: 46, aspect: 1.7 });
  assert.ok(largePose.distance > smallPose.distance * 5, `${largePose.distance} vs ${smallPose.distance}`);
});

test("portrait viewports frame further back, so mobile keeps the subject in view", () => {
  const subjects = [{ name: "Core", position: { x: 0, y: 0, z: 0 }, radius: 2 }];
  const portrait = framingPose(subjects, { fov: 46, aspect: 0.46 });
  const landscape = framingPose(subjects, { fov: 46, aspect: 1.9 });
  assert.ok(
    effectiveHalfFov(46, 0.46) < effectiveHalfFov(46, 1.9),
    "the narrower axis decides the effective half-FOV",
  );
  assert.ok(portrait.distance > landscape.distance, `${portrait.distance} vs ${landscape.distance}`);
});

test("camera focus frames a real object and camera reset returns the opening view", async () => {
  fresh();
  await bus.apply({ op: "object.create", kind: "box", name: "Station", position: { x: 4, y: 1, z: 2 } });

  const focused = await bus.apply({ op: "camera.focus", targets: ["Station"] });
  assert.equal(focused.ok, true, focused.message);
  assert.equal(focused.revision, 1, "camera motion never changes the scene revision");
  assert.ok(focused.camera);
  assert.ok(Math.abs(focused.camera!.target.x - 4) < 0.001);
  assert.ok(focused.camera!.distance >= 1.8);
  assert.equal(focused.verification?.layers.camera, "skipped", "no camera attached in tests is skipped");

  const reset = await bus.apply({ op: "camera.reset" });
  assert.equal(reset.ok, true);
  assert.deepEqual(
    [reset.camera?.position.x, reset.camera?.position.y, reset.camera?.position.z],
    [0, 1.7, 10.4],
  );
});

test("camera focus refuses an unknown target with candidates instead of moving somewhere", () => {
  fresh();
  const applier = SpatialCameraApplier.getInstance();
  const result = applier.focus(["No Such Object"]);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.refusal.code, "unknown-object");
  }
});

test("camera verification fails honestly when the camera never arrived", () => {
  const pose = { position: { x: 0, y: 0, z: 10 }, target: { x: 0, y: 0, z: 0 }, distance: 10, fov: 46 };
  const arrived: LiveCameraState = {
    position: [0, 0, 10],
    direction: [0, 0, -1],
    fov: 46,
    aspect: 1.7,
    near: 0.1,
    far: 200,
    updatedAt: Date.now(),
  };
  const passed = summarize(verifyCamera(pose, arrived));
  assert.equal(passed.layers.camera, "pass");
  assert.equal(passed.layers.framing, "pass");

  const missed = summarize(
    verifyCamera(pose, { ...arrived, position: [0, 0, 40], direction: [0, 1, 0] }),
  );
  assert.equal(missed.ok, false);
  assert.equal(missed.layers.camera, "fail");
  assert.equal(missed.layers.framing, "fail");
});

/* ===================== Gate G — verification ===================== */

test("renderer verification reports a missing mesh as a failure, and an unattached renderer as skipped", () => {
  const expectations = [
    {
      id: "spatial-box-1",
      name: "Cube 1",
      localPosition: { x: 1, y: 2, z: 3 },
      color: "#ff0000",
      visible: true,
    },
  ];
  const skipped = verifyRenderer(expectations, null);
  assert.equal(skipped.every((check) => check.status === "skipped"), true);

  const missing = verifyRenderer(expectations, [node("Core", {})]);
  assert.equal(missing.some((check) => check.status === "fail"), true);

  const wrongColour = verifyRenderer(expectations, [
    node("spatial:spatial-box-1", { local: [1, 2, 3], color: "#00ff00" }),
  ]);
  assert.equal(wrongColour.some((check) => check.status === "fail"), true);

  const correct = verifyRenderer(expectations, [
    node("spatial:spatial-box-1", { local: [1, 2, 3], color: "#ff0000" }),
  ]);
  assert.equal(correct.every((check) => check.status !== "fail"), true);
});

/* ===================== Gate H — chat ===================== */

test("chat maps camera, composition and approval phrases to real intents", () => {
  const focus = parseSpatialCommand("show me Nova");
  assert.equal(focus?.intent.op, "camera.focus");
  assert.deepEqual(focus?.intent, { op: "camera.focus", targets: ["Nova"] });

  const reset = parseSpatialCommand("return to the original Genesis view");
  assert.equal(reset?.intent.op, "camera.reset");

  const whole = parseSpatialCommand("zoom out and show the entire planetary system");
  assert.equal(whole?.intent.op, "camera.frame");

  const compose = parseSpatialCommand("build a research station beside Nova");
  assert.equal(compose?.intent.op, "scene.compose");
  assert.equal(compose && "anchor" in compose.intent ? compose.intent.anchor : undefined, "Nova");

  const approved = parseSpatialCommand("I approve");
  assert.equal(approved?.intent.op, "scene.commit");
  assert.equal(approved?.ownerApproval, true);

  const create = parseSpatialCommand("create a red cube at the left called Nova");
  assert.equal(create?.intent.op, "object.create", "phase 2.1 primitives still parse as creates");

  const lab = parseSpatialCommand("build a futuristic laboratory with separate research zones");
  assert.equal(lab?.intent.op, "scene.compose");

  const formation = parseSpatialCommand("arrange these objects into a symmetrical formation");
  assert.equal(formation?.intent.op, "scene.compose");
});

test("end to end from chat: plan, approve, commit as one revision", async () => {
  fresh();
  await bus.apply({ op: "object.create", kind: "sphere", name: "Nova" });
  const before = graph.snapshot().revision;

  const planned = parseSpatialCommand("create an orbital observatory around Nova");
  assert.equal(planned?.intent.op, "scene.compose");
  const prepared = await bus.apply(planned!.intent);
  assert.equal(prepared.ok, true, prepared.message);

  const approvalId = guard.requestApproval(["scene.commit"], "chat approval").approvalId;
  const committed = await bus.apply({ op: "scene.commit" }, { approvalId });
  assert.equal(committed.ok, true, committed.message);
  assert.equal(committed.revision, before + 1);
  assert.equal(graph.snapshot().objects.length, 4, "Nova plus the observatory's three objects");
});

/* ===================== manifest + guard ===================== */

test("the manifest tells the truth about what Phase 2.2 implemented", () => {
  assert.equal(SPATIAL_OPERATIONS["scene.compose"].implemented, true);
  assert.equal(SPATIAL_OPERATIONS["scene.compose"].mutates, false, "planning writes nothing");
  assert.equal(SPATIAL_OPERATIONS["scene.commit"].implemented, true);
  assert.equal(SPATIAL_OPERATIONS["scene.commit"].requiresApproval, true);
  assert.equal(SPATIAL_OPERATIONS["scene.commit"].tier, 4);
  assert.equal(SPATIAL_OPERATIONS["camera.focus"].tier, 2);
  assert.equal(SPATIAL_OPERATIONS["camera.focus"].mutates, false);
  assert.equal(SPATIAL_OPERATIONS["camera.frame"].implemented, true);
  assert.equal(
    Object.values(SPATIAL_OPERATIONS).some((operation) => operation.tier === 5),
    false,
    "no operation claims Tier 5",
  );
});

test("Tier 4 runs only under a single-use owner approval, never by self-elevation", () => {
  fresh();
  const withoutApproval = guard.authorize(["scene.commit"]);
  assert.equal(withoutApproval.ok, false);
  if (!withoutApproval.ok) assert.equal(withoutApproval.refusal.code, "approval-required");

  const approval = guard.requestApproval(["scene.commit"], "test");
  const approved = guard.authorize(["scene.commit"], { approvalId: approval.approvalId });
  assert.equal(approved.ok, true, "an owner-approved Tier 4 batch is allowed");
  if (approved.ok) assert.equal(approved.authorization.tier, 4);

  const reuse = guard.authorize(["scene.commit"], { approvalId: approval.approvalId });
  assert.equal(reuse.ok, false, "the approval is single-use");
  if (!reuse.ok) assert.equal(reuse.refusal.code, "approval-invalid");

  assert.deepEqual(guard.grantedTiers(), [1, 2, 3], "the configured grant is unchanged");
});
