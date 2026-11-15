/**
 * Mission 17 — the object EXPERIENCE, not just the object store.
 *
 * What is checked here is the part that was missing: the camera maths that
 * frames real geometry in a real viewport, undo/redo that preserves identity,
 * splitting a part out of an object, the furniture and garment builders, and
 * the local routing for typed and spoken Cosmos commands.
 */

import test from "node:test";
import assert from "node:assert/strict";

import CosmosObjectStore from "../src/core/cosmos/objects/CosmosObjectStore";
import { boundsOfList, framePose, poseFor, zoomPose, COSMOS_HOME_POSE } from "../src/core/cosmos/objects/CosmosObjectCamera";
import { compileDirect } from "../src/core/creative/kit/DirectCompiler";
import { buildFurniture } from "../src/core/creative/kit/build/Furniture";
import { buildGarment, garmentFromFabric, fabricOf } from "../src/core/creative/kit/build/Garment";
import { buildV8 } from "../src/core/creative/kit/build/V8";
import { BUILDERS } from "../src/core/creative/kit/build/Registry";
import { BUILD_DOMAINS } from "../src/core/creative/kit/build/BuildTypes";
import type { Scene3DProgram } from "../src/core/creative/kit/Scene3D";

function boxScene(size = 1): Scene3DProgram {
  return {
    background: "#000",
    camera: { position: [0, 0, 3], target: [0, 0, 0], fov: 45 },
    lights: [],
    objects: [
      {
        id: "body",
        shape: "box",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        color: "#fff",
        metalness: 0.2,
        roughness: 0.5,
        opacity: 1,
        size: { width: size, height: size, depth: size },
      },
    ],
    duration: 2,
    seed: 1,
  };
}

function fresh() {
  const store = CosmosObjectStore.createIsolated();
  return store;
}

/* ------------------------------------------------------------------ */
/* camera                                                              */
/* ------------------------------------------------------------------ */

test("the camera fits real geometry, and a narrow viewport backs off further", () => {
  const store = fresh();
  const a = store.spawn({ name: "box", scene: boxScene(1), builder: "test", frame: { position: [0, 0, 0], scale: 1 } }).ok;
  assert.ok(a);
  const objects = store.list();
  const bounds = boundsOfList(objects)!;
  assert.equal(bounds.center[0], 0);
  assert.ok(Math.abs(bounds.radius - Math.hypot(0.5, 0.5, 0.5)) < 1e-6, `radius ${bounds.radius}`);

  const landscape = framePose(bounds, { fov: 50, aspect: 16 / 9 });
  const portrait = framePose(bounds, { fov: 50, aspect: 9 / 16 });
  assert.ok(portrait.distance > landscape.distance, "portrait must stand further back than landscape");
  // The subject must be inside the frustum: radius / distance ≤ sin(fov/2).
  assert.ok(bounds.radius / landscape.distance <= Math.sin((50 * Math.PI) / 360) + 1e-9);
  assert.ok(Math.abs(landscape.lookAt[0] - bounds.center[0]) < 1e-9);
});

test("framing modes: everything, one object, the assembly, home, and an honest refusal", () => {
  const store = fresh();
  assert.deepEqual(poseFor({ mode: "all" }, [], { fov: 50, aspect: 1 }, null), {
    ok: false,
    reason: "there are no objects to frame — the Cosmos is waiting for one",
  });

  store.spawn({ name: "engine", scene: boxScene(1), builder: "test", frame: { position: [0, 0, -4], scale: 1 } });
  store.spawn({ name: "cabin", scene: boxScene(4), builder: "test", frame: { position: [6, 0, -4], scale: 1 } });
  const objects = store.list();

  const all = poseFor({ mode: "all" }, objects, { fov: 50, aspect: 1.5 }, null);
  assert.ok(all.ok);
  if (all.ok) {
    // Centred between the two, and far enough away for the wider of them.
    // engine spans -0.5…0.5, cabin 4…8: the centre of the union is 3.75
    assert.ok(Math.abs(all.pose.lookAt[0] - 3.75) < 1e-6, `centre ${all.pose.lookAt[0]}`);
    assert.ok(all.pose.distance > 6);
  }

  const focus = poseFor({ mode: "focus", object: "engine" }, objects, { fov: 50, aspect: 1.5 }, null);
  assert.ok(focus.ok);
  if (focus.ok) assert.ok(Math.abs(focus.pose.lookAt[2] + 4) < 1e-6);

  const missing = poseFor({ mode: "focus", object: "spaceship" }, objects, { fov: 50, aspect: 1.5 }, null);
  assert.equal(missing.ok, false);

  const home = poseFor({ mode: "home" }, objects, { fov: 50, aspect: 1.5 }, null);
  assert.ok(home.ok && home.pose.position[2] === COSMOS_HOME_POSE.position[2]);

  const previous = poseFor({ mode: "previous" }, objects, { fov: 50, aspect: 1.5 }, null);
  assert.equal(previous.ok, false, "with no earlier pose, it says so");

  const zoomed = zoomPose(all.ok ? all.pose : COSMOS_HOME_POSE, 1.6);
  assert.ok(zoomed.distance < (all.ok ? all.pose.distance : 1));

  // An assembly includes what is inside it.
  const engine = store.list()[0];
  const cabin = store.list()[1];
  store.integrate(engine.id, cabin.id);
  const assembly = poseFor({ mode: "assembly", object: "cabin" }, store.list(), { fov: 50, aspect: 1.5 }, null);
  assert.ok(assembly.ok);
  if (assembly.ok) assert.ok(assembly.subject.includes("1 object(s) inside it"));
});

