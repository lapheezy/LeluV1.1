/**
 * ==========================================================
 * LÉLU 3D FORGE — MESHY SERVICE (server only)
 *
 * The one place a Meshy credential is used. Everything that
 * can spend credits goes through request() → approve(), and
 * everything that reads progress goes through refresh():
 *
 *   request   validate → identity check → idempotency lookup
 *             → ledger entry (awaiting_approval) → submit only
 *             if approved or under the auto-approve ceiling
 *   submit    balance check → POST create. A 429/5xx means
 *             Meshy refused, so it is retried with backoff; a
 *             network failure means a task MAY exist, so the
 *             job becomes submit_uncertain and is never
 *             resubmitted without a person saying so
 *   refresh   GET the task (free), record progress and the
 *             real consumed_credits, and on SUCCEEDED download
 *             every output into a new version folder and
 *             inspect the GLB before anything can use it
 *   approveSlot  promote a finished job to the character's
 *             base / rig / animation slot — refused unless the
 *             inspection proves it is fit for that slot
 *
 * The API key is attached only to requests for the Meshy API
 * host. Output downloads are signed URLs on other hosts and
 * get no Authorization header.
 * ==========================================================
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  IMAGE_KINDS,
  MESHY_KINDS,
  canonicalRequest,
  estimateCredits,
  isForgeJobKind,
  taskPath,
  validateRequest,
  type ForgeJobKind,
  type MeshyTaskStatus,
} from "../src/core/forge/MeshyCatalog.ts";
import { inspectGlb } from "../src/core/forge/GlbInspector.ts";
import { motionOnlyGlb } from "../src/core/forge/MotionGlb.ts";
import { buildRecords } from "./forgeReferences.ts";
import {
  ForgeStore,
  isTerminal,
  type CharacterSlot,
  type CosmosPlacement,
  type ForgeJob,
  type ForgeOutputFile,
  type PlacementAttachment,
  type WardrobeCategory,
  type WardrobeItem,
} from "./forgeStore.ts";

export type EnvReader = (name: string) => string | undefined;

const KEY_NAMES = ["MESHY_API_KEY", "MESHY_API", "MESSY_API", "VITE_MESHY_API_KEY"];
const LOOSE_KEY_NAME = /^(messy|meshy)[ _-]?api([ _-]?key)?$/i;
const DEFAULT_BASE = "https://api.meshy.ai";

/** What can be worn, and the bone a piece of each kind follows by default. */
const WARDROBE_CATEGORIES: ReadonlySet<WardrobeCategory> = new Set(["look", "hair", "headwear", "jewelry", "outerwear", "bag", "shoes", "accessory", "other"]);
const DEFAULT_BONE: Partial<Record<WardrobeCategory, string>> = {
  hair: "Head",
  headwear: "Head",
  jewelry: "Neck",
  outerwear: "Spine02",
  bag: "RightHand",
  shoes: "RightFoot",
  accessory: "Spine02",
  other: "Spine02",
};
const IDENTITY_BOUND: ReadonlySet<ForgeJobKind> = new Set(["image-to-3d", "multi-image-to-3d", "retexture", "image-to-image"]);

export interface ForgeOptions {
  store: ForgeStore;
  readEnv: EnvReader;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Jobs estimated at or under this many credits submit without approval. Default 0: every spend is approved. */
  autoApproveCredits?: number;
}

export interface ForgeRequest {
  character: string;
  kind: string;
  body: Record<string, unknown>;
  purpose?: string;
  approve?: boolean;
  parentJobId?: string;
}

export class ForgeError extends Error {
  readonly status: number;
  readonly details: string[];

  constructor(message: string, status = 400, details: string[] = []) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

interface MeshyTask {
  id?: string;
  status?: MeshyTaskStatus;
  progress?: number;
  consumed_credits?: number;
  task_error?: { message?: string } | null;
  model_urls?: Record<string, string | undefined>;
  thumbnail_url?: string;
  thumbnail_urls?: Record<string, string | undefined>;
  alpha_thumbnail_url?: string;
  image_urls?: string[];
  texture_urls?: Array<Record<string, string | undefined>>;
  result?: Record<string, unknown> | null;
}

/** The Meshy task kind of a job; local Blender jobs never reach Meshy. */
function meshyKind(job: ForgeJob): ForgeJobKind {
  if (job.kind === "blender") throw new ForgeError(`Job ${job.id} is a local Blender post-process, not a Meshy task.`, 409);
  return job.kind;
}

function newJobId(): string {
  return `fj_${Date.now().toString(36)}_${createHash("sha1").update(String(Math.random())).digest("hex").slice(0, 6)}`;
}

function extensionOf(url: string, fallback: string): string {
  try {
    const match = /\.([a-z0-9]{2,5})$/i.exec(new URL(url).pathname);
    return match ? `.${match[1].toLowerCase()}` : fallback;
  } catch {
    return fallback;
  }
}

export class MeshyForge {
  readonly store: ForgeStore;
  private readonly readEnv: EnvReader;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly autoApprove: number;
  private readonly refreshing = new Map<string, Promise<ForgeJob>>();
  private poller: ReturnType<typeof setInterval> | null = null;

  constructor(options: ForgeOptions) {
    this.store = options.store;
    this.readEnv = options.readEnv;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.autoApprove = options.autoApproveCredits ?? Number(options.readEnv("FORGE_AUTO_APPROVE_CREDITS") ?? 0);
  }

  /* ------------------------------ upstream ----------------------------- */

  /**
   * Candidate names: the documented ones, then any process variable that is
   * "messy/meshy api (key)" in whatever case and separator it was saved with
   * (e.g. `Messy_API`), since environment settings are typed by hand.
   */
  private keyNames(): string[] {
    const loose = typeof process !== "undefined" ? Object.keys(process.env).filter((n) => LOOSE_KEY_NAME.test(n)) : [];
    return [...KEY_NAMES, ...loose.filter((n) => !KEY_NAMES.includes(n))];
  }

