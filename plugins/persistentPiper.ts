/**
 * ==========================================================
 * LÉLU — PERSISTENT SPEECH RUNTIME (warm Piper workers)
 * ==========================================================
 *
 * Mission 22.9 / WP01.
 *
 * M22.8 measured a cold Piper process per sentence: 511–630 ms each, of
 * which ~290 ms was loading the 63 MB ONNX voice, every single sentence.
 * The measurements that shaped this file (piper-persistence-probe.sh,
 * piper-streaming-probe.sh, piper-delivery-probe.sh):
 *
 *   · 5 sentences, 5 cold processes ................. 7 237 ms
 *   · 5 sentences, one `--json-input` process ....... 1 225 ms
 *   · `--output_raw` + `--json-input` ............... 10 bytes (unusable)
 *   · `output_file: "-"` in json mode ............... 2 bytes (unusable)
 *   · output file during synthesis .................. 0 bytes, then full
 *   · per-request `length_scale` over json ........... IGNORED
 *   · warm worker resident memory ................... 111.5 MiB
 *
 * So: one long-lived process per DELIVERY PROFILE, fed JSON lines, each
 * request writing a complete WAV to a private temp file. The model is
 * loaded once per profile and never again; a profile costs ~1/4 of its
 * cold cost per sentence afterwards.
 *
 * WHAT THIS COSTS, SAID PLAINLY
 *
 * `--json-input` cannot stream raw PCM (measured above), so audio for a
 * sentence arrives complete instead of sample-by-sample. At a warm
 * synthesis cost of 80–200 ms against a 2–4 s playback duration, the
 * synthesis-ahead queue still always has the next sentence ready before
 * the current one ends — the audible property that mattered — and the
 * first sample of a sentence now arrives sooner than the OLD path's
 * model load alone. The streaming `--output_raw` path is kept intact and
 * is used when the warm runtime is disabled (`LELU_PIPER_PERSISTENT=0`)
 * or when a warm worker fails.
 *
 * LIFECYCLE
 *
 * - spawn lazily per profile, or `prewarm()` at boot so the first reply
 *   a visitor hears is already warm;
 * - requests are serialised per worker (one line at a time), profiles run
 *   in parallel;
 * - a cancelled request stops being awaited, its file is swept, and the
 *   worker keeps its loaded model (killing it would cost a model load per
 *   barge-in);
 * - a crashed worker rejects its in-flight request and is respawned on the
 *   next request, counted in `restarts`;
 * - a worker that dies before ever completing a request is a model load
 *   failure, reported as such instead of silently retrying forever;
 * - every fact an operator needs (model loads, restarts, queue depth,
 *   cancellations, RSS, PID, uptime) is exposed through `stats()` and
 *   served by /api/voice/diagnostic. No text and no credential is kept.
 * ==========================================================
 */

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, openSync, closeSync, readSync, readFileSync, rmSync, statSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_SPEECH_PROFILE,
  SPEECH_PROFILE_IDS,
  speechProfile,
  speechProfileArgs,
  type SpeechProfileId,
} from "../src/core/voice/speechProfile.ts";

/** One completed synthesis: the WAV bytes plus how they were produced. */
export interface PiperSynthesis {
  wav: Buffer;
  /** The delivery used; always one of the closed profile set. */
  profile: SpeechProfileId;
  /** Time from submitting the text to holding the complete WAV. */
  synthesisMs: number;
  /** Whether this sentence paid for the model load (first use of a profile). */
  coldStart: boolean;
  /** Worker identity, so a log can show one process served many sentences. */
  workerPid: number | null;
  /** Model loads this pool has performed at the time of this answer. */
  modelLoads: number;
}

export interface PiperWorkerSnapshot {
  profile: SpeechProfileId;
  state: "absent" | "starting" | "ready" | "busy" | "dead";
  pid: number | null;
  alive: boolean;
  uptimeMs: number;
  requests: number;
  failures: number;
  cancelled: number;
  restarts: number;
  lastSynthesisMs: number | null;
  /** Median of the last 20 syntheses, measured — never estimated. */
  medianSynthesisMs: number | null;
  rssMiB: number | null;
  lastError: string | null;
}

