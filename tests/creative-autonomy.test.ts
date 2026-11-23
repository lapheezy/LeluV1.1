/**
 * M16.3 WP03 — deterministic cognition and spatial layout for creations.
 *
 * Two properties are under test:
 *   1. an instruction compiles to the exact couture.objects call a model would
 *      emit, with "it" bound to the object named earlier in the sentence;
 *   2. relative placement is computed from real bounding boxes, so two objects
 *      never end up inside each other.
 *
 * Both are pure, so they run everywhere and cost nothing.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { compileCreativeObjectPlan } from "../src/core/couture/intents";
import { boxCentre, boxSize, relationOffset, type Box } from "../src/core/couture/layout";
import { getCreativeSelection, selectCreativeObject, subscribeCreativeSelection } from "../src/core/couture/selection";

const box = (min: [number, number, number], max: [number, number, number]): Box => ({ min, max });
const argsOf = (prompt: string, selectedId?: string) =>
  compileCreativeObjectPlan(prompt, { selectedId: selectedId ?? null })?.steps.map((s) => s.args) ?? [];

test("select compiles to the canonical select call", () => {
  const [call] = argsOf("select the chair");
  assert.equal(call?.action, "select");
  assert.equal(call?.object, "chair");
});

test("a part can be named in the selection", () => {
  const [call] = argsOf("select the gown by its sleeve");
  assert.equal(call?.action, "select");
  assert.equal(call?.object, "gown");
  assert.equal(call?.component, "sleeve");
});

test("scaling understands twice, half and a factor", () => {
  assert.equal(argsOf("make the pendant twice as large")[0]?.scale, 2);
  assert.equal(argsOf("make the pendant half the size")[0]?.scale, 0.5);
  assert.equal(argsOf("scale the chair 1.5x")[0]?.scale, 1.5);
  assert.equal(argsOf("make the chair slightly smaller")[0]?.scale, 0.8);
});

test("rotation is expressed in the engine's own degrees", () => {
  const [call] = argsOf("rotate the chair 90 degrees");
  assert.deepEqual(call?.rotation, [0, 0, 90]);
  assert.deepEqual(argsOf("turn the pendant a quarter turn")[0]?.rotation, [0, 0, 90]);
});

test("a relative placement names the anchor instead of guessing coordinates", () => {
  const [call] = argsOf("move the chair beside the table");
  assert.equal(call?.action, "move");
  assert.equal(call?.relativeTo, "table");
  assert.equal(call?.relation, "beside");
});

test("it resolves to the selected object", () => {
  const [call] = argsOf("move it to the left", "obj-product-1");
  assert.equal(call?.object, "obj-product-1");
  assert.deepEqual(call?.delta, [-300, 0, 0]);
});

test("a compound instruction keeps its order and its referent", () => {
  const plan = compileCreativeObjectPlan("select the chair, rotate it 90 degrees and move it beside the table", {
    selectedId: null,
  });
  assert.ok(plan);
  assert.equal(plan.steps.length, 3);
  assert.equal(plan.steps[0].args.action, "select");
  assert.equal(plan.steps[1].args.object, "chair");
  assert.deepEqual(plan.steps[1].args.rotation, [0, 0, 90]);
  assert.equal(plan.steps[2].args.relativeTo, "table");
  assert.equal(plan.steps[2].args.object, "chair");
});

test("an unrelated sentence is not hijacked", () => {
  assert.equal(compileCreativeObjectPlan("what is the weather in Lisbon"), null);
  assert.equal(compileCreativeObjectPlan("build me a gear train"), null);
});

test("relative placement leaves a real gap between the two bodies", () => {
  const subject = box([-0.2, 0, -0.2], [0.2, 1, 0.2]);
  const target = box([2, 0, -0.5], [3, 1.2, 0.5]);
  const gap = 0.25;

  // Stage units: x right, y up, z toward the viewer.
  const beside = relationOffset(subject, target, "beside", gap);
  const subjectCentreX = boxCentre(subject)[0] + beside[0];
  const targetCentreX = boxCentre(target)[0];
  const halfWidths = boxSize(subject)[0] / 2 + boxSize(target)[0] / 2;
  assert.ok(Math.abs(subjectCentreX - targetCentreX) >= halfWidths + gap - 1e-9, "side by side with clear space");

  const above = relationOffset(subject, target, "above", gap);
  const subjectCentreY = boxCentre(subject)[1] + above[1];
  const targetCentreY = boxCentre(target)[1];
  const halfHeights = boxSize(subject)[1] / 2 + boxSize(target)[1] / 2;
  assert.ok(subjectCentreY - targetCentreY >= halfHeights + gap - 1e-9, "stacked with clear space");

  const centre = relationOffset(subject, target, "centre", gap);
  assert.ok(Math.abs(boxCentre(subject)[0] + centre[0] - targetCentreX) < 1e-9, "centred means centred");
});

test("selection is a pointer, and it notifies without touching any object", () => {
  const seen: string[] = [];
  const stop = subscribeCreativeSelection((next) => seen.push(next?.objectId ?? "none"));
  selectCreativeObject({ objectId: "obj-a" });
  assert.equal(getCreativeSelection()?.objectId, "obj-a");
  selectCreativeObject({ objectId: "obj-a" });
  assert.deepEqual(seen, ["obj-a"], "a repeat selection does not fire twice");
  selectCreativeObject(null);
  stop();
  assert.deepEqual(seen, ["obj-a", "none"]);
});
