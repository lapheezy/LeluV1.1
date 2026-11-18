/**
 * LÉLU 2 — Golden Geometry Engine — contract tests.
 *
 * These assert the *mathematics*, not a rendering: divergence and convergence,
 * equal-area packing, the golden spiral's quarter-turn growth, symmetry error,
 * self-similar recursion, and the honesty rules in the constraint selector
 * (a Fibonacci count that would change density is rejected).
 *
 *   npx tsx --test tests/golden-geometry.test.ts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PHI,
  PHI_INV,
  GOLDEN_ANGLE,
  GOLDEN_ANGLE_DEG,
  fibonacci,
  fibonacciSequence,
  phiConvergent,
  ratioConvergence,
  nearestFibonacci,
  continuedFraction,
  closestPhiPower,
  goldenSection,
  vogel,
  growthFrame,
  parastichyPair,
  cylindricalPhyllotaxis,
  fibonacciSphere,
  sphericalCap,
  mapDirectionsToSurface,
  goldenSpiral,
  archimedeanSpiral,
  conicalCurl,
  spiralFit,
  arcLength,
  radialSymmetry,
  bilateralSymmetry,
  symmetryError,
  bilateralError,
  recursiveBranches,
  nearestNeighbourStats,
  divergenceStats,
  radialStats,
  geometricSignature,
  analyseProportions,
  analyseIncrements,
  goldenPartition,
  goldenFrameNode,
  selectConstraints,
  acceptedConstraints,
} from "../src/core/geometry/golden/index.ts";

test("golden constants are exact to double precision", () => {
  assert.ok(Math.abs(PHI - 1.618033988749895) < 1e-15);
  assert.ok(Math.abs(PHI_INV - 0.6180339887498949) < 1e-15);
  assert.ok(Math.abs(GOLDEN_ANGLE_DEG - 137.50776405) < 1e-7);
  assert.equal(GOLDEN_ANGLE, Math.PI * (3 - Math.sqrt(5)));
  // φ² = φ + 1 and 1/φ = φ − 1, the identities the engine relies on.
  assert.ok(Math.abs(PHI * PHI - (PHI + 1)) < 1e-12);
  assert.ok(Math.abs(1 / PHI - (PHI - 1)) < 1e-15);
});

test("fibonacci converges on φ from alternating sides", () => {
  assert.deepEqual(fibonacciSequence(8), [1, 1, 2, 3, 5, 8, 13, 21]);
  assert.equal(fibonacci(0), 0);
  assert.equal(fibonacci(10), 55);
  const conv = ratioConvergence(14);
  for (let i = 1; i < conv.length; i++) assert.ok(conv[i].error < conv[i - 1].error, `convergence not monotone at n=${i}`);
  assert.ok(Math.abs(phiConvergent(20) - PHI) < 1e-8);
  // φ is the slowest-converging continued fraction there is: [1;1,1,1,…].
  assert.deepEqual(continuedFraction(PHI, 6), [1, 1, 1, 1, 1, 1]);
});

test("nearestFibonacci picks the count that changes density least", () => {
  assert.equal(nearestFibonacci(1350).value, 1597); // 1350 sits between 987 and 1597
  assert.equal(nearestFibonacci(1600).value, 1597); // −0.2 %
  assert.equal(nearestFibonacci(100).value, 89); // −11 %
});

test("closestPhiPower reports its own error", () => {
  const exact = closestPhiPower(PHI * PHI);
  assert.equal(exact.power, 2);
  assert.ok(exact.relativeError < 1e-12);
  const notGolden = closestPhiPower(1.29);
  assert.equal(notGolden.power, 0);
  assert.ok(notGolden.relativeError > 0.2);
});

test("Vogel phyllotaxis is equal-area and turns by the golden angle", () => {
  const pts = vogel(900, { radius: 1 });
  assert.equal(pts.length, 900);
  const stats = nearestNeighbourStats(pts);
  assert.ok(stats.cv < 0.05, `spacing CV ${stats.cv} should be near-uniform`);
  const radial = radialStats(pts);
  assert.ok(Math.abs(radial.exponent - 0.5) < 0.02, `exponent ${radial.exponent} should be ½`);
  assert.ok(radial.r2 > 0.999);
  const div = divergenceStats(pts);
  assert.ok(div.goldenErrorDeg < 6, `dominant ${div.dominantDeg}° should sit near the golden angle`);
  // Growth order must be by radius: index 0 at the centre, last at the rim.
  assert.ok(pts[0].r < pts[899].r);
});

test("a quadratic (non-equal-area) spiral is rejected by the radial metric", () => {
  const bad = vogel(600, { radius: 1, exponent: 1 });
  const radial = radialStats(bad);
  assert.ok(radial.error > 0.4, `exponent ${radial.exponent} should be far from ½`);
  // and the constraint selector must not accept it
  const constraints = selectConstraints({ signature: geometricSignature(bad) });
  const equalArea = constraints.find((c) => c.id === "pattern.equal-area")!;
  assert.equal(equalArea.accepted, true);
  assert.ok(equalArea.measuredError > 0.4);
});

test("geometor growth frame places the newest primordium at the rim", () => {
  const frame = growthFrame(21);
  assert.equal(frame[0].r, 21);
  assert.equal(frame[20].r, 1);
  assert.deepEqual(parastichyPair(21), [8, 13]);
});

test("cylindrical phyllotaxis wraps a pattern around a tube", () => {
  const pts = cylindricalPhyllotaxis(144, 0.01, 0.2);
  assert.equal(pts.length, 144);
  for (const p of pts) assert.ok(Math.abs(Math.hypot(p.x, p.y) - 0.01) < 1e-12);
  assert.ok(pts[0].z > -0.101 && pts[143].z < 0.101);
});

test("Fibonacci sphere spreads points evenly and honours caps", () => {
  const dirs = fibonacciSphere(2000);
  assert.equal(dirs.length, 2000);
  const pts = dirs.map((d) => ({ x: d.x, y: d.y, z: d.z }));
  for (const d of dirs) assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-12);
  const stats = nearestNeighbourStats(pts);
  assert.ok(stats.cv < 0.05, `sphere spacing CV ${stats.cv}`);
  const top = fibonacciSphere(500, { hemisphere: "top" });
  assert.ok(top.every((d) => d.z >= 0));
  const cap = sphericalCap(800, Math.PI / 4, [0, 1, 0]);
  assert.ok(cap.length > 0 && cap.length < 200);
  for (const d of cap) assert.ok(d.y >= Math.cos(Math.PI / 4) - 1e-12);
});

test("mapDirectionsToSurface lands only on surface points that pass the filter", () => {
  // A sphere of radius 0.1 sampled on a lattice, filtered to its top half.
  const surf: number[] = [];
  for (let i = 0; i <= 30; i++)
    for (let j = 0; j <= 60; j++) {
      const theta = (i / 30) * Math.PI;
      const phi = (j / 60) * Math.PI * 2;
      surf.push(0.1 * Math.sin(theta) * Math.cos(phi), 0.1 * Math.cos(theta), 0.1 * Math.sin(theta) * Math.sin(phi));
    }
  const { points, unmatched } = mapDirectionsToSurface(400, Float32Array.from(surf), [0, 0, 0], { filter: (_x, y) => y >= -1e-9, shell: 0.1, cell: 0.02 });
  assert.ok(points.length / 3 > 120, `only ${points.length / 3} roots mapped`);
  assert.ok(unmatched < 40);
  for (let i = 0; i < points.length; i += 3) assert.ok(points[i + 1] >= -1e-9, "filtered point leaked through");
});

test("golden spiral grows by φ every quarter turn and fits a log law", () => {
  const spiral = goldenSpiral(1, 2, 400);
  const quarter = 50; // 400 samples over 2 turns ⇒ 50 per quarter turn
  for (let i = 0; i + quarter < spiral.length; i += quarter) {
    const r0 = Math.hypot(spiral[i].x, spiral[i].y);
    const r1 = Math.hypot(spiral[i + quarter].x, spiral[i + quarter].y);
    const ratio = r1 / r0;
    assert.ok(Math.abs(ratio - PHI) < 0.01, `quarter-turn growth ${ratio} should be φ`);
  }
  const fit = spiralFit(spiral);
  assert.ok(fit.r2 > 0.999, `log-radius fit r² ${fit.r2}`);
  assert.ok(arcLength(spiral) > 1);
});

test("archimedean and golden spirals are distinguishable by their fit", () => {
  const arch = archimedeanSpiral(1, 3, 300);
  const gold = goldenSpiral(1, 3, 300);
  const archFit = spiralFit(arch), goldFit = spiralFit(gold);
  assert.ok(goldFit.r2 > archFit.r2, "a log spiral must fit the log-radius law better than an archimedean one");
});

test("conical curl tapers toward the tip (a ringlet, not a telephone cord)", () => {
  const curl = conicalCurl({
    origin: [0, 0, 0], axis: [0, -1, 0], e1: [1, 0, 0], e2: [0, 0, 1],
    length: 0.22, radius0: 0.01, turns: 5.5, samples: 220, taper: 1,
  });
  const rootR = Math.hypot(curl[20].x, curl[20].z);
  const tipR = Math.hypot(curl[215].x, curl[215].z);
  assert.ok(tipR < rootR * 0.75, `tip ${tipR} should be tighter than root ${rootR}`);
  const flat = conicalCurl({
    origin: [0, 0, 0], axis: [0, -1, 0], e1: [1, 0, 0], e2: [0, 0, 1],
    length: 0.22, radius0: 0.01, turns: 5.5, samples: 220, taper: 0,
  });
  const flatRoot = Math.hypot(flat[20].x, flat[20].z);
  const flatTip = Math.hypot(flat[215].x, flat[215].z);
  assert.ok(Math.abs(flatTip - flatRoot) / flatRoot < 0.05, "taper 0 must keep a constant radius");
});

test("symmetry metrics detect n-fold and bilateral structure", () => {
  const p = { x: 0.3, y: 0.1, z: 0 };
  const six = radialSymmetry(p, 6);
  assert.ok(symmetryError(six, 6) < 1e-9);
  assert.ok(symmetryError(six, 5) > 0.05);
  const mirrored = bilateralSymmetry([{ x: 0.2, y: 0, z: 0.1 }, { x: 0.05, y: 0.1, z: 0.2 }]);
  assert.ok(bilateralError(mirrored) < 1e-9);
});

test("recursive construction is self-similar at 1/φ per level", () => {
  const segs = recursiveBranches({ origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 }, length: 1, depth: 3, children: 2 });
  assert.equal(segs.length, 7); // 1 + 2 + 4
  const level1 = segs.filter((s) => s.depth === 1);
  const level2 = segs.filter((s) => s.depth === 2);
  assert.ok(Math.abs(level1[0].length * PHI_INV - level2[0].length) < 1e-12);
  assert.ok(Math.abs(level1[0].length - 1 / PHI) < 1e-12);
});

test("proportion analysis finds φ where it is measured and refuses it where it is not", () => {
  const golden = analyseProportions({ total: 1.7, part: 1.7 / PHI, rest: 1.7 / (PHI * PHI) });
  assert.ok(golden.supported.length >= 1);
  const tight = golden.supported[0];
  assert.equal(tight.power, 1);
  assert.ok(tight.relativeError < 1e-12);

  const human = analyseProportions({ height: 1.7, waist: 0.7, hip: 0.95, bust: 0.9 });
  const bustWaist = human.matches.find((m) => (m.a === "bust" && m.b === "waist") || (m.a === "waist" && m.b === "bust"));
  assert.ok(bustWaist);
  // 0.9/0.7 = 1.286 — not a φ power, and the analysis must say so.
  assert.equal(bustWaist!.withinTolerance, false);

  const increments = analyseIncrements([0, 0.1, 0.1 + 0.1 / PHI, 0.1 + 0.1 / PHI + 0.1 / (PHI * PHI)]);
  assert.equal(increments.golden, true);
});

test("golden section and framing nodes are the canonical shares", () => {
  assert.ok(Math.abs(goldenSection(0, 1) - 0.3819660112501051) < 1e-12);
  const node = goldenFrameNode();
  assert.ok(Math.abs(node.x - PHI_INV * PHI_INV) < 1e-15);
  const part = goldenPartition(0.62);
  assert.ok(Math.abs(part.smallShare + part.largeShare - 1) < 1e-12);
});

test("constraint selection adopts golden geometry only when measured and useful", () => {
  // Unevenly spaced roots justify an even-area redistribution.
  const uneven = [{ x: 0, y: 0, z: 0 }, { x: 0.01, y: 0, z: 0 }, { x: 0.5, y: 0, z: 0 }, { x: 0.52, y: 0, z: 0 }];
  const unevenSet = selectConstraints({ signature: geometricSignature(uneven) });
  assert.equal(unevenSet.find((c) => c.id === "roots.even-area")!.accepted, true);

  const even = selectConstraints({ signature: geometricSignature(vogel(400, { radius: 1 })) });
  assert.equal(even.find((c) => c.id === "roots.even-area")!.accepted, false);

  // A Fibonacci count that would change the amount of hair is rejected.
  const rebalanced = selectConstraints({ count: 1600, fibonacciCount: 1597 });
  assert.equal(rebalanced.find((c) => c.id === "count.fibonacci")!.accepted, true);
  const tooFar = selectConstraints({ count: 1350, fibonacciCount: 1597 });
  assert.equal(tooFar.find((c) => c.id === "count.fibonacci")!.accepted, false);

  assert.ok(acceptedConstraints(rebalanced).length >= 1);
  assert.ok(acceptedConstraints(tooFar).every((c) => c.id !== "count.fibonacci"));
});

test("signature of a phyllotactic disc is measurably different from a random cloud", () => {
  const phyllo = geometricSignature(vogel(600, { radius: 1 }));
  let seed = 7;
  const rand = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const cloud = geometricSignature(Array.from({ length: 600 }, () => ({ x: rand() * 2 - 1, y: 0, z: rand() * 2 - 1 })));
  assert.ok(phyllo.points.cv < cloud.points.cv, "phyllotaxis must be more even than a random cloud");
  assert.ok(phyllo.divergence.goldenErrorDeg < 3, `phyllotaxis divergence ${phyllo.divergence.dominantDeg}° must sit on the golden angle`);
  assert.ok(cloud.divergence.goldenErrorDeg > 30, "a random cloud must not look golden");
  // The short and long sweeps alternate, so the top bin holds ~45 % of the gaps;
  // the modal sweep is the metric that separates the two sets.
  assert.ok(phyllo.divergence.concentration > 0.4, `phyllotaxis concentration ${phyllo.divergence.concentration}`);
  assert.ok(cloud.divergence.concentration < 0.1, `cloud concentration ${cloud.divergence.concentration}`);
  assert.ok(phyllo.radial.error < 0.05, `phyllotaxis radial exponent ${phyllo.radial.exponent}`);
});