export interface PiperPoolSnapshot {
  /** A warm runtime exists for this bin/model pair. */
  persistent: boolean;
  /** Warm workers currently holding a loaded model. */
  warmWorkers: number;
  modelLoads: number;
  modelLoadFailures: number;
  restarts: number;
  requests: number;
  failures: number;
  cancelled: number;
  queueDepth: number;
  active: number;
  workers: PiperWorkerSnapshot[];
  note: string;
}

export interface SynthesizeOptions {
  profile?: SpeechProfileId;
  signal?: AbortSignal;
}

/** Raised when a request cannot be honoured; `code` says why. */
export class PiperError extends Error {
  public readonly code:
    | "cancelled"
    | "queue-full"
    | "timeout"
    | "worker-crashed"
    | "spawn-failed"
    | "empty-output"
    | "shutting-down";

  public constructor(code: PiperError["code"], message: string) {
    super(message);
    this.name = "PiperError";
    this.code = code;
  }
}

interface Job {
  text: string;
  output: string;
  enqueuedAt: number;
  /** True once the line has been written to the worker. */
  started: boolean;
  /** True when this request paid for the model load of a new worker. */
  cold: boolean;
  settled: boolean;
  resolve: (value: PiperSynthesis) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  abortListener?: () => void;
  poll?: ReturnType<typeof setInterval>;
  deadline?: ReturnType<typeof setTimeout>;
}

export interface PersistentPiperOptions {
  bin: string;
  model: string;
  /** Per-request ceiling. A hung synthesiser is killed, not waited on. */
  requestTimeoutMs?: number;
  /** How long a spawn may take before it is called a load failure. */
  loadGraceMs?: number;
  /** Bounded queue per profile: a runaway client cannot grow memory. */
  maxQueuePerProfile?: number;
  /** Poll cadence for the output file's completion. */
  pollMs?: number;
  /** Injectable for tests; production uses a real child process. */
  workerFactory?: (profile: SpeechProfileId) => WorkerLike;
}

/** Fully-resolved worker configuration, including the private temp dir. */
interface WorkerOptions {
  bin: string;
  model: string;
  requestTimeoutMs: number;
  loadGraceMs: number;
  maxQueuePerProfile: number;
  pollMs: number;
  workdir: string;
  workerFactory?: (profile: SpeechProfileId) => WorkerLike;
}

/** The seam tests use in place of a real child process. */
export interface WorkerLike {
  pid: number | null;
  onExit(listener: (code: number | null, signal: string | null) => void): void;
  send(line: string): void;
  kill(): void;
}

function readDataSize(path: string, size: number): number | null {
  if (size < 44) return null;
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const header = Buffer.alloc(44);
    readSync(fd, header, 0, 44, 0);
    // "RIFF"…"WAVE", then at 40 the little-endian data-chunk size.
    if (header.toString("ascii", 0, 4) !== "RIFF") return null;
    return header.readUInt32LE(40);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        // already closed
      }
    }
  }
}

function processRssMiB(pid: number | null): number | null {
  if (!pid) return null;
  try {
    const status = readFileSync(`/proc/${pid}/status`, "utf8");
    const match = /VmRSS:\s+(\d+)\s+kB/.exec(status);
    if (!match) return null;
    return Math.round(Number(match[1]) / 1024);
  } catch {
    return null;
  }
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const center = sorted[middle] ?? 0;
  if (sorted.length % 2 === 1) return Math.round(center);
  const below = sorted[middle - 1] ?? center;
  return Math.round((center + below) / 2);
}

/**
 * One warm process for one delivery profile.
 *
 * The worker owns the process, the queue and the measurements. It never
 * interprets text and never decides a profile: it is told which delivery
 * to run and it runs it.
 */
class ProfileWorker {
  private child: WorkerLike | null = null;
  private childPid: number | null = null;
  private spawnedAt = 0;
  private readonly queue: Job[] = [];
  private inFlight: Job | null = null;
  private shuttingDown = false;
  private readonly sweep: Set<string> = new Set();

