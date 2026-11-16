/**
 * ==========================================================
 * LÉLU 3D FORGE — COAT WEIGHTING STAGE (server only)
 *
 * A long coat is not a placement. Hanging it off one bone
 * gives a rigid shell that walks through her legs, so it is
 * bound to her own skeleton by scripts/blender/lelu_coatweights.py
 * and only recorded as a job when the measurement says the
 * binding is real.
 *
 * The gate is applied here, independently of what the Blender
 * script claims: a report that says ok is not enough. This
 * stage re-checks every vertex is weighted, the weights sum to
 * one, no vertex is rigid, more than two bones carry weight,
 * posing her actually moved the garment, and the exported GLB
 * carries readable, normalised skin weights. Any failure is a
 * 422 with the reasons, and nothing enters the ledger.
 *
 * Spends no credits: it only runs Blender on a finished job.
 * ==========================================================
 */

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectGlb } from "../src/core/forge/GlbInspector.ts";
import type { ForgeJob, ForgeOutputFile, ForgeStore } from "./forgeStore.ts";
import { ForgeError, type EnvReader } from "./meshyForge.ts";
import { findBlender, run as runBlender, type BlenderRunner } from "./blenderStage.ts";

export const COAT_WEIGHTS_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "blender", "lelu_coatweights.py");

export interface CoatPose {
  name: string;
  sampledVertices: number;
  maxDisplacement: number;
  movedShare: number;
  penetratingVertices: number;
}

export interface CoatWeightsReport {
  ok: boolean;
  garment?: { objects: number; vertices: number; triangles: number };
  bones?: string[];
  boneShare?: Record<string, number>;
  weights?: { unweighted: number; minSum: number; maxSum: number; meanInfluences: number; maxInfluences: number };
  deformation?: CoatPose[];
  problems?: string[];
  warnings?: string[];
}

export interface CoatRigOptions {
  /** Most bones a single vertex may follow. Meshy's own rigs use 4. */
  maxInfluences?: number;
  /** Influences weaker than this fraction of the strongest one are dropped. */
  minWeight?: number;
}

export interface CoatRigDeps {
  /** Runs the Blender script. Injected in tests; defaults to a real headless Blender. */
  execute?: (payload: string, script: string) => Promise<{ code: number | null; log: string }>;
  runner?: BlenderRunner | null;
  timeoutMs?: number;
}

const DEFAULTS: Required<CoatRigOptions> = { maxInfluences: 4, minWeight: 0.02 };

/**
 * Independent verification of what the weighting run produced. Returns the
 * reasons it cannot be worn; an empty array means the binding is measured.
 */
export function checkCoatReport(report: CoatWeightsReport): string[] {
  const problems: string[] = [...(report.problems ?? [])];
  const weights = report.weights;
  if (!weights) return [...problems, "the report has no weight statistics."];
  if (weights.unweighted !== 0) problems.push(`${weights.unweighted} vertices are unweighted.`);
  if (Math.abs(weights.minSum - 1) > 1e-3 || Math.abs(weights.maxSum - 1) > 1e-3) {
    problems.push(`weights are not normalised (min ${weights.minSum}, max ${weights.maxSum}).`);
  }
  if (weights.meanInfluences < 1.5) problems.push(`the binding is rigid: ${weights.meanInfluences} bones per vertex.`);
  const bones = report.bones ?? [];
  if (bones.length < 3) problems.push(`only ${bones.length} bones carry weight.`);
  const poses = report.deformation ?? [];
  const moving = poses.filter((pose) => pose.name !== "stand");
  if (moving.length < 3) problems.push(`only ${moving.length} posed tests were measured; at least 3 are required.`);
  if (!moving.some((pose) => pose.maxDisplacement > 0.02)) problems.push("no pose moved the garment by more than 2 cm.");
  if (!moving.some((pose) => pose.movedShare > 0.01)) problems.push("almost no vertex moved between poses.");
  if (report.ok === false && problems.length === 0) problems.push("the Blender run reported failure.");
  return problems;
}

/**
 * Bind a finished garment job to a finished rigged body, record the result as
 * a derived "blender" job in the clothing area. Returns the existing job when
 * this exact pair was already weighted with these settings.
 */
