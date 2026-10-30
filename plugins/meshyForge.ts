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
import { readFileSync } from "node:fs";
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
import { buildRecords } from "./forgeReferences.ts";
import { ForgeStore, isTerminal, type CharacterSlot, type CosmosPlacement, type PlacementAttachment, type ForgeJob, type ForgeOutputFile } from "./forgeStore.ts";

export type EnvReader = (name: string) => string | undefined;

const KEY_NAMES = ["MESHY_API_KEY", "MESHY_API", "MESSY_API", "VITE_MESHY_API_KEY"];
const LOOSE_KEY_NAME = /^(messy|meshy)[ _-]?api([ _-]?key)?$/i;
const DEFAULT_BASE = "https://api.meshy.ai";
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
    const outputs = this.outputsOf(job.kind, task);
    const images = IMAGE_KINDS.has(job.kind);
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
    if (!job || !IMAGE_KINDS.has(job.kind) || job.status !== "SUCCEEDED" || !job.output) {
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

  place(input: { jobId: string; label?: string; position?: unknown; rotationY?: unknown; height?: unknown; attach?: unknown; slot?: unknown; worn?: unknown }): CosmosPlacement {
    const job = this.store.job(input.jobId);
    if (!job) throw new ForgeError(`No job ${input.jobId}.`, 404);
    const model = job.output?.files.find((f) => f.role === "model");
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
    const looks: Record<string, ReturnType<typeof fileFor>> = {};
    for (const [slot, jobId] of Object.entries(manifest.active)) {
      if (slot.startsWith("look:")) looks[slot.slice("look:".length)] = fileFor(jobId);
    }
    const currentLook = manifest.currentLook && looks[manifest.currentLook] ? manifest.currentLook : null;
    const model = (currentLook ? looks[currentLook] : null) ?? fileFor(manifest.active.rig) ?? fileFor(manifest.active.base);
    return { character, model, base: fileFor(manifest.active.base), rig: fileFor(manifest.active.rig), animations, looks, currentLook };
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
