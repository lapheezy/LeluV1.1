/**
 * ==========================================================
 * LÉLU 3D FORGE — RUNNER (server side)
 *
 * Runs one APPROVED job against the provider:
 *   resolve its inputs (reference images → data URIs, earlier jobs' task
 *   ids) → create the task ONCE → record its id before anything else →
 *   track it to the end → download its outputs into a new version folder
 *   → read what the files really contain (inspectGlb) → write the report.
 *
 * Nothing runs unless a person approved it. A create that may or may not
 * have gone through is marked needs_attention, never re-sent. Failed tasks
 * are refunded by the provider; the credits recorded are the task's own
 * consumed_credits.
 * ==========================================================
 */

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { inspectGlb, loadLedger, nextVersionDir, saveLedger, type ForgeJob, type Ledger } from "./forgeCore";
import { createTask, download, getTask, MeshyError, type MeshyTask } from "./meshyClient";

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** "ref:<asset-relative path>" → a data URI of that file (Meshy accepts data URIs up to 20 MB). */
function resolveRefs(value: unknown, assetDir: string): unknown {
  if (typeof value === "string" && value.startsWith("ref:")) {
    const file = path.join(assetDir, value.slice(4));
    const mime = MIME[path.extname(file).toLowerCase()];
    if (!mime) throw new Error(`Unsupported reference type: ${value}`);
    return `data:${mime};base64,${readFileSync(file).toString("base64")}`;
  }
  if (Array.isArray(value)) return value.map((item) => resolveRefs(item, assetDir));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveRefs(item, assetDir)]));
  }
  return value;
}

function log(job: ForgeJob, event: string): void {
  job.history.push({ at: new Date().toISOString(), event });
}

/** Where a workflow's outputs go inside the asset. */
const OUTPUT_FOLDER: Record<string, string> = {
  "multi-image-to-3d": "meshes",
  "image-to-3d": "meshes",
  rigging: "rig",
  animation: "animations",
  remesh: "meshes",
};

/** The file a workflow exists to produce. */
const PRIMARY_OUTPUT: Record<string, string> = {
  "multi-image-to-3d": "model.glb",
  "image-to-3d": "model.glb",
  rigging: "rigged.glb",
  animation: "animation.glb",
  remesh: "model.glb",
};

/** The URLs worth keeping from a finished task, by local file name. */
function outputUrls(job: ForgeJob, task: MeshyTask): Record<string, string> {
  const out: Record<string, string> = {};
  if (job.workflow === "multi-image-to-3d" || job.workflow === "image-to-3d") {
    for (const [format, url] of Object.entries(task.model_urls ?? {})) if (["glb", "fbx", "usdz"].includes(format)) out[`model.${format}`] = url;
    if (task.thumbnail_url) out["thumbnail.png"] = task.thumbnail_url;
    for (const [view, url] of Object.entries((task.thumbnail_urls as Record<string, string> | undefined) ?? {})) out[`thumbnail-${view}.png`] = url;
    (task.texture_urls ?? []).forEach((set, index) => {
      for (const [map, url] of Object.entries(set)) out[`texture-${index}-${map}.png`] = url;
    });
  } else if (job.workflow === "rigging") {
    const result = (task.result ?? {}) as Record<string, unknown>;
    if (typeof result.rigged_character_glb_url === "string") out["rigged.glb"] = result.rigged_character_glb_url;
    if (typeof result.rigged_character_fbx_url === "string") out["rigged.fbx"] = result.rigged_character_fbx_url;
    for (const [name, url] of Object.entries((result.basic_animations as Record<string, unknown> | null) ?? {})) {
      if (typeof url === "string") out[`basic-${name.replace(/_url$/, "").replace(/_/g, "-")}${url.split("?")[0].endsWith(".fbx") ? ".fbx" : ".glb"}`] = url;
    }
  } else if (job.workflow === "animation") {
    const result = (task.result ?? {}) as Record<string, unknown>;
    if (typeof result.animation_glb_url === "string") out["animation.glb"] = result.animation_glb_url;
    if (typeof result.animation_fbx_url === "string") out["animation.fbx"] = result.animation_fbx_url;
  }
  return out;
}

export interface RunOptions {
  projectRoot: string;
  pollMs?: number;
  maxWaitMs?: number;
  onProgress?: (job: ForgeJob) => void;
}

