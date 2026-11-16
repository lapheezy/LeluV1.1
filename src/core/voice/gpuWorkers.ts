/**
 * ==========================================================
 * LÉLU — VOXCPM2 COMPUTE POOL (one API, many free GPU workers)
 * ==========================================================
 *
 * VoxCPM2 needs a GPU it can call its own. This module is the ONE
 * place that knows where those GPUs are, whether they are awake,
 * and which one should speak — so the rest of LÉLU never learns
 * that the worker behind her voice can be a Kaggle notebook this
 * afternoon and a Colab session tonight.
 *
 *   Kaggle GPU notebook ─┐
 *   Google Colab GPU  ───┤
 *   Hugging Face ZeroGPU ┼─→ same HTTP contract → one voice
 *   Lightning AI GPU  ───┤   (services/voxcpm/server.py)
 *   local CPU fallback ──┘
 *
 * The contract is identical on every one of them because they all
 * run the same file. A worker going to sleep is therefore an
 * availability fact, not an identity change: her voice comes from
 * `public/audio/voice/lelu-voice-reference.m4a`, which travels with
 * the code, never with the machine.
 *
 * WHAT THIS MODULE REFUSES TO DO
 * ------------------------------
 * · it never substitutes another speaker when a worker is asleep —
 *   it reports the worker unavailable and the engine decides to fall
 *   back to ElevenLabs, which is a visible, logged choice;
 * · it never reports a worker healthy because it is configured: a
 *   worker is healthy only after it ANSWERED `/health`;
 * · it never puts a token in a snapshot, a log line or an error
 *   string. `describe()` is what the dashboard and the status route
 *   are allowed to see.
 *
 * Environment
 * -----------
 *   VOXCPM_WORKERS      JSON array [{ "id", "kind", "url", "token" }]
 *                       kinds: kaggle | colab | zerogpu | lightning | tunnel | local
 *   VOXCPM_BASE_URL     single worker shorthand (kind: tunnel, or local if loopback)
 *   VOXCPM_TOKEN        bearer token for that single worker
 *   VOXCPM_LOCAL_FALLBACK  "0" disables the built-in 127.0.0.1:8788 worker
 * ==========================================================
 */

export type VoxcpmWorkerKind = "local" | "kaggle" | "colab" | "zerogpu" | "lightning" | "tunnel";

export interface VoxcpmWorker {
  id: string;
  kind: VoxcpmWorkerKind;
  /** Base URL, no trailing slash. */
  url: string;
  /** Bearer token for a public tunnel; empty for loopback. */
  token: string;
}

export type VoxcpmProbeReason =
  | "ok"
  | "unreachable"
  | "timeout"
  | "auth"
  | "busy"
  | "model-unavailable"
  | "bad-response";

export interface VoxcpmHealth {
  worker: string;
  kind: VoxcpmWorkerKind;
  available: boolean;
  reason: VoxcpmProbeReason;
  detail: string;
  latencyMs: number;
  modelId: string | null;
  device: string | null;
  gpu: boolean;
  loaded: boolean;
  /** Worker lifecycle (STARTING…READY/FAILED) when the worker reports one; null for older workers. */
  state: string | null;
  sampleRate: number | null;
  loadSeconds: number | null;
  loadError: string | null;
  referenceSeconds: number | null;
  checkedAt: number;
}

export type EnvReader = (name: string) => string | undefined;

const KINDS: readonly VoxcpmWorkerKind[] = ["local", "kaggle", "colab", "zerogpu", "lightning", "tunnel"];

/** The worker the sidecar binds to by default (services/voxcpm/server.py). */
export const LOOPBACK_WORKER_URL = "http://127.0.0.1:8788";

