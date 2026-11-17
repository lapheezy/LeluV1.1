/**
 * LÉLU ASRE — Node-side runtime: Blender renders (through the existing
 * plugins/blenderStage findBlender/run) and the offline Python worker.
 *
 * Environment:
 *   LELU_BLENDER_BIN / LELU_BLENDER_PYTHON   as for the Forge Blender stage
 *   LELU_ASRE_PYTHON   Python with torch/transformers/scikit-image (TripoSR)
 *   LELU_TRIPOSR_SRC   checkout of VAST-AI-Research/TripoSR (pinned commit)
 *   HF_HOME / LELU_ASRE_HF_CACHE   Hugging Face cache holding stabilityai/TripoSR
 * Defaults point at /opt/lelu-tools (see services/asre-reconstruct/setup.sh).
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findBlender, run } from "../../plugins/blenderStage.ts";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SERVICE = path.join(ROOT, "services/asre-reconstruct");
const TOOLS = "/opt/lelu-tools";

export function env(name: string): string | undefined {
  return process.env[name];
}

export function blenderRunner() {
  const fallback = path.join(TOOLS, "blender-4.2.23-linux-x64/blender");
  return findBlender((k) => env(k) ?? (k === "LELU_BLENDER_BIN" && existsSync(fallback) ? fallback : undefined));
}

export interface RenderJob {
  inputs: string[];
  output: string;
  resolution?: [number, number];
  samples?: number;
  view?: "three-quarter" | "front" | "side" | "back";
  background?: [number, number, number];
}

export interface RenderReport {
  output: string;
  objects: string[];
  triangles: number;
  render_seconds: number;
  blender: string;
}

export async function renderGlb(job: RenderJob, timeoutMs = 600_000): Promise<RenderReport> {
  const runner = blenderRunner();
  if (!runner) throw new Error("Blender not available: set LELU_BLENDER_BIN (see services/asre-reconstruct/setup.sh)");
  mkdirSync(path.dirname(job.output), { recursive: true });
  const jobFile = `${job.output}.job.json`;
  writeFileSync(jobFile, JSON.stringify(job));
  const { code, log } = await run(runner, jobFile, timeoutMs, path.join(SERVICE, "blender_render.py"));
  if (code !== 0 || !existsSync(`${job.output}.json`)) throw new Error(`blender exited ${code}: ${log.slice(-2000)}`);
  return JSON.parse(readFileSync(`${job.output}.json`, "utf8"));
}

export function asrePython(): string {
  return env("LELU_ASRE_PYTHON") ?? path.join(TOOLS, "asre-venv/bin/python");
}

export function workerEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    LELU_TRIPOSR_SRC: env("LELU_TRIPOSR_SRC") ?? path.join(TOOLS, "TripoSR"),
    HF_HOME: env("LELU_ASRE_HF_CACHE") ?? env("HF_HOME") ?? path.join(TOOLS, "hf-home"),
    HF_HUB_OFFLINE: env("HF_HUB_OFFLINE") ?? "1",
  };
}

/** Run a Python worker script with a JSON job; resolves with its parsed JSON result. */
export function runWorker(script: string, job: unknown, timeoutMs = 900_000): Promise<{ result: Record<string, unknown>; log: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(asrePython(), ["-I", path.join(SERVICE, script), JSON.stringify(job)], { env: workerEnv(), stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err = (err + c).slice(-20_000)));
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      const line = out.trim().split("\n").pop() ?? "";
      if (code !== 0) return reject(new Error(`${script} exited ${code}: ${err.slice(-3000)}`));
      try {
        resolve({ result: JSON.parse(line), log: err });
      } catch {
        reject(new Error(`${script}: no JSON result. stderr: ${err.slice(-2000)}`));
      }
    });
  });
}
