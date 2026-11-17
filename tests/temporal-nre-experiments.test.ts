/**
 * NRE — Experiments A, B and C, executed for real.
 *
 * These tests run the actual harnesses, not fixtures of their results.
 * Experiment A cannot reconstruct without a worker, and the test asserts
 * exactly that: the plan reports BLOCKED and names the missing piece,
 * rather than producing a pipeline that looks finished.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { runExperimentB, SURFACE_IOU_THRESHOLD } from "../src/temporal/nre/experiments/b.ts";
import { runExperimentC } from "../src/temporal/nre/experiments/c.ts";
import { runBenchmark } from "../src/temporal/nre/experiments/benchmark.ts";
import { eligibleFor, planSingleImageReconstruction } from "../src/temporal/nre/index.ts";
import { createGrid } from "../src/temporal/nre/index.ts";
import { inspectGlb } from "../src/core/forge/GlbInspector.ts";

test("Experiment B: numerical → 3D → numerical is measured and passes its thresholds", async () => {
  const report = await runExperimentB();

  assert.ok(report.cases.length >= 12, `expected a broad case set, got ${report.cases.length}`);
  assert.equal(report.summary.failed, 0, `failed cases: ${report.cases.filter((c) => !c.pass).map((c) => `${c.name}: ${c.notes.join(" | ")}`).join("; ")}`);
  assert.equal(report.summary.status, "VERIFIED");
  assert.ok(report.summary.meanSurfaceIou >= SURFACE_IOU_THRESHOLD, `mean surface IoU ${report.summary.meanSurfaceIou}`);

  const cube = report.cases.find((c) => c.name === "cube-shell-16");
  assert.ok(cube);
  assert.equal(cube.recoveredCells, cube.inputCells, "an axis-aligned shell must round trip to exactly the same cells");
  assert.equal(cube.surfaceIou, 1);

  const torusCase = report.cases.find((c) => c.name === "torus-24");
  assert.ok(torusCase);
  assert.ok(torusCase.surfaceIou >= SURFACE_IOU_THRESHOLD, `torus IoU ${torusCase.surfaceIou}`);

  const dense = report.cases.find((c) => c.name === "filled-box-16");
  assert.ok(dense);
  assert.ok(dense.totalContainment < 0.999, "a solid volume must show measurable interior loss");
  assert.ok(dense.representableFraction < 1);
  assert.ok(dense.notes.some((n) => /Interior cells cannot be represented/.test(n)));

  const empty = report.cases.find((c) => c.name === "empty");
  assert.ok(empty);
  assert.equal(empty.gateAccepted, false, "an empty mesh must be rejected by the export gate");
  assert.ok(empty.gateProblems.length > 0);

  for (const c of report.cases) {
    assert.ok(c.glbBytes > 0 || c.name === "empty", `${c.name} produced no GLB`);
    assert.ok(c.timings.totalMs >= 0);
  }

  // Resolution comparison must produce real, different measurements.
  const resolutions = report.cases.filter((c) => c.name.startsWith("resolution-"));
  assert.equal(resolutions.length, 3);
  assert.ok(new Set(resolutions.map((r) => r.inputCells)).size > 1);
});

test("Experiment B validates every export through the existing GlbInspector gate", async () => {
  const report = await runExperimentB();
  for (const c of report.cases) {
    if (c.kind === "degenerate" && c.name === "empty") continue;
    assert.equal(c.gateAccepted, true, `${c.name} was rejected by the gate: ${c.gateProblems.join("; ")}`);
  }
  assert.ok(report.summary.totalGlbBytes > 0);
});

test("Experiment C: six snapshots, four kinds of change, and no evidence overwritten", async () => {
  const report = await runExperimentC();

  assert.equal(report.status, "VERIFIED", JSON.stringify({ restoration: report.restoration, accumulation: report.accumulation }, null, 1));
  assert.equal(report.snapshots.length, 6, "four observed, one accumulated, one interpolated");
  assert.deepEqual(report.snapshots.map((s) => s.state), ["observed", "observed", "observed", "observed", "accumulated", "interpolated"]);

  assert.equal(report.diffs[0].kind, "expanded", report.diffs[0].explains);
  assert.equal(report.diffs[1].kind, "improved-confidence", report.diffs[1].explains);
  assert.equal(report.diffs[2].kind, "rigid-movement", report.diffs[2].explains);

  assert.ok(report.restoration.byteIdentical, "the first snapshot must be byte-identical after five later appends");
  assert.ok(report.restoration.occupancyIdentical);
  assert.ok(report.restoration.provenanceSurvived, "provenance must survive the whole lifecycle");
  assert.ok(report.restoration.confidenceSurvived, "confidence must survive conversion");
  assert.equal(report.restoration.observationCount, 1);

  assert.ok(report.accumulation.sourceSnapshotsUnchanged, "accumulation must not rewrite its sources");
  assert.ok(Math.abs(report.accumulation.fusedConfidence - report.accumulation.expectedNoisyOr) < 1e-6);
  assert.equal(report.interpolation.state, "interpolated");
  assert.ok(report.interpolation.cells > 0);
  assert.ok(report.interpolation.iouToEither > 0);

  assert.equal(report.history.length, 6);
  assert.equal(report.history.filter((h) => h.state === "interpolated").length, 1);
  assert.equal(report.export.gateAccepted, true, "the exported accumulated geometry must pass the existing gate");
  assert.ok(report.export.triangles > 0);

  for (const snapshot of report.snapshots) {
    assert.ok(snapshot.containerBytes > 0);
    assert.match(snapshot.containerSha256, /^[0-9a-f]{64}$/);
  }
});

test("the numerical pipeline runs with the network disabled", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    throw new Error("NETWORK USED: the numerical engine must not reach the network");
  }) as typeof fetch;
  try {
    const b = await runExperimentB();
    const c = await runExperimentC();
    assert.equal(b.summary.failed, 0);
    assert.equal(c.status, "VERIFIED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Experiment A: the pipeline plan is honest about a missing worker", () => {
  const grid = createGrid({ cellSize: 0.01, resolution: [256, 256, 256] });
  const plan = planSingleImageReconstruction({
    imageSha256: "b".repeat(64),
    imageBytes: 12345,
    grid,
    cpuOnly: true,
    availableVramGb: 0,
    modelAvailable: false,
  });

  assert.equal(plan.status, "BLOCKED");
  assert.ok(plan.model, "TripoSR is commercial-eligible and CPU-capable, so it must still be selected");
  assert.equal(plan.model?.id, "triposr");
  assert.ok(plan.blockers.some((b) => /not installed/.test(b)), plan.blockers.join(" | "));
  assert.equal(plan.stages.find((s) => s.id === "image-input")?.status, "VERIFIED");
  assert.equal(plan.stages.find((s) => s.id === "image-analysis")?.status, "BLOCKED");
  assert.equal(plan.stages.find((s) => s.id === "numerical-representation")?.status, "VERIFIED");
  assert.equal(plan.stages.find((s) => s.id === "geometry-export")?.status, "VERIFIED");
  assert.ok(plan.worker, "the command an operator would run must be spelled out");

  // With a worker present the plan becomes PARTIAL, never VERIFIED, because
  // nothing has actually been reconstructed in this process.
  const ready = planSingleImageReconstruction({ imageSha256: "b".repeat(64), imageBytes: 10, grid, cpuOnly: true, availableVramGb: 0, modelAvailable: true });
  assert.equal(ready.status, "PARTIAL");
  assert.equal(ready.stages.find((s) => s.id === "spatial-reconstruction")?.status, "PARTIAL");
});

test("only commercially eligible CPU models are routed for image-to-3d", () => {
  const models = eligibleFor("image-to-3d");
  assert.ok(models.length > 0);
  assert.equal(models[0].id, "triposr", "TripoSR must be the first CPU-capable image-to-3d candidate");
  assert.ok(models.every((m) => m.costClass === "free" && m.gating === "none"));
  assert.ok(!models.some((m) => m.id === "sam3d-objects"), "access-gated, 32 GB, NVIDIA-only models must not be routed to a CPU worker");
  assert.equal(models[0].runsOnCpu, true);
});

test("benchmarks record real numbers for several geometry sizes", async () => {
  const report = await runBenchmark();
  assert.ok(report.rows.length >= 6);
  assert.equal(report.status, "VERIFIED");

  const sparse = report.rows.filter((r) => r.label.startsWith("sparse-") && !r.label.endsWith("-raw"));
  assert.ok(sparse.length >= 3, "at least three sparse sizes must be measured");
  for (const row of report.rows) {
    assert.ok(row.containerBytes > 0, `${row.label} produced an empty container`);
    assert.ok(row.serializeMs >= 0 && row.deserializeMs >= 0 && row.diffMs >= 0);
    assert.ok(row.bytesPerCell > 0);
    assert.ok(row.glbValid, `${row.label} GLB failed the gate`);
  }

  const raw = report.rows.find((r) => r.label === "sparse-20000-raw");
  const deflated = report.rows.find((r) => r.label === "sparse-20000");
  assert.ok(raw && deflated);
  assert.ok(deflated.containerBytes < raw.containerBytes, "deflate must beat raw on a random cloud");
  assert.ok(deflated.compressionRatio > raw.compressionRatio);
  assert.equal(deflated.cells, raw.cells);
});
