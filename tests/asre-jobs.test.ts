/**
 * Mission 5 WP01 — ASRE as a native service: typed jobs with a traceable
 * lifecycle, cancellation, restart recovery, failure reporting, competing
 * hypotheses, multi-view refinement and evidence classes. Everything here
 * runs the real TS engine on CPU; the Python runtime is replaced by a
 * stand-in only where a test needs to control it (hang, cancel).
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { monitorEventLoopDelay } from "node:perf_hooks";

import { AsreJobManager, pngBytes, zlib, type AsreRuntime } from "../plugins/asreJobs";
import { decodePng, encodePng } from "../src/core/asre/image/png";
import { compareHypotheses, evidenceBreakdown, reconstructFromViews } from "../src/core/asre/reconstruct/pipeline";
import { evidenceClass, describeEvidence } from "../src/core/asre/contracts";
import { iou, Provenance, SparseVoxelGrid } from "../src/core/asre/nre";
import { gridSpecFor, project, type ViewName } from "../src/core/asre/reconstruct/silhouette";
import { inspectGlb } from "../src/core/forge/GlbInspector";

/** Ground truth: an axis-aligned box standing on y=0, n-cell lattice. W×H×D in cells. */
function boxTruth(n: number, w: number, h: number, d: number): SparseVoxelGrid {
  const g = new SparseVoxelGrid(gridSpecFor({ n, heightMeters: 1 }));
  const o = g.addObservation({ id: "truth", capturedAt: 0, source: "truth", modality: "procedural", provenance: "OBSERVED", confidence: 1, parameters: {}, fingerprint: "truth", lineage: [] }).index;
  const x0 = Math.round((n - w) / 2), z0 = Math.round((n - d) / 2);
  for (let x = x0; x < x0 + w; x++) for (let y = 0; y < h; y++) for (let z = z0; z < z0 + d; z++) g.addEvidence(x, y, z, o);
  return g;
}

/** Orthographic silhouette PNG of a truth grid seen from a view (object pixels red-ish on white). */
function render(truth: SparseVoxelGrid, n: number, view: ViewName, px = 4): Uint8Array {
  const mask = new Uint8Array(n * n);
  for (const [x, y, z] of truth.coords()) {
    const p = project(view, n, x, y, z);
    mask[p.v * n + p.u] = 1;
  }
  const W = n * px + 16, H = n * px + 16;
  return pngBytes(W, H, (x, y) => {
    const u = Math.floor((x - 8) / px), v = n - 1 - Math.floor((y - 8) / px);
    return u >= 0 && v >= 0 && u < n && v < n && mask[v * n + u] ? [200, 60, 50, 255] : [255, 255, 255, 255];
  });
}

const fakeRuntime = (over: Partial<AsreRuntime> = {}): AsreRuntime => ({
  available: async () => ({ triposr: false, blender: false }),
  runWorker: async () => {
    throw new Error("no python here");
  },
  ingest: async () => ({}),
  triposrHypotheses: async () => ({}),
  render: async () => null,
  ...over,
});

const tmp = () => mkdtempSync(path.join(tmpdir(), "asre-jobs-"));

test("PNG: encode → decode is lossless; a real example image decodes", () => {
  const img = { width: 7, height: 5, data: new Uint8Array(7 * 5 * 4).map((_, i) => (i * 37) % 256) };
  const back = decodePng(encodePng(img, zlib), zlib);
  assert.equal(back.width, 7);
  assert.deepEqual([...back.data], [...img.data]);
  const example = "/opt/lelu-tools/TripoSR/examples/chair.png";
  if (existsSync(example)) {
    const chair = decodePng(new Uint8Array(readFileSync(example)), zlib);
    assert.ok(chair.width > 100 && chair.height > 100);
  }
  assert.throws(() => decodePng(new Uint8Array([1, 2, 3]), zlib), /not a PNG/);
});