function rawEnv(read: EnvReader | undefined, name: string): string {
  const value = read ? read(name) : platformEnv(name);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Read the process environment without a Node type dependency: this module is
 * also bundled for the page, where `process` does not exist.
 */
function platformEnv(name: string): string | undefined {
  const scope = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return scope.process?.env?.[name];
}

function cleanUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function asKind(value: unknown): VoxcpmWorkerKind {
  const kind = String(value ?? "").toLowerCase();
  return (KINDS as readonly string[]).includes(kind) ? (kind as VoxcpmWorkerKind) : "tunnel";
}

/**
 * The configured workers, in priority order.
 *
 * JSON is preferred because a URL may contain commas and a token may contain
 * anything; the single-worker shorthand exists so the common laptop case is
 * one variable. Anything malformed is dropped rather than guessed at, because
 * a worker list is not a thing to be creative with.
 */
export function parseVoxcpmWorkers(read?: EnvReader): VoxcpmWorker[] {
  const workers: VoxcpmWorker[] = [];
  const seen = new Set<string>();
  const ids = new Set<string>();
  const add = (worker: VoxcpmWorker) => {
    if (!/^https?:\/\//i.test(worker.url)) return;
    if (seen.has(worker.url)) return;
    seen.add(worker.url);
    // Health, cooldown and choice are all keyed by id. Two workers sharing
    // one ("local" for a configured loopback worker AND the loopback
    // default) made the dead one's ECONNREFUSED overwrite the live one's
    // state: measured, /vox/health chose a READY worker while /vox/speech
    // answered "no VoxCPM2 worker is READY". The first keeps its id; a
    // later duplicate is told apart by its host.
    let id = worker.id;
    if (ids.has(id)) {
      let host = worker.url;
      try {
        host = new URL(worker.url).host;
      } catch {
        /* keep the url */
      }
      id = `${worker.id}@${host}`;
    }
    ids.add(id);
    workers.push({ ...worker, id });
  };

  const json = rawEnv(read, "VOXCPM_WORKERS");
  if (json) {
    try {
      const parsed = JSON.parse(json) as unknown;
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of list) {
        if (!entry || typeof entry !== "object") continue;
        const record = entry as Record<string, unknown>;
        const url = cleanUrl(typeof record.url === "string" ? record.url : "");
        if (!url) continue;
        add({
          id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : url,
          kind: asKind(record.kind),
          url,
          token: typeof record.token === "string" ? record.token.trim() : "",
        });
      }
    } catch {
      // A malformed list configures nothing; the single-worker shorthand and
      // the loopback default are still tried below.
    }
  }

  const base = cleanUrl(rawEnv(read, "VOXCPM_BASE_URL"));
  if (base) {
    const loopback = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/i.test(base);
    add({
      id: loopback ? "local" : "tunnel",
      kind: loopback ? "local" : "tunnel",
      url: base,
      token: rawEnv(read, "VOXCPM_TOKEN"),
    });
  }

  if (rawEnv(read, "VOXCPM_LOCAL_FALLBACK") !== "0" && !seen.has(LOOPBACK_WORKER_URL)) {
    add({ id: "local", kind: "local", url: LOOPBACK_WORKER_URL, token: "" });
  }
  return workers;
}

/** The bearer header for one worker; empty object when it needs none. */
export function workerHeaders(worker: VoxcpmWorker): Record<string, string> {
  return worker.token ? { Authorization: `Bearer ${worker.token}` } : {};
}

/**
 * Ask one worker whether it is alive, for how long, and on what.
 *
 * A `false` answer always carries a reason: "unreachable" (session asleep or
 * tunnel down), "timeout" (GPU wedged), "auth" (token rotated), "busy"
 * (queue full), "model-unavailable" (weights not loaded). Each one tells an
 * operator something different, which one "unavailable" would not.
 */
export async function probeVoxcpmWorker(
  worker: VoxcpmWorker,
  options: { timeoutMs?: number } = {},
): Promise<VoxcpmHealth> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? 2500;
  const base: VoxcpmHealth = {
    worker: worker.id,
    kind: worker.kind,
    available: false,
    reason: "unreachable",
    detail: "no answer",
    latencyMs: 0,
    modelId: null,
    device: null,
    gpu: false,
    loaded: false,
    state: null,
    sampleRate: null,
    loadSeconds: null,
    loadError: null,
    referenceSeconds: null,
    checkedAt: started,
  };

  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const response = await fetch(`${worker.url}/health`, {
      headers: { Accept: "application/json", ...workerHeaders(worker) },
      ...(controller ? { signal: controller.signal } : {}),
    });
    const latencyMs = Date.now() - started;
    if (response.status === 401 || response.status === 403) {
      return { ...base, latencyMs, reason: "auth", detail: `worker refused the token (HTTP ${response.status})` };
    }
    if (response.status === 429 || response.status === 503) {
      return { ...base, latencyMs, reason: "busy", detail: `worker is busy (HTTP ${response.status})` };
    }
    if (!response.ok) {
      return { ...base, latencyMs, reason: "bad-response", detail: `worker answered HTTP ${response.status}` };
    }
    const payload = (await response.json()) as Record<string, unknown>;
    const sampleRate = typeof payload.sampleRate === "number" ? payload.sampleRate : null;
    const device = typeof payload.device === "string" ? payload.device : null;
    const hardware = (payload.hardware ?? {}) as Record<string, unknown>;
    const reference = (payload.reference ?? null) as Record<string, unknown> | null;
    const loadError = typeof payload.loadError === "string" ? payload.loadError : null;
    const loaded = payload.loaded === true;
    // A lifecycle-aware worker says READY only after a real generation
    // produced audio; loaded-but-untested is not available. Older workers
    // report no state, and for them "loaded" is all there is to go on.
    const state = typeof payload.state === "string" ? payload.state : null;
    const stateError = typeof payload.stateError === "string" ? payload.stateError : null;
    const ready = state === null ? loaded : payload.ready === true && state === "READY";
    const gpu = hardware.cuda === true || (device !== null && /cuda|mps/i.test(device));
    return {
      ...base,
      available: ready,
      reason: ready ? "ok" : "model-unavailable",
      detail: ready
        ? `${String(payload.engine ?? "voxcpm")} on ${String(hardware.deviceName ?? device ?? "unknown device")}`
        : state !== null
          ? `worker is ${state}${stateError ? `: ${stateError}` : ""}`
          : loadError ?? "model is not loaded yet",
      latencyMs,
      modelId: typeof payload.modelId === "string" ? payload.modelId : null,
      device,
      gpu,
      loaded,
      state,
      sampleRate,
      loadSeconds: typeof payload.loadSeconds === "number" ? payload.loadSeconds : null,
      loadError,
      referenceSeconds: reference && typeof reference.seconds === "number" ? reference.seconds : null,
      checkedAt: Date.now(),
    };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const name = (error as Error)?.name ?? "";
    const timedOut = name === "AbortError" || /abort/i.test(String((error as Error)?.message ?? ""));
    return {
      ...base,
      latencyMs,
      reason: timedOut ? "timeout" : "unreachable",
      detail: timedOut ? `no answer within ${timeoutMs} ms` : `cannot reach worker: ${(error as Error)?.message ?? "network error"}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export interface VoxcpmSnapshot {
  workers: Array<{
    id: string;
    kind: VoxcpmWorkerKind;
    /** Host only: a tunnel URL may carry a secret path. */
    host: string;
    cooldownUntil: number | null;
    last: Omit<VoxcpmHealth, "worker" | "kind"> | null;
  }>;
  chosen: string | null;
  lastChosenAt: number | null;
}

/**
 * Which worker speaks, and what happened to the others.
 *
 * Failures are remembered for a cooldown instead of being retried on every
 * sentence: a Kaggle session that has shut down will not come back within
 * the next three seconds, and hammering it costs the reply. `markSuccess`
 * clears the cooldown immediately, so recovery is noticed the moment a
 * worker answers again.
 */
export class VoxcpmPool {
  private readonly workers: VoxcpmWorker[];
  private readonly cooldowns = new Map<string, number>();
  private readonly health = new Map<string, VoxcpmHealth>();
  private chosen: string | null = null;
  private lastChosenAt: number | null = null;
  private readonly cooldownMs: number;

  public constructor(workers: VoxcpmWorker[], options: { cooldownMs?: number } = {}) {
    this.workers = workers;
    this.cooldownMs = options.cooldownMs ?? 60_000;
  }

  public list(): VoxcpmWorker[] {
    return [...this.workers];
  }

  public size(): number {
    return this.workers.length;
  }

  /** Workers that may be tried right now, cheapest-to-reach first. */
  public candidates(now = Date.now()): VoxcpmWorker[] {
    return this.workers.filter((worker) => {
      const until = this.cooldowns.get(worker.id) ?? 0;
      return until <= now;
    });
  }

  /**
   * Probe every candidate and return the best healthy one.
   *
   * Probe order is priority order, and a loaded GPU beats an unloaded one
   * beats a CPU: the whole point of the pool is to answer quickly, and an
   * unloaded worker pays model-load latency on the first sentence.
   */
  public async select(options: { timeoutMs?: number; now?: number } = {}): Promise<VoxcpmHealth | null> {
    const now = options.now ?? Date.now();
    const candidates = this.candidates(now);
    if (candidates.length === 0) return null;
    const probes = await Promise.all(candidates.map((worker) => probeVoxcpmWorker(worker, options)));
    for (const health of probes) {
      this.health.set(health.worker, health);
      if (health.available) this.cooldowns.delete(health.worker);
      else this.markFailure(health.worker, now);
    }
    const healthy = probes.filter((health) => health.available);
    if (healthy.length === 0) return null;
    const rank = (health: VoxcpmHealth): number => (health.gpu ? 0 : 2) + (health.loaded ? 0 : 1);
    healthy.sort((a, b) => rank(a) - rank(b) || a.latencyMs - b.latencyMs);
    const best = healthy[0];
    this.chosen = best.worker;
    this.lastChosenAt = Date.now();
    return best;
  }

  public markFailure(workerId: string, now = Date.now()): void {
    this.cooldowns.set(workerId, now + this.cooldownMs);
    if (this.chosen === workerId) this.chosen = null;
  }

  public markSuccess(workerId: string): void {
    this.cooldowns.delete(workerId);
  }

  public worker(workerId: string): VoxcpmWorker | null {
    return this.workers.find((worker) => worker.id === workerId) ?? null;
  }

  /** Never contains a token or a tunnel's secret path. */
  public snapshot(): VoxcpmSnapshot {
    return {
      workers: this.workers.map((worker) => {
        const last = this.health.get(worker.id) ?? null;
        let host = "";
        try {
          host = new URL(worker.url).host;
        } catch {
          host = "invalid";
        }
        return {
          id: worker.id,
          kind: worker.kind,
          host,
          cooldownUntil: this.cooldowns.get(worker.id) ?? null,
          last: last
            ? {
                available: last.available,
                reason: last.reason,
                detail: last.detail,
                latencyMs: last.latencyMs,
                modelId: last.modelId,
                device: last.device,
                gpu: last.gpu,
                loaded: last.loaded,
                state: last.state,
                sampleRate: last.sampleRate,
                loadSeconds: last.loadSeconds,
                loadError: last.loadError,
                referenceSeconds: last.referenceSeconds,
                checkedAt: last.checkedAt,
              }
            : null,
        };
      }),
      chosen: this.chosen,
      lastChosenAt: this.lastChosenAt,
    };
  }
}

/**
 * `VOICE_PROVIDER=voxcpm` (or `auto`) asks for VoxCPM2 first; `elevenlabs`
 * keeps today's path. `auto` means "use VoxCPM2 when a worker answers",
 * which is what a laptop with the sidecar and a phone without it both want.
 */
export function resolveVoiceProvider(read?: EnvReader): "voxcpm" | "elevenlabs" | "auto" {
  const value = rawEnv(read, "VOICE_PROVIDER").toLowerCase();
  if (value === "voxcpm" || value === "elevenlabs") return value;
  return "auto";
}