/** Run one approved job to its end. Returns the job as recorded. */
export async function runJob(id: string, options: RunOptions): Promise<ForgeJob> {
  const { projectRoot } = options;
  const pollMs = options.pollMs ?? 10_000;
  const maxWaitMs = options.maxWaitMs ?? 30 * 60_000;
  let ledger: Ledger = loadLedger(projectRoot);
  const find = () => {
    const job = ledger.jobs.find((item) => item.id === id);
    if (!job) throw new Error(`No forge job ${id}.`);
    return job;
  };
  const save = () => saveLedger(projectRoot, ledger);
  let job = find();
  const assetDir = path.join(projectRoot, job.asset);

  if (job.state === "succeeded") return job;
  // A task already created (its id recorded) is tracked again, never re-sent.
  const resumable = job.state === "submitted" || (job.state === "needs_attention" && Boolean(job.providerTaskId));
  if (job.state !== "approved" && !resumable) throw new Error(`Job ${id} is ${job.state}; only an approved job runs.`);

  if (job.state === "approved" && !job.providerTaskId) {
    // Inputs from earlier jobs: they must have succeeded.
    const body = resolveRefs(job.params, assetDir) as Record<string, unknown>;
    for (const dependency of job.dependsOn ?? []) {
      const earlier = ledger.jobs.find((item) => item.id === dependency);
      if (!earlier || earlier.state !== "succeeded" || !earlier.providerTaskId) throw new Error(`Job ${id} needs ${dependency} to have succeeded first.`);
      if (job.workflow === "rigging") body.input_task_id = earlier.providerTaskId;
      if (job.workflow === "animation") body.rig_task_id = earlier.providerTaskId;
    }
    try {
      const taskId = await createTask(job.workflow, body);
      job.providerTaskId = taskId;
      job.state = "submitted";
      job.submittedAt = new Date().toISOString();
      log(job, `submitted to Meshy as ${taskId}`);
    } catch (error) {
      const uncertain = error instanceof MeshyError && error.uncertain;
      job.state = uncertain ? "needs_attention" : "failed";
      job.error = (error as Error).message;
      log(job, `${uncertain ? "submission uncertain — not re-sent" : "submission refused"}: ${job.error}`);
    }
    save();
    if (job.state !== "submitted") return job;
  }

  // Track it.
  const started = Date.now();
  let task: MeshyTask | null = null;
  while (Date.now() - started < maxWaitMs) {
    task = await getTask(job.workflow, job.providerTaskId!);
    ledger = loadLedger(projectRoot);
    job = find();
    job.progress = task.progress ?? job.progress;
    if (typeof task.consumed_credits === "number") job.consumedCredits = task.consumed_credits;
    save();
    options.onProgress?.(job);
    if (task.status === "SUCCEEDED" || task.status === "FAILED" || task.status === "CANCELED") break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  if (!task || (task.status !== "SUCCEEDED" && task.status !== "FAILED" && task.status !== "CANCELED")) {
    log(job, `still ${task?.status ?? "unknown"} after ${Math.round(maxWaitMs / 1000)} s; run again to keep tracking (it will not be re-submitted)`);
    save();
    return job;
  }
  if (task.status !== "SUCCEEDED") {
    job.state = "failed";
    job.consumedCredits = task.consumed_credits ?? 0;
    job.error = task.task_error?.message || `Meshy reported ${task.status}`;
    job.finishedAt = new Date().toISOString();
    log(job, `failed: ${job.error}`);
    save();
    return job;
  }

  // Keep the outputs, in a version folder of their own.
  const dir = nextVersionDir(assetDir, OUTPUT_FOLDER[job.workflow]);
  const outputs: Record<string, string> = {};
  const validation: Record<string, unknown> = {};
  for (const [name, url] of Object.entries(outputUrls(job, task))) {
    try {
      const bytes = await download(url);
      const file = path.join(dir, name);
      writeFileSync(file, bytes);
      outputs[name] = path.relative(projectRoot, file);
      if (name.endsWith(".glb")) validation[name] = inspectGlb(bytes);
    } catch (error) {
      validation[name] = { downloaded: false, error: (error as Error).message };
    }
  }
  writeFileSync(path.join(dir, "task.json"), `${JSON.stringify({ job: { id: job.id, workflow: job.workflow, purpose: job.purpose }, provider: "meshy", task }, null, 2)}\n`);
  writeFileSync(path.join(dir, "validation.json"), `${JSON.stringify(validation, null, 2)}\n`);
  job.outputs = outputs;
  job.validation = validation;
  job.consumedCredits = task.consumed_credits ?? job.consumedCredits;
  // Done only when the main file is here and is what it claims to be.
  const primary = PRIMARY_OUTPUT[job.workflow];
  const primaryReport = validation[primary] as { valid?: boolean } | undefined;
  if (!outputs[primary] || primaryReport?.valid !== true) {
    job.state = "needs_attention";
    job.error = `Meshy finished the task, but ${primary} ${outputs[primary] ? "is not a valid GLB" : "could not be downloaded"}; run the job again to retry the download (nothing is re-submitted).`;
    log(job, job.error);
    save();
    return job;
  }
  job.state = "succeeded";
  job.error = undefined;
  job.finishedAt = new Date().toISOString();
  log(job, `succeeded; ${Object.keys(outputs).length} file(s) in ${path.relative(projectRoot, dir)}`);
  save();
  return job;
}
