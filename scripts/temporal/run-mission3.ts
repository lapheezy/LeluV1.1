/**
 * ==========================================================
 * TEMPORAL STUDIO — MISSION 3 EXPERIMENT RUNNER
 *
 * Runs Experiments A (plan only), B and C plus the performance
 * benchmark, and writes the raw results to artifacts/mission3/ as JSON.
 * The Markdown reports quote these files; nothing in them is typed by
 * hand.
 *
 *   npx tsx scripts/temporal/run-mission3.ts
 * ==========================================================
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { runExperimentB } from "../../src/temporal/nre/experiments/b.ts";
import { runExperimentC } from "../../src/temporal/nre/experiments/c.ts";
import { runBenchmark } from "../../src/temporal/nre/experiments/benchmark.ts";
import { planSingleImageReconstruction } from "../../src/temporal/nre/pipeline.ts";
import { createGrid } from "../../src/temporal/nre/voxels.ts";

const outDir = path.join(process.cwd(), "artifacts", "mission3");
mkdirSync(outDir, { recursive: true });

const write = (name: string, value: unknown) => {
  writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 1)}\n`);
  console.log(`wrote artifacts/mission3/${name}`);
};

const b = await runExperimentB();
write("experiment_b.json", b);

const c = await runExperimentC();
write("experiment_c.json", c);

const bench = await runBenchmark();
write("benchmark.json", bench);

const a = planSingleImageReconstruction({
  imageSha256: "",
  imageBytes: null,
  grid: createGrid({ cellSize: 0.01, resolution: [256, 256, 256] }),
  cpuOnly: true,
  availableVramGb: 0,
  modelAvailable: false,
});
write("experiment_a_plan.json", a);

console.log("\n=== EXPERIMENT B ===");
console.log("case                     kind      in   bnd  out  sIoU   sCont  tCont  gate  pass");
for (const row of b.cases) {
  console.log(
    [
      row.name.padEnd(24),
      row.kind.padEnd(9),
      String(row.inputCells).padStart(4),
      String(row.boundaryCells).padStart(4),
      String(row.recoveredCells).padStart(4),
      row.surfaceIou.toFixed(4).padStart(6),
      row.surfaceContainment.toFixed(4).padStart(6),
      row.totalContainment.toFixed(4).padStart(6),
      (row.gateAccepted ? "ok" : "rej").padStart(5),
      row.pass ? "yes" : "NO",
    ].join(" "),
  );
}
console.log(`B summary: ${b.summary.passed}/${b.summary.cases} passed, mean surface IoU ${b.summary.meanSurfaceIou.toFixed(4)}`);

console.log("\n=== EXPERIMENT C ===");
console.log("ord state         cells  conf   bytes  id");
for (const s of c.snapshots) {
  console.log([String(s.ordinal).padStart(3), s.state.padEnd(13), String(s.cells).padStart(5), s.confidence.toFixed(3).padStart(6), String(s.containerBytes).padStart(6), s.id].join(" "));
}
for (const d of c.diffs) console.log(`  diff ${d.kind.padEnd(20)} iou=${d.iou.toFixed(4)} +${d.onlyLater}/-${d.onlyOnlyEarlier} Δc=${d.confidenceDelta.toFixed(3)}`);
console.log(`C status: ${c.status}; first snapshot byte-identical after 5 appends: ${c.restoration.byteIdentical}`);

console.log("\n=== BENCHMARK ===");
console.log("label                cells  codec        rawB     contB  ratio  serMs  desMs  diffMs");
for (const row of bench.rows) {
  console.log(
    [
      row.label.padEnd(20),
      String(row.cells).padStart(5),
      row.codec.padEnd(11),
      String(row.payloadRawBytes).padStart(7),
      String(row.containerBytes).padStart(7),
      row.compressionRatio.toFixed(2).padStart(6),
      row.serializeMs.toFixed(1).padStart(6),
      row.deserializeMs.toFixed(2).padStart(6),
      row.diffMs.toFixed(1).padStart(7),
    ].join(" "),
  );
}

console.log("\n=== EXPERIMENT A ===");
console.log(`status: ${a.status}; model: ${a.model?.id ?? "none"}`);
for (const blocker of a.blockers) console.log(`  blocker: ${blocker}`);
