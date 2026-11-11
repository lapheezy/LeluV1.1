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
import { createRateLimiter } from "./requestGuard.ts";
import VoiceResourceManager, { isAnotherAccountWorthTrying } from "../src/core/voice/VoiceResourceManager.ts";
import { resolveVoiceIdentity, voiceSettingsPayload } from "../src/core/voice/voiceIdentity.ts";

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
  setHeader: (name: string, value: string) => void;
  end: (body?: string | Uint8Array) => void;
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
    const { keyCount, voiceId, modelId, sttModelId } = voiceConfig();
    // Presence, not health: this makes no network call and claims nothing
    // about whether a credential is still accepted upstream.
    sendJson(res, { configured: keyCount > 0, stt: keyCount > 0, voiceId, modelId, sttModelId });
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
      if (keyCount === 0) {
        sendJson(res, { ok: false, error: "ElevenLabs is not configured." }, 503);
        return;
      }
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
