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
import {
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
import { ForgeStore, isTerminal, type CharacterSlot, type ForgeJob, type ForgeOutputFile } from "./forgeStore.ts";

export type EnvReader = (name: string) => string | undefined;

const KEY_NAMES = ["MESHY_API_KEY", "MESHY_API", "MESSY_API", "VITE_MESHY_API_KEY"];
const DEFAULT_BASE = "https://api.meshy.ai";
const IDENTITY_BOUND: ReadonlySet<ForgeJobKind> = new Set(["image-to-3d", "multi-image-to-3d", "retexture"]);

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
  texture_urls?: Array<Record<string, string | undefined>>;
  result?: Record<string, unknown> | null;
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

  private apiKey(): string {
    for (const name of KEY_NAMES) {
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
    return KEY_NAMES.find((n) => (this.readEnv(n) ?? "").trim().length > 0) ?? null;
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
        res = await this.meshy("POST", MESHY_KINDS[job.kind].path, resolved);
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

  reject(jobId: string): ForgeJob {
    const job = this.store.job(jobId);
    if (!job) throw new ForgeError(`No job ${jobId}.`, 404);
    if (job.status !== "awaiting_approval") throw new ForgeError(`Only a job awaiting approval can be rejected (this one is ${job.status}).`, 409);
    job.status = "rejected";
    this.store.logEvent(job.character, { type: "job_rejected", jobId });
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
        res = await this.meshy("GET", taskPath(job.kind, job.meshyTaskId));
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
    const res = await this.meshy("GET", taskPath(job.kind, job.meshyTaskId));
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
    } else if (kind === "animation") {
      const r = task.result ?? {};
      add("model", "animation", r.animation_glb_url, ".glb");
      add("model-fbx", "animation", r.animation_fbx_url, ".fbx");
    } else {
      add("model", "model", task.model_urls?.glb, ".glb");
      add("pre-remesh", "pre_remeshed", task.model_urls?.pre_remeshed_glb, ".glb");
      for (const [i, set] of (task.texture_urls ?? []).entries()) {
        for (const [channel, url] of Object.entries(set)) add(`texture:${channel}`, `texture_${i}_${channel}`, url, ".png");
      }
    }
    add("preview", "preview", task.thumbnail_url, ".png");
    return out;
  }

  private async collect(job: ForgeJob, task: MeshyTask): Promise<ForgeJob> {
    const outputs = this.outputsOf(job.kind, task);
    if (!outputs.some((o) => o.role === "model")) {
      job.error = "Task succeeded but returned no GLB.";
      return this.store.saveJob(job);
    }
    const area = job.kind === "rigging" ? "rig" : job.kind === "animation" ? "animations" : "meshes";
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

    job.output = { dir: this.store.relative(dir), files };
    job.validation = primary ? inspectGlb(primary) : null;
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
    if (reasons.length) throw new ForgeError(`Job ${jobId} is not fit for slot ${slot}.`, 422, reasons);
    return this.store.setActive(character, slot, jobId);
  }

  /** Files the Cosmos needs to show the character: the best validated model plus clips. */
  activeCharacter(character: string) {
    const manifest = this.store.manifest(character);
    const fileFor = (jobId: string | undefined) => {
      const job = jobId ? this.store.job(jobId) : null;
      const model = job?.output?.files.find((f) => f.role === "model");
      return job && model ? { jobId: job.id, kind: job.kind, file: model.file, verdict: job.validation?.verdict ?? null } : null;
    };
    const animations: Record<string, ReturnType<typeof fileFor>> = {};
    for (const [slot, jobId] of Object.entries(manifest.active)) {
      if (slot.startsWith("animation:")) animations[slot.slice("animation:".length)] = fileFor(jobId);
    }
    return { character, model: fileFor(manifest.active.rig) ?? fileFor(manifest.active.base), base: fileFor(manifest.active.base), rig: fileFor(manifest.active.rig), animations };
  }
}