  private requests = 0;
  private failures = 0;
  private cancelled = 0;
  private restarts = 0;
  private modelLoads = 0;
  private lastSynthesisMs: number | null = null;
  private readonly recentMs: number[] = [];
  private lastError: string | null = null;
  /** Set when a spawn never produced a single request: a load failure. */
  private everCompleted = false;
  private modelLoadFailed = false;

  private readonly profileId: SpeechProfileId;
  private readonly options: WorkerOptions;

  public constructor(profileId: SpeechProfileId, options: WorkerOptions) {
    this.profileId = profileId;
    this.options = options;
  }

  /** True when this profile's process never managed to load its voice. */
  public get loadFailed(): boolean {
    return this.modelLoadFailed;
  }

  public get profile(): SpeechProfileId {
    return this.profileId;
  }

  public get depth(): number {
    return this.queue.length;
  }

  public get active(): boolean {
    return this.inFlight !== null;
  }

  public get loadedModel(): boolean {
    return this.child !== null;
  }

  /** Total model initialisations this profile has caused. */
  public get modelLoadCount(): number {
    return this.modelLoads;
  }

  /** Spawn now, and prove the model is usable with a throwaway request. */
  public async prewarm(): Promise<void> {
    try {
      await this.synthesize("Ready.", {});
    } catch {
      // A prewarm that fails is reported through stats(), not thrown at boot.
    }
  }

  public synthesize(text: string, options: SynthesizeOptions): Promise<PiperSynthesis> {
    if (this.shuttingDown) {
      return Promise.reject(new PiperError("shutting-down", "The speech runtime is shutting down."));
    }
    if (this.queue.length + (this.inFlight ? 1 : 0) >= this.options.maxQueuePerProfile) {
      return Promise.reject(new PiperError("queue-full", "The speech queue is full."));
    }
    if (options.signal?.aborted) {
      return Promise.reject(new PiperError("cancelled", "The request was cancelled."));
    }
    return new Promise<PiperSynthesis>((resolve, reject) => {
      const job: Job = {
        text,
        output: join(this.directory(), `${this.profileId}-${Date.now()}-${this.requests + this.queue.length}.wav`),
        enqueuedAt: Date.now(),
        started: false,
        cold: false,
        settled: false,
        resolve,
        reject,
        ...(options.signal ? { signal: options.signal } : {}),
      };
      if (options.signal) {
        job.abortListener = () => this.cancel(job);
        options.signal.addEventListener("abort", job.abortListener, { once: true });
      }
      this.queue.push(job);
      this.pump();
    });
  }

  private directory(): string {
    return this.options.workdir;
  }

  private finish(job: Job): void {
    job.settled = true;
    if (job.poll) clearInterval(job.poll);
    if (job.deadline) clearTimeout(job.deadline);
    if (job.abortListener && job.signal) job.signal.removeEventListener("abort", job.abortListener);
  }

  private cancel(job: Job): void {
    if (job.settled) return;
    this.cancelled += 1;
    this.finish(job);
    if (!job.started) {
      const index = this.queue.indexOf(job);
      if (index >= 0) this.queue.splice(index, 1);
    } else {
      // The process is still writing this sentence; it cannot be
      // interrupted without losing the loaded model. Let it finish into a
      // file nobody will read, and delete that file when it appears.
      this.sweep.add(job.output);
      if (this.inFlight === job) this.inFlight = null;
    }
    job.reject(new PiperError("cancelled", "The request was cancelled."));
  }

  /** Write the next queued job to the warm process. */
  private pump(): void {
    if (this.inFlight || this.shuttingDown) return;
    const job = this.queue.shift();
    if (!job) return;
    if (job.settled) {
      this.pump();
      return;
    }
    let child: WorkerLike;
    const loadsBefore = this.modelLoads;
    try {
      child = this.ensureChild();
      job.cold = this.modelLoads > loadsBefore;
    } catch (error) {
      this.failures += 1;
      this.lastError = (error as Error).message;
      this.finish(job);
      job.reject(error instanceof Error ? error : new PiperError("spawn-failed", String(error)));
      this.pump();
      return;
    }
    this.inFlight = job;
    job.started = true;
    this.sweepStale();
    try {
      child.send(JSON.stringify({ text: job.text, output_file: job.output }));
    } catch (error) {
      this.failures += 1;
      this.lastError = `write-failed: ${(error as Error).message}`;
      this.inFlight = null;
      this.finish(job);
      job.reject(new PiperError("worker-crashed", "The speech worker could not accept the request."));
      this.pump();
      return;
    }
    job.deadline = setTimeout(() => this.onTimeout(job), this.options.requestTimeoutMs);
    job.poll = setInterval(() => this.onPoll(job), this.options.pollMs);
  }

