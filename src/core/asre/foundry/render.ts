/**
 * ==========================================================
 * LÉLU CHARACTER FOUNDRY — RENDER BRIDGE (server)
 *
 * One shot = one Blender process with a hard timeout. That is the whole
 * stability design: a render that hangs or exhausts memory is killed, its log
 * is kept next to the image, and the next shot still runs. The LÉLU app is
 * never in the same process as a path tracer.
 *
 * Failure is reported as failure, per shot. `renderBenchmark` deliberately keeps
 * going after a failure so a 13-shot run cannot be lost to one bad camera.
 * ==========================================================
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecutionPlan, HardwareProfile } from "./capabilities.ts";
import { planExecution } from "./capabilities.ts";
import type { FoundryShot } from "./shots.ts";

export const FOUNDRY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
export const FOUNDRY_RENDER_SCRIPT = path.join(FOUNDRY_ROOT, "scripts/blender/lelu_foundry_render.py");

export function foundryBlender(env: NodeJS.ProcessEnv = process.env): string | null {
  const tools = env.LELU_TOOLS || path.join(os.homedir(), "lelu-tools");
  const candidates = [
    env.LELU_BLENDER_BIN,
    path.join(tools, "blender-4.2.23-linux-x64", "blender"),
    "/usr/bin/blender",
    "/opt/blender/blender",
  ].filter((p): p is string => Boolean(p));
  return candidates.find((p) => existsSync(p)) ?? null;
}

export interface ShotRender {
  shot: string;
  index: number;
  ok: boolean;
  png: string | null;
  report: Record<string, unknown> | null;
  error: string | null;
  seconds: number;
  log: string | null;
  plan: ExecutionPlan;
}

export interface RenderShotRequest {
  glb: string;
  outDir: string;
  shot: FoundryShot;
  plan: ExecutionPlan;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  materials?: boolean;
  /** Evaluate the armature at rest instead of the imported clip's frame 0. */
  restPose?: boolean;
  /** Object names to delete before framing — stray objects in an imported asset. */
  exclude?: string[];
  /** Cap samples (a quick proof render at the cost of noise). */
  sampleCap?: number;
}

function scaleSamples(shot: FoundryShot, plan: ExecutionPlan, cap?: number): number {
  const base = Math.round(shot.samples * plan.resolutionScale);
  const capped = cap ? Math.min(base, cap) : base;
  return Math.max(8, plan.samples !== null ? Math.min(plan.samples, capped) : capped);
}

export async function renderFoundryShot(req: RenderShotRequest): Promise<ShotRender> {
  const { glb, outDir, shot, plan } = req;
  const started = Date.now();
  const blender = foundryBlender(req.env);
  if (!blender) {
    return { shot: shot.id, index: shot.index, ok: false, png: null, report: null, error: "Blender is not installed (set LELU_BLENDER_BIN or install the setup.sh toolchain)", seconds: 0, log: null, plan };
  }
  if (plan.backend === "refuse") {
    return { shot: shot.id, index: shot.index, ok: false, png: null, report: null, error: `refused by the execution plan: ${plan.reasons.join("; ")}`, seconds: 0, log: null, plan };
  }
  if (!existsSync(glb)) {
    return { shot: shot.id, index: shot.index, ok: false, png: null, report: null, error: `model does not exist: ${glb}`, seconds: 0, log: null, plan };
  }
  mkdirSync(outDir, { recursive: true });
  const output = path.join(outDir, `${shot.id}.png`);
  const job = {
    inputs: [path.resolve(glb)],
    output,
    shot: shot.id,
    view: shot.view,
    focus: shot.focus,
    ...(shot.camera ? { camera: shot.camera } : {}),
    resolution: [Math.round(shot.resolution[0] * plan.resolutionScale), Math.round(shot.resolution[1] * plan.resolutionScale)],
    samples: scaleSamples(shot, plan, req.sampleCap),
    threads: plan.threads,
    ground: shot.ground,
    ...(shot.environment ? { environment: true } : {}),
    ...(shot.lens ? { lens: shot.lens } : {}),
    materials: req.materials ?? true,
    ...(req.restPose ? { rest_pose: true } : {}),
    ...(req.exclude?.length ? { exclude: req.exclude } : {}),
  };
  const jobFile = path.join(outDir, `${shot.id}.job.json`);
  writeFileSync(jobFile, JSON.stringify(job, null, 1));
  const timeoutMs = Math.min(req.timeoutMs ?? plan.timeoutMs, 20 * 60_000);

  const log = await new Promise<string>((resolve) => {
    const child = spawn(blender, ["--background", "--factory-startup", "--python", FOUNDRY_RENDER_SCRIPT, "--", jobFile], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out = (out + d.toString()).slice(-30_000)));
    child.stderr.on("data", (d) => (out = (out + d.toString()).slice(-30_000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve(`${out}\nspawn error: ${e.message}`);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve(`${out}\nexit ${code}`);
    });
  });

  const reportFile = `${output}.json`;
  const seconds = Number(((Date.now() - started) / 1000).toFixed(2));
  if (!existsSync(output) || !existsSync(reportFile)) {
    const logFile = path.join(outDir, `${shot.id}.log.txt`);
    writeFileSync(logFile, log);
    const firstError = log
      .split("\n")
      .find((l) => /error|traceback|SystemExit|exited/i.test(l))
      ?.trim();
    return {
      shot: shot.id,
      index: shot.index,
      ok: false,
      png: null,
      report: null,
      error: firstError ?? `Blender produced no image (log: ${path.basename(logFile)})`,
      seconds,
      log: log.slice(-4000),
      plan,
    };
  }
  const report = JSON.parse(readFileSync(reportFile, "utf8")) as Record<string, unknown>;
  return { shot: shot.id, index: shot.index, ok: true, png: output, report, error: null, seconds, log: null, plan };
}

export interface BenchmarkRender {
  results: ShotRender[];
  ok: number;
  failed: number;
  skipped: number;
  totalSeconds: number;
}

export interface RenderBenchmarkRequest {
  glb: string;
  outDir: string;
  shots: FoundryShot[];
  hardware: HardwareProfile;
  env?: NodeJS.ProcessEnv;
  sampleCap?: number;
  materials?: boolean;
  /** Called after every shot so a long run can report progress. */
  onProgress?: (result: ShotRender) => void;
}

export async function renderBenchmark(req: RenderBenchmarkRequest): Promise<BenchmarkRender> {
  const results: ShotRender[] = [];
  const started = Date.now();
  for (const shot of req.shots) {
    const plan = planExecution(
      { id: `render:${shot.id}`, need: "cpu", ramGb: 2, minutes: shot.samples > 48 ? 3 : 2 },
      req.hardware,
    );
    const result = await renderFoundryShot({ glb: req.glb, outDir: req.outDir, shot, plan, env: req.env, sampleCap: req.sampleCap, materials: req.materials });
    results.push(result);
    req.onProgress?.(result);
  }
  return {
    results,
    ok: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    skipped: results.filter((r) => !r.ok && r.plan.backend === "refuse").length,
    totalSeconds: Number(((Date.now() - started) / 1000).toFixed(2)),
  };
}
