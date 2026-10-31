/**
 * ==========================================================
 * LÉLU 3D FORGE — BLENDER STAGE (server only)
 *
 * The step between "Meshy returned a validated GLB" and "the
 * Cosmos shows it": runs scripts/blender/lelu_postprocess.py
 * headlessly on a finished Forge job and records the result
 * as a new job in the same ledger, so the existing slot
 * rules, inspector, asset route and Cosmos loader all apply
 * unchanged.
 *
 *   source job (SUCCEEDED, inspected)
 *     → Blender: clean, measure, face shape keys, phone copy,
 *       previews  (spends no credits)
 *     → new version folder next to the source
 *     → derived job kind "blender", parentJobId = source,
 *       consumedCredits 0, validation = inspectGlb(lelu.glb)
 *     → approveSlot(...) exactly like a Meshy job
 *
 * Blender is found, in order, from:
 *   LELU_BLENDER_PYTHON  a Python with the `bpy` module
 *                        (pip install bpy — no GUI needed)
 *   LELU_BLENDER_BIN     a Blender executable
 *   `blender` on PATH
 * If none is present the stage reports that and changes
 * nothing; it never pretends a step ran.
 *
 * Idempotent: the same source, script and options give the
 * same request key, so a repeated run returns the earlier job.
 * ==========================================================
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectGlb } from "../src/core/forge/GlbInspector.ts";
import type { ForgeJob, ForgeOutputFile, ForgeStore } from "./forgeStore.ts";
import { ForgeError, type EnvReader } from "./meshyForge.ts";

export const BLENDER_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "blender", "lelu_postprocess.py");

export interface BlenderRunner {
  kind: "bpy" | "blender";
  command: string;
  /** Arguments that run the script with one JSON argument after "--". */
  args: (script: string, json: string) => string[];
}

export interface PostprocessOptions {
  faceKeys?: boolean;
  /** Phone copy: triangle budget and longest texture side. null skips it. */
  mobile?: { targetTris: number; textureSize: number } | null;
  previews?: boolean;
}

const DEFAULTS: Required<PostprocessOptions> = { faceKeys: true, mobile: { targetTris: 24_000, textureSize: 1024 }, previews: true };

const ROLE_BY_FILE: Record<string, string> = {
  "lelu.glb": "model",
  "lelu_mobile.glb": "model-mobile",
  "report.json": "blender-report",
  "preview_body.png": "preview",
  "preview_face_neutral.png": "preview-face",
  "preview_face_open_smile.png": "preview-face-keys",
  "preview_face_blink.png": "preview-face-blink",
};

/** Find a way to run Blender, or null. Probes only; runs nothing else. */
export function findBlender(readEnv: EnvReader): BlenderRunner | null {
  const python = readEnv("LELU_BLENDER_PYTHON");
  if (python && existsSync(python)) return { kind: "bpy", command: python, args: (script, json) => [script, "--", json] };
  const candidates = [readEnv("LELU_BLENDER_BIN"), "blender"].filter((c): c is string => Boolean(c));
  for (const command of candidates) {
    const probe = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 20_000 });
    if (probe.status === 0 && /Blender/i.test(probe.stdout)) {
      return { kind: "blender", command, args: (script, json) => ["--background", "--factory-startup", "--python", script, "--", json] };
    }
  }
  return null;
}

function run(runner: BlenderRunner, json: string, timeoutMs: number): Promise<{ code: number | null; log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(runner.command, runner.args(BLENDER_SCRIPT, json), { stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    const keep = (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-20_000);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, log });
    });
  });
}

/**
 * Post-process a finished job's model in Blender and record the result as a
 * derived job. Returns the existing derived job when this exact run was done before.
 */