/* ------------------------------------------------------------------ */
/* undo / redo                                                         */
/* ------------------------------------------------------------------ */

test("undo and redo take back changes without re-creating objects", () => {
  const store = fresh();
  const first = store.spawn({ name: "engine", scene: boxScene(), builder: "test", frame: { position: [0, 0, 0] } });
  assert.ok(first.ok);
  const id = first.ok ? first.value.id : "";
  assert.equal(store.canUndo(), true);

  store.transform(id, { position: [4, 0, 0] });
  assert.deepEqual(store.get(id)!.frame.position, [4, 0, 0]);

  assert.ok(store.undo().ok);
  assert.deepEqual(store.get(id)!.frame.position, [0, 0, 0], "the position came back");
  assert.equal(store.get(id)!.id, id, "the id is the same object, not a copy");
  assert.equal(store.list().length, 1);

  assert.ok(store.redo().ok);
  assert.deepEqual(store.get(id)!.frame.position, [4, 0, 0]);

  // Removal is undoable and the object comes back as itself.
  store.remove(id);
  assert.equal(store.list().length, 0);
  assert.ok(store.undo().ok);
  assert.equal(store.list().length, 1);
  assert.equal(store.list()[0].id, id);

  // Selection is a view state: it must not fill the history.
  const depth = store.historyDepth().undo;
  store.select(id);
  store.select(null);
  assert.equal(store.historyDepth().undo, depth);
});

test("a multi-object drag is one undo step", () => {
  const store = fresh();
  const a = store.spawn({ name: "a", scene: boxScene(), builder: "test" }).ok ? store.list()[0] : null;
  store.spawn({ name: "b", scene: boxScene(), builder: "test" });
  const ids = store.list().map((o) => o.id);
  assert.ok(a);

  const starts = store.list().map((o) => [...o.frame.position]);
  const before = store.historyDepth().undo;
  // What the drag does: many silent moves, then one commit.
  store.nudge(ids, [1, 0, 0], { silent: true });
  store.nudge(ids, [1, 0, 0], { silent: true });
  store.nudge(ids, [0, 0, 0]);
  assert.equal(store.historyDepth().undo, before + 1, "one step, not three");

  store.undo();
  store.list().forEach((object, index) => assert.deepEqual([...object.frame.position], starts[index], "both came back"));
});

/* ------------------------------------------------------------------ */
/* splitting a part out                                                */
/* ------------------------------------------------------------------ */

