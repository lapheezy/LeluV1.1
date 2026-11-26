/**
 * ==========================================================
 * LÉLU — VOICE API (ElevenLabs, server-side)
 *
 * Her voice was browser `speechSynthesis`: whatever voice the
 * visitor's OS happened to install, different on every machine,
 * never hers. This route is what makes it consistent — one
 * voice, one model, chosen here, synthesised by ElevenLabs and
 * streamed to the page as audio/mpeg.
 *
 * The key never reaches the browser:
 *   - the request goes to /api/voice/tts
 *   - the SERVER attaches `xi-api-key`
 *   - the response is audio bytes, nothing else
 *
 * Endpoints:
 *   GET  /api/voice/status              → { configured, stt, voiceId, modelId, sttModelId }  (no key, no network)
 *   POST /api/voice/tts                 → audio/mpeg for { text }
 *   POST /api/voice/stt                 → { text, languageCode } for raw audio bytes (ElevenLabs Scribe)
 *   GET  /api/voice/resources           → sanitized allowance, cooldowns, failures, history
 *   POST /api/voice/resources/reconcile → fold ElevenLabs' own counters in (real network call)
 *   POST /api/voice/resources/replenish → the operator says an account has allowance again
 *
 * Usage: ElevenLabs reports what each call cost in response headers
 * (`character-cost`, and for STT `fiat-cost-before-overages`). Both are
 * passed to the page in `X-Lelu-Usage` so LÉLU's usage ledger records the
 * provider's own numbers — never an estimate. Absent → unknown.
 *
 * Limits: per-client rate limits on both routes (ElevenLabs credit is
 * finite — the free tier is 10,000 characters a month), a 900-character
 * cap per TTS segment and a 12 MB cap per STT upload.
 *
 * Credentials: several free-tier accounts may be configured at once
 * (`ELEVENLABS_API_KEY`, `ELEVENLABS_API_KEY_2`, `ELEVENLABS_API_KEY_3`).
 * src/core/voice/VoiceResourceManager.ts owns what each one has spent, what it
 * has left, its cooldown and its failures; this route asks that one layer which
 * account may spend a request and never decides it itself. A refusal another
 * account can fix (401/403/429) cools THAT account for THAT modality and the
 * next one receives the same request; a spent allowance is skipped instead of
 * being retried on every sentence. Accounts are handed to the manager as opaque
 * positional ids, so its status can be served without exposing a key or the
 * name of an environment variable.
 *
 * Her voice does not travel with the account: voice id, model and speaking
 * style come from src/core/voice/voiceIdentity.ts, so rotation changes which
 * account pays, never who is speaking.
 *
 * Failure is reported as failure: a synthesis error returns a
 * JSON body with the upstream status, never silent audio and
 * never a 200 carrying an error string.
 * ==========================================================
 */

/** Anything that resolves an environment name, like vite's envReader. */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { ServerResponse } from "node:http";

import { createRateLimiter } from "./requestGuard.ts";
import { spendPolicy, spendRefusal } from "./spendPolicy.ts";
import VoiceResourceManager, { isAnotherAccountWorthTrying } from "../src/core/voice/VoiceResourceManager.ts";
import { resolveVoiceIdentity, voiceSettingsPayload } from "../src/core/voice/voiceIdentity.ts";
import { speechProfile, type SpeechProfileId } from "../src/core/voice/speechProfile.ts";
import { getPersistentPiper, PiperError, type PiperPoolSnapshot } from "./persistentPiper.ts";
import { relayWorkerSpeech } from "./voxApi.ts";
import { VoxcpmPool, parseVoxcpmWorkers, resolveVoiceProvider } from "../src/core/voice/gpuWorkers.ts";

type ReadEnv = (key: string) => string | undefined;

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

/** A single reply segment. Keeps one request inside the free quota. */
const MAX_TEXT_LENGTH = 900;
/** Speech-to-text model (Scribe). Override with ELEVENLABS_STT_MODEL_ID. */
const DEFAULT_STT_MODEL_ID = "scribe_v1";
/** About two minutes of compressed speech; an utterance is far smaller. */
const MAX_AUDIO_BYTES = 12_000_000;
const TTS_LIMIT = { max: 60, windowMs: 60_000 };
const STT_LIMIT = { max: 40, windowMs: 60_000 };
/** Status polling is cheap but not free: no network, still rate-limited. */
const RESOURCES_LIMIT = { max: 120, windowMs: 60_000 };
/** Asking the provider about every account is expensive and its answer lags. */
const RECONCILE_LIMIT = { max: 6, windowMs: 60_000 };

interface ConnectLikeReq {
  method?: string;
  url?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
  on: ((event: "data", listener: (chunk: unknown) => void) => void) &
    ((event: "end", listener: () => void) => void) &
    ((event: "error", listener: (error: unknown) => void) => void);
}

interface ConnectLikeRes {
  statusCode?: number;
  /** Present on a real ServerResponse once anything has been written. */
  headersSent?: boolean;
  setHeader: (name: string, value: string) => void;
  end: (body?: string | Uint8Array) => void;
  /** Present on a real ServerResponse: incremental audio is written here. */
  write?: (chunk: Uint8Array) => void;
  on?: (event: "close" | "error", listener: () => void) => void;
  flushHeaders?: () => void;
}

type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

/** A credential never contains whitespace; see plugins/bareSecretAliases.ts. */
function readSecret(readEnv: ReadEnv | undefined, names: readonly string[]): string {
  for (const name of names) {
    const raw = readEnv ? readEnv(name) : process.env[name];
    const value = typeof raw === "string" ? raw.replace(/\s+/g, "") : "";
    if (value) return value;
  }
  return "";
}

