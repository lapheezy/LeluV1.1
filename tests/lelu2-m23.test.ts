/**
 * ==========================================================
 * LÉLU 2.3 — GUARDS FOR THE YOUTH PASS, THE BABY-HAIR SYSTEM AND
 * CONVERSATIONAL EVIDENCE
 *
 * These are not coverage tests. Each one pins a rule the mission depends on:
 *
 *   the youth pass SHORTENS the lower face and ROUNDS the jaw (it is a shape
 *   change, not a label), it moves the FRONT of the head and not the back, a
 *   baby hair is a complete record with a measured path, a malformed evidence
 *   block cannot blank a conversation, and a comparison is two labelled states
 *   with the measured change between them.
 * ==========================================================
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_YOUTH, youthWarp, youthLift, youthGap, REFERENCE_FACE, type YouthLandmarks } from "../src/core/asre/character/youth.ts";
import { curvatureOf, growBabyHair, pathLength, projectToSkin, babyHairOverlaySvg, describeStrand, type SurfaceProbe, type Vec3 } from "../src/core/asre/hair/baby.ts";
import { evidenceFromEntry, evidenceToMarkdown, parseEvidence, publicEvidencePath, evidenceFence, normaliseBlock } from "../src/core/cognition/research/evidence.ts";
import type { ResearchEntry } from "../src/core/cognition/research/types.ts";

/* ------------------------------- youth pass ------------------------------ */

const lm: YouthLandmarks = { eyeY: 1.6, chinY: 1.5, mouthY: 1.55, mouthX: 0, cheekX: 0.046, faceZ: 0.13 };

/** A sphere of radius r around a point: an SDF whose surface is easy to read. */
const ball = (c: Vec3, r: number) => (x: number, y: number, z: number) => Math.hypot(x - c[0], y - c[1], z - c[2]) - r;
type Field = (x: number, y: number, z: number) => number;

/** Where the field first turns solid marching +z (the FRONT surface at x, y). */
function frontSurface(field: Field, y: number, x = 0): number {
  for (let z = 0.2; z > 0.0; z -= 0.0001) if (field(x, y, z) < 0) return z;
  return NaN;
}

/** Where it first turns solid marching −z (the BACK surface at x, y). */
function backSurface(field: Field, y: number, x = 0): number {
  for (let z = -0.2; z < 0.0; z += 0.0001) if (field(x, y, z) < 0) return z;
  return NaN;
}

/** Where it first turns solid marching +y (the BOTTOM surface at x, z). */
function bottomSurface(field: Field, z: number, x = 0): number {
  for (let y = lm.chinY - 0.05; y < lm.eyeY; y += 0.0001) if (field(x, y, z) < 0) return y;
  return NaN;
}