  private onTimeout(job: Job): void {
    if (job.settled) return;
    this.failures += 1;
    this.lastError = `timeout after ${this.options.requestTimeoutMs} ms`;
    this.finish(job);
    if (this.inFlight === job) this.inFlight = null;
    // A hung synthesiser cannot be trusted with the next sentence.
    this.killChild("timeout");
    this.sweep.add(job.output);
    job.reject(new PiperError("timeout", "The speech worker did not answer in time."));
    this.pump();
  }

  private onPoll(job: Job): void {
    if (job.settled) return;
    let size = 0;
    try {
      size = statSync(job.output).size;
    } catch {
      return; // not created yet
    }
    if (size <= 44) return;
    const dataSize = readDataSize(job.output, size);
    // Piper patches the WAV header with the real data length as its last
    // write (measured), so "header says N and the file holds N + 44" is
    // the completion signal — not a file that merely exists.
    if (dataSize === null || dataSize + 44 !== size || dataSize === 0) return;
    let wav: Buffer;
    try {
      wav = readFileSync(job.output);
    } catch {
      return;
    }
    this.finish(job);
    if (this.inFlight === job) this.inFlight = null;
    this.requests += 1;
    this.everCompleted = true;
    const synthesisMs = Date.now() - job.enqueuedAt;
    this.lastSynthesisMs = synthesisMs;
    this.recentMs.push(synthesisMs);
    if (this.recentMs.length > 20) this.recentMs.shift();
    try {
      unlinkSync(job.output);
    } catch {
      // the sweep will catch it
    }
    job.resolve({
      wav,
      profile: this.profileId,
      synthesisMs,
      coldStart: job.cold,
      workerPid: this.childPid,
      modelLoads: this.modelLoads,
    });
    this.pump();
  }

  private sweepStale(): void {
    for (const path of [...this.sweep]) {
      try {
        unlinkSync(path);
        this.sweep.delete(path);
      } catch {
        // not written yet; a later sweep will collect it
      }
    }
  }

  private ensureChild(): WorkerLike {
    if (this.child) return this.child;
    this.modelLoads += 1;
    this.spawnedAt = Date.now();
    const child = this.options.workerFactory
      ? this.options.workerFactory(this.profileId)
      : spawnWorker(this.options.bin, this.options.model, this.profileId);
    this.child = child;
    this.childPid = child.pid;
    child.onExit((code, signal) => this.onExit(child, code, signal));
    return child;
  }

  private onExit(child: WorkerLike, code: number | null, signal: string | null): void {
    if (this.child !== child) return;
    this.child = null;
    this.childPid = null;
    const job = this.inFlight;
    this.inFlight = null;
    const lived = Date.now() - this.spawnedAt;
    const description = `worker exited (code ${String(code)}, signal ${String(signal)}) after ${lived} ms`;
    if (!this.everCompleted && lived <= this.options.loadGraceMs) {
      // Never produced a single sentence: the model could not be loaded.
      this.modelLoadFailed = true;
      this.lastError = `model load failed: ${description}`;
    } else if (!this.shuttingDown) {
      this.restarts += 1;
      this.lastError = description;
    }
    if (job && !job.settled) {
      this.finish(job);
      this.failures += 1;
      job.reject(new PiperError("worker-crashed", "The speech worker stopped unexpectedly."));
    }
    if (!this.shuttingDown) this.pump();
  }

  private killChild(reason: string): void {
    const child = this.child;
    if (!child) return;
    this.child = null;
    this.childPid = null;
    this.restarts += 1;
    this.lastError = `worker killed: ${reason}`;
    try {
      child.kill();
    } catch {
      // already gone
    }
  }

