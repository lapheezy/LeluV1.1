/**
 * ==========================================================
 * LÉLU ASRE — RECONSTRUCTION JOBS (server only)
 *
 * Every reconstruction is a job with a traceable lifecycle:
 *
 *   queued → running → succeeded | failed | cancelled
 *                    ↘ interrupted   (the server stopped mid-job)
 *
 * The job record is rewritten atomically on every transition under
 * <root>/jobs/<id>/job.json, so a restart finds every job and marks
 * the ones it cannot finish as `interrupted` (retryable) instead of
 * leaving them "running" forever. Cancellation aborts the job's
 * AbortSignal: a Python worker is killed, a TS step stops at the next
 * step boundary. Heavy TS steps yield to the event loop between steps,
 * so the server keeps answering while a job runs.
 *
 * Engines:
 *   silhouette  TS-native, CPU, offline, no dependency (always available)
 *   triposr     local TripoSR CPU worker + WP1 analyses (needs setup.sh)
 *   auto        triposr when its toolchain is installed, else silhouette
 *
 * Nothing here calls a paid API, a remote service or the Meshy Forge.
 * ==========================================================
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { deflateRawSync, deflateSync, inflateRawSync, inflateSync } from "node:zlib";
import {
  TERMINAL_JOB_STATES,
  describeEvidence,
  type AsreJobKind,
  type AsreJobStep,
  type AsreJobView,
  type HypothesisSummary,
  type ReconstructionEngine,
  type ReconstructionResult,
} from "../src/core/asre/contracts.ts";
import { decodePng, encodePng, isPng } from "../src/core/asre/image/png.ts";
import type { SparseVoxelGrid } from "../src/core/asre/nre/SparseVoxelGrid.ts";
import { decodeGrid, encodeGrid } from "../src/core/asre/nre/serialize.ts";
import {
  addView,
  compareHypotheses,
  coverageSummary,
  evidenceBreakdown,
  gridFacts,
  meshGrid,
  reconstructFromViews,
  reconstructionPart,
  type SilhouetteReconstruction,
  type ViewInput,
} from "../src/core/asre/reconstruct/pipeline.ts";
import { HYPOTHESES, silhouetteOf, VIEWS, type ViewName } from "../src/core/asre/reconstruct/silhouette.ts";
import { Flipbook } from "../src/core/asre/temporal/Flipbook.ts";
import { analyzeMesh, voxelFaceMesh } from "../src/core/asre/volume/mesh.ts";
import { writeGlb } from "../src/core/asre/gltf/GlbWriter.ts";
import { inspectGlb } from "../src/core/forge/GlbInspector.ts";

export const zlib = { inflate: (b: Uint8Array) => new Uint8Array(inflateSync(b)), deflate: (b: Uint8Array) => new Uint8Array(deflateSync(b)) };
export const lnreCodec = { name: "deflate-raw", compress: (b: Uint8Array) => new Uint8Array(deflateRawSync(b, { level: 9 })), decompress: (b: Uint8Array) => new Uint8Array(inflateRawSync(b)) };

export class AsreJobError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface ImageInput {
  view: ViewName;
  bytes: Uint8Array;
}

export interface ReconstructOptions {
  engine?: ReconstructionEngine | "auto";
  /** Cells along the object's height (silhouette engine). 32…96. */
  resolution?: number;
  /** Assumed height in metres (scale is not observable from a photo). */
  heightMeters?: number;
  render?: boolean;
}

/** What a finished reconstruction is handed to (WP02: the Forge intake). */
export type SucceededHook = (job: AsreJobView, ctx: { root: string; dir: string }) => Promise<string | null> | string | null;

export interface AsreRuntime {
  available(): Promise<{ triposr: boolean; blender: boolean }>;
  runWorker(script: string, job: unknown, timeoutMs: number, signal: AbortSignal): Promise<{ result: Record<string, unknown> }>;
  ingest(dir: string, options: { render: boolean }): Promise<unknown>;
  triposrHypotheses(trDir: string, wpDir: string): Promise<Record<string, SparseVoxelGrid>>;
  render(glb: string, png: string): Promise<string | null>;
}

interface JobRecord extends AsreJobView {
  options: Required<Omit<ReconstructOptions, "engine">> & { engine: ReconstructionEngine };
}

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const yieldNow = () => new Promise<void>((r) => setImmediate(r));

function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 1));
  renameSync(tmp, file);
}