describe("LÉLU 2.3 — youth pass", () => {
  it("lifts the chin: the lower face is shorter after the warp", () => {
    // The lift is zero at the eye line and full at the chin, and the surface at
    // chin height rises by exactly that.
    assert.equal(youthLift(lm.eyeY, lm), 0);
    const full = youthLift(lm.chinY, lm);
    assert.ok(Math.abs(full - (lm.eyeY - lm.chinY) * DEFAULT_YOUTH.lowerFaceCompression) < 1e-9);

    const chin = ball([0, lm.chinY + 0.012, 0.09], 0.012);
    const warped = youthWarp(chin, lm, { ...DEFAULT_YOUTH, lipFullnessMm: 0, chinRoundnessMm: 0, cheekFullnessMm: 0 });
    const before = bottomSurface(chin, 0.09);
    const after = bottomSurface(warped, 0.09);
    assert.ok(after > before + 0.004, `chin lifted ${((after - before) * 1000).toFixed(1)} mm`);
  });

  it("keeps the eye line fixed: nothing at or above it moves", () => {
    const brow = ball([0, lm.eyeY + 0.02, 0.1], 0.02);
    const warped = youthWarp(brow, lm);
    const delta = frontSurface(warped, lm.eyeY + 0.02) - frontSurface(brow, lm.eyeY + 0.02);
    assert.ok(Math.abs(delta) < 0.0004, `eye-line surface moved ${(delta * 1000).toFixed(2)} mm`);
  });

  it("adds forward volume at the cheekbones and leaves the back of the head alone", () => {
    // The cheek pad is centred at the cheekbone, 34 % of the way from the eye
    // line down to the chin — sampling anywhere else measures a faded edge.
    const cheekY = lm.eyeY - (lm.eyeY - lm.chinY) * 0.34;
    // Sample AT the cheekbone, not on the midline: the pad is lateral (centred on
    // lm.cheekX · 0.8 after M23.1's stronger jaw pinch), so a midline sample
    // measures the faded edge of the pad and of the jaw narrowing at once.
    const cheekX = lm.cheekX * 0.8;
    const cheekBall = ball([cheekX, cheekY, 0.06], 0.06);
    const warpedCheek = youthWarp(cheekBall, lm);
    const before = frontSurface(cheekBall, cheekY, cheekX);
    const after = frontSurface(warpedCheek, cheekY, cheekX);
    // The nominal pad is 2.4 mm; the front gate trims it at the cheek's own depth,
    // so the guard is direction and locality, and the magnitude it reports.
    assert.ok(after > before + 0.0003, `cheek pushed forward ${((after - before) * 1000).toFixed(2)} mm`);

    const backBall = ball([0, lm.eyeY - 0.03, -0.1], 0.02);
    const backDelta = backSurface(youthWarp(backBall, lm), lm.eyeY - 0.03) - backSurface(backBall, lm.eyeY - 0.03);
    assert.ok(Math.abs(backDelta) < 0.0005, `back of head moved ${(backDelta * 1000).toFixed(2)} mm`);
  });

  it("reports the gap to the reference ratios instead of assuming it is closed", () => {
    const gap = youthGap({ head: { jawToCheek: 0.8, chinToJaw: 0.45, cheekShareOfHead: 0.18 }, eyes: { spacingToHeadWidth: 0.36 } });
    assert.ok(gap.some((g) => g.ratio === "chin / jaw"));
    assert.equal(gap.find((g) => g.ratio === "chin / jaw")!.gap, 0);
    assert.equal(REFERENCE_FACE.chinToJaw, 0.45);
    const off = youthGap({ head: { jawToCheek: 0.825, chinToJaw: 0.485, cheekShareOfHead: 0.188 }, eyes: { spacingToHeadWidth: 0.36 } });
    assert.ok(off.find((g) => g.ratio === "chin / jaw")!.gap > 0.03);
  });
});

/* ------------------------------- baby hair ------------------------------- */

/** A head as a sphere: signed distance and an outward unit gradient. */
function sphereProbe(centre: Vec3, radius: number): SurfaceProbe {
  const d = (p: Vec3) => Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z) - radius;
  return {
    distance: d,
    gradient: (p) => {
      const l = Math.hypot(p.x - centre.x, p.y - centre.y, p.z - centre.z) || 1;
      return { x: (p.x - centre.x) / l, y: (p.y - centre.y) / l, z: (p.z - centre.z) / l };
    },
  };
}

const head = { x: 0, y: 1.6, z: 0 };
const R = 0.075;
const probe = sphereProbe(head, R);

/** Roots on the front of the sphere from the brow upwards — a scalp. */
function scalpRoots(): Float32Array {
  const out: number[] = [];
  for (let i = 0; i < 900; i++) {
    // The scalp starts 25 mm above the brow line and runs up over the crown.
    const elev = 0.35 + (i / 900) * 0.8;
    const az = -1.4 + (((i * 37) % 900) / 900) * 2.8;
    const r = R + 0.0002;
    out.push(head.x + Math.sin(az) * Math.cos(elev) * r, head.y + Math.sin(elev) * r, head.z + Math.cos(az) * Math.cos(elev) * r);
  }
  return Float32Array.from(out);
}