  public stop(): void {
    this.shuttingDown = true;
    for (const job of this.queue.splice(0)) {
      if (!job.settled) {
        this.finish(job);
        job.reject(new PiperError("shutting-down", "The speech runtime is shutting down."));
      }
    }
    const job = this.inFlight;
    this.inFlight = null;
    if (job && !job.settled) {
      this.finish(job);
      job.reject(new PiperError("shutting-down", "The speech runtime is shutting down."));
    }
    const child = this.child;
    this.child = null;
    this.childPid = null;
    if (child) {
      try {
        child.kill();
      } catch {
        // already gone
      }
    }
  }

  public snapshot(): PiperWorkerSnapshot {
    const alive = this.child !== null;
    const state: PiperWorkerSnapshot["state"] = !alive
      ? this.requests > 0
        ? "dead"
        : "absent"
      : this.inFlight
        ? "busy"
        : "ready";
    return {
      profile: this.profileId,
      state,
      pid: this.childPid,
      alive,
      uptimeMs: alive ? Date.now() - this.spawnedAt : 0,
      requests: this.requests,
      failures: this.failures,
      cancelled: this.cancelled,
      restarts: this.restarts,
      lastSynthesisMs: this.lastSynthesisMs,
      medianSynthesisMs: median(this.recentMs),
      rssMiB: processRssMiB(this.childPid),
      lastError: this.lastError,
    };
  }
}

/** The production worker: one `piper --json-input` child process. */
function spawnWorker(bin: string, model: string, profileId: SpeechProfileId): WorkerLike {
  const profile = speechProfile(profileId);
  const child: ChildProcess = spawn(
    bin,
    ["--model", model, "--json-input", ...speechProfileArgs(profile)],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  const exitListeners: Array<(code: number | null, signal: string | null) => void> = [];
  let stderrTail = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    // Piper's diagnostics never contain the text being spoken.
    stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-600);
  });
  // A worker that dies mid-write closes its stdin; the exit handler is what
  // reports the crash, so the pipe error itself must not become an uncaught
  // exception on the server.
  child.stdin?.on("error", () => undefined);
  child.on("exit", (code, signal) => {
    for (const listener of exitListeners) listener(code, signal);
  });
  child.on("error", () => {
    // A spawn that could not even start reports as an immediate exit.
    for (const listener of exitListeners) listener(null, "spawn-error");
  });
  return {
    pid: child.pid ?? null,
    onExit(listener) {
      exitListeners.push(listener);
    },
    send(line) {
      // The trailing newline is the protocol: one JSON document per line.
      child.stdin?.write(`${line}\n`);
    },
    kill() {
      child.kill("SIGKILL");
      void stderrTail;
    },
  };
}

/**
 * Every warm worker for one bin/model pair, keyed by delivery profile.
 *
 * One instance per server process. `synthesize` is the only entry point
 * the route needs, and it never throws for an ordinary failure — it
 * rejects with a `PiperError` whose `code` says what happened.
 */
export class PersistentPiper {
  private readonly workers = new Map<SpeechProfileId, ProfileWorker>();
  private readonly workdir: string;
  private readonly options: Omit<WorkerOptions, "workdir">;
  private closed = false;
  private totals = { requests: 0, failures: 0, cancelled: 0, restarts: 0, modelLoadFailures: 0 };

  public constructor(options: PersistentPiperOptions) {
    this.workdir = mkdtempSync(join(tmpdir(), "lelu-piper-"));
    this.options = {
      bin: options.bin,
      model: options.model,
      requestTimeoutMs: options.requestTimeoutMs ?? 20_000,
      loadGraceMs: options.loadGraceMs ?? 5_000,
      maxQueuePerProfile: options.maxQueuePerProfile ?? 8,
      pollMs: options.pollMs ?? 8,
      ...(options.workerFactory ? { workerFactory: options.workerFactory } : {}),
    };
  }

  public get binModelKey(): string {
    return `${this.options.bin}::${this.options.model}`;
  }

  private worker(profileId: SpeechProfileId): ProfileWorker {
    const existing = this.workers.get(profileId);
    if (existing) return existing;
    const created = new ProfileWorker(profileId, { ...this.options, workdir: this.workdir });
    this.workers.set(profileId, created);
    return created;
  }