const STEP_WEIGHTS: Record<ReconstructionEngine, string[]> = {
  silhouette: ["decode", "hypotheses", "refine", "mesh", "coverage", "persist", "forge"],
  triposr: ["triposr", "analyses", "nre+glb", "hypotheses", "coverage", "forge"],
};

export class AsreJobManager {
  readonly root: string;
  private readonly jobs = new Map<string, JobRecord>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly running = new Map<string, Promise<void>>();
  private readonly runtime: AsreRuntime;
  private readonly onSucceeded: SucceededHook | null;

  constructor(options: { root: string; runtime: AsreRuntime; onSucceeded?: SucceededHook | null }) {
    this.root = path.resolve(options.root);
    this.runtime = options.runtime;
    this.onSucceeded = options.onSucceeded ?? null;
    this.load();
  }

  /** Reload every job from disk; a job that was in flight when the server stopped becomes `interrupted`. */
  private load(): void {
    const base = path.join(this.root, "jobs");
    if (!existsSync(base)) return;
    for (const id of readdirSync(base)) {
      const file = path.join(base, id, "job.json");
      if (!existsSync(file)) continue;
      try {
        const job = JSON.parse(readFileSync(file, "utf8")) as JobRecord;
        if (!job.kind) continue; // pre-Mission-5 record: kept on disk, not managed
        if (!TERMINAL_JOB_STATES.includes(job.state)) {
          job.state = "interrupted";
          job.error = "the server stopped while this job was running; retry it to run it again";
          for (const s of job.steps) if (s.state === "running") Object.assign(s, { state: "failed", note: "interrupted by a server restart" });
          job.finishedAt = Date.now();
          writeJsonAtomic(file, job);
        }
        this.jobs.set(job.id, job);
      } catch {
        /* a corrupt record is skipped, never guessed at */
      }
    }
  }

  dir(id: string): string {
    return path.join(this.root, "jobs", id);
  }

