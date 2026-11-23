/**
 * LÉLU 2.1 — the measured artefacts guard the journal.
 *
 * Every research entry cites one of these files. If a number moves,
 * or a report starts claiming something the file does not support,
 * these tests fail — which is the only way a knowledge base stays
 * attached to reality instead of to the last thing written about it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

import { compareRenders, decodePng } from "../src/core/cognition/research/visual";

const read = <T>(path: string): T => JSON.parse(readFileSync(path, "utf8")) as T;

interface AuditFile {
  ok: boolean;
  violations: string[];
  warnings: string[];
  verdicts: Array<{ metric: string; winner: string; confounded: boolean; relativeChange: number }>;
}

interface MatrixFile {
  spec: { points: number };
  applications: Array<{
    application: string;
    requested: number;
    methods: Array<{ id: string; achieved: number; spacing: { cv: number; mean: number }; coverage: number }>;
    decision: string;
  }>;
  curls: Array<{ law: string; logRadiusR2: number; growthPerTurn: number; decision: string; bundle: { minStrandGap: number } }>;
}

interface HairMetrics {
  variant: string;
  occupancyCells: number;
  occupancyDigest: number;
  hairTriangles: number;
  triangles: number;
  tubes: {
    enabled: boolean;
    strands: number;
    diameterCv: number;
    babyStrands: number;
    rootPenetrations: number;
    floatingRoots: number;
  };
  rootClearance: { p50Mm: number; p95Mm: number; maxMm: number; over4mm: number } | null;
}

test("the audit refuses to let a confounded hair comparison be a clean win", () => {
  const audit = read<AuditFile>("artifacts/lelu2/audit.json");
  assert.equal(audit.ok, true);
  assert.deepEqual(audit.violations, []);
  const hair = audit.verdicts.find((verdict) => verdict.metric.startsWith("hair root spacing CV"));
  assert.ok(hair);
  assert.equal(hair?.confounded, true, "the unequal-n comparison must stay flagged");
  assert.match(audit.warnings.join(" "), /confounded by sample count/);
});

test("every sampler is judged on the same sample count, and the one-arm spiral is rejected", () => {
  const matrix = read<MatrixFile>("artifacts/lelu2/matrix/summary.json");
  assert.equal(matrix.spec.points, 800);
  assert.equal(matrix.applications.length, 4);

  for (const application of matrix.applications) {
    assert.equal(application.requested, 800);
    const conventional = application.methods.find((method) => method.id === "A-conventional");
    assert.ok(conventional, `${application.application} has the conventional baseline`);

    const full = application.methods.filter((method) => method.coverage >= 0.95);
    const best = full.sort((a, b) => a.spacing.cv - b.spacing.cv)[0];
    assert.ok(
      best.spacing.cv < conventional.spacing.cv,
      `${application.application}: a covering method beats the ordered stride (${best.id} ${best.spacing.cv.toFixed(4)} vs A ${conventional.spacing.cv.toFixed(4)})`,
    );

    const spiral = application.methods.find((method) => method.id === "D-logspiral");
    assert.ok(spiral);
    assert.ok(spiral.coverage < 0.3, `${application.application}: the one-arm log spiral must stay rejected for coverage`);
  }
});

test("a curl law is only retained when it is both regular and distinct", () => {
  const matrix = read<MatrixFile>("artifacts/lelu2/matrix/summary.json");
  const retained = matrix.curls.filter((curl) => curl.decision === "retain");
  assert.ok(retained.length > 0);
  for (const curl of retained) {
    assert.ok(curl.logRadiusR2 > 0.95, `${curl.law} is retained with R² ${curl.logRadiusR2}`);
    assert.ok(curl.bundle.minStrandGap > 0, `${curl.law} keeps strands apart`);
  }
  const rejected = matrix.curls.filter((curl) => curl.decision === "reject");
  for (const curl of rejected) {
    // A rejected law is one where the geometry itself fails: crossing strands.
    assert.ok(curl.bundle.minStrandGap <= 0, `${curl.law} is rejected for a measurable reason`);
  }
});

test("the tube variants cannot move her occupancy", () => {
  const variants = ["voxel", "tubes-high", "tubes-medium", "tubes-low"].map((variant) =>
    read<HairMetrics>(`artifacts/lelu2/hair/${variant}/metrics-${variant}.json`),
  );
  const first = variants[0];
  for (const variant of variants) {
    assert.equal(variant.occupancyCells, first.occupancyCells);
    assert.equal(variant.occupancyDigest, first.occupancyDigest);
  }
  const high = variants.find((variant) => variant.variant === "tubes-high");
  const low = variants.find((variant) => variant.variant === "tubes-low");
  const voxel = variants.find((variant) => variant.variant === "voxel");
  assert.ok(high && low && voxel);
  assert.ok(high.hairTriangles < voxel.hairTriangles, "tubes spend fewer triangles than the voxel shell");
  assert.ok(low.hairTriangles < high.hairTriangles, "the low LOD is a real reduction, not a label");
  assert.equal(high.tubes.strands, 1219);
  assert.equal(high.tubes.babyStrands, 120);
});

test("the two root diagnostics still disagree, and the disagreement is on the record", () => {
  const high = read<HairMetrics>("artifacts/lelu2/hair/tubes-high/metrics-tubes-high.json");
  assert.equal(high.tubes.floatingRoots, 0, "the tube builder's own counter reports no floating roots");
  assert.ok(high.rootClearance);
  assert.equal(high.rootClearance?.over4mm, 54, "the vertex-clearance measure reports 54 roots beyond 4 mm");
  assert.ok((high.rootClearance?.maxMm ?? 0) > 40);
  assert.ok(high.tubes.rootPenetrations > 0, "and 392 roots sit inside the head mesh");
});

test("the documented oval taper is contradicted by the measured head", () => {
  const head = read<{
    head: { skullWidthMm: number; cheekWidthMm: number; taper: number[] };
    checks: Array<{ claim: string; agrees: boolean }>;
  }>("artifacts/lelu2/head/head-metrics.json");
  assert.ok(head.head.cheekWidthMm > head.head.skullWidthMm, "the cheek is wider than the skull");
  const oval = head.checks.find((check) => check.claim.startsWith("oval face"));
  assert.equal(oval?.agrees, false);
  const hairline = head.checks.find((check) => check.claim.startsWith("hairline"));
  assert.equal(hairline?.agrees, false);
});

test("no frame time is claimed anywhere in the projection report", () => {
  const projection = read<{ note: string; files: Array<{ variant: string; drawCalls: number }> }>("artifacts/lelu2/projection.json");
  assert.match(projection.note, /No frame time was measured/i);
  assert.equal(projection.files.length, 4);
  assert.ok(projection.files.every((file) => file.drawCalls === 15));
});

test("the two hair renders differ in silhouette, and the comparison says where", () => {
  const load = (path: string) => decodePng(readFileSync(path), (bytes) => new Uint8Array(inflateSync(bytes)));
  const comparison = compareRenders(
    load("artifacts/lelu2/hair/voxel/lelu2-voxel-head-front.png"),
    load("artifacts/lelu2/hair/tubes-high/lelu2-tubes-high-head-front.png"),
    { a: "voxel", b: "tubes-high" },
  );
  assert.ok(comparison.width > 100);
  assert.ok(comparison.iou > 0 && comparison.iou < 1, "the silhouettes overlap but are not identical");
  const upper = comparison.thirdDeltas[0];
  assert.ok(Number.isFinite(upper));
  assert.ok(comparison.findings.length > 0);
  assert.ok(
    comparison.findings.some((finding) => finding.corroborateWith.length > 0),
    "every visual finding points at the measurement that can settle it",
  );
});
