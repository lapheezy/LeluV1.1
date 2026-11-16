import assert from "node:assert/strict";
import test from "node:test";

import {
  VERIFICATION_THRESHOLDS,
  centreDistance,
  classify,
  exceedsViewport,
  intersectionArea,
  iou,
  rectArea,
  rectCentre,
  summarise,
  type PixelRect,
  type ProjectionObservation,
} from "../src/core/cosmos/objects/ProjectionVerification";

/*
 * Every expected number below is written down by hand from the rectangles in
 * the test, not produced by calling the function under test:
 *   {10,10,30,40} is 20 wide and 30 tall → 600.
 *   Two 100×100 squares offset by 50 in x and y overlap by 50×50 → IoU 25/175.
 */
const box = (left: number, top: number, right: number, bottom: number): PixelRect => ({ left, top, right, bottom });

function observation(over: Partial<ProjectionObservation>): ProjectionObservation {
  return {
    id: "obj_1",
    projected: box(100, 100, 200, 200),
    observed: box(110, 110, 190, 190),
    observedArea: 80 * 80,
    projectedCentre: [150, 150],
    observedCentre: [150, 150],
    raycastOwner: "obj_1",
    projectedOnScreen: true,
    projectedInFrustum: true,
    projectionFailure: null,
    viewport: { width: 400, height: 400 },
    ...over,
  };
}

test("rect area, centre and intersection are the hand-computed figures", () => {
  assert.equal(rectArea(box(10, 10, 30, 40)), 20 * 30);
  assert.deepEqual(rectCentre(box(10, 10, 30, 40)), [20, 25]);
  assert.equal(intersectionArea(box(0, 0, 10, 10), box(5, 5, 15, 15)), 25);
  assert.equal(intersectionArea(box(0, 0, 10, 10), box(20, 20, 30, 30)), 0);
  assert.equal(rectArea(null), 0);
});

test("IoU of two 100x100 squares offset by 50 is 25/175", () => {
  assert.ok(Math.abs(iou(box(0, 0, 100, 100), box(50, 50, 150, 150)) - 25 / 175) < 1e-12);
  assert.equal(iou(box(0, 0, 10, 10), box(50, 50, 60, 60)), 0);
});

test("a silhouette inside its box, with both centres agreeing, is a match", () => {
  const agreement = classify(observation({}));
  assert.equal(agreement.verdict, "match");
  assert.equal(agreement.coverage, 1);
  assert.equal(agreement.centreDelta, 0);
  assert.equal(agreement.raycastAgrees, true);
});

test("a silhouette somewhere else entirely is outside, not a pass", () => {
  const agreement = classify(
    observation({
      projected: box(100, 100, 200, 200),
      observed: box(400, 400, 480, 480),
      observedArea: 80 * 80,
      observedCentre: [440, 440],
    }),
  );
  assert.equal(agreement.verdict, "outside");
  assert.equal(agreement.coverage, 0);
});

test("a box that is too small fails on coverage even when the centres agree", () => {
  /* A 40×40 box around a 80×80 silhouette: half the silhouette is outside. */
  const agreement = classify(
    observation({
      projected: box(130, 130, 170, 170),
      projectedCentre: [150, 150],
      observed: box(110, 110, 190, 190),
      observedArea: 80 * 80,
      observedCentre: [150, 150],
    }),
  );
  assert.equal(agreement.verdict, "outside");
  /* 40×40 of the 80×80 mask = 1600 / 6400 */
  assert.equal(agreement.coverage, 0.25);
});

test("the drawn silhouette inside a broader box, with an off centre, is partial", () => {
  const agreement = classify(
    observation({
      projected: box(100, 100, 300, 300),
      projectedCentre: [200, 200],
      observed: box(150, 120, 250, 240),
      observedArea: 100 * 120,
      observedCentre: [200, 180],
    }),
  );
  assert.equal(agreement.verdict, "partial");
  assert.equal(agreement.coverage, 1);
  /* centres are 20 px apart: beyond the 12 px match tolerance, inside 30 */
  assert.equal(agreement.centreDelta, 20);
});