function readJsonBody(req: ConnectLikeReq): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    req.on("data", (chunk: unknown) => {
      const buffer = typeof chunk === "string" ? new TextEncoder().encode(chunk) : (chunk as Uint8Array);
      size += buffer.length;
      // A reply is a few kilobytes; anything larger is not a reply.
      if (size > 64_000) {
        reject(new Error("Request body too large."));
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      try {
        const joined = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          joined.set(chunk, offset);
          offset += chunk.length;
        }
        const body = new TextDecoder().decode(joined).trim();
        resolve(body ? (JSON.parse(body) as Record<string, unknown>) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function isCrossOrigin(req: ConnectLikeReq): boolean {
  const headers = req.headers ?? {};
  const origin = typeof headers.origin === "string" ? headers.origin : "";
  const host = typeof headers.host === "string" ? headers.host : "";
  if (!origin || !host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/** The usage ElevenLabs reported for one call, as the page receives it. */
export interface ElevenLabsUsage {
  characterCost: number | null;
  /** USD, when ElevenLabs reports it; null means unknown, never zero. */
  fiatCostUsd: number | null;
}

export function usageFromHeaders(headers: { get(name: string): string | null }): ElevenLabsUsage {
  const num = (name: string) => {
    const raw = headers.get(name);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  return { characterCost: num("character-cost"), fiatCostUsd: num("fiat-cost-before-overages") };
}

function readBinaryBody(req: ConnectLikeReq, max: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    let failed = false;
    req.on("data", (chunk: unknown) => {
      if (failed) return;
      const buffer = typeof chunk === "string" ? new TextEncoder().encode(chunk) : (chunk as Uint8Array);
      size += buffer.length;
      if (size > max) {
        failed = true;
        reject(new Error("Audio too large."));
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => {
      if (failed) return;
      const joined = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
      }
      resolve(joined);
    });
    req.on("error", reject);
  });
}

function clientKey(req: ConnectLikeReq): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.socket?.remoteAddress || "unknown";
}

/** Her identity, independent of which account will pay for it. */
export function voiceSettings(): { voiceId: string; modelId: string } {
  const identity = resolveVoiceIdentity();
  return { voiceId: identity.voiceId, modelId: identity.modelId };
}

export function createVoiceApi(readEnv?: ReadEnv): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  const limiter = createRateLimiter();

  /**
   * The names her credentials can arrive under, in the order they are spent:
   * the documented slot names first, then the platform's bare secret names so
   * a runtime that exposes only those still speaks.
   */
  const VOICE_KEY_NAMES = [
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_API_KEY_1",
    "ELEVENLABS_API_KEY_2",
    "ELEVENLABS_API_KEY_3",
    "ELEVENLABS_API_KEY_4",
    "Elevenlabs",
    "Elevenlabs2",
    "Elevenlabs3",
  ] as const;

  /**
   * Allowance, cooldowns, failures and history for every account, per
   * modality. It is handed opaque positional ids and NEVER receives a key, so
   * its snapshot is safe to log, render and serve.
   */
  const resources = new VoiceResourceManager();

  /** The accounts configured right now, in spend order, deduplicated by key. */
  function voiceAccounts(): Array<{ id: string; key: string }> {
    const accounts: Array<{ id: string; key: string }> = [];
    const seen = new Set<string>();
    for (const name of VOICE_KEY_NAMES) {
      const key = readSecret(readEnv, [name]);
      if (key.length < 8) continue;
      // The same key under two names is ONE account.
      if (seen.has(key)) continue;
      seen.add(key);
      accounts.push({ id: `account-${accounts.length + 1}`, key });
    }
    // Nothing downstream ever sees `key` or the environment name it came from.
    resources.sync(accounts.map((account) => account.id));
    return accounts;
  }

  /** Her voice — identity, never infrastructure. */
  function voiceIdentity() {
    return resolveVoiceIdentity(readEnv);
  }

  /**
   * The free local speaker, used when no ElevenLabs key is configured.
   *
   * Piper is an offline neural TTS: a binary plus one voice model, no
   * account, no network, no per-character cost. It is deliberately opt-in
   * through the environment so a checkout without the binary behaves
   * exactly as before (honest 503 rather than a surprise voice).
   *
   * It is NOT LÉLU's cloned voice; `/api/voice/status` says so.
   */
  function localVoiceConfig(): { bin: string; model: string } | null {
    const bin = readSecret(readEnv, ["LELU_LOCAL_TTS_BIN"]);
    const model = readSecret(readEnv, ["LELU_LOCAL_TTS_MODEL"]);
    if (!bin || !model) return null;
    if (!existsSync(bin) || !existsSync(model)) return null;
    return { bin, model };
  }

  /**
   * Her own voice: the speech worker (MOSS-TTS-Nano on the Contabo VPS,
   * VoxCPM2 elsewhere) that /api/voice/vox/speech already relays to. Used by
   * this route only when it is configured EXPLICITLY (VOXCPM_BASE_URL or
   * VOXCPM_WORKERS): the pool's implicit loopback default must not change
   * what a checkout without a worker answers. VOICE_PROVIDER=elevenlabs
   * turns it off here; VOICE_PROVIDER=voxcpm prefers it even over a paid key.
   */
  const workerConfigured =
    Boolean(readSecret(readEnv, ["VOXCPM_BASE_URL"]) || readSecret(readEnv, ["VOXCPM_WORKERS"])) &&
    resolveVoiceProvider(readEnv) !== "elevenlabs";
  const speechWorkers = workerConfigured
    ? new VoxcpmPool(parseVoxcpmWorkers(readEnv ?? ((name) => process.env[name])), { cooldownMs: 15_000 })
    : null;
  const WORKER_VOICE_ID = "worker:lelu-reference";
  // A worker far slower than real time (VoxCPM2 on a CPU: RTF 5–10 measured)
  // is asked for whole sentences instead of a stream that plays as fragments.
  // 2.0 keeps MOSS-TTS-Nano (RTF 0.8–1.3 on the VPS) streaming as before.
  const workerStreamMaxRtf = Number(readSecret(readEnv, ["VOXCPM_STREAM_MAX_RTF"]) || "2");

  /**
   * The chosen worker's last measured real-time factor, from the pool's
   * cached health (no network call). The page sizes its wait on it: VoxCPM2
   * on a CPU needs 5–10 s per second of speech, and a fixed 15 s header
   * timeout aborted every sentence it was still generating.
   */
  function lastWorkerRtf(): number | null {
    const snapshot = speechWorkers?.snapshot();
    if (!snapshot) return null;
    const chosen = snapshot.workers.find((entry) => entry.id === snapshot.chosen) ?? snapshot.workers.find((entry) => entry.last?.available);
    return chosen?.last?.rtf ?? null;
  }

  function localVoiceId(): string | null {
    const config = localVoiceConfig();
    return config ? `local-piper:${basename(config.model).replace(/\.onnx$/, "")}` : null;
  }

  /**
   * The local model's own sample rate, read from the voice's config file next
   * to the model ("audio": {"sample_rate": 16000}). Never guessed: raw PCM
   * played at the wrong rate is a chipmunk, and the config is the authority.
   */
  function localVoiceSampleRate(): number {
    const config = localVoiceConfig();
    if (!config) return 16_000;
    try {
      const parsed = JSON.parse(readFileSync(`${config.model}.json`, "utf8")) as {
        audio?: { sample_rate?: unknown };
      };
      const rate = Number(parsed.audio?.sample_rate);
      return Number.isFinite(rate) && rate > 0 ? rate : 16_000;
    } catch {
      return 16_000;
    }
  }

  /**
   * WHETHER THE WARM RUNTIME IS USED (Mission 22.9, WP01).
   *
   * On by default when a local voice is configured. `LELU_PIPER_PERSISTENT=0`
   * restores the M22.8 behaviour exactly (one cold process per sentence with
   * `--output_raw` PCM streaming), so the old path stays a working fallback
   * and can be compared against the warm one in the same build.
   */
  function persistentEnabled(): boolean {
    const raw = readSecret(readEnv, ["LELU_PIPER_PERSISTENT"]);
    return raw !== "0";
  }

  /** The delivery an untrusted request body asked for, validated to the set. */
  function requestedProfile(body: Record<string, unknown>): SpeechProfileId {
    return speechProfile(body.delivery).id;
  }

  /** Warm-runtime facts for the diagnostic; null when it is not running. */
  function warmRuntime(): PiperPoolSnapshot | null {
    const config = localVoiceConfig();
    if (!config || !persistentEnabled()) return null;
    try {
      return getPersistentPiper({ bin: config.bin, model: config.model }).stats();
    } catch {
      return null;
    }
  }

  /**
   * THE COLD STREAMING PATH (Mission 22.8, WP02) — preserved as fallback.
   *
   * Piper's `--output_raw` emits 16-bit mono PCM as it is generated, so the
   * first audible sample can reach the page while the rest of the sentence
   * is still being synthesised. It pays a model load per sentence (measured:
   * 511–630 ms each), which is exactly what the warm runtime removes.
   *
   * The response is `audio/L16` with its real rate in the header, chunked so
   * a barge-in can abort it: closing the response kills the synthesiser
   * instead of letting it finish a sentence nobody will hear.
   */
  function streamFromColdProcess(text: string, res: ConnectLikeRes, rate: number, config: { bin: string; model: string }): void {
    const child = execFile(
      config.bin,
      ["--model", config.model, "--output_raw"],
      // `encoding: "buffer"`: audio is bytes, not UTF-8 text. Without it every
      // sample above 0x7F is replaced by U+FFFD and the reply is noise.
      { timeout: 60_000, maxBuffer: 64 * 1024 * 1024, encoding: "buffer" },
    );
    let sent = 0;
    let failed = false;
    res.statusCode = 200;
    res.setHeader("Content-Type", `audio/L16;rate=${rate};channels=1`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Lelu-Voice-Provider", localVoiceId() ?? "local-piper");
    res.setHeader("X-Lelu-Sample-Rate", String(rate));
    res.setHeader("X-Lelu-Streaming", "pcm16");
    // Headers are NOT flushed here: nothing is committed until the first
    // sample exists, so a synthesiser that produces nothing can still be
    // reported as a failure instead of as an empty 200.

    child.stdout?.on("data", (chunk: Uint8Array) => {
      if (failed) return;
      sent += chunk.length;
      res.write?.(chunk);
    });
    child.on("error", () => {
      failed = true;
      if (sent === 0) {
        sendJson(res, { ok: false, error: "The local speech engine failed." }, 502);
        return;
      }
      res.end();
    });
    child.on("close", () => {
      // A synthesiser that produced nothing is a failure, not silence.
      if (!failed && sent === 0) {
        sendJson(res, { ok: false, error: "The local speech engine produced no audio." }, 502);
        return;
      }
      res.end();
    });
    // The client stopped listening (barge-in, navigation): stop generating.
    res.on?.("close", () => {
      if (!child.killed) child.kill();
    });
    // A synthesiser that has already exited closes its end of the pipe; the
    // write then fails with EPIPE, which is the "produced no audio" failure
    // above and must be reported as that, not thrown as a stream error.
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(text);
  }

  /**
   * LOCAL SPEECH, WARM FIRST (Mission 22.9, WP01).
   *
   * The durable path: one long-lived synthesiser per delivery profile, its
   * model loaded once, answering with a complete WAV in 80–200 ms instead of
   * paying a ~290 ms model load per sentence. A warm failure falls back to
   * the cold streaming path rather than going silent, and the fallback is
   * recorded in the diagnostic so it can never look like the warm path.
   */
  function synthesizeLocalStream(text: string, res: ConnectLikeRes, profile: SpeechProfileId): void {
    const config = localVoiceConfig();
    if (!config || typeof res.write !== "function") {
      sendJson(res, { ok: false, error: "No streaming speech engine is configured." }, 503);
      return;
    }
    const rate = localVoiceSampleRate();
    if (!persistentEnabled()) {
      streamFromColdProcess(text, res, rate, config);
      return;
    }
    const controller = new AbortController();
    // A barge-in closes the response: stop waiting for a sentence nobody
    // will hear (the worker finishes it into a file the pool then deletes).
    res.on?.("close", () => controller.abort());
    void (async () => {
      try {
        const pool = getPersistentPiper({ bin: config.bin, model: config.model });
        const result = await pool.synthesize(text, { profile, signal: controller.signal });
        if (controller.signal.aborted) return;
        res.statusCode = 200;
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Lelu-Voice-Provider", localVoiceId() ?? "local-piper");
        res.setHeader("X-Lelu-Sample-Rate", String(rate));
        // Not `pcm16`: this sentence arrived complete, and the client must
        // not be told it is receiving a stream it is not receiving.
        res.setHeader("X-Lelu-Streaming", "warm-wav");
        res.setHeader("X-Lelu-Synthesis-Ms", String(result.synthesisMs));
        res.setHeader("X-Lelu-Worker-Profile", result.profile);
        res.setHeader("X-Lelu-Model-Loads", String(result.modelLoads));
        res.setHeader("X-Lelu-Cold-Start", result.coldStart ? "1" : "0");
        res.end(result.wav);
        return;
      } catch (error) {
        // Cancelled: nobody is listening, so there is nothing to repair.
        if (controller.signal.aborted) return;
        if (error instanceof PiperError && error.code === "cancelled") return;
      }
      // The warm runtime failed: speak with the cold streaming path, and
      // never claim the warm runtime answered.
      if (!res.headersSent) streamFromColdProcess(text, res, rate, config);
      else res.end();
    })();
  }

  /** Synthesise with the local engine; resolves to WAV bytes or null. */
  async function synthesizeLocal(text: string, profile: SpeechProfileId): Promise<Buffer | null> {
    const config = localVoiceConfig();
    if (!config) return null;
    if (persistentEnabled()) {
      try {
        const pool = getPersistentPiper({ bin: config.bin, model: config.model });
        const result = await pool.synthesize(text, { profile });
        return result.wav;
      } catch {
        // fall through to the cold process below
      }
    }
    const dir = await mkdtemp(join(tmpdir(), "lelu-tts-"));
    const out = join(dir, "speech.wav");
    try {
      await new Promise<void>((resolve, reject) => {
        const child = execFile(
          config.bin,
          ["--model", config.model, "--output_file", out],
          { timeout: 30_000, maxBuffer: 1024 * 1024 },
          (error) => (error ? reject(error) : resolve()),
        );
        child.stdin?.end(text);
      });
      return await readFile(out);
    } catch {
      return null;
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  function voiceConfig(): { keyCount: number; voiceId: string; modelId: string; sttModelId: string } {
    const identity = voiceIdentity();
    return {
      keyCount: voiceAccounts().length,
      voiceId: identity.voiceId,
      modelId: identity.modelId,
      sttModelId: readSecret(readEnv, ["ELEVENLABS_STT_MODEL_ID"]) || DEFAULT_STT_MODEL_ID,
    };
  }

  /** Per-client rate limit; answers 429 and returns false when exceeded. */
  function admit(req: ConnectLikeReq, res: ConnectLikeRes, bucket: string, limit: { max: number; windowMs: number }): boolean {
    const decision = limiter.take(`${bucket}:${clientKey(req)}`, limit);
    if (decision.ok) return true;
    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    sendJson(res, { ok: false, error: "Too many voice requests; slow down." }, 429);
    return false;
  }

  function handleStatus(req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): void {
    if ((req.method ?? "GET") !== "GET") {
      next();
      return;
    }
    // The worker's pace is part of the answer (see lastWorkerRtf). Before the
    // pool has ever checked it, ask once — bounded at 3 s — so the page's
    // first sentence is not given a fast engine's timeout.
    if (speechWorkers && lastWorkerRtf() === null) {
      void speechWorkers
        .select({ timeoutMs: 3000 })
        .catch(() => null)
        .then(() => answerStatus(res));
      return;
    }
    answerStatus(res);
  }

  function answerStatus(res: ConnectLikeRes): void {
    const { keyCount, voiceId, modelId, sttModelId } = voiceConfig();
    // Presence, not health: this makes no network call and claims nothing
    // about whether a credential is still accepted upstream. ElevenLabs is
    // paid: without the user's authorization it is reported unavailable, so
    // the page speaks through LÉLU's free local worker instead.
    const spend = spendPolicy().check("elevenlabs", { operation: "tts" }, { peek: true });
    const usable = keyCount > 0 && spend.allowed;
    // Presence again: a configured worker is reported, not probed (the
    // TTS route falls back to Piper, then to an honest 503, if it is down).
    const worker = speechWorkers && (!usable || resolveVoiceProvider(readEnv) === "voxcpm") ? WORKER_VOICE_ID : null;
    const local = usable || worker ? null : localVoiceId();
    sendJson(res, {
      configured: usable || Boolean(worker) || Boolean(local),
      stt: usable,
      voiceId: worker ?? local ?? voiceId,
      modelId,
      sttModelId,
      ...(worker ? { provider: "speech-worker", localVoice: true, workerRtf: lastWorkerRtf() } : {}),
      ...(local ? { provider: "local-piper", localVoice: true } : {}),
      ...(keyCount > 0 && !spend.allowed ? { spend: spend.code } : {}),
    });
  }

  function handleTts(req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): void {
    if ((req.method ?? "GET") !== "POST") {
      next();
      return;
    }
    if (isCrossOrigin(req)) {
      sendJson(res, { ok: false, error: "Cross-origin requests are not allowed." }, 403);
      return;
    }
    if (!admit(req, res, "tts", TTS_LIMIT)) return;
    void (async () => {
      const { keyCount } = voiceConfig();
      let body: Record<string, unknown>;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, { ok: false, error: "Malformed request body." }, 400);
        return;
      }
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) {
        sendJson(res, { ok: false, error: "No text to speak." }, 400);
        return;
      }
      if (text.length > MAX_TEXT_LENGTH) {
        sendJson(res, { ok: false, error: `Text exceeds ${MAX_TEXT_LENGTH} characters.` }, 413);
        return;
      }
      const wantsStream =
        body.stream === true ||
        new URL(req.url ?? "/", "http://localhost").searchParams.get("stream") === "1";
      // The same rule /api/voice/status states to the page: a paid key that
      // is not authorized to spend is not a voice, so the free worker speaks.
      const elevenLabsUsable =
        keyCount > 0 && spendPolicy().check("elevenlabs", { operation: "tts" }, { peek: true }).allowed;
      if (speechWorkers && (!elevenLabsUsable || resolveVoiceProvider(readEnv) === "voxcpm")) {
        // Her own voice first: the free speech worker. Nothing written when
        // no worker is READY, so Piper, ElevenLabs' own refusal, or the
        // honest 503 still answers exactly as before.
        const outcome = await relayWorkerSpeech({
          pool: speechWorkers,
          text,
          format: wantsStream ? "pcm" : "wav",
          stream: wantsStream,
          res: res as unknown as ServerResponse,
          extraHeaders: { "X-Lelu-Voice-Provider": WORKER_VOICE_ID, ...(wantsStream ? { "X-Lelu-Streaming": "worker" } : {}) },
          maxStreamRtf: workerStreamMaxRtf,
        });
        if (outcome === "handled") return;
      }
      if (keyCount === 0) {
        // No paid account: speak with the free local engine when it is set up.
        const profile = requestedProfile(body);
        if (wantsStream) {
          synthesizeLocalStream(text, res, profile);
          return;
        }
        const started = Date.now();
        const audio = await synthesizeLocal(text, profile);
        if (!audio) {
          sendJson(res, { ok: false, error: "No speech engine is configured." }, 503);
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", "audio/wav");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Lelu-Voice-Provider", localVoiceId() ?? "local-piper");
        res.setHeader("X-Lelu-Synthesis-Ms", String(Date.now() - started));
        res.end(audio);
        return;
      }
      // Which account may spend what this sentence costs — decided from local
      // accounting, before anything is sent to the provider.
      const plan = resources.plan("tts", { text });
      if (!plan.available) {
        const retryAfterMs = plan.retryAfterMs ?? 60_000;
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
        sendJson(
          res,
          {
            ok: false,
            error:
              plan.unavailableReason === "all_credentials_exhausted"
                ? "Every voice account has spent its character allowance."
                : plan.unavailableReason === "all_credentials_cooling"
                  ? "Every voice account is cooling after a refusal."
                  : plan.unavailableReason === "no_credentials"
                    ? "ElevenLabs is not configured."
                    : "No voice account has enough allowance for this request.",
            reason: plan.unavailableReason,
            retryAfterMs,
            remainingCharacters: plan.remainingCharacters,
            skipped: plan.skipped,
          },
          503,
        );
        return;
      }
      const identity = voiceIdentity();
      const spokenStyle = voiceSettingsPayload(identity);
      const accounts = new Map(voiceAccounts().map((account) => [account.id, account.key]));
      const ttsSpend = spendPolicy().check("elevenlabs", { operation: "tts" });
      if (!ttsSpend.allowed) {
        sendJson(res, spendRefusal("elevenlabs", ttsSpend, { operation: "tts" }), 402);
        return;
      }
      spendPolicy().consume(ttsSpend.grantId);
      try {
        let lastStatus = 0;
        for (const id of plan.candidates) {
          const key = accounts.get(id);
          if (!key) continue;
          const started = Date.now();
          let upstream: Response;
          try {
            upstream = await fetch(
              `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(identity.voiceId)}?output_format=mp3_44100_128`,
              {
                method: "POST",
                headers: {
                  "xi-api-key": key,
                  "Content-Type": "application/json",
                  Accept: "audio/mpeg",
                },
                body: JSON.stringify({
                  text,
                  model_id: identity.modelId,
                  voice_settings: spokenStyle,
                }),
              },
            );
          } catch (error) {
            // The network, not the account: recorded, and it does not cool it.
            resources.recordFailure("tts", id, {
              status: 0,
              reason: `transport: ${(error as Error).message}`,
              estimatedCharacters: plan.estimate,
              latencyMs: Date.now() - started,
            });
            throw error;
          }
          const usage = usageFromHeaders(upstream.headers);
          if (upstream.ok) {
            resources.recordSuccess("tts", id, {
              estimatedCharacters: plan.estimate,
              reportedCharacters: usage.characterCost,
              fiatCostUsd: usage.fiatCostUsd,
              latencyMs: Date.now() - started,
            });
            const audio = new Uint8Array(await upstream.arrayBuffer());
            res.statusCode = 200;
            res.setHeader("X-Lelu-Usage", JSON.stringify(usage));
            // Which account paid — an opaque id, never a key or env name.
            res.setHeader("X-Lelu-Voice", id);
            res.setHeader("X-Lelu-Remaining", String(resources.remainingCharacters(id) ?? ""));
            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Content-Length", String(audio.byteLength));
            res.setHeader("Cache-Control", "no-store");
            res.end(audio);
            return;
          }
          // A spent quota or a refused key may be another account's problem, so
          // that account cools and the next one receives the same request. Only
          // the status is recorded: an upstream body can echo her text.
          lastStatus = upstream.status;
          resources.recordFailure("tts", id, {
            status: upstream.status,
            reason: `ElevenLabs HTTP ${upstream.status}`,
            estimatedCharacters: plan.estimate,
            latencyMs: Date.now() - started,
          });
          if (!isAnotherAccountWorthTrying(upstream.status)) break;
        }
        sendJson(
          res,
          { ok: false, error: "ElevenLabs refused the request.", upstreamStatus: lastStatus },
          502,
        );
        return;
      } catch (error) {
        sendJson(
          res,
          { ok: false, error: `ElevenLabs request failed: ${(error as Error).message}` },
          502,
        );
      }
    })();
  }

  function handleStt(req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): void {
    if ((req.method ?? "GET") !== "POST") {
      next();
      return;
    }
    if (isCrossOrigin(req)) {
      sendJson(res, { ok: false, error: "Cross-origin requests are not allowed." }, 403);
      return;
    }
    if (!admit(req, res, "stt", STT_LIMIT)) return;
    void (async () => {
      const { keyCount, sttModelId } = voiceConfig();
      if (keyCount === 0) {
        sendJson(res, { ok: false, error: "ElevenLabs is not configured." }, 503);
        return;
      }
      const type = String(req.headers?.["content-type"] ?? "").split(";")[0].trim().toLowerCase();
      if (!/^audio\/[a-z0-9.+-]+$|^video\/webm$|^application\/octet-stream$/.test(type)) {
        sendJson(res, { ok: false, error: "Send the recording as raw audio (Content-Type audio/*)." }, 415);
        return;
      }
      let audio: Uint8Array;
      try {
        audio = await readBinaryBody(req, MAX_AUDIO_BYTES);
      } catch {
        sendJson(res, { ok: false, error: `Audio exceeds ${MAX_AUDIO_BYTES} bytes.` }, 413);
        return;
      }
      if (audio.byteLength < 200) {
        sendJson(res, { ok: false, error: "No audio to transcribe." }, 400);
        return;
      }
      const lang = new URL(req.url ?? "/", "http://localhost").searchParams.get("lang") ?? "";
      // Transcription is tracked apart from synthesis: a spent TTS allowance
      // must not close her ears, and a transcription cooldown must not silence
      // her mouth.
      const plan = resources.plan("stt", { audioBytes: audio.byteLength });
      if (!plan.available) {
        const retryAfterMs = plan.retryAfterMs ?? 60_000;
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
        sendJson(
          res,
          {
            ok: false,
            error:
              plan.unavailableReason === "all_credentials_cooling"
                ? "Every voice account is cooling after a refusal."
                : plan.unavailableReason === "no_credentials"
                  ? "ElevenLabs is not configured."
                  : "No voice account can transcribe right now.",
            reason: plan.unavailableReason,
            retryAfterMs,
            skipped: plan.skipped,
          },
          503,
        );
        return;
      }
      const sttSpend = spendPolicy().check("elevenlabs", { operation: "stt" });
      if (!sttSpend.allowed) {
        sendJson(res, spendRefusal("elevenlabs", sttSpend, { operation: "stt" }), 402);
        return;
      }
      spendPolicy().consume(sttSpend.grantId);
      const started = Date.now();
      const accounts = new Map(voiceAccounts().map((account) => [account.id, account.key]));
      let lastStatus = 0;
      let lastUsage: ElevenLabsUsage | null = null;
      try {
        for (const id of plan.candidates) {
          const key = accounts.get(id);
          if (!key) continue;
          const attemptStarted = Date.now();
          // A FormData body is consumed by the send, so each attempt gets its own.
          const form = new FormData();
          form.append("model_id", sttModelId);
          if (/^[a-z]{2,3}$/.test(lang)) form.append("language_code", lang);
          form.append("tag_audio_events", "false");
          form.append("file", new Blob([audio], { type: type === "application/octet-stream" ? "audio/webm" : type }), "utterance");
          const upstream = await fetch(`${ELEVENLABS_BASE}/speech-to-text`, {
            method: "POST",
            headers: { "xi-api-key": key },
            body: form,
          });
          const usage = usageFromHeaders(upstream.headers);
          if (!upstream.ok) {
            lastStatus = upstream.status;
            lastUsage = usage;
            resources.recordFailure("stt", id, {
              status: upstream.status,
              reason: `ElevenLabs HTTP ${upstream.status}`,
              latencyMs: Date.now() - attemptStarted,
            });
            if (!isAnotherAccountWorthTrying(upstream.status)) break;
            continue;
          }
          resources.recordSuccess("stt", id, {
            // No character estimate is invented for transcription.
            estimatedCharacters: null,
            reportedCharacters: usage.characterCost,
            fiatCostUsd: usage.fiatCostUsd,
            latencyMs: Date.now() - attemptStarted,
          });
          const data = (await upstream.json()) as { text?: unknown; language_code?: unknown };
          sendJson(res, {
            ok: true,
            text: typeof data.text === "string" ? data.text.trim() : "",
            languageCode: typeof data.language_code === "string" ? data.language_code : null,
            model: sttModelId,
            latencyMs: Date.now() - started,
            usage,
            account: id,
          });
          return;
        }
        sendJson(
          res,
          {
            ok: false,
            error: "ElevenLabs refused the request.",
            upstreamStatus: lastStatus,
            usage: lastUsage ?? { characterCost: null, fiatCostUsd: null },
          },
          502,
        );
        return;
      } catch (error) {
        sendJson(res, { ok: false, error: `ElevenLabs request failed: ${(error as Error).message}` }, 502);
      }
    })();
  }

  /**
   * THE RUNTIME DIAGNOSTIC (Mission 22.8, WP06).
   *
   * One answer that says which components of a voice conversation are
   * actually in place on THIS server: the transcriber, the response
   * providers' reachability is the client's to report, the speaker, whether
   * that speaker is her identity or an honest fallback, and whether the
   * streaming and interruption paths are the ones this build runs.
   *
   * It makes NO network call and reads NO key: a diagnostic that spends
   * credit or claims an upstream is healthy because a socket opened is worse
   * than none. What cannot be known from here (a physical microphone, a
   * speaker, the browser's echo cancellation) is reported as the CLIENT's
   * fact and marked unverified rather than assumed present.
   */
  /**
   * What the warm runtime is doing right now, safe to publish.
   *
   * Facts only: worker state, PID, uptime, how many times a voice was loaded,
   * queue depth, cancellations, restarts and RSS. No text, no path, no key and
   * no audio ever appears here.
   */
  function runtimeFacts(): Record<string, unknown> {
    const stats = warmRuntime();
    if (!stats) {
      return {
        persistent: false,
        mode: "cold-process-per-sentence",
        note: "Set LELU_LOCAL_TTS_BIN and LELU_LOCAL_TTS_MODEL (and do not set LELU_PIPER_PERSISTENT=0) to hold the model in memory.",
      };
    }
    return {
      persistent: true,
      warmWorkers: stats.warmWorkers,
      modelLoads: stats.modelLoads,
      modelLoadFailures: stats.modelLoadFailures,
      restarts: stats.restarts,
      requests: stats.requests,
      failures: stats.failures,
      cancelled: stats.cancelled,
      queueDepth: stats.queueDepth,
      active: stats.active,
      workers: stats.workers.map((worker) => ({
        profile: worker.profile,
        state: worker.state,
        pid: worker.pid,
        uptimeMs: worker.uptimeMs,
        requests: worker.requests,
        medianSynthesisMs: worker.medianSynthesisMs,
        rssMiB: worker.rssMiB,
        lastError: worker.lastError,
      })),
    };
  }

  function handleDiagnostic(req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): void {
    if ((req.method ?? "GET") !== "GET") {
      next();
      return;
    }
    if (!admit(req, res, "diagnostic", RESOURCES_LIMIT)) return;
    const { keyCount, sttModelId } = voiceConfig();
    const local = localVoiceConfig();
    const spend = spendPolicy().check("elevenlabs", { operation: "tts" }, { peek: true });
    const elevenLabsUsable = keyCount > 0 && spend.allowed;
    const identity = voiceIdentity();
    const ttsProvider =
      speechWorkers && (!elevenLabsUsable || resolveVoiceProvider(readEnv) === "voxcpm")
        ? "speech-worker"
        : elevenLabsUsable
          ? "elevenlabs"
          : local
            ? "local-piper"
            : "none";
    sendJson(res, {
      ok: true,
      at: Date.now(),
      server: "ok",
      asr: {
        provider: elevenLabsUsable ? "elevenlabs-scribe" : "groq-whisper-relay",
        model: elevenLabsUsable ? sttModelId : "whisper-large-v3-turbo",
        configured: true,
      },
      ai: {
        // The response providers are the client's to probe: this route does
        // not open a socket to a paid model to answer a diagnostic.
        provider: "client-reported",
        note: "see VoiceEngine diagnostics (responseReceived, turnFailure)",
      },
      tts: {
        provider: ttsProvider,
        configured: ttsProvider !== "none",
        voiceId:
          ttsProvider === "elevenlabs"
            ? identity.voiceId
            : ttsProvider === "local-piper"
              ? localVoiceId()
              : ttsProvider === "speech-worker"
                ? WORKER_VOICE_ID
                : null,
        modelId: ttsProvider === "elevenlabs" ? identity.modelId : null,
        localBinary: Boolean(local),
        /** M22.9: whether the speaker holds its model, and what that cost. */
        runtime: runtimeFacts(),
      },
      voiceIdentity: {
        name: identity.name,
        provider:
          ttsProvider === "elevenlabs"
            ? identity.provider
            : ttsProvider === "local-piper"
              ? "piper"
              : ttsProvider === "speech-worker"
                ? "speech-worker"
                : "none",
        // Piper is a placeholder voice, never presented as her clone.
        status: ttsProvider === "elevenlabs" ? "identity" : ttsProvider === "local-piper" || ttsProvider === "speech-worker" ? "fallback" : "absent",
        cloned: false,
      },
      streaming: {
        sentenceStreaming: true,
        synthesisAhead: true,
        firstAudioMeasured: true,
      },
      interruption: {
        fullDuplexCapture: true,
        bargeIn: "energy-vad + transcript ownership",
        echoCancellationRequested: true,
      },
      hardware: {
        // The server has no microphone or speaker to inspect.
        verified: false,
        reportedBy: "client",
        note: "microphone, speaker and echo cancellation are client facts; hardware acceptance is a separate, physical test",
      },
      voxcpm: {
        configured: Boolean(readSecret(readEnv, ["VOXCPM_BASE_URL"]) || readSecret(readEnv, ["VOXCPM_WORKERS"])),
        // Not probed here: the worker's own /health is the authority.
        reachable: "unprobed",
      },
    });
  }

  /**
   * Sanitized operational status for the dashboard: allowance, cooldowns,
   * failures, history and availability. No key, no environment name and no
   * upstream response body ever appears here — accounts are opaque ids.
   *
   * Makes NO network call: every number is local accounting, labelled as such
   * (`estimatedCharacters` vs `reportedCharacters`), so a poll cannot cost her
   * a character or pretend a quota was checked.
   */
  function handleResources(req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): void {
    if ((req.method ?? "GET") !== "GET") {
      next();
      return;
    }
    if (!admit(req, res, "resources", RESOURCES_LIMIT)) return;
    // Configured accounts are discovered here, not only as a side effect of
    // synthesis: the panel polls this route FIRST, and a fresh process that had
    // never spoken must still report three accounts rather than "not
    // configured". Local only — reads the environment, makes no network call.
    voiceAccounts();
    const identity = voiceIdentity();
    sendJson(res, {
      ok: true,
      provider: identity.provider,
      // Her voice, shown beside the infrastructure so a rotation can never be
      // mistaken for a change of identity.
      identity: {
        name: identity.name,
        voiceId: identity.voiceId,
        modelId: identity.modelId,
        speakingStyle: identity.speakingStyle,
      },
      ...resources.snapshot(),
    });
  }

  /**
   * Fold ElevenLabs' own counters in.
   *
   * The only route that asks the provider about quota, because it costs a round
   * trip per account and the answer LAGS. The manager keeps the internal lower
   * bound and reports the gap as `lagging` instead of trusting a stale number
   * down; only the numbers come back, never the provider's response body.
   */
  function handleReconcile(req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): void {
    if ((req.method ?? "GET") !== "POST") {
      next();
      return;
    }
    if (isCrossOrigin(req)) {
      sendJson(res, { ok: false, error: "Cross-origin requests are not allowed." }, 403);
      return;
    }
    if (!admit(req, res, "reconcile", RECONCILE_LIMIT)) return;
    void (async () => {
      const accounts = voiceAccounts();
      if (accounts.length === 0) {
        sendJson(res, { ok: false, error: "ElevenLabs is not configured." }, 503);
        return;
      }
      const reconciled: Array<Record<string, unknown>> = [];
      for (const account of accounts) {
        try {
          const upstream = await fetch(`${ELEVENLABS_BASE}/user/subscription`, {
            headers: { "xi-api-key": account.key, Accept: "application/json" },
          });
          if (!upstream.ok) {
            reconciled.push({ account: account.id, ok: false, upstreamStatus: upstream.status });
            continue;
          }
          const data = (await upstream.json()) as { character_count?: unknown; character_limit?: unknown };
          const used = typeof data.character_count === "number" ? data.character_count : null;
          const limit = typeof data.character_limit === "number" ? data.character_limit : null;
          if (used === null || limit === null) {
            reconciled.push({ account: account.id, ok: false, reason: "provider reported no character counters" });
            continue;
          }
          const applied = resources.applyUpstreamUsage(account.id, { characterCount: used, characterLimit: limit });
          reconciled.push({
            account: account.id,
            ok: true,
            upstreamUsed: used,
            upstreamLimit: limit,
            internalUsed: applied?.internalUsed ?? null,
            lagging: applied?.lagging ?? false,
          });
        } catch (error) {
          reconciled.push({ account: account.id, ok: false, reason: (error as Error).message });
        }
      }
      sendJson(res, {
        ok: true,
        reconciledAt: Date.now(),
        accounts: reconciled,
        note: "A provider counter can lag; a lower upstream number never lowers the internal lower bound.",
      });
    })();
  }

  /**
   * The operator states an account has allowance again (top-up, new month).
   * The internal counters restart — otherwise the account stays exhausted
   * forever — while the usage history keeps what was really spent.
   */
  function handleReplenish(req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): void {
    if ((req.method ?? "GET") !== "POST") {
      next();
      return;
    }
    if (isCrossOrigin(req)) {
      sendJson(res, { ok: false, error: "Cross-origin requests are not allowed." }, 403);
      return;
    }
    if (!admit(req, res, "replenish", RECONCILE_LIMIT)) return;
    void (async () => {
      let body: Record<string, unknown> = {};
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, { ok: false, error: "Malformed request body." }, 400);
        return;
      }
      const requested = typeof body.account === "string" ? body.account : "";
      const reset = resources.replenish(requested ? [requested] : undefined);
      if (reset.length === 0) {
        sendJson(res, { ok: false, error: "No such voice account." }, 404);
        return;
      }
      sendJson(res, {
        ok: true,
        replenished: reset,
        at: Date.now(),
        note: "Cooldowns and internal counters restarted; the usage history keeps what was actually spent.",
      });
    })();
  }

  return {
    attach(middlewares) {
      // Specific paths first: these middlewares match by prefix.
      middlewares.use("/api/voice/resources/reconcile", handleReconcile);
      middlewares.use("/api/voice/resources/replenish", handleReplenish);
      middlewares.use("/api/voice/resources", handleResources);
      middlewares.use("/api/voice/status", handleStatus);
      middlewares.use("/api/voice/diagnostic", handleDiagnostic);
      middlewares.use("/api/voice/tts", handleTts);
      middlewares.use("/api/voice/stt", handleStt);
    },
  };
}

export function voiceApiPlugin(readEnv?: ReadEnv): {
  name: string;
  configureServer: (server: { middlewares: { use: (path: string, handler: Handler) => void } }) => void;
  configurePreviewServer: (server: { middlewares: { use: (path: string, handler: Handler) => void } }) => void;
} {
  const api = createVoiceApi(readEnv);
  return {
    name: "voice-api",
    configureServer(server) {
      api.attach(server.middlewares);
    },
    configurePreviewServer(server) {
      api.attach(server.middlewares);
    },
  };
}