test("a part can be taken out of an object and keep its material and place", () => {
  const store = fresh();
  const v8 = buildV8({}).program!;
  const spawned = store.spawn({
    name: "V8 engine",
    scene: v8.scene,
    builder: "v8",
    domain: "mechanical",
    frame: { position: [2, 0, -3], scale: 4 },
    partCount: v8.parts.length,
  });
  assert.ok(spawned.ok);
  const engine = spawned.ok ? spawned.value : null;
  assert.ok(engine);
  const before = engine!.partCount;

  const split = store.splitPart(engine!.id, "crank");
  assert.ok(split.ok, split.ok ? "" : split.reason);
  if (!split.ok) return;
  const { source, part } = split.value;

  assert.equal(source.id, engine!.id, "the parent keeps its identity");
  assert.equal(source.partCount, before - 1);
  assert.equal(part.partCount, 1);
  assert.equal(part.scene.objects[0].id, "crank-part");
  assert.equal(part.scene.objects[0].color, source.scene.objects.find((p) => p.id.includes("crank"))?.color ?? part.scene.objects[0].color);
  // It stays where it was on screen, in world space, not at the origin.
  assert.notDeepEqual(part.frame.position, [0, 0, 0]);
  assert.deepEqual(part.frame.position.slice(0, 2), [2, 0]);
  assert.ok(store.list().length === 2);

  // And the whole split is one undo.
  assert.ok(store.undo().ok);
  assert.equal(store.list().length, 1);
  assert.equal(store.get(engine!.id)!.partCount, before, "the part is back inside the engine");

  const nonsense = store.splitPart(engine!.id, "warp-drive");
  assert.equal(nonsense.ok, false);
  if (!nonsense.ok) assert.match(nonsense.reason, /has no part called/);
});

/* ------------------------------------------------------------------ */
/* furniture and garments                                              */
/* ------------------------------------------------------------------ */

test("furniture is one assembly: dimensions drive the parts", () => {
  const chair = buildFurniture({ kind: "chair" }).program!;
  assert.equal(chair.domain, "furniture");
  assert.equal(chair.derived.find((d) => d.label === "Legs")?.value, "4");
  assert.equal(chair.derived.find((d) => d.label === "Seat / top height")?.value, "45 cm");
  assert.ok(chair.parts.some((p) => p.id === "surface"));
  assert.ok(chair.parts.some((p) => p.id === "back"));

  const tall = buildFurniture({ kind: "chair", seatHeight: 0.62 }).program!;
  const tallSurface = tall.parts.find((p) => p.id === "surface")!;
  const tallLeg = tall.parts.find((p) => p.id === "leg-left-front")!;
  assert.equal(tallSurface.position[1], 0.62, "the seat moved up");
  assert.ok((tallLeg.size.height as number) > 0.55, "the legs grew to reach the floor");

  const table = buildFurniture({ kind: "table", width: 1.8 }).program!;
  assert.equal(table.parts.filter((p) => p.layer === "legs").length, 6, "a long table gains two legs");
  assert.equal(table.parts.filter((p) => p.layer === "back").length, 0, "a table has no back");

  const shelf = buildFurniture({ kind: "shelf" }).program!;
  assert.ok(shelf.parts.filter((p) => p.id.startsWith("shelf-")).length >= 2);
  assert.ok(shelf.notes.some((n) => /not a manufacturing drawing/.test(n)), "the limit is stated, not hidden");
});

test("a garment is panels cut from a fabric, and says what it is not", () => {
  const shirt = buildGarment({ kind: "shirt" }).program!;
  assert.equal(shirt.domain, "fashion");
  for (const id of ["panel-front", "panel-back", "sleeve-left", "sleeve-right", "collar", "seam-side-left", "closure-1", "fabric-swatch"]) {
    assert.ok(shirt.parts.some((p) => p.id === id), `missing ${id}`);
  }
  assert.ok(shirt.derived.some((d) => d.label === "Fabric used"));

  const sleeveless = buildGarment({ kind: "shirt", sleeve: 0 }).program!;
  assert.equal(sleeveless.parts.filter((p) => p.layer === "sleeves").length, 0);
  assert.equal(sleeveless.derived.find((d) => d.label === "Sleeve")?.value, "none");

  const hoodie = buildGarment({ kind: "hoodie" }).program!;
  assert.ok(hoodie.parts.some((p) => p.id === "hood"));

  const pants = buildGarment({ kind: "pants" }).program!;
  assert.ok(pants.parts.some((p) => p.id === "waistband"));

  // The fabric is the loom's own rubric, not a second opinion.
  const fabric = fabricOf({ weave: "twill", density: 30, threadDiameter: 0.0005 });
  assert.equal(fabric.weave, "twill");
  assert.ok(Math.abs(fabric.cover - Math.min(1, 30 * 0.0005 * 100 * 2)) < 1e-9);

  const fromSample = garmentFromFabric({ weave: "satin", density: 40, threadDiameter: 0.0004 });
  const dress = buildGarment({ kind: "dress", ...fromSample }).program!;
  assert.equal(dress.params.weave, "satin");
  assert.ok(dress.derived.find((d) => d.label === "Fabric")!.value.startsWith("satin"));

  // The classification is honest about what this is.
  assert.ok(dress.notes.some((n) => /Pattern-based textile representation/.test(n)));
  assert.ok(dress.notes.some((n) => /Not a graded, manufacturing-ready pattern/.test(n)));
});