  list(): AsreJobView[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt - a.createdAt).map((j) => this.view(j));
  }

  get(id: string): AsreJobView | null {
    const j = this.jobs.get(id);
    return j ? this.view(j) : null;
  }

  private view(j: JobRecord): AsreJobView {
    const { options: _o, ...v } = j;
    return structuredClone(v);
  }

  /** Resolves when the job reaches a terminal state (tests, the CLI and the benchmark wait on this). */
  async settle(id: string): Promise<AsreJobView> {
    await this.running.get(id);
    const j = this.get(id);
    if (!j) throw new AsreJobError(`no job ${id}`, 404);
    return j;
  }

  private save(j: JobRecord): void {
    const total = STEP_WEIGHTS[j.engine].length + (j.kind === "observe" ? 0 : 0);
    const done = j.steps.filter((s) => s.state === "done" || s.state === "skipped").length;
    j.progress = j.state === "succeeded" ? 1 : Math.min(0.99, done / total);
    writeJsonAtomic(path.join(this.dir(j.id), "job.json"), j);
  }

  private async resolveEngine(engine: ReconstructOptions["engine"]): Promise<ReconstructionEngine> {
    if (engine === "silhouette") return "silhouette";
    const { triposr } = await this.runtime.available();
    if (engine === "triposr") {
      if (!triposr) throw new AsreJobError("the TripoSR toolchain is not installed on this machine (run services/asre-reconstruct/setup.sh); the silhouette engine works without it", 503);
      return "triposr";
    }
    return triposr ? "triposr" : "silhouette";
  }

  async reconstruct(images: ImageInput[], options: ReconstructOptions = {}): Promise<AsreJobView> {
    if (!images.length) throw new AsreJobError("at least one image is needed");
    const views = new Set<string>();
    for (const im of images) {
      if (!VIEWS.includes(im.view)) throw new AsreJobError(`unknown view "${im.view}" (front, back, left, right)`);
      if (views.has(im.view)) throw new AsreJobError(`two images for the ${im.view} view`);
      views.add(im.view);
      if (!isPng(im.bytes)) throw new AsreJobError(`the ${im.view} image is not a PNG`);
    }
    const engine = await this.resolveEngine(options.engine);
    if (engine === "triposr" && images.length > 1) throw new AsreJobError("TripoSR reconstructs from one image; add further views with an observe job on a silhouette reconstruction");
    const id = randomUUID().slice(0, 12);
    const dir = this.dir(id);
    mkdirSync(dir, { recursive: true });
    const input = images.map((im) => {
      const file = `jobs/${id}/input-${im.view}.png`;
      writeFileSync(path.join(this.root, file), im.bytes);
      return { view: im.view, file, sha256: sha256(im.bytes) };
    });
    const job: JobRecord = {
      id,
      kind: "reconstruct",
      state: "queued",
      engine,
      parentJobId: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      steps: [],
      error: null,
      progress: 0,
      input: { images: input },
      result: null,
      observation: null,
      options: {
        engine,
        resolution: Math.round(Math.min(96, Math.max(32, options.resolution ?? 64))),
        heightMeters: Math.min(100, Math.max(0.01, options.heightMeters ?? 1)),
        render: options.render === true,
      },
    };
    this.jobs.set(id, job);
    this.save(job);
    this.start(job, () => (engine === "triposr" ? this.runTriposr(job) : this.runSilhouette(job)));
    return this.view(job);
  }

  /** Add one more view to a finished silhouette reconstruction: a new job, incremental. */
  async observe(parentId: string, image: ImageInput): Promise<AsreJobView> {
    const parent = this.jobs.get(parentId);
    if (!parent) throw new AsreJobError(`no job ${parentId}`, 404);
    if (parent.state !== "succeeded" || !parent.result) throw new AsreJobError("only a finished reconstruction can take another view", 409);
    if (parent.engine !== "silhouette") throw new AsreJobError("further views refine silhouette reconstructions; a TripoSR job is a single-image generative reconstruction", 409);
    if (!VIEWS.includes(image.view)) throw new AsreJobError(`unknown view "${image.view}"`);
    if (!isPng(image.bytes)) throw new AsreJobError(`the ${image.view} image is not a PNG`);
    const id = randomUUID().slice(0, 12);
    mkdirSync(this.dir(id), { recursive: true });
    const file = `jobs/${id}/input-${image.view}.png`;
    writeFileSync(path.join(this.root, file), image.bytes);
    const job: JobRecord = {
      ...structuredClone(parent),
      id,
      kind: "observe" as AsreJobKind,
      state: "queued",
      parentJobId: parentId,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      steps: [],
      error: null,
      progress: 0,
      input: { images: [...parent.input.images, { view: image.view, file, sha256: sha256(image.bytes) }] },
      result: null,
      observation: null,
    };
    this.jobs.set(id, job);
    this.save(job);
    this.start(job, () => this.runObserve(job, parent));
    return this.view(job);
  }

  cancel(id: string): AsreJobView {
    const j = this.jobs.get(id);
    if (!j) throw new AsreJobError(`no job ${id}`, 404);
    if (TERMINAL_JOB_STATES.includes(j.state)) throw new AsreJobError(`job ${id} is already ${j.state}`, 409);
    this.controllers.get(id)?.abort();
    if (j.state === "queued") {
      j.state = "cancelled";
      j.finishedAt = Date.now();
      this.save(j);
    }
    return this.view(j);
  }

  /** A failed, cancelled or interrupted job runs again as a NEW job with the same inputs. */
  async retry(id: string): Promise<AsreJobView> {
    const j = this.jobs.get(id);
    if (!j) throw new AsreJobError(`no job ${id}`, 404);
    if (!["failed", "cancelled", "interrupted"].includes(j.state)) throw new AsreJobError(`job ${id} is ${j.state}; only failed, cancelled or interrupted jobs are retried`, 409);
    const read = (f: string) => new Uint8Array(readFileSync(path.join(this.root, f)));
    if (j.kind === "observe" && j.parentJobId) {
      const last = j.input.images[j.input.images.length - 1];
      return this.observe(j.parentJobId, { view: last.view as ViewName, bytes: read(last.file) });
    }
    return this.reconstruct(j.input.images.map((im) => ({ view: im.view as ViewName, bytes: read(im.file) })), j.options);
  }

  private start(job: JobRecord, body: () => Promise<void>): void {
    const controller = new AbortController();
    this.controllers.set(job.id, controller);
    const p = (async () => {
      await yieldNow();
      if (controller.signal.aborted) return;
      job.state = "running";
      job.startedAt = Date.now();
      this.save(job);
      try {
        await body();
        if (controller.signal.aborted) throw new Error("cancelled");
        job.state = "succeeded";
      } catch (e) {
        if (controller.signal.aborted) {
          job.state = "cancelled";
          job.error = "cancelled by request";
        } else {
          job.state = "failed";
          job.error = e instanceof Error ? e.message.slice(0, 2000) : String(e);
        }
      }
      job.finishedAt = Date.now();
      this.save(job);
    })().finally(() => {
      this.controllers.delete(job.id);
      this.running.delete(job.id);
    });
    this.running.set(job.id, p);
  }

  private async step<T>(job: JobRecord, name: string, fn: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
    const signal = this.controllers.get(job.id)?.signal;
    if (signal?.aborted) throw new Error("cancelled");
    const s: AsreJobStep = { step: name, state: "running" };
    job.steps.push(s);
    this.save(job);
    const t0 = Date.now();
    try {
      const r = await fn(signal ?? new AbortController().signal);
      Object.assign(s, { state: "done", ms: Date.now() - t0 });
      this.save(job);
      await yieldNow();
      return r;
    } catch (e) {
      Object.assign(s, { state: signal?.aborted ? "cancelled" : "failed", ms: Date.now() - t0, note: e instanceof Error ? e.message.slice(0, 500) : String(e) });
      this.save(job);
      throw e;
    }
  }

  private skip(job: JobRecord, name: string, note: string): void {
    job.steps.push({ step: name, state: "skipped", ms: 0, note });
    this.save(job);
  }

  private viewInputs(job: JobRecord): ViewInput[] {
    return job.input.images.map((im) => {
      const bytes = new Uint8Array(readFileSync(path.join(this.root, im.file)));
      return { view: im.view as ViewName, image: decodePng(bytes, zlib), evidence: { view: im.view as ViewName, imageSha256: im.sha256, source: `input:${im.view}:${im.file}`, capturedAt: job.createdAt } };
    });
  }

  /* ------------------------------ silhouette engine ------------------------------ */

  private async runSilhouette(job: JobRecord): Promise<void> {
    const frame = { n: job.options.resolution, heightMeters: job.options.heightMeters };
    const inputs = await this.step(job, "decode", () => this.viewInputs(job));
    const rec = await this.step(job, "hypotheses", () => reconstructFromViews(inputs.slice(0, 1), frame));
    if (inputs.length > 1)
      await this.step(job, "refine", () => {
        for (const v of inputs.slice(1)) rec.observations.push(addView(rec, v));
      });
    else this.skip(job, "refine", "one view: nothing to refine with yet");
    await this.finishSilhouette(job, rec);
  }

  private async runObserve(job: JobRecord, parent: JobRecord): Promise<void> {
    const frame = { n: parent.options.resolution, heightMeters: parent.options.heightMeters };
    const inputs = await this.step(job, "decode", () => this.viewInputs(job));
    const rec = await this.step(job, "hypotheses", () => {
      // incremental: start from the parent's stored grid, not from scratch
      const bytes = new Uint8Array(readFileSync(path.join(this.root, parent.result!.files.lnre)));
      const grid = decodeGrid(bytes, { codecs: [lnreCodec] }).grid;
      const silhouettes = inputs.slice(0, -1).map((v) => silhouetteOf(v.image, v.view, frame.n));
      const r: SilhouetteReconstruction = { frame, silhouettes, hypotheses: {} as SilhouetteReconstruction["hypotheses"], comparison: compareHypotheses({ [parent.result!.hypotheses.find((h) => h.selected)!.id]: grid }), book: new Flipbook(grid, `from job ${parent.id}`), observations: [] };
      return r;
    });
    await this.step(job, "refine", () => {
      const report = addView(rec, inputs[inputs.length - 1]);
      rec.observations.push(report);
      job.observation = report;
    });
    await this.finishSilhouette(job, rec, parent);
  }

  private async finishSilhouette(job: JobRecord, rec: SilhouetteReconstruction, parent?: JobRecord): Promise<void> {
    const dir = this.dir(job.id);
    const rel = (f: string) => path.relative(this.root, path.join(dir, f)).split(path.sep).join("/");
    const grid = rec.book.current;
    const frame = rec.frame;
    const hypothesisFiles: Record<string, string> = {};
    const hypothesisMesh: Record<string, { valid: boolean; triangles: number }> = {};
    const { mesh, colorSources } = await this.step(job, "mesh", () => {
      const out = meshGrid(grid, frame, rec.silhouettes);
      const glb = writeGlb([reconstructionPart("reconstruction", out.mesh, { engine: "silhouette", job: job.id, evidence: evidenceBreakdown(grid), colourSources: out.colorSources })], { generator: "LÉLU ASRE silhouette", extras: { job: job.id, engine: "silhouette", heightAssumedMeters: frame.heightMeters } });
      writeFileSync(path.join(dir, "reconstruction.glb"), glb);
      for (const [id, g] of Object.entries(rec.hypotheses)) {
        const m = meshGrid(g, frame, rec.silhouettes).mesh;
        const hglb = writeGlb([reconstructionPart(id, m, { hypothesis: id })], { generator: "LÉLU ASRE silhouette" });
        writeFileSync(path.join(dir, `hypothesis-${id}.glb`), hglb);
        hypothesisFiles[id] = rel(`hypothesis-${id}.glb`);
        const v = inspectGlb(hglb);
        hypothesisMesh[id] = { valid: v.verdict.meshValid, triangles: m.indices.length / 3 };
      }
      return out;
    });
    const coverage = await this.step(job, "coverage", () => coverageSummary(grid, [0, 0, 1], [0, 1, 0]));
    await this.step(job, "persist", () => writeFileSync(path.join(dir, "reconstruction.lnre"), encodeGrid(grid, { codec: lnreCodec })));
    const glbBytes = new Uint8Array(readFileSync(path.join(dir, "reconstruction.glb")));
    const report = inspectGlb(glbBytes);
    const meshReport = analyzeMesh(mesh);
    const evidence = evidenceBreakdown(grid);
    const facts = gridFacts(grid);
    const hyps: HypothesisSummary[] = parent
      ? parent.result!.hypotheses.map((h) => ({ ...h }))
      : rec.comparison.ranking.map((id, i) => ({
          id,
          label: HYPOTHESES[id as keyof typeof HYPOTHESES].label,
          method: HYPOTHESES[id as keyof typeof HYPOTHESES].method,
          evidence: "INFERRED" as const,
          cells: rec.hypotheses[id as keyof typeof rec.hypotheses].size,
          agreement: rec.comparison.agreement[id],
          meshValid: hypothesisMesh[id]?.valid ?? false,
          triangles: hypothesisMesh[id]?.triangles ?? 0,
          glb: hypothesisFiles[id] ?? null,
          rank: i + 1,
          selected: id === rec.comparison.selected,
        }));
    job.result = {
      engine: "silhouette",
      grid: { ...facts, resolution: grid.spec.resolution, dims: grid.spec.dims },
      evidence,
      evidenceText: `${describeEvidence(evidence, "the reconstruction")} Scale is UNKNOWN from images alone: the object is assumed ${frame.heightMeters} m tall. Surfaces no view faces are shown in neutral grey (${colorSources.neutral} of ${mesh.positions.length / 3} vertices).`,
      hypotheses: hyps,
      pairwiseIou: parent ? parent.result!.pairwiseIou : rec.comparison.pairwiseIou,
      consensusCells: parent ? parent.result!.consensusCells : rec.comparison.consensusCells,
      disagreementFraction: parent ? parent.result!.disagreementFraction : rec.comparison.disagreementFraction,
      coverage,
      files: { glb: rel("reconstruction.glb"), lnre: rel("reconstruction.lnre"), preview: null, hypotheses: parent ? parent.result!.files.hypotheses : hypothesisFiles },
      mesh: { triangles: meshReport.triangles, vertices: meshReport.vertices, meshValid: report.verdict.meshValid, problems: report.problems },
      observations: grid.getObservations().map((o) => ({ id: o.id, source: o.source, provenance: o.provenance === "SYNTHESIZED" ? "GENERATED" : o.provenance, confidence: o.confidence, modality: o.modality })),
      snapshots: [...(parent?.result?.snapshots ?? []), ...rec.book.store.list().slice(parent ? 1 : 0).map((s) => ({ id: s.id, label: s.label, cells: s.cellCount, hash: s.contentHash, parentId: s.parentId }))],
      forgeJobId: null,
    } as ReconstructionResult;
    if (job.options.render) {
      const { blender } = await this.runtime.available();
      if (blender) await this.step(job, "render", async () => (job.result!.files.preview = (await this.runtime.render(path.join(dir, "reconstruction.glb"), path.join(dir, "preview.png"))) ? rel("preview.png") : null));
      else this.skip(job, "render", "Blender is not installed: no preview render");
    }
    await this.forge(job);
  }

  /* -------------------------------- TripoSR engine -------------------------------- */

  private async runTriposr(job: JobRecord): Promise<void> {
    const dir = this.dir(job.id);
    const rel = (f: string) => path.relative(this.root, f).split(path.sep).join("/");
    const image = path.join(this.root, job.input.images[0].file);
    const tr = path.join(dir, "triposr");
    const wp = path.join(dir, "wp1");
    await this.step(job, "triposr", (signal) => this.runtime.runWorker("triposr_worker.py", { image, out_dir: tr }, 900_000, signal));
    await this.step(job, "analyses", (signal) => this.runtime.runWorker("analyze_worker.py", { image, triposr_dir: tr, out_dir: wp }, 900_000, signal));
    const { blender } = await this.runtime.available();
    await this.step(job, "nre+glb", () => this.runtime.ingest(tr, { render: blender && job.options.render }));
    const grids = await this.step(job, "hypotheses", () => this.runtime.triposrHypotheses(tr, wp));
    const comparison = compareHypotheses(grids);
    const grid = decodeGrid(new Uint8Array(readFileSync(path.join(tr, "reconstruction.lnre"))), { codecs: [lnreCodec] }).grid;
    // TripoSR's conditioning camera sits on +X; Z is up in that frame
    const coverage = await this.step(job, "coverage", () => coverageSummary(grid, [1, 0, 0], [0, 0, 1]));
    const glbFile = path.join(tr, "reconstruction.glb");
    const glbBytes = new Uint8Array(readFileSync(glbFile));
    const report = inspectGlb(glbBytes);
    const evidence = evidenceBreakdown(grid);
    const hypothesisFiles: Record<string, string> = {};
    const hyps: HypothesisSummary[] = comparison.ranking.map((id, i) => {
      const m = voxelFaceMesh(grids[id]);
      const f = path.join(dir, `hypothesis-${id}.glb`);
      const hglb = writeGlb([{ name: id, mesh: m, extras: { hypothesis: id } }], { sourceAxes: "z-up-right-handed", generator: "LÉLU ASRE triposr" });
      writeFileSync(f, hglb);
      hypothesisFiles[id] = rel(f);
      return {
        id,
        label: id,
        method: id === "triposr" ? "TripoSR generative occupancy (CPU)" : id === "depth-lift" ? "monocular depth (Depth-Anything-V2-Small) front surface + mirrored back" : "silhouette × elliptical cross-section prior",
        evidence: id === "triposr" ? "GENERATED" : "INFERRED",
        cells: grids[id].size,
        agreement: comparison.agreement[id],
        meshValid: inspectGlb(hglb).verdict.meshValid,
        triangles: m.indices.length / 3,
        glb: hypothesisFiles[id],
        rank: i + 1,
        selected: id === comparison.selected,
      };
    });
    const preview = path.join(tr, "reconstruction.png");
    job.result = {
      engine: "triposr",
      grid: { ...gridFacts(grid), resolution: grid.spec.resolution, dims: grid.spec.dims },
      evidence,
      evidenceText: `${describeEvidence(evidence, "the reconstruction")} The exported mesh is TripoSR's; the hypothesis ranking says which of the competing shapes the others agree with most (${comparison.selected}). Scale is UNKNOWN from one image.`,
      hypotheses: hyps,
      pairwiseIou: comparison.pairwiseIou,
      consensusCells: comparison.consensusCells,
      disagreementFraction: comparison.disagreementFraction,
      coverage,
      files: { glb: rel(glbFile), lnre: rel(path.join(tr, "reconstruction.lnre")), preview: existsSync(preview) ? rel(preview) : null, hypotheses: hypothesisFiles },
      mesh: { triangles: report.geometry.triangles, vertices: report.geometry.vertices, meshValid: report.verdict.meshValid, problems: report.problems },
      observations: grid.getObservations().map((o) => ({ id: o.id, source: o.source, provenance: o.provenance === "SYNTHESIZED" ? "GENERATED" : o.provenance, confidence: o.confidence, modality: o.modality })),
      snapshots: [],
      forgeJobId: null,
    };
    await this.forge(job);
  }

  private async forge(job: JobRecord): Promise<void> {
    if (!this.onSucceeded) return this.skip(job, "forge", "no Forge intake configured");
    if (!job.result?.mesh.meshValid) return this.skip(job, "forge", "the GLB did not pass inspection, so it is not filed in the Forge");
    await this.step(job, "forge", async () => {
      job.result!.forgeJobId = await this.onSucceeded!(this.view(job), { root: this.root, dir: this.dir(job.id) });
    });
  }
}

/** A tiny PNG for tests and previews of silhouettes (RGBA). */
export function pngBytes(width: number, height: number, pixel: (x: number, y: number) => [number, number, number, number]): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) data.set(pixel(x, y), 4 * (y * width + x));
  return encodePng({ width, height, data }, zlib);
}