test("a box clipped by the viewport edge is clipped, not a match", () => {
  const agreement = classify(
    observation({
      projected: box(-100, 100, 50, 400),
      projectedCentre: [-25, 250],
      observed: box(0, 150, 40, 300),
      observedArea: 40 * 150,
      observedCentre: [20, 225],
    }),
  );
  assert.equal(agreement.verdict, "clipped");
  assert.ok(agreement.fill! < VERIFICATION_THRESHOLDS.clippedFill);
  assert.equal(exceedsViewport(box(-100, 100, 50, 400), { width: 400, height: 400 }), true);
});

test("no mask means missing when the projection claimed an on-screen object", () => {
  const agreement = classify(observation({ observed: null, observedArea: 0, observedCentre: null }));
  assert.equal(agreement.verdict, "missing");
});

test("no mask is not-rendered only when the projection already said so", () => {
  const offScreen = classify(
    observation({ observed: null, observedArea: 0, observedCentre: null, projectedOnScreen: false, projectedInFrustum: false }),
  );
  assert.equal(offScreen.verdict, "not-rendered");

  const offFrustum = classify(
    observation({ observed: null, observedArea: 0, observedCentre: null, projectedInFrustum: false }),
  );
  assert.equal(offFrustum.verdict, "not-rendered");
});

test("a failed projection is reported as a failure, never as agreement", () => {
  const agreement = classify(observation({ projectionFailure: "behind camera", projected: null, observed: null, observedArea: 0 }));
  assert.equal(agreement.verdict, "projection-failure");
  assert.equal(agreement.reason, "behind camera");
});

test("centres that disagree beyond both tolerances are uncertain, not a pass", () => {
  const agreement = classify(
    observation({
      projected: box(100, 100, 300, 300),
      projectedCentre: [200, 200],
      /* fully inside the box, so coverage is 1, but 75 px from its centre */
      observed: box(110, 110, 140, 140),
      observedArea: 30 * 30,
      observedCentre: [125, 125],
    }),
  );
  assert.equal(agreement.verdict, "uncertain");
  assert.equal(agreement.coverage, 1);
  assert.equal(Math.round(agreement.centreDelta!), 106);
});

test("an occluded silhouette still matches when its visible edges align", () => {
  /* The real 390×844 numbers: the chair's legs are behind the planet, so the
     visible mask stops 32 px above the box bottom. Edges and horizontal
     centre still align, so this is a match with occlusion noted. */
  const agreement = classify(
    observation({
      projected: box(126, 388, 188, 486),
      projectedCentre: [157, 437],
      observed: box(129, 387, 175, 454),
      observedArea: 46 * 67,
      observedCentre: [150, 416],
    }),
  );
  assert.equal(agreement.verdict, "match");
  assert.equal(agreement.deltaX, 5);
  assert.equal(agreement.deltaTop, 1);
  assert.ok(agreement.fill! < 0.9);
  assert.match(agreement.reason, /behind scene geometry/);
});

test("a shifted silhouette fails the edge test even when the box contains it", () => {
  const agreement = classify(
    observation({
      projected: box(100, 100, 200, 200),
      projectedCentre: [150, 150],
      observed: box(175, 105, 199, 199),
      observedArea: 24 * 94,
      observedCentre: [187, 152],
    }),
  );
  assert.equal(agreement.verdict, "uncertain");
  assert.equal(agreement.coverage, 1);
  assert.equal(agreement.deltaX, 37);
});

test("a raycast that names a different object is recorded as disagreement", () => {
  const agreement = classify(observation({ raycastOwner: "obj_2" }));
  assert.equal(agreement.raycastAgrees, false);
});

test("summarise counts verdicts and refuses to call a viewport passed with a failure in it", () => {
  const good = { id: "obj_1", agreement: classify(observation({})) };
  const alsoGood = { id: "obj_2", agreement: classify(observation({ id: "obj_2" })) };
  const bad = { id: "obj_3", agreement: classify(observation({ id: "obj_3", observed: null, observedArea: 0, observedCentre: null })) };
  const result = summarise([good, alsoGood, bad]);
  assert.equal(result.total, 3);
  assert.equal(result.counts.match, 2);
  assert.equal(result.counts.missing, 1);
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures.map((f) => f.id), ["obj_3"]);
});

test("centre distance is null when either centre is missing", () => {
  assert.equal(centreDistance(null, [1, 2]), null);
  assert.equal(centreDistance([0, 0], [3, 4]), 5);
});