  private apiKey(): string {
    for (const name of this.keyNames()) {
      const value = this.readEnv(name)?.trim();
      if (value) return value;
    }
    return "";
  }

  configured(): boolean {
    return this.apiKey().length > 0;
  }

  /** Which name the credential was found under — never its value. */
  credentialSource(): string | null {
    return this.keyNames().find((n) => (this.readEnv(n) ?? "").trim().length > 0) ?? null;
  }

  private base(): string {
    return (this.readEnv("MESHY_API_URL") ?? DEFAULT_BASE).trim().replace(/\/$/, "") || DEFAULT_BASE;
  }

  private async meshy(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
    const key = this.apiKey();
    if (!key) {
      throw new ForgeError("MESHY_API_KEY is not set on the server. Add it to the server environment (never a VITE_ name).", 503);
    }
    return this.fetchImpl(`${this.base()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(method === "POST" ? 120_000 : 30_000),
    });
  }

  async balance(): Promise<{ balance: number; monthly_credits?: number; permanent_credits?: number }> {
    const res = await this.meshy("GET", "/openapi/v1/balance");
    if (!res.ok) throw new ForgeError(`Meshy balance check failed (HTTP ${res.status}).`, 502);
    return (await res.json()) as { balance: number };
  }

  async animationLibrary(query: Record<string, string>): Promise<unknown> {
    const params = new URLSearchParams(query);
    const res = await this.meshy("GET", `/openapi/v1/animations/library${params.size ? `?${params}` : ""}`);
    if (!res.ok) throw new ForgeError(`Meshy animation library failed (HTTP ${res.status}): ${(await res.text()).slice(0, 200)}`, 502);
    return res.json();
  }

  /* ------------------------------ request ------------------------------ */

  async request(input: ForgeRequest): Promise<{ job: ForgeJob; reused: boolean }> {
    if (!isForgeJobKind(input.kind)) throw new ForgeError(`Unknown job kind "${input.kind}".`);
    const kind = input.kind;
    const body = input.body ?? {};
    const problems = validateRequest(kind, body);
    if (problems.length) throw new ForgeError("Request does not match the Meshy API.", 400, problems);

    const store = this.store;
    store.characterDir(input.character);
    let identityLock: string | null = null;
    if (IDENTITY_BOUND.has(kind) && store.identity(input.character)) {
      const check = store.verifyIdentity(input.character);
      if (!check.ok) throw new ForgeError("Identity lock is broken; refusing to generate.", 409, check.problems);
      identityLock = check.lockHash;
    }
    // Resolve now so a missing or altered reference fails before a job exists.
    store.resolveReferences(input.character, body);

    const requestKey = createHash("sha256").update(canonicalRequest(kind, body)).digest("hex");
    const existing = store.findByKey(input.character, requestKey);
    if (existing) {
      if (existing.status === "awaiting_approval" && input.approve) return { job: await this.approve(existing.id), reused: true };
      return { job: existing, reused: true };
    }

    const now = Date.now();
    const job = store.saveJob({
      id: newJobId(),
      character: input.character,
      kind,
      purpose: input.purpose ?? "",
      request: body,
      requestKey,
      estimatedCredits: estimateCredits(kind, body),
      status: "awaiting_approval",
      meshyTaskId: null,
      progress: 0,
      consumedCredits: null,
      error: null,
      identityLock,
      createdAt: now,
      updatedAt: now,
      submittedAt: null,
      finishedAt: null,
      output: null,
      validation: null,
    });
    store.logEvent(job.character, { type: "job_planned", jobId: job.id, kind, estimatedCredits: job.estimatedCredits, parentJobId: input.parentJobId ?? null });

    if (input.approve || job.estimatedCredits <= this.autoApprove) return { job: await this.approve(job.id), reused: false };
    return { job, reused: false };
  }

  /**
   * Spend the credits. Only an awaiting_approval job is submitted; an
   * uncertain one needs `resubmitUncertain`, because a task may already
   * exist upstream and a second one would be paid for twice.
   */
  async approve(jobId: string, options: { resubmitUncertain?: boolean } = {}): Promise<ForgeJob> {
    const job = this.store.job(jobId);
    if (!job) throw new ForgeError(`No job ${jobId}.`, 404);
    if (job.status === "submit_uncertain" && !options.resubmitUncertain) {
      throw new ForgeError("This job may already exist at Meshy. Check the Meshy dashboard, then resubmit explicitly.", 409);
    }
    if (job.status !== "awaiting_approval" && job.status !== "submit_uncertain") return job;

    try {
      const { balance } = await this.balance();
      if (typeof balance === "number" && balance < job.estimatedCredits) {
        job.error = `Insufficient Meshy credits: ${balance} available, ${job.estimatedCredits} needed.`;
        this.store.logEvent(job.character, { type: "job_blocked", jobId, reason: "insufficient_credits", balance });
        return this.store.saveJob(job);
      }
    } catch (error) {
      if (error instanceof ForgeError && error.status === 503) throw error;
      // Balance is advisory: Meshy itself answers 402 if credits are short.
    }

    job.status = "submitting";
    job.error = null;
    this.store.saveJob(job);
    const resolved = this.store.resolveReferences(job.character, job.request) as Record<string, unknown>;

    for (let attempt = 1; ; attempt++) {
      let res: Response;
      try {
        res = await this.meshy("POST", MESHY_KINDS[meshyKind(job)].path, resolved);
      } catch (error) {
        if (error instanceof ForgeError) throw error;
        job.status = "submit_uncertain";
        job.error = `Create call did not complete (${error instanceof Error ? error.message : String(error)}); a task may exist.`;
        this.store.logEvent(job.character, { type: "submit_uncertain", jobId, error: job.error });
        return this.store.saveJob(job);
      }
      if (res.ok) {
        const created = (await res.json()) as { result?: string };
        if (!created.result) {
          job.status = "submit_uncertain";
          job.error = "Meshy accepted the request but returned no task id.";
          return this.store.saveJob(job);
        }
        job.meshyTaskId = created.result;
        job.status = "PENDING";
        job.submittedAt = Date.now();
        this.store.logEvent(job.character, { type: "job_submitted", jobId, meshyTaskId: job.meshyTaskId, estimatedCredits: job.estimatedCredits });
        return this.store.saveJob(job);
      }
      const text = (await res.text().catch(() => "")).slice(0, 400);
      if ((res.status === 429 || res.status >= 500) && attempt < 4) {
        this.store.logEvent(job.character, { type: "submit_retry", jobId, httpStatus: res.status, attempt });
        await this.sleep(2_000 * 2 ** (attempt - 1));
        continue;
      }
      job.status = "FAILED";
      job.error = `Meshy refused the request (HTTP ${res.status}): ${text}`;
      job.finishedAt = Date.now();
      this.store.logEvent(job.character, { type: "job_rejected_upstream", jobId, httpStatus: res.status, body: text });
      return this.store.saveJob(job);
    }
  }

  reject(jobId: string, reason = ""): ForgeJob {
    const job = this.store.job(jobId);
    if (!job) throw new ForgeError(`No job ${jobId}.`, 404);
    if (job.status !== "awaiting_approval") throw new ForgeError(`Only a job awaiting approval can be rejected (this one is ${job.status}).`, 409);
    job.status = "rejected";
    if (reason) job.error = `Rejected: ${reason}`;
    this.store.logEvent(job.character, { type: "job_rejected", jobId, reason: reason || null });
    return this.store.saveJob(job);
  }

  /* ------------------------------ progress ----------------------------- */

  /** Read the task once; concurrent callers share one in-flight read. */
  refresh(jobId: string): Promise<ForgeJob> {
    const running = this.refreshing.get(jobId);
    if (running) return running;
    const promise = this.refreshOnce(jobId).finally(() => this.refreshing.delete(jobId));
    this.refreshing.set(jobId, promise);
    return promise;
  }

  private async refreshOnce(jobId: string): Promise<ForgeJob> {
    const job = this.store.job(jobId);
    if (!job) throw new ForgeError(`No job ${jobId}.`, 404);
    if (!job.meshyTaskId || (isTerminal(job.status) && (job.status !== "SUCCEEDED" || job.output))) return job;

    if (job.status !== "SUCCEEDED") {
      let res: Response;
      try {
        res = await this.meshy("GET", taskPath(meshyKind(job), job.meshyTaskId));
      } catch (error) {
        if (error instanceof ForgeError) throw error;
        job.error = `Status check failed, will retry: ${error instanceof Error ? error.message : String(error)}`;
        return this.store.saveJob(job);
      }
      if (!res.ok) {
        job.error = `Status check returned HTTP ${res.status}, will retry.`;
        return this.store.saveJob(job);
      }
      const task = (await res.json()) as MeshyTask;
      job.status = task.status ?? job.status;
      job.progress = typeof task.progress === "number" ? task.progress : job.progress;
      if (typeof task.consumed_credits === "number") job.consumedCredits = task.consumed_credits;
      job.error = task.task_error?.message || null;
      if (job.status === "FAILED" || job.status === "CANCELED") {
        job.finishedAt = Date.now();
        this.store.logEvent(job.character, { type: "job_failed", jobId, status: job.status, error: job.error });
        return this.store.saveJob(job);
      }
      if (job.status !== "SUCCEEDED") return this.store.saveJob(job);
      job.finishedAt = Date.now();
      this.store.saveJob(job);
      return this.collect(job, task);
    }

    // SUCCEEDED but outputs never landed (e.g. a download failed): fetch the task again and retry the downloads.
    const res = await this.meshy("GET", taskPath(meshyKind(job), job.meshyTaskId));
    if (!res.ok) throw new ForgeError(`Could not re-read finished task (HTTP ${res.status}).`, 502);
    return this.collect(job, (await res.json()) as MeshyTask);
  }

  /** The files a finished task produced, by role. */
  private outputsOf(kind: ForgeJobKind, task: MeshyTask): Array<{ role: string; name: string; url: string }> {
    const out: Array<{ role: string; name: string; url: string }> = [];
    const add = (role: string, base: string, url: unknown, fallbackExt: string) => {
      if (typeof url === "string" && url) out.push({ role, name: `${base}${extensionOf(url, fallbackExt)}`, url });
    };
    if (kind === "rigging") {
      const r = task.result ?? {};
      add("model", "rigged", r.rigged_character_glb_url, ".glb");
      add("model-fbx", "rigged", r.rigged_character_fbx_url, ".fbx");
      const basic = (r.basic_animations ?? {}) as Record<string, unknown>;
      for (const [key, url] of Object.entries(basic)) {
        if (key.endsWith("_glb_url")) add(key.includes("armature") ? "armature" : "animation", key.replace(/_url$/, ""), url, ".glb");
      }
    } else if (IMAGE_KINDS.has(kind)) {
      for (const [i, url] of (task.image_urls ?? []).entries()) add(i === 0 ? "image" : `image:${i}`, `image_${i}`, url, ".png");
    } else if (kind === "animation") {
      const r = task.result ?? {};
      add("model", "animation", r.animation_glb_url, ".glb");
      add("model-fbx", "animation", r.animation_fbx_url, ".fbx");
    } else {
      add("model", "model", task.model_urls?.glb, ".glb");
      add("pre-remesh", "pre_remeshed", task.model_urls?.pre_remeshed_glb, ".glb");
      // Every other format the request asked for, kept beside the runtime GLB.
      for (const format of ["fbx", "obj", "mtl", "usdz", "stl", "3mf"]) add(`model-${format}`, "model", task.model_urls?.[format], `.${format}`);
      for (const [i, set] of (task.texture_urls ?? []).entries()) {
        for (const [channel, url] of Object.entries(set)) add(`texture:${channel}`, `texture_${i}_${channel}`, url, ".png");
      }
    }
    add("preview", "preview", task.thumbnail_url, ".png");
    add("preview-alpha", "preview_alpha", task.alpha_thumbnail_url, ".png");
    for (const [view, url] of Object.entries(task.thumbnail_urls ?? {})) add(`view:${view}`, `view_${view}`, url, ".png");
    return out;
  }

  private async collect(job: ForgeJob, task: MeshyTask): Promise<ForgeJob> {
    const outputs = this.outputsOf(meshyKind(job), task);
    const images = IMAGE_KINDS.has(meshyKind(job));
    if (!outputs.some((o) => o.role === (images ? "image" : "model"))) {
      job.error = images ? "Task succeeded but returned no images." : "Task succeeded but returned no GLB.";
      return this.store.saveJob(job);
    }
    const area = images ? "concepts" : job.kind === "rigging" ? "rig" : job.kind === "animation" ? "animations" : "meshes";
    const dir = this.store.newVersionDir(job.character, area, `${job.kind}_${(job.meshyTaskId ?? job.id).slice(0, 8)}`);
    const files: ForgeOutputFile[] = [];
    let primary: Uint8Array | null = null;
    try {
      for (const output of outputs) {
        // Signed asset URL on a different host: deliberately no Authorization header.
        const res = await this.fetchImpl(output.url, { signal: AbortSignal.timeout(300_000) });
        if (!res.ok) throw new Error(`${output.role} download failed (HTTP ${res.status}).`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        files.push(this.store.writeOutput(dir, output.name, output.role, bytes));
        if (output.role === "model") primary = bytes;
        if (output.role === "preview") files.push(this.store.copyPreview(job.character, job.id, bytes, extensionOf(output.url, ".png")));
      }
    } catch (error) {
      job.error = `Output download incomplete: ${error instanceof Error ? error.message : String(error)}`;
      job.output = null;
      this.store.logEvent(job.character, { type: "download_failed", jobId: job.id, dir: this.store.relative(dir), error: job.error });
      return this.store.saveJob(job);
    }

    job.validation = primary ? inspectGlb(primary) : null;
    // An animation comes back as the whole character again; the client only
    // needs its motion (see MotionGlb). Kept beside the full file.
    if (job.kind === "animation" && primary) {
      try {
        files.push(this.store.writeOutput(dir, "motion.glb", "motion", motionOnlyGlb(primary, animationName(job))));
      } catch (error) {
        this.store.logEvent(job.character, { type: "motion_extract_failed", jobId: job.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    files.push(this.store.writeOutput(dir, "provenance.json", "provenance", new TextEncoder().encode(`${JSON.stringify(this.provenance(job), null, 2)}\n`)));
    job.output = { dir: this.store.relative(dir), files };
    job.error = null;
    this.store.logEvent(job.character, {
      type: "job_succeeded",
      jobId: job.id,
      consumedCredits: job.consumedCredits,
      dir: job.output.dir,
      verdict: job.validation?.verdict ?? null,
      problems: job.validation?.problems ?? [],
    });
    return this.store.saveJob(job);
  }

  /**
   * What produced this asset: the exact request (reference handles, not
   * inline bytes), each reference's recorded hash, the identity lock in
   * force, and the Meshy task. Written once into the version folder.
   */
  private provenance(job: ForgeJob) {
    const handles = new Set<string>();
    const walk = (v: unknown): void => {
      if (typeof v === "string" && v.startsWith("ref:")) handles.add(v.slice(4));
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(job.request);
    const records = this.store.references(job.character);
    return {
      jobId: job.id,
      character: job.character,
      kind: job.kind,
      purpose: job.purpose,
      meshyTaskId: job.meshyTaskId,
      request: job.request,
      references: [...handles].map((id) => {
        const r = records.find((x) => x.id === id);
        return { id, sha256: r?.metrics.sha256 ?? null, view: r?.view ?? null, outfitVariant: r?.outfitVariant ?? null };
      }),
      identityLock: job.identityLock,
      estimatedCredits: job.estimatedCredits,
      consumedCredits: job.consumedCredits,
      submittedAt: job.submittedAt,
      finishedAt: job.finishedAt,
    };
  }

  /** Refresh every submitted, unfinished job (and finished ones whose downloads failed). */
  async refreshAll(): Promise<ForgeJob[]> {
    const pending = this.store
      .allJobs()
      .filter((j) => j.meshyTaskId && (!isTerminal(j.status) || (j.status === "SUCCEEDED" && !j.output)));
    const results: ForgeJob[] = [];
    for (const job of pending) {
      try {
        results.push(await this.refresh(job.id));
      } catch (error) {
        this.store.logEvent(job.character, { type: "refresh_error", jobId: job.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return results;
  }

  /** Background monitor: polls only while there is something to poll. */
  startPolling(intervalMs = 10_000): void {
    if (this.poller) return;
    this.poller = setInterval(() => {
      if (!this.configured()) return;
      void this.refreshAll();
    }, intervalMs);
    this.poller.unref?.();
  }

  stopPolling(): void {
    if (this.poller) clearInterval(this.poller);
    this.poller = null;
  }

  /* ------------------------------- slots ------------------------------- */

  approveSlot(character: string, slot: CharacterSlot, jobId: string) {
    const job = this.store.job(jobId);
    if (!job || job.character !== character) throw new ForgeError(`No job ${jobId} for ${character}.`, 404);
    if (job.status !== "SUCCEEDED" || !job.output || !job.validation) throw new ForgeError("Only a finished, downloaded, inspected job can fill a slot.", 409);
    const v = job.validation.verdict;
    const reasons: string[] = [];
    if (!job.validation.ok) reasons.push(...job.validation.problems);
    if (slot === "base" && !v.meshValid) reasons.push("Mesh did not validate.");
    if (slot === "rig" && !v.rigValid) reasons.push("Rig did not validate (bones, weights or bind matrices).");
    if (slot.startsWith("animation:") && !v.animated) reasons.push("No clip that drives joints.");
    if (slot.startsWith("look:") && !v.meshValid) reasons.push("Mesh did not validate.");
    if (slot.startsWith("look:") && !/^look:[a-z0-9_-]{1,40}$/.test(slot)) reasons.push("Look names are lowercase letters, digits, _ or -.");
    if (reasons.length) throw new ForgeError(`Job ${jobId} is not fit for slot ${slot}.`, 422, reasons);
    return this.store.setActive(character, slot, jobId);
  }

  /* --------------------------- generated views -------------------------- */

  /**
   * Make one image from a finished image job a reference, so a reviewed,
   * generated view can feed a later 3D job by `ref:<id>` beside the real
   * originals. It is stored like any reference (hashed, never overwritten)
   * but marked `generatedFrom`, and the identity lock refuses it.
   */
  adoptView(jobId: string, index: number, classification: { id: string; view: string; outfitVariant?: string; intendedUse?: string; notes?: string }) {
    const job = this.store.job(jobId);
    if (!job || job.kind === "blender" || !IMAGE_KINDS.has(job.kind) || job.status !== "SUCCEEDED" || !job.output) {
      throw new ForgeError(`Job ${jobId} is not a finished image job.`, 409);
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(classification.id)) throw new ForgeError("id must be lowercase letters, digits, _ or -.");
    const role = index === 0 ? "image" : `image:${index}`;
    const file = job.output.files.find((f) => f.role === role);
    if (!file) throw new ForgeError(`Job ${jobId} has no image ${index}.`, 404);
    const bytes = readFileSync(this.store.safeAssetPath(file.file)!);
    const existing = this.store.references(job.character);
    const [record] = buildRecords(
      [
        {
          classification: {
            id: classification.id,
            sourceName: path.basename(file.file),
            category: "body",
            view: classification.view,
            outfitVariant: classification.outfitVariant ?? "unspecified",
            intendedUse: classification.intendedUse ?? "Generated view adopted after review.",
            uses: ["geometry", "texture"],
            notes: classification.notes,
            generatedFrom: { jobId, meshyTaskId: job.meshyTaskId, index },
          },
          file: "",
          bytes: new Uint8Array(bytes),
        },
      ],
      existing,
    );
    if (record.duplicateOf) return existing.find((r) => r.id === record.duplicateOf)!;
    if (existing.some((r) => r.id === record.id)) throw new ForgeError(`Reference id "${record.id}" is taken.`, 409);
    record.file = this.store.relative(this.store.storeReferenceFile(job.character, record.id, path.extname(file.file) || ".png", bytes));
    this.store.saveReferences(job.character, [...existing, record]);
    this.store.logEvent(job.character, { type: "reference_adopted", id: record.id, fromJob: jobId, index, sha256: record.metrics.sha256 });
    return record;
  }

  /* ------------------------------ cosmos ------------------------------ */

  /**
   * Put a finished asset into the Cosmos. Only a downloaded job whose GLB
   * the inspector passed can be placed; the placement points at that
   * version's file, so later generations never change what is standing there.
   */
  private attachment(value: unknown): PlacementAttachment | null {
    if (!value || typeof value !== "object") return null;
    const a = value as Record<string, unknown>;
    const character = String(a.character ?? "lelu_character");
    const bone = String(a.bone ?? "").trim();
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(bone)) throw new ForgeError("attach.bone must be a bone name such as Head, Spine02 or LeftHand.");
    const vec = (v: unknown, limit: number): [number, number, number] => {
      const arr = Array.isArray(v) ? v : [];
      return [0, 1, 2].map((i) => (typeof arr[i] === "number" && Number.isFinite(arr[i]) ? Math.max(-limit, Math.min(limit, arr[i] as number)) : 0)) as [number, number, number];
    };
    this.store.characterDir(character);
    return { character, bone, offset: vec(a.offset, 5), rotation: vec(a.rotation, Math.PI * 2) };
  }

  private slotName(value: unknown): string | null {
    if (value === undefined || value === null || value === "") return null;
    const slot = String(value).toLowerCase();
    if (!/^[a-z0-9_-]{1,32}$/.test(slot)) throw new ForgeError("slot must be lowercase letters, digits, _ or -.");
    return slot;
  }

  /**
   * Put a wearable slot on or take it off (hood up / hood down) — the
   * character model is untouched; only that component's visibility changes.
   */
  wear(character: string, slot: string, worn: boolean): CosmosPlacement[] {
    const name = this.slotName(slot);
    const placements = this.store.placements();
    const hits = placements.filter((p) => p.slot === name && p.attach?.character === character);
    if (!hits.length) throw new ForgeError(`${character} has no wearable in slot "${name}".`, 404);
    for (const p of hits) p.worn = worn;
    this.store.savePlacements(placements);
    this.store.logEvent(character, { type: "wearable_changed", slot: name, worn });
    return hits;
  }

  /** Move, re-size, re-label, attach to a bone, or detach (attach: null) an existing placement. */
  updatePlacement(placementId: string, patch: Record<string, unknown>): CosmosPlacement {
    const placements = this.store.placements();
    const index = placements.findIndex((p) => p.id === placementId);
    if (index === -1) throw new ForgeError(`No placement ${placementId}.`, 404);
    const current = placements[index];
    const num = (v: unknown, fallback: number, min: number, max: number) =>
      typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
    const p = Array.isArray(patch.position) ? patch.position : [];
    const next: CosmosPlacement = {
      ...current,
      label: typeof patch.label === "string" && patch.label.trim() ? patch.label.trim().slice(0, 80) : current.label,
      position: [num(p[0], current.position[0], -40, 40), num(p[1], current.position[1], -20, 20), num(p[2], current.position[2], -40, 40)],
      rotationY: num(patch.rotationY, current.rotationY, -Math.PI * 2, Math.PI * 2),
      height: num(patch.height, current.height, 0.01, 20),
      attach: "attach" in patch ? this.attachment(patch.attach) : (current.attach ?? null),
      slot: "slot" in patch ? this.slotName(patch.slot) : (current.slot ?? null),
      worn: typeof patch.worn === "boolean" ? patch.worn : current.worn,
    };
    placements[index] = next;
    this.store.savePlacements(placements);
    this.store.logEvent(current.character, { type: "cosmos_updated", placementId, attach: next.attach ?? null });
    return next;
  }

  place(input: { jobId: string; label?: string; position?: unknown; rotationY?: unknown; height?: unknown; attach?: unknown; slot?: unknown; worn?: unknown; environmentId?: unknown }): CosmosPlacement {
    const job = this.store.job(input.jobId);
    if (!job) throw new ForgeError(`No job ${input.jobId}.`, 404);
    // A job can offer its own model ("model") or an optimized runtime copy
    // written by the Blender export stage ("model-runtime"); either is a real,
    // inspected GLB and either may be placed. The runtime copy is preferred so
    // the Cosmos holds the lighter mesh.
    const model = job.output?.files.find((f) => f.role === "model-runtime") ?? job.output?.files.find((f) => f.role === "model");
    if (job.status !== "SUCCEEDED" || !model) throw new ForgeError("Only a finished, downloaded job can be placed.", 409);
    if (!job.validation?.verdict.meshValid) throw new ForgeError("Its GLB did not pass inspection, so it is not placed.", 422, job.validation?.problems ?? []);
    const placements = this.store.placements();
    const num = (v: unknown, fallback: number, min: number, max: number) =>
      typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
    // Default spot: on LÉLU's floor (y −2.55, she stands at x 0, z 3.3),
    // alternating left/right of her and stepping outward per placement.
    const n = placements.length;
    const side = n % 2 === 0 ? 1 : -1;
    const p = Array.isArray(input.position) ? input.position : [];
    const placement: CosmosPlacement = {
      id: `pl_${Date.now().toString(36)}_${createHash("sha1").update(String(Math.random())).digest("hex").slice(0, 4)}`,
      jobId: job.id,
      character: job.character,
      label: (input.label ?? job.purpose ?? job.kind).toString().slice(0, 80) || job.kind,
      file: model.file,
      position: [num(p[0], side * (2.2 + 1.6 * Math.floor(n / 2)), -40, 40), num(p[1], -2.55, -20, 20), num(p[2], 2.6, -40, 40)],
      rotationY: num(input.rotationY, 0, -Math.PI * 2, Math.PI * 2),
      height: num(input.height, input.attach ? 0.3 : 2, 0.01, 20),
      attach: this.attachment(input.attach),
      slot: this.slotName(input.slot),
      worn: input.attach ? input.worn !== false : undefined,
      environmentId: !input.attach && typeof input.environmentId === "string" && input.environmentId ? input.environmentId : undefined,
      createdAt: Date.now(),
    };
    this.store.savePlacements([...placements, placement]);
    this.store.logEvent(job.character, { type: "cosmos_placed", placementId: placement.id, jobId: job.id });
    return placement;
  }

  unplace(placementId: string): CosmosPlacement {
    const placements = this.store.placements();
    const found = placements.find((p) => p.id === placementId);
    if (!found) throw new ForgeError(`No placement ${placementId}.`, 404);
    this.store.savePlacements(placements.filter((p) => p.id !== placementId));
    this.store.logEvent(found.character, { type: "cosmos_removed", placementId, jobId: found.jobId });
    return found;
  }

  /** Every finished, inspected asset across characters and prop collections — what can be reused or placed. */
  library() {
    return this.store
      .allJobs()
      .filter((j) => j.status === "SUCCEEDED" && j.output)
      .map((j) => ({
        jobId: j.id,
        character: j.character,
        kind: j.kind,
        purpose: j.purpose,
        dir: j.output!.dir,
        model: j.output!.files.find((f) => f.role === "model")?.file ?? null,
        preview: j.output!.files.find((f) => f.role === "preview")?.file ?? null,
        meshValid: j.validation?.verdict.meshValid ?? false,
        rigValid: j.validation?.verdict.rigValid ?? false,
        consumedCredits: j.consumedCredits,
        finishedAt: j.finishedAt,
      }));
  }

  /**
   * Write motion.glb for an animation job collected before motion extraction
   * existed. Free: reads the job's own downloaded GLB.
   */
  ensureMotion(jobId: string): ForgeOutputFile {
    const job = this.store.job(jobId);
    if (!job || job.kind !== "animation" || !job.output) throw new ForgeError("Not a collected animation job.");
    const existing = job.output.files.find((f) => f.role === "motion");
    if (existing) return existing;
    const model = job.output.files.find((f) => f.role === "model");
    if (!model) throw new ForgeError("The job has no GLB to extract motion from.");
    const bytes = new Uint8Array(readFileSync(this.store.absolute(model.file)));
    const file = this.store.writeOutput(this.store.absolute(job.output.dir), "motion.glb", "motion", motionOnlyGlb(bytes, animationName(job)));
    job.output.files.push(file);
    this.store.saveJob(job);
    return file;
  }

  /** Files the Cosmos needs to show the character: the best validated model plus clips. */
  activeCharacter(character: string) {
    const manifest = this.store.manifest(character);
    const fileFor = (jobId: string | undefined) => {
      const job = jobId ? this.store.job(jobId) : null;
      // For a clip, its motion-only file: her body is already loaded once.
      const model = job?.output?.files.find((f) => f.role === "motion") ?? job?.output?.files.find((f) => f.role === "model");
      // A job can be in the ledger while its bytes are not on this machine: a
      // fresh clone, a restored backup, or a version folder that never copied.
      // Advertising it hands the Cosmos a URL that can only 404 and hides her
      // behind "asset download failed", when a perfectly good approved rig
      // sits one slot down. Missing bytes mean missing, so the caller's
      // fallback (look → rig → base) can do its job.
      if (!job || !model || !existsSync(this.store.absolute(model.file))) return null;
      return { jobId: job.id, kind: job.kind, file: model.file, verdict: job.validation?.verdict ?? null };
    };
    const animations: Record<string, ReturnType<typeof fileFor>> = {};
    for (const [slot, jobId] of Object.entries(manifest.active)) {
      if (slot.startsWith("animation:")) animations[slot.slice("animation:".length)] = fileFor(jobId);
    }
    const looks: Record<string, ReturnType<typeof fileFor>> = {};
    for (const [slot, jobId] of Object.entries(manifest.active)) {
      if (slot.startsWith("look:")) looks[slot.slice("look:".length)] = fileFor(jobId);
    }
    const currentLook = manifest.currentLook && looks[manifest.currentLook] ? manifest.currentLook : null;
    const model = (currentLook ? looks[currentLook] : null) ?? fileFor(manifest.active.rig) ?? fileFor(manifest.active.base);
    return { character, model, base: fileFor(manifest.active.base), rig: fileFor(manifest.active.rig), animations, looks, currentLook };
  }

  /* ----------------------------- wardrobe ----------------------------- */

  /**
   * Register a finished asset so it can be worn. A `look` becomes a
   * look:<name> slot (it replaces her whole model); anything else becomes
   * a piece with a bone to follow and an interchangeable slot. Nothing is
   * regenerated and nothing is spent: this only names an asset that
   * already finished and passed inspection.
   */
  addWardrobeItem(
    character: string,
    input: { id: string; name?: string; category?: string; slot?: string; jobId: string; bone?: string; offset?: unknown; rotation?: unknown; height?: number },
  ) {
    const job = this.store.job(String(input.jobId ?? ""));
    if (!job || job.character !== character) throw new ForgeError(`No job ${input.jobId} for ${character}.`, 404);
    if (job.status !== "SUCCEEDED" || !job.output) throw new ForgeError("Only a finished, downloaded job can be worn.", 409);
    if (!job.validation?.verdict.meshValid) throw new ForgeError("Its GLB did not pass inspection, so it cannot be worn.", 422, job.validation?.problems ?? []);
    const id = String(input.id ?? "");
    if (!/^[a-z0-9][a-z0-9_-]{1,40}$/.test(id)) throw new ForgeError("Wardrobe ids are 2–41 lowercase letters, digits, _ or -.");
    const category = String(input.category ?? "accessory") as WardrobeCategory;
    if (!WARDROBE_CATEGORIES.has(category)) {
      throw new ForgeError(`"${category}" is not a wardrobe category.`, 422, [`Categories: ${[...WARDROBE_CATEGORIES].join(", ")}.`]);
    }
    if (category === "look") {
      const manifest = this.approveSlot(character, `look:${id}`, job.id);
      return { item: { id, category, slot: "look", jobId: job.id, bone: null }, wardrobe: this.wardrobeView(character), manifest };
    }
    const slot = this.slotName(input.slot ?? category);
    if (!slot) throw new ForgeError("slot is required for a worn piece (e.g. hair, earrings, bag).");
    const bone = String(input.bone ?? DEFAULT_BONE[category] ?? "Spine02");
    if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(bone)) throw new ForgeError("bone must be a bone name such as Head, Neck or RightHand.");
    const vec = (v: unknown, limit: number): [number, number, number] => {
      const arr = Array.isArray(v) ? v : [];
      return [0, 1, 2].map((i) => (typeof arr[i] === "number" && Number.isFinite(arr[i]) ? Math.max(-limit, Math.min(limit, arr[i] as number)) : 0)) as [number, number, number];
    };
    const item: WardrobeItem = {
      id,
      name: String(input.name ?? id).trim().slice(0, 80) || id,
      slot,
      category,
      jobId: job.id,
      bone,
      offset: vec(input.offset, 5),
      rotation: vec(input.rotation, Math.PI * 2),
      height: typeof input.height === "number" && Number.isFinite(input.height) ? Math.min(5, Math.max(0.02, input.height)) : 0.3,
      createdAt: Date.now(),
    };
    // Re-registering an id replaces its settings; the asset it pointed at is kept.
    this.store.saveWardrobeItems(character, [...this.store.wardrobeItems(character).filter((i) => i.id !== id), item]);
    this.store.logEvent(character, { type: "wardrobe_item_registered", id, slot, category, jobId: job.id, bone });
    return { item, wardrobe: this.wardrobeView(character) };
  }

  /**
   * Everything she can switch between: approved looks, and every worn
   * slot with the pieces registered for it and whether each is on.
   */
  wardrobeView(character: string) {
    const manifest = this.store.manifest(character);
    const placed = this.store.placements();
    const model = (jobId: string | undefined) => {
      const job = jobId ? this.store.job(jobId) : null;
      const file = job?.output?.files.find((f) => f.role === "model");
      return job && file ? { jobId: job.id, kind: job.kind, file: file.file, verdict: job.validation?.verdict ?? null } : null;
    };
    const looks = Object.entries(manifest.active)
      .filter(([slot]) => slot.startsWith("look:"))
      .map(([slot, jobId]) => {
        const name = slot.slice("look:".length);
        return { id: name, ...(model(jobId) ?? { jobId, kind: null, file: null, verdict: null }), showing: manifest.currentLook === name };
      });
    const slots = new Map<string, { slot: string; category: WardrobeCategory; wornId: string | null; items: Array<Record<string, unknown>> }>();
    for (const item of this.store.wardrobeItems(character)) {
      const entry = slots.get(item.slot) ?? { slot: item.slot, category: item.category, wornId: null, items: [] };
      const piece = placed.find((p) => p.attach?.character === character && p.item === item.id);
      const worn = Boolean(piece && piece.worn !== false);
      if (worn) entry.wornId = item.id;
      entry.items.push({ ...item, ...(model(item.jobId) ?? { file: null }), worn, placementId: piece?.id ?? null });
      slots.set(item.slot, entry);
    }
    return { character, currentLook: manifest.currentLook ?? null, looks, slots: [...slots.values()] };
  }

  /**
   * Put an outfit on: switch the look and swap any worn pieces in one
   * call. `wear` maps a slot to an item id (put that one on, taking off
   * whatever was in the slot) or to null (take the slot off). Everything
   * is validated before anything changes, so a bad id leaves her as she
   * was.
   */
  dressOutfit(character: string, input: { look?: unknown; wear?: unknown }) {
    const manifest = this.store.manifest(character);
    const approved = Object.keys(manifest.active).filter((s) => s.startsWith("look:")).map((s) => s.slice("look:".length));
    let look: string | null = manifest.currentLook ?? null;
    const lookGiven = "look" in input && input.look !== undefined;
    if (lookGiven) {
      if (input.look === null || input.look === "") look = null;
      else {
        const name = String(input.look);
        if (!approved.includes(name)) {
          throw new ForgeError(`No approved look "${name}" for ${character}.`, 404, [`Approved looks: ${approved.join(", ") || "none (approve one with slot look:<name>)"}.`]);
        }
        look = name;
      }
    }
    const items = this.store.wardrobeItems(character);
    const wear = (input.wear ?? {}) as Record<string, unknown>;
    if (wear === null || typeof wear !== "object" || Array.isArray(wear)) throw new ForgeError("wear must be an object of slot: item id or null.");
    const plan = Object.entries(wear).map(([rawSlot, value]) => {
      const slot = this.slotName(rawSlot);
      if (!slot) throw new ForgeError("wear keys are wearable slots such as hair, earrings or bag.");
      if (value === null || value === "") return { slot, item: null as WardrobeItem | null };
      if (typeof value !== "string") throw new ForgeError(`wear.${rawSlot} must be a wardrobe item id, or null to take the slot off.`);
      const item = items.find((i) => i.id === value);
      if (!item) throw new ForgeError(`No wardrobe item "${value}" for ${character}.`, 404, [items.length ? `Items: ${items.map((i) => i.id).join(", ")}.` : "The wardrobe is empty."]);
      if (item.slot !== slot) throw new ForgeError(`"${value}" belongs in slot "${item.slot}", not "${slot}".`, 422);
      return { slot, item };
    });

    // Validated: switch the look, then swap the pieces in those slots.
    if (lookGiven) this.setLook(character, look);
    const placements = this.store.placements();
    const slots = new Set(plan.map((p) => p.slot));
    let touched = false;
    for (const p of placements) {
      if (p.attach?.character === character && p.slot && slots.has(p.slot) && p.worn !== false) {
        p.worn = false;
        touched = true;
      }
    }
    if (touched) this.store.savePlacements(placements);

    const dressed: Array<{ slot: string; item: string | null; placementId: string | null }> = [];
    for (const { slot, item } of plan) {
      if (!item) {
        dressed.push({ slot, item: null, placementId: null });
        continue;
      }
      const current = this.store.placements();
      const existing = current.find((p) => p.attach?.character === character && p.item === item.id && p.slot === slot);
      if (existing) {
        const updated = this.updatePlacement(existing.id, { worn: true, label: item.name });
        dressed.push({ slot, item: item.id, placementId: updated.id });
        continue;
      }
      const created = this.place({
        jobId: item.jobId,
        label: item.name,
        attach: { character, bone: item.bone, offset: item.offset, rotation: item.rotation },
        slot,
        worn: true,
        height: item.height,
      });
      const withItem = this.store.placements();
      const target = withItem.find((p) => p.id === created.id);
      if (target) {
        target.item = item.id;
        this.store.savePlacements(withItem);
      }
      dressed.push({ slot, item: item.id, placementId: created.id });
    }
    this.store.logEvent(character, { type: "dressed", look: this.store.manifest(character).currentLook ?? null, wear: dressed });
    return { manifest: this.store.manifest(character), dressed, wardrobe: this.wardrobeView(character) };
  }

  /** Switch what the Cosmos shows (e.g. hood up / hood down). null returns to the rig/base. */
  setLook(character: string, look: string | null) {
    try {
      return this.store.setCurrentLook(character, look);
    } catch (error) {
      throw new ForgeError(error instanceof Error ? error.message : String(error), 404);
    }
  }
}

/** The slot name an animation job was made for ("Phase H motion: wave" → "wave"). */
function animationName(job: ForgeJob): string {
  const match = /motion:\s*([\w-]+)/.exec(job.purpose ?? "");
  return match ? match[1] : job.id;
}