export async function postprocess(
  store: ForgeStore,
  readEnv: EnvReader,
  sourceJobId: string,
  options: PostprocessOptions = {},
  deps: { runner?: BlenderRunner | null; timeoutMs?: number } = {},
): Promise<{ job: ForgeJob; reused: boolean }> {
  const source = store.job(sourceJobId);
  if (!source) throw new ForgeError(`No job ${sourceJobId}.`, 404);
  const model = source.output?.files.find((f) => f.role === "model");
  if (source.status !== "SUCCEEDED" || !model || !source.validation?.verdict.meshValid) {
    throw new ForgeError("Only a finished job whose GLB passed inspection can be post-processed.", 409);
  }
  const opts = { ...DEFAULTS, ...options };
  const scriptHash = createHash("sha256").update(readFileSync(BLENDER_SCRIPT)).digest("hex").slice(0, 16);
  const request = { source: source.id, sourceSha256: model.sha256, script: scriptHash, options: opts };
  const requestKey = createHash("sha256").update(JSON.stringify(request)).digest("hex");
  const existing = store.findByKey(source.character, requestKey);
  if (existing) return { job: existing, reused: true };

  const runner = deps.runner === undefined ? findBlender(readEnv) : deps.runner;
  if (!runner) {
    throw new ForgeError("Blender is not available on this server.", 503, [
      "Set LELU_BLENDER_PYTHON to a Python that has `bpy` (pip install bpy), or LELU_BLENDER_BIN to a Blender executable, or put `blender` on PATH.",
    ]);
  }
  const input = store.safeAssetPath(model.file);
  if (!input || !existsSync(input)) throw new ForgeError(`Model file ${model.file} is missing.`, 404);

  const work = mkdtempSync(path.join(tmpdir(), "lelu-blender-"));
  const started = Date.now();
  try {
    const { code, log } = await run(runner, JSON.stringify({ input, outDir: work, ...opts }), deps.timeoutMs ?? 15 * 60_000);
    const produced = existsSync(work) ? readdirSync(work) : [];
    if (code !== 0 || !produced.includes("lelu.glb") || !produced.includes("report.json")) {
      store.logEvent(source.character, { type: "blender_failed", jobId: source.id, code, log: log.slice(-2000) });
      throw new ForgeError(`Blender post-process failed (exit ${code}).`, 500, log.trim().split("\n").slice(-8));
    }
    const area = source.output!.dir.split("/")[2] === "rig" ? "rig" : "meshes";
    const dir = store.newVersionDir(source.character, area, `blender_${source.id.slice(3, 11)}`);
    const files: ForgeOutputFile[] = [];
    for (const name of produced.sort()) {
      files.push(store.writeOutput(dir, name, ROLE_BY_FILE[name] ?? "blender-output", new Uint8Array(readFileSync(path.join(work, name)))));
    }
    const report = JSON.parse(readFileSync(path.join(work, "report.json"), "utf8")) as { faceKeys?: string[]; warnings?: string[] };
    const now = Date.now();
    const job: ForgeJob = {
      id: `fj_${now.toString(36)}_${createHash("sha1").update(String(Math.random())).digest("hex").slice(0, 6)}`,
      character: source.character,
      kind: "blender",
      purpose: `Blender post-process of ${source.id}: ${opts.faceKeys ? "face shape keys, " : ""}${opts.mobile ? "phone copy, " : ""}clean-up`,
      request: { ...request, parentJobId: source.id, runner: runner.kind },
      requestKey,
      estimatedCredits: 0,
      status: "SUCCEEDED",
      meshyTaskId: null,
      progress: 100,
      consumedCredits: 0,
      error: null,
      identityLock: source.identityLock,
      createdAt: started,
      updatedAt: now,
      submittedAt: started,
      finishedAt: now,
      output: { dir: store.relative(dir), files },
      validation: inspectGlb(new Uint8Array(readFileSync(path.join(dir, "lelu.glb")))),
    };
    store.saveJob(job);
    store.logEvent(source.character, {
      type: "blender_succeeded",
      jobId: job.id,
      parentJobId: source.id,
      dir: job.output!.dir,
      faceKeys: report.faceKeys ?? [],
      warnings: report.warnings ?? [],
      verdict: job.validation?.verdict ?? null,
    });
    return { job, reused: false };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