test("evidence classes: strongest class wins, SYNTHESIZED is reported as GENERATED, nothing is UNKNOWN", () => {
  assert.equal(evidenceClass(Provenance.SYNTHESIZED | Provenance.OBSERVED), "OBSERVED");
  assert.equal(evidenceClass(Provenance.SYNTHESIZED), "GENERATED");
  assert.equal(evidenceClass(Provenance.INTERPOLATED), "INTERPOLATED");
  assert.equal(evidenceClass(0), "UNKNOWN");
  const text = describeEvidence({ OBSERVED: 10, INFERRED: 30, GENERATED: 60, INTERPOLATED: 0, UNKNOWN: 0 });
  assert.match(text, /10% .* OBSERVED/);
  assert.match(text, /60% is GENERATED/);
});

test("one view → three competing hypotheses; the medoid is selected; unseen far half is GENERATED, not observed", () => {
  const n = 48;
  const truth = boxTruth(n, 24, 40, 12);
  const front = decodePng(render(truth, n, "front"), zlib);
  const r = reconstructFromViews([{ view: "front", image: front, evidence: { view: "front", imageSha256: "f", source: "t", capturedAt: 0 } }], { n, heightMeters: 1 });
  assert.deepEqual(Object.keys(r.hypotheses).sort(), ["ellipse", "inflation", "slab"]);
  assert.equal(Object.keys(r.comparison.pairwiseIou).length, 3);
  const best = r.comparison.ranking[0];
  for (const id of r.comparison.ids) assert.ok(r.comparison.agreement[best] >= r.comparison.agreement[id]);
  const b = evidenceBreakdown(r.book.current);
  assert.ok(b.OBSERVED > 0 && b.INFERRED > 0 && b.GENERATED > 0);
  assert.equal(b.UNKNOWN, 0);
  // every OBSERVED cell is the nearest occupied cell of its column, as seen from the front (+Z)
  const g = r.book.current;
  for (const [x, y, z] of g.coords()) {
    if (evidenceClass(g.get(x, y, z)!.provenance) !== "OBSERVED") continue;
    for (let k = z + 1; k < n; k++) assert.equal(g.has(x, y, k), false, `observed cell ${x},${y},${z} is hidden behind ${k}`);
  }
  // hypotheses really differ
  assert.ok(r.comparison.disagreementFraction > 0);
  assert.equal(compareHypotheses({ a: truth, b: truth.clone() }).pairwiseIou["a|b"], 1);
});

test("a second view improves geometry where it has evidence, preserves the rest, and keeps conflicts traceable", () => {
  const n = 48;
  const truth = boxTruth(n, 24, 40, 30); // deeper than any front-only prior guesses
  const ev = (view: ViewName) => ({ view, imageSha256: view, source: `t:${view}`, capturedAt: 0 });
  const front = { view: "front" as const, image: decodePng(render(truth, n, "front"), zlib), evidence: ev("front") };
  const right = { view: "right" as const, image: decodePng(render(truth, n, "right"), zlib), evidence: ev("right") };
  const one = reconstructFromViews([front], { n, heightMeters: 1 });
  const before = iou(one.book.current, truth);
  const two = reconstructFromViews([front, right], { n, heightMeters: 1 });
  const after = iou(two.book.current, truth);
  const rep = two.observations[0];
  assert.ok(after > before + 0.1, `IoU with truth must improve: ${before.toFixed(3)} → ${after.toFixed(3)}`);
  assert.ok(rep.newCells > 0, "the side view adds depth the prior lacked");
  assert.ok(rep.evidenceAfter.OBSERVED > rep.evidenceBefore.OBSERVED, "more of the object is now observed");
  assert.equal(rep.unaffectedVerified, true, "cells outside the touched blocks are untouched");
  assert.ok(rep.meanConfidenceAfter !== rep.meanConfidenceBefore);
  assert.ok(two.book.store.list().length >= 2, "each page is a snapshot");
  // interior cells are never claimed as observed
  const g = two.book.current;
  let interiorObserved = 0;
  for (const [x, y, z] of g.coords()) {
    const inner = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]].every(([dx, dy, dz]) => g.has(x + dx, y + dy, z + dz));
    if (inner && evidenceClass(g.get(x, y, z)!.provenance) === "OBSERVED") interiorObserved++;
  }
  assert.equal(interiorObserved, 0, "no fully enclosed cell may be OBSERVED");

  // a contradicting view (a narrower object) carves weak cells and records the conflicts
  const narrow = boxTruth(n, 24, 40, 8);
  const wrongSide = { view: "left" as const, image: decodePng(render(narrow, n, "left"), zlib), evidence: ev("left") };
  const three = reconstructFromViews([front, right, wrongSide], { n, heightMeters: 1 });
  const c = three.observations[1];
  assert.ok(c.conflicts > 0, "the contradicting view conflicts with the state");
  assert.ok(c.carved > 0 || c.contradictions > 0);
  assert.equal(c.conflicts, c.carved + c.contradictions, "every conflict is either carved or kept on record");
});