const babyLm = {
  centre: head,
  hairlineFrontY: head.y + R * Math.sin(0.35),
  hairlineY: head.y,
  browY: head.y + 0.005,
  eyes: [
    { x: -0.031, y: head.y + 0.008, z: head.z + 0.068 },
    { x: 0.031, y: head.y + 0.008, z: head.z + 0.068 },
  ] as [Vec3, Vec3],
  temples: [
    { x: -0.065, y: head.y + 0.02, z: head.z + 0.03 },
    { x: 0.065, y: head.y + 0.02, z: head.z + 0.03 },
  ] as [Vec3, Vec3],
  faceSpan: 0.062,
};

const report = growBabyHair({ roots: scalpRoots(), landmarks: babyLm, probe });

describe("LÉLU 2.3 — baby hair", () => {
  it("grows strands, each a complete record", () => {
    assert.ok(report.count > 10, `only ${report.count} strands`);
    for (const s of report.strands) {
      assert.ok(s.id.length > 3);
      assert.ok(s.controlPoints.length > 2);
      assert.ok(s.lengthMm > 0.5);
      assert.ok(s.rootThicknessMm > 0);
      assert.ok(s.tipThicknessMm < s.rootThicknessMm);
      assert.ok(s.curvaturePerM >= 0);
      assert.ok(Math.abs(Math.hypot(s.growth.x, s.growth.y, s.growth.z) - 1) < 1e-6);
      assert.ok(s.landmarks.eyeMm > 0);
      assert.ok(["front", "side", "occluded"].includes(s.visibility));
      assert.ok(["clear", "contact", "penetrating"].includes(s.collision));
      assert.ok(Number.isFinite(s.minSkinGapMm));
    }
  });

  it("lies on the skin: no strand cuts into it", () => {
    for (const s of report.strands) {
      assert.ok(s.minSkinGapMm > -0.2, `${s.id} sits ${s.minSkinGapMm.toFixed(2)} mm under the skin`);
      assert.ok(s.maxSkinGapMm < 2, `${s.id} floats ${s.maxSkinGapMm.toFixed(2)} mm off the skin`);
    }
    assert.equal(report.collision.penetrating, 0);
  });

  it("is deterministic: the same head draws the same strands", () => {
    const again = growBabyHair({ roots: scalpRoots(), landmarks: babyLm, probe });
    assert.equal(again.count, report.count);
    assert.deepEqual(
      again.strands.map((s) => `${s.id}:${s.lengthMm.toFixed(3)}`),
      report.strands.map((s) => `${s.id}:${s.lengthMm.toFixed(3)}`),
    );
  });

  it("measures the hairline it was placed against", () => {
    assert.ok(report.hairlineFrontY > babyLm.browY);
    // The hairline is an ARC (36 mm higher at the centre than at the temples), so
    // the median root sits BELOW the centre-line hairline by construction — a
    // "median above the hairline ≥ 0" assertion only held for the flat band.
    assert.ok(report.hairline.rootAboveHairlineMm.median > -37, "roots follow the arc, not a flat band");
    assert.ok(report.hairline.coveragePct > 0);
    assert.ok(report.available.front + report.available.temples + report.available.sideburns > 0);
  });

  it("draws every strand in the overlay", () => {
    const svg = babyHairOverlaySvg(report, { showFlyaways: true });
    const paths = (svg.match(/<path /g) ?? []).length;
    assert.equal(paths, report.count);
    assert.ok(svg.includes("Baby hair placement"));
  });

  it("describes a strand with its coordinates, thickness and landmarks", () => {
    const text = describeStrand(report.strands[0]);
    for (const needle of ["root", "mm", "curvature", "hairline"]) assert.ok(text.includes(needle), `missing "${needle}"`);
  });

  it("measures geometry instead of assuming it: length, curvature, projection", () => {
    assert.ok(Math.abs(pathLength([{ x: 0, y: 0, z: 0 }, { x: 0, y: 0.01, z: 0 }]) - 0.01) < 1e-9);
    assert.equal(curvatureOf({ x: 0, y: 0, z: 0 }, { x: 0, y: 0.01, z: 0 }, { x: 0, y: 0.02, z: 0 }), 0);
    // A 10 mm circle through three points has curvature 1/0.01 = 100 1/m.
    const curvature = curvatureOf({ x: 0, y: 0, z: 0 }, { x: 0.01, y: 0.01, z: 0 }, { x: 0, y: 0.02, z: 0 });
    assert.ok(Math.abs(curvature - 100) < 1, `curvature ${curvature.toFixed(1)} 1/m`);
    // A path point starts ~0.5 mm proud of the skin, which is what the growth
    // walk hands the projector.
    const projected = projectToSkin(probe, { x: 0, y: head.y, z: R + 0.0005 }, 0.0006);
    assert.ok(Math.abs(probe.distance(projected.point) - 0.0006) < 0.0002);
    assert.ok(projected.converged);
  });
});

