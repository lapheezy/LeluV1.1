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
 *   GET  /api/voice/status  → { configured, stt, voiceId, modelId, sttModelId }  (no key, no network)
 *   POST /api/voice/tts     → audio/mpeg for { text }
 *   POST /api/voice/stt     → { text, languageCode } for raw audio bytes (ElevenLabs Scribe)
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
 * (`ELEVENLABS_API_KEY`, `ELEVENLABS_API_KEY_2`, `ELEVENLABS_API_KEY_3`). A
 * refusal another account can fix (401/403/429) cools THAT credential in the
 * shared ProviderKeyRing and the next one receives the same request, so a spent
 * monthly quota does not silence her.
 *
 * Failure is reported as failure: a synthesis error returns a
 * JSON body with the upstream status, never silent audio and
 * never a 200 carrying an error string.
 * ==========================================================
 */

/** Anything that resolves an environment name, like vite's envReader. */
import { createRateLimiter } from "./requestGuard.ts";

type ReadEnv = (key: string) => string | undefined;

const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

/**
 * Jessica — "Playful, Bright, Warm", American, conversational.
 * Chosen from the 21 voices this key can actually reach, for a
 * natural feminine speaking register rather than an announcer.
 * Override with ELEVENLABS_VOICE_ID without touching code.
 */
const DEFAULT_VOICE_ID = "cgSgspJ2msm6clMCkdW9";

/**
 * Eleven v3 is the expressive model on this account; turbo v2.5 is
 * the low-latency fallback if v3 is unavailable. Both are verified
 * against the live account before being reported as usable.
 */
const DEFAULT_MODEL_ID = "eleven_v3";

/** A single reply segment. Keeps one request inside the free quota. */
const MAX_TEXT_LENGTH = 900;
/** Speech-to-text model (Scribe). Override with ELEVENLABS_STT_MODEL_ID. */
const DEFAULT_STT_MODEL_ID = "scribe_v1";
/** About two minutes of compressed speech; an utterance is far smaller. */
const MAX_AUDIO_BYTES = 12_000_000;
const TTS_LIMIT = { max: 60, windowMs: 60_000 };
const STT_LIMIT = { max: 40, windowMs: 60_000 };

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

export function voiceSettings(): { voiceId: string; modelId: string } {
  return { voiceId: DEFAULT_VOICE_ID, modelId: DEFAULT_MODEL_ID };
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

  /** A refused or spent account will not fix itself in thirty seconds. */
  const SPENT_CREDENTIAL_COOLDOWN_MS = 15 * 60_000;

  /** Label → when it may be spent again. Labels only, never a key. */
  const cooling = new Map<string, number>();

  /** Her configured credentials, in spend order, deduplicated by value. */
  function voiceCredentials(): Array<{ label: string; key: string }> {
    const credentials: Array<{ label: string; key: string }> = [];
    for (const name of VOICE_KEY_NAMES) {
      const key = readSecret(readEnv, [name]);
      if (key.length < 8) continue;
      // The same key under two names is ONE credential.
      if (credentials.some((entry) => entry.key === key)) continue;
      credentials.push({ label: name, key });
    }
    return credentials;
  }

  /**
   * The credentials one request may spend. A key that just refused is skipped
   * for fifteen minutes, so a spent free tier costs one failed call rather than
   * one per synthesis; when every account is cooling they are all offered again
   * instead of going silent.
   */
  function spendableCredentials(): Array<{ label: string; key: string }> {
    const all = voiceCredentials();
    const now = Date.now();
    const ready = all.filter((credential) => (cooling.get(credential.label) ?? 0) <= now);
    return ready.length > 0 ? ready : all;
  }

  /** Only a refusal, a spent quota or a rate limit justifies sitting out. */
  function coolCredential(label: string, upstreamStatus: number): void {
    if (upstreamStatus !== 401 && upstreamStatus !== 403 && upstreamStatus !== 429) return;
    cooling.set(label, Date.now() + SPENT_CREDENTIAL_COOLDOWN_MS);
  }

  function voiceConfig(): { keyCount: number; voiceId: string; modelId: string; sttModelId: string } {
    const configured = voiceSettings();
    return {
      keyCount: voiceCredentials().length,
      voiceId: readSecret(readEnv, ["ELEVENLABS_VOICE_ID"]) || configured.voiceId,
      modelId: readSecret(readEnv, ["ELEVENLABS_MODEL_ID"]) || configured.modelId,
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
      const { keyCount, voiceId, modelId } = voiceConfig();
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
      try {
        let lastStatus = 0;
        for (const credential of spendableCredentials()) {
          const upstream = await fetch(
            `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
            {
              method: "POST",
              headers: {
                "xi-api-key": credential.key,
                "Content-Type": "application/json",
                Accept: "audio/mpeg",
              },
              body: JSON.stringify({
                text,
                model_id: modelId,
                voice_settings: {
                  stability: 0.4,
                  similarity_boost: 0.8,
                  style: 0.2,
                  use_speaker_boost: true,
                },
              }),
            },
          );
          if (upstream.ok) {
            cooling.delete(credential.label);
            const audio = new Uint8Array(await upstream.arrayBuffer());
            res.statusCode = 200;
            res.setHeader("X-Lelu-Usage", JSON.stringify(usageFromHeaders(upstream.headers)));
            res.setHeader("Content-Type", "audio/mpeg");
            res.setHeader("Content-Length", String(audio.byteLength));
            res.setHeader("Cache-Control", "no-store");
            res.end(audio);
            return;
          }
          // A spent quota or a refused key may be another account's problem, so
          // that credential cools and the next one receives the same request.
          // Only the status is reported: an upstream body can echo the text.
          lastStatus = upstream.status;
          coolCredential(credential.label, upstream.status);
          if (upstream.status !== 401 && upstream.status !== 403 && upstream.status !== 429) break;
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
      const started = Date.now();
      let lastStatus = 0;
      let lastUsage: ElevenLabsUsage | null = null;
      try {
        for (const credential of spendableCredentials()) {
          // A FormData body is consumed by the send, so each attempt gets its own.
          const form = new FormData();
          form.append("model_id", sttModelId);
          if (/^[a-z]{2,3}$/.test(lang)) form.append("language_code", lang);
          form.append("tag_audio_events", "false");
          form.append("file", new Blob([audio], { type: type === "application/octet-stream" ? "audio/webm" : type }), "utterance");
          const upstream = await fetch(`${ELEVENLABS_BASE}/speech-to-text`, {
            method: "POST",
            headers: { "xi-api-key": credential.key },
            body: form,
          });
          const usage = usageFromHeaders(upstream.headers);
          if (!upstream.ok) {
            lastStatus = upstream.status;
            lastUsage = usage;
            coolCredential(credential.label, upstream.status);
            if (upstream.status !== 401 && upstream.status !== 403 && upstream.status !== 429) break;
            continue;
          }
          cooling.delete(credential.label);
          const data = (await upstream.json()) as { text?: unknown; language_code?: unknown };
          sendJson(res, {
            ok: true,
            text: typeof data.text === "string" ? data.text.trim() : "",
            languageCode: typeof data.language_code === "string" ? data.language_code : null,
            model: sttModelId,
            latencyMs: Date.now() - started,
            usage,
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

  return {
    attach(middlewares) {
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