test("the registry now covers ten domains with nine builders", () => {
  assert.equal(BUILD_DOMAINS.length, 10);
  assert.deepEqual(new Set(BUILDERS.map((b) => b.domain)).size, 8);
  assert.ok(BUILDERS.some((b) => b.id === "furniture"));
  assert.ok(BUILDERS.some((b) => b.id === "garment"));
});

/* ------------------------------------------------------------------ */
/* local routing                                                       */
/* ------------------------------------------------------------------ */

test("typed /cosmos commands are parsed as arguments", () => {
  const frame = compileDirect("/cosmos frame all");
  assert.equal(frame?.steps[0].tool, "cosmos.view.frame");
  assert.equal(frame?.steps[0].args.mode, "all");

  const position = compileDirect("/cosmos position obj_1 1.5 0 -3");
  assert.equal(position?.steps[0].tool, "cosmos.object.position");
  assert.deepEqual(position?.steps[0].args.position, [1.5, 0, -3]);
  assert.equal(position?.steps[0].args.relative, false);

  const turn = compileDirect("/cosmos rotate engine 90");
  assert.deepEqual(turn?.steps[0].args.rotation, [0, 90, 0]);
  assert.equal(turn?.steps[0].args.object, "engine");

  const remove = compileDirect("/cosmos remove obj_1 confirm=true");
  assert.equal(remove?.steps[0].args.object, "obj_1", "the flag is a flag, not part of the name");
  assert.equal(remove?.steps[0].args.confirm, true);

  const split = compileDirect("/cosmos split engine crank");
  assert.equal(split?.steps[0].tool, "cosmos.object.split");
  assert.deepEqual([split?.steps[0].args.object, split?.steps[0].args.part], ["engine", "crank"]);

  assert.equal(compileDirect("/cosmos undo")?.steps[0].tool, "cosmos.object.undo");
  assert.equal(compileDirect("/cosmos open")?.steps[0].tool, "cosmos.view.open");
  assert.equal(compileDirect("/cosmos place engine workspace")?.steps[0].args.place, "workspace");
  // An unknown verb never becomes a mutation: it falls back to reading.
  assert.equal(compileDirect("/cosmos frobnicate")?.steps[0].tool, "cosmos.object.list");
});

test("spoken Cosmos commands route locally, and ambiguous ones stay away", () => {
  assert.equal(compileDirect("Open my Cosmos.")?.steps[0].tool, "cosmos.view.open");
  assert.equal(compileDirect("Open my Cosmos.")?.steps[0].args.open, true);
  assert.equal(compileDirect("Frame all my objects.")?.steps[0].args.mode, "all");
  assert.equal(compileDirect("Return to my Home.")?.steps[0].tool, "cosmos.view.open");
  assert.equal(compileDirect("Return to my Home.")?.steps[0].args.open, false);
  assert.equal(compileDirect("Zoom to the engine")?.steps[0].args.mode, "zoom");

  // With nothing in the Cosmos, a sentence about a part is a construction change,
  // not an object operation.
  const store = CosmosObjectStore.getInstance();
  const wasEmpty = store.list().length === 0;
  if (wasEmpty) assert.equal(compileDirect("remove the idler"), null);
});

test("relative moves and sizes read the words as directions and factors", () => {
  const store = CosmosObjectStore.getInstance();
  const seeded = store.spawn({ name: "routing engine", scene: boxScene(), builder: "test", frame: { position: [0, 0, 0] } });
  store.spawn({ name: "routing cabin", scene: boxScene(2), builder: "test", frame: { position: [3, 0, 0] } });
  try {
    const left = compileDirect("move the routing engine to the left of the routing cabin");
    assert.equal(left?.steps[0].tool, "cosmos.object.position");
    assert.equal(left?.steps[0].args.side, "left");

    const twice = compileDirect("make the routing engine twice as large");
    assert.equal(twice?.steps[0].tool, "cosmos.object.transform");
    assert.equal(twice?.steps[0].args.scale, 2);
    assert.equal(twice?.steps[0].args.relative, true);

    const turn = compileDirect("rotate the routing engine 90 degrees");
    assert.deepEqual(turn?.steps[0].args.rotation, [0, 90, 0]);
  } finally {
    if (seeded.ok) store.clear();
  }
});