test("job lifecycle: auto picks the silhouette engine offline; every step, file and verdict is recorded", async () => {
  const root = tmp();
  try {
    const m = new AsreJobManager({ root, runtime: fakeRuntime() });
    const truth = boxTruth(48, 20, 40, 14);
    const queued = await m.reconstruct([{ view: "front", bytes: render(truth, 48, "front") }], { resolution: 48 });
    assert.equal(queued.state, "queued");
    assert.equal(queued.engine, "silhouette");
    const job = await m.settle(queued.id);
    assert.equal(job.state, "succeeded", job.error ?? "");
    assert.equal(job.progress, 1);
    assert.deepEqual(job.steps.map((s) => s.step), ["decode", "hypotheses", "refine", "mesh", "coverage", "persist", "forge"]);
    assert.equal(job.steps.find((s) => s.step === "refine")!.state, "skipped");
    const r = job.result!;
    assert.equal(r.hypotheses.length, 3);
    assert.equal(r.hypotheses.filter((h) => h.selected).length, 1);
    assert.equal(r.mesh.meshValid, true);
    assert.ok(existsSync(path.join(root, r.files.glb)) && existsSync(path.join(root, r.files.lnre)));
    assert.equal(inspectGlb(new Uint8Array(readFileSync(path.join(root, r.files.glb)))).verdict.meshValid, true);
    for (const f of Object.values(r.files.hypotheses)) assert.ok(existsSync(path.join(root, f)));
    assert.match(r.evidenceText, /OBSERVED/);
    assert.match(r.evidenceText, /Scale is UNKNOWN/);
    assert.ok(r.coverage.requests.length > 0, "it says which view would help most");
    // persisted record equals the in-memory view
    const disk = JSON.parse(readFileSync(path.join(root, "jobs", job.id, "job.json"), "utf8"));
    assert.equal(disk.state, "succeeded");
    assert.equal(m.list()[0].id, job.id);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("observe: a further view becomes a new incremental job linked to its parent", async () => {
  const root = tmp();
  try {
    const m = new AsreJobManager({ root, runtime: fakeRuntime() });
    const truth = boxTruth(48, 20, 40, 30);
    const first = await m.settle((await m.reconstruct([{ view: "front", bytes: render(truth, 48, "front") }], { resolution: 48 })).id);
    const second = await m.settle((await m.observe(first.id, { view: "right", bytes: render(truth, 48, "right") })).id);
    assert.equal(second.state, "succeeded", second.error ?? "");
    assert.equal(second.kind, "observe");
    assert.equal(second.parentJobId, first.id);
    assert.ok(second.observation!.newCells > 0);
    assert.ok(second.result!.snapshots.length > first.result!.snapshots.length, "history grows, never rewritten");
    assert.deepEqual(second.result!.snapshots.slice(0, first.result!.snapshots.length), first.result!.snapshots);
    // the parent's files are untouched
    assert.equal(m.get(first.id)!.result!.files.glb, first.result!.files.glb);
    await assert.rejects(() => m.observe("nope", { view: "left", bytes: render(truth, 48, "left") }), /no job/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failures are reported, not hidden: bad input refused, empty image fails with its reason", async () => {
  const root = tmp();
  try {
    const m = new AsreJobManager({ root, runtime: fakeRuntime() });
    await assert.rejects(() => m.reconstruct([{ view: "front", bytes: new Uint8Array([1, 2, 3]) }]), /not a PNG/);
    await assert.rejects(() => m.reconstruct([{ view: "top" as ViewName, bytes: pngBytes(4, 4, () => [0, 0, 0, 255]) }]), /unknown view/);
    await assert.rejects(() => m.reconstruct([{ view: "front", bytes: pngBytes(4, 4, () => [0, 0, 0, 255]) }], { engine: "triposr" }), /not installed/);
    const blank = await m.settle((await m.reconstruct([{ view: "front", bytes: pngBytes(64, 64, () => [255, 255, 255, 255]) }])).id);
    assert.equal(blank.state, "failed");
    assert.match(blank.error!, /no object/);
    assert.equal(blank.steps.find((s) => s.state === "failed")!.step, "hypotheses");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cancellation kills a running worker; a restart marks in-flight jobs interrupted; retry runs them again", async () => {
  const root = tmp();
  try {
    let killed = false;
    const hanging = fakeRuntime({
      available: async () => ({ triposr: true, blender: false }),
      runWorker: (_s, _j, _t, signal) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            killed = true;
            reject(new Error("killed"));
          });
        }),
    });
    const m = new AsreJobManager({ root, runtime: hanging });
    const png = render(boxTruth(48, 20, 40, 14), 48, "front");
    const job = await m.reconstruct([{ view: "front", bytes: png }], { engine: "triposr" });
    while (m.get(job.id)!.state !== "running") await new Promise((r) => setTimeout(r, 5));
    m.cancel(job.id);
    const done = await m.settle(job.id);
    assert.equal(done.state, "cancelled");
    assert.equal(killed, true, "the worker received the abort");
    assert.equal(done.steps[0].state, "cancelled");
    assert.throws(() => m.cancel(job.id), /already cancelled/);

    // simulate a crash: a job left "running" on disk
    const crashed = await m.reconstruct([{ view: "front", bytes: png }], { engine: "triposr" });
    while (m.get(crashed.id)!.state !== "running") await new Promise((r) => setTimeout(r, 5));
    const file = path.join(root, "jobs", crashed.id, "job.json");
    const snapshot = readFileSync(file, "utf8");
    m.cancel(crashed.id);
    await m.settle(crashed.id);
    writeFileSync(file, snapshot); // the disk still says "running", as after a crash
    const restarted = new AsreJobManager({ root, runtime: fakeRuntime({ available: async () => ({ triposr: true, blender: false }) }) });
    const interrupted = restarted.get(crashed.id)!;
    assert.equal(interrupted.state, "interrupted");
    assert.match(interrupted.error!, /server stopped/);
    const again = await restarted.settle((await restarted.retry(crashed.id)).id);
    assert.equal(again.state, "failed", "the retry ran (and failed honestly: no Python on the restarted runtime)");
    assert.match(again.error!, /no python here/);
    assert.notEqual(again.id, crashed.id, "a retry is a new job; the interrupted record stays as it was");
    assert.equal(restarted.get(crashed.id)!.state, "interrupted");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the server keeps answering while a reconstruction runs (event-loop delay is measured)", async () => {
  const root = tmp();
  try {
    const m = new AsreJobManager({ root, runtime: fakeRuntime() });
    const h = monitorEventLoopDelay({ resolution: 5 });
    h.enable();
    let ticks = 0;
    const timer = setInterval(() => ticks++, 10);
    const job = await m.reconstruct([{ view: "front", bytes: render(boxTruth(64, 30, 60, 20), 64, "front") }], { resolution: 64 });
    const t0 = Date.now();
    await m.settle(job.id);
    const ms = Date.now() - t0;
    clearInterval(timer);
    h.disable();
    const maxDelay = h.max / 1e6;
    console.log(`# event loop during a 64³ job: ${ms} ms total, max delay ${maxDelay.toFixed(0)} ms, ${ticks} timer ticks`);
    assert.ok(ticks >= 3, "timers kept firing during the job");
    assert.ok(maxDelay < 1500, `longest single block ${maxDelay.toFixed(0)} ms`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
