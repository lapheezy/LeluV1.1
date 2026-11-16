import { test } from "node:test";
import assert from "node:assert/strict";
import { assessTurn, checkCall, inLoopNote, qualityNotice } from "../src/core/router/qualityCheckpoint";

const drawing = (n: number) => ({ name: "studio_create", ok: true, args: { kind: "drawing", title: "cat", scene: { elements: Array.from({ length: n }, () => ({})) } } });

test("a too-simple drawing is surfaced, not reported as fine", () => {
  const d = checkCall("draw a cat", drawing(3));
  assert.equal(d?.area, "drawing");
  assert.match(d!.problem, /only 3 elements/);
  assert.equal(checkCall("draw a cat", drawing(8)), null);
  // "detailed" raises the bar.
  assert.ok(checkCall("draw a detailed cat", drawing(8)));
});

test("a later, richer revision clears the deficiency (free improvement worked)", () => {
  assert.equal(assessTurn("draw a cat", [drawing(2), drawing(12)]).length, 0);
  assert.equal(assessTurn("draw a cat", [drawing(12), drawing(2)]).length, 1);
});

test("a complex 3D subject as one primitive is flagged, and the paid route is only offered", () => {
  const call = { name: "world_object", ok: true, args: { action: "create", shape: "cylinder", label: "statue" } };
  const found = assessTurn("make a 3d statue", [call]);
  assert.equal(found.length, 1);
  assert.match(found[0].problem, /single cylinder primitive/);
  const notice = qualityNotice(found);
  assert.match(notice, /below what you asked for/);
  assert.match(notice, /I have not used it/);
  assert.match(notice, /explicit go-ahead/);
  // An assembly of several primitives is not a stand-in.
  assert.equal(assessTurn("make a 3d statue", [call, call, call]).length, 0);
});

test("the in-loop note steers to free tools only", () => {
  const note = inLoopNote(checkCall("draw a cat", drawing(1))!);
  assert.match(note, /same free tools/);
  assert.match(note, /Do not use any paid service/);
});

test("failed calls, unrelated tools and good results produce no notice", () => {
  assert.equal(checkCall("draw", { ...drawing(1), ok: false }), null);
  assert.equal(checkCall("search", { name: "web_search", ok: true, args: {} }), null);
  assert.equal(checkCall("a cozy room", { name: "world_generate", ok: true, args: { items: [{}, {}, {}, {}] } }), null);
  assert.ok(checkCall("a cozy room", { name: "world_generate", ok: true, args: { items: [{}] } }));
  assert.equal(qualityNotice([]), "");
});

test("asks before paid inference to improve a drawing", () => {
  const notice = qualityNotice(assessTurn("draw a cat", [drawing(2)]));
  assert.match(notice, /stronger paid model/);
  assert.match(notice, /needs your explicit go-ahead/);
});