  /** Load the model(s) now so the first real sentence is warm. */
  public async prewarm(profiles: readonly SpeechProfileId[] = [DEFAULT_SPEECH_PROFILE]): Promise<void> {
    if (this.closed) return;
    await Promise.all(profiles.map((profile) => this.worker(profile).prewarm()));
  }

  public async synthesize(text: string, options: SynthesizeOptions = {}): Promise<PiperSynthesis> {
    if (this.closed) throw new PiperError("shutting-down", "The speech runtime is shutting down.");
    const profileId = options.profile ?? DEFAULT_SPEECH_PROFILE;
    const worker = this.worker(profileId);
    try {
      const result = await worker.synthesize(text, options);
      this.totals.requests += 1;
      // The pool-wide count, not this worker's: "how many times has a voice
      // been loaded to answer" is the fact a reader needs, and per-worker
      // counters would make a second profile look free.
      const modelLoads = [...this.workers.values()].reduce((sum, item) => sum + item.modelLoadCount, 0);
      return { ...result, modelLoads };
    } catch (error) {
      if (error instanceof PiperError) {
        if (error.code === "cancelled") this.totals.cancelled += 1;
        else this.totals.failures += 1;
      } else {
        this.totals.failures += 1;
      }
      throw error;
    }
  }

  /** A snapshot of what the runtime really did; served by the diagnostic. */
  public stats(): PiperPoolSnapshot {
    const workers = [...this.workers.values()].map((worker) => worker.snapshot());
    const modelLoads = [...this.workers.values()].reduce((sum, worker) => sum + worker.modelLoadCount, 0);
    const warm = workers.filter((worker) => worker.alive).length;
    const modelLoadFailures = [...this.workers.values()].filter((worker) => worker.loadFailed).length;
    this.totals.modelLoadFailures = Math.max(this.totals.modelLoadFailures, modelLoadFailures);
    return {
      persistent: true,
      warmWorkers: warm,
      modelLoads,
      modelLoadFailures: this.totals.modelLoadFailures,
      restarts: workers.reduce((sum, worker) => sum + worker.restarts, 0),
      requests: workers.reduce((sum, worker) => sum + worker.requests, 0),
      failures: workers.reduce((sum, worker) => sum + worker.failures, 0),
      cancelled: workers.reduce((sum, worker) => sum + worker.cancelled, 0),
      queueDepth: [...this.workers.values()].reduce((sum, worker) => sum + worker.depth, 0),
      active: [...this.workers.values()].filter((worker) => worker.active).length,
      workers,
      note: "A warm worker loads its voice once; delivery profiles are separate workers because Piper ignores per-request length_scale over --json-input (measured).",
    };
  }

  public stop(): void {
    this.closed = true;
    for (const worker of this.workers.values()) worker.stop();
    this.workers.clear();
    try {
      rmSync(this.workdir, { recursive: true, force: true });
    } catch {
      // a temp directory that cannot be removed is not a runtime failure
    }
  }
}

/* ------------------------------------------------------------------ *
 * One runtime per bin/model pair, shared by every route instance
 * ------------------------------------------------------------------ */

const pool = new Map<string, PersistentPiper>();

export function getPersistentPiper(options: {
  bin: string;
  model: string;
  requestTimeoutMs?: number;
  maxQueuePerProfile?: number;
  pollMs?: number;
  workerFactory?: PersistentPiperOptions["workerFactory"];
}): PersistentPiper {
  const key = `${options.bin}::${options.model}`;
  const existing = pool.get(key);
  if (existing) return existing;
  const created = new PersistentPiper(options);
  pool.set(key, created);
  return created;
}

/** Shut every warm worker down (server exit, test teardown). */
export function shutdownPersistentPipers(): void {
  for (const instance of pool.values()) instance.stop();
  pool.clear();
}

/** The pool's snapshot for one bin/model pair, or null when none exists. */
export function persistentPiperStats(bin: string, model: string): PiperPoolSnapshot | null {
  return pool.get(`${bin}::${model}`)?.stats() ?? null;
}

/** Every profile id, for the prewarm and for diagnostics. */
export const ALL_SPEECH_PROFILES = SPEECH_PROFILE_IDS;