export async function weightGarment(
  store: ForgeStore,
  readEnv: EnvReader,
  garmentJobId: string,
  bodyJobId: string,
  options: CoatRigOptions = {},
  deps: CoatRigDeps = {},
): Promise<{ job: ForgeJob; reused: boolean; report: CoatWeightsReport }> {
  const garment = store.job(garmentJobId);
  const body = store.job(bodyJobId);
  if (!garment || !body) throw new ForgeError(`No job ${!garment ? garmentJobId : bodyJobId}.`, 404);
  const garmentModel = garment.output?.files.find((file) => file.role === "model");
  const bodyModel = body.output?.files.find((file) => file.role === "model");
  if (garment.status !== "SUCCEEDED" || !garmentModel || !garment.validation?.verdict.meshValid) {
    throw new ForgeError("The garment must be a finished job whose GLB passed inspection.", 409);
  }
  if (body.status !== "SUCCEEDED" || !bodyModel || !body.validation?.verdict.rigValid) {
    throw new ForgeError("The body must be a finished job whose rig validated.", 409);
  }

  const opts = { ...DEFAULTS, ...options };
  const scriptHash = createHash("sha256").update(readFileSync(COAT_WEIGHTS_SCRIPT)).digest("hex").slice(0, 16);
  const request = {
    operation: "coatweights",
    garment: garment.id,
    garmentSha256: garmentModel.sha256,
    body: body.id,
    bodySha256: bodyModel.sha256,
    script: scriptHash,
    options: opts,
  };
  const requestKey = createHash("sha256").update(JSON.stringify(request)).digest("hex");
  const existing = store.findByKey(garment.character, requestKey);
  if (existing) {
    const reportFile = existing.output?.files.find((file) => file.role === "coatweights-report");
    const report = reportFile ? (JSON.parse(readFileSync(store.safeAssetPath(reportFile.file)!, "utf8")) as CoatWeightsReport) : { ok: true };
    return { job: existing, reused: true, report };
  }

  let execute = deps.execute;
  if (!execute) {
    const runner = deps.runner === undefined ? findBlender(readEnv) : deps.runner;
    if (!runner) {
      throw new ForgeError("Blender is not available on this server.", 503, [
        "Set LELU_BLENDER_BIN to a Blender executable, LELU_BLENDER_PYTHON to a Python with bpy, or put `blender` on PATH.",
      ]);
    }
    execute = (payload, script) => runBlender(runner, payload, deps.timeoutMs ?? 20 * 60_000, script);
  }

  const garmentPath = store.safeAssetPath(garmentModel.file);
  const bodyPath = store.safeAssetPath(bodyModel.file);
  if (!garmentPath || !bodyPath || !existsSync(garmentPath) || !existsSync(bodyPath)) throw new ForgeError("A model file is missing.", 404);

  const work = mkdtempSync(path.join(tmpdir(), "lelu-coatweights-"));
  const started = Date.now();
  try {
    const outModel = path.join(work, "lelu.glb");
    const outReport = path.join(work, "report.json");
    const { code, log } = await execute(JSON.stringify({ body: bodyPath, garment: garmentPath, outDir: work, options: opts }), COAT_WEIGHTS_SCRIPT);
    if (!existsSync(outModel) || !existsSync(outReport)) {
      store.logEvent(garment.character, { type: "coatweights_failed", jobId: garment.id, code, reason: "no output", log: log.slice(-2000) });
      throw new ForgeError(`Blender weighting produced no result (exit ${code}).`, 500, log.trim().split("\n").slice(-8));
    }
    const report = JSON.parse(readFileSync(outReport, "utf8")) as CoatWeightsReport;
    const problems = checkCoatReport(report);
    const inspection = inspectGlb(new Uint8Array(readFileSync(outModel)));
    if (!inspection.verdict.meshValid) problems.push("the exported garment has no measurable geometry.");
    if ((inspection.rig.skinnedVertices ?? 0) === 0) problems.push("the exported garment carries no skin weights.");
    if ((inspection.rig.weightValidity ?? 0) < 0.99) problems.push(`only ${((inspection.rig.weightValidity ?? 0) * 100).toFixed(1)}% of exported vertices weigh correctly.`);
    if (problems.length) {
      store.logEvent(garment.character, { type: "coatweights_rejected", jobId: garment.id, body: body.id, problems });
      throw new ForgeError("The weighted coat did not pass its deformation checks.", 422, problems);
    }

    const dir = store.newVersionDir(garment.character, "clothing", `coatweights_${garment.id.slice(3, 11)}`);
    const files: ForgeOutputFile[] = [
      store.writeOutput(dir, "garment_weighted.glb", "model", new Uint8Array(readFileSync(outModel))),
      store.writeOutput(dir, "report.json", "coatweights-report", new Uint8Array(readFileSync(outReport))),
    ];
    const now = Date.now();
    const job: ForgeJob = {
      id: `fj_${now.toString(36)}_${createHash("sha1").update(String(Math.random())).digest("hex").slice(0, 6)}`,
      character: garment.character,
      kind: "blender",
      purpose: `Coat weights: ${garment.id} bound to ${body.id}`,
      request: { ...request, parentJobId: garment.id, bodyJobId: body.id },
      requestKey,
      estimatedCredits: 0,
      status: "SUCCEEDED",
      meshyTaskId: null,
      progress: 100,
      consumedCredits: 0,
      error: null,
      identityLock: body.identityLock,
      createdAt: started,
      updatedAt: now,
      submittedAt: started,
      finishedAt: now,
      output: { dir: store.relative(dir), files },
      validation: inspection,
    };
    store.saveJob(job);
    store.logEvent(garment.character, {
      type: "coatweights_succeeded",
      jobId: job.id,
      garment: garment.id,
      body: body.id,
      dir: job.output!.dir,
      bones: report.bones ?? [],
      meanInfluences: report.weights?.meanInfluences ?? null,
      deformation: report.deformation ?? [],
    });
    return { job, reused: false, report };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

export function producedFiles(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir) : [];
}