/* --------------------------- conversational evidence -------------------------- */

const entry: ResearchEntry = {
  id: "R-20261118-m23-test",
  kind: "experiments",
  createdAt: 1,
  updatedAt: 1,
  mission: "LÉLU 2.3",
  workPackage: "WP05",
  observed: "a head",
  studied: "geometry",
  question: "does the youth pass shorten the lower face?",
  hypothesis: "yes",
  method: "measure",
  results: "yes",
  evidence: [
    { kind: "render", ref: "artifacts/lelu2/m23/youth/face-front.png", commit: "abc1234def", note: "youth build" },
    { kind: "render", ref: "artifacts/lelu2/m23/baseline/face-front.png", commit: "abc1234def", note: "baseline" },
    { kind: "measurement", ref: "1.560 m", note: "chin height, youth" },
  ],
  learned: "the chin lifts",
  confidence: 0.7,
  limitations: [],
  applications: [],
  nextQuestions: [],
  status: "verified",
  tags: [],
  commit: "abc1234def",
  session: null,
  assumptions: [],
  refutations: [],
  supersedes: [],
  supersededBy: [],
  answers: [],
  verifiedAt: 2,
};

describe("LÉLU 2.3 — evidence in the conversation", () => {
  it("round-trips a fenced evidence block", () => {
    const blocks = [
      { kind: "image" as const, src: "/lelu2-evidence/a.png", alt: "render", caption: "her head", commit: "abc1234def" },
      { kind: "measure" as const, title: "head", rows: [{ label: "jaw / cheek", value: 0.79, delta: "-0.035" }] },
    ];
    assert.equal(parseEvidence(JSON.stringify(blocks)).length, 2);
    assert.ok(evidenceFence(blocks).startsWith("```evidence"));
  });

  it("refuses a malformed block instead of rendering a broken one", () => {
    assert.deepEqual(parseEvidence("not json"), []);
    assert.equal(normaliseBlock({ kind: "compare", before: { src: "a" } }), null);
    assert.equal(normaliseBlock({ kind: "unknown" }), null);
    assert.deepEqual(parseEvidence(JSON.stringify([{ kind: "image", src: "", alt: "x" }])), []);
  });

  it("renders a comparison with both states labelled, never inferred from order", () => {
    const markdown = evidenceToMarkdown([
      {
        kind: "compare",
        title: "head, baseline → youth",
        before: { src: "before.png", alt: "baseline", caption: "baseline" },
        after: { src: "after.png", alt: "youth", caption: "youth" },
        measurements: [{ label: "chin / jaw", value: 0.44, delta: "-0.045" }],
      },
    ]);
    assert.ok(markdown.includes("| before | after |"));
    assert.ok(markdown.includes("baseline"));
    assert.ok(markdown.includes("youth"));
    assert.ok(markdown.includes("chin / jaw"));
  });

  it("builds chat blocks from a journal entry's own evidence and commit", () => {
    const blocks = evidenceFromEntry(entry);
    assert.equal(blocks[0].kind, "group");
    const commit = blocks.find((b) => b.kind === "commit");
    assert.ok(commit && commit.kind === "commit" && commit.sha === "abc1234def");
    const measures = blocks.find((b) => b.kind === "measure");
    assert.ok(measures && measures.kind === "measure" && measures.rows.length === 1);
  });

  it("maps an artifact path to a path a browser can actually load", () => {
    assert.equal(publicEvidencePath("artifacts/lelu2/m23/youth/face-front.png"), "/lelu2-evidence/artifacts__lelu2__m23__youth__face-front.png");
  });
});
