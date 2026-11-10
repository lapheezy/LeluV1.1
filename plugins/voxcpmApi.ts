/**
 * ==========================================================
 * LÉLU — VOXCPM2 VOICE ROUTE (server-side)
 *
 * GET  /api/voice/voxcpm/status → can her reference voice speak, and why not
 * POST /api/voice/voxcpm/tts    → reference-conditioned audio for { text }
 *
 * The reference recording is read HERE, from the repository, and
 * sent to the inference server with its verified transcript. The
 * browser never holds the recording, the transcript is never
 * guessed per request, and the model credential never reaches the
 * page — this route talks to a local inference server whose
 * address is configuration, not a public URL.
 *
 * CONSENT IS A GATE, NOT A COMMENT
 * --------------------------------
 * Cloning a voice is only lawful with the speaker's permission.
 * `LELU_VOICE_CONSENT_ATTESTED=true` is the operator's attestation
 * that the reference recording is their own voice or that they
 * hold the speaker's explicit authorisation. Without it this route
 * answers 403 and generates nothing — it does not "warn and
 * continue". The reference is never replaced by a stock voice.
 *
 * Deployment: deploy/voxcpm/ (hardware requirements, model pin,
 * reference preparation, inference server).
 * ==========================================================
 */

import { createHash } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createRateLimiter } from "./requestGuard.ts";
import { LELU_VOICE_IDENTITY } from "../src/core/voice/voiceIdentity.ts";

type ReadEnv = (key: string) => string | undefined;

/** Apache-2.0, 2B params, 48 kHz output. Pinned, not "latest". */
export const DEFAULT_VOXCPM_MODEL = "openbmb/VoxCPM2";

/**
 * The canonical reference derived from the committed recording by
 * deploy/voxcpm/prepare-reference.sh. Generated, therefore not
 * committed; absent until the operator prepares it.
 */
export const DEFAULT_REFERENCE_WAV = "deploy/voxcpm/reference/lelu-voice-reference-44k-mono.wav";

/** A single reply segment. Matches the existing speech chunk ceiling. */
const MAX_TEXT_LENGTH = 900;
/** Two minutes of 48 kHz mono is ~11 MB; a segment is far smaller. */
const MAX_UPSTREAM_BYTES = 24_000_000;
const TTS_LIMIT = { max: 30, windowMs: 60_000 };
/** Reference is ~48 s of speech; refuse an absurd file rather than post it. */
const MAX_REFERENCE_BYTES = 40_000_000;

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

function readSecret(readEnv: ReadEnv | undefined, names: readonly string[]): string {
  for (const name of names) {
    const raw = readEnv ? readEnv(name) : process.env[name];
    const value = typeof raw === "string" ? raw.trim() : "";
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

function clientKey(req: ConnectLikeReq): string {
  const forwarded = req.headers?.["x-forwarded-for"];
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
  return first || req.socket?.remoteAddress || "unknown";
}

/** One resolved view of the deployment, so status and generation cannot disagree. */
export interface VoxCpmConfig {
  baseUrl: string;
  model: string;
  referencePath: string;
  referenceText: string;
  consentAttested: boolean;
}

export function voxCpmConfig(readEnv?: ReadEnv): VoxCpmConfig {
  const baseUrl = readSecret(readEnv, ["VOXCPM_BASE_URL"]).replace(/\/+$/, "");
  return {
    baseUrl,
    model: readSecret(readEnv, ["VOXCPM_MODEL"]) || DEFAULT_VOXCPM_MODEL,
    referencePath: readSecret(readEnv, ["VOXCPM_REFERENCE_WAV"]) || DEFAULT_REFERENCE_WAV,
    referenceText: readSecret(readEnv, ["VOXCPM_REFERENCE_TEXT"]) || LELU_VOICE_IDENTITY.promptTranscript,
    consentAttested: readSecret(readEnv, ["LELU_VOICE_CONSENT_ATTESTED"]).toLowerCase() === "true",
  };
}

interface ReferenceState {
  loaded: boolean;
  bytes: number;
  file: string;
  /** Base64 of the reference audio, cached by path+mtime. Sent to the model. */
  base64: string | null;
  detail: string;
}

const referenceCache = new Map<string, { mtimeMs: number; bytes: number; base64: string }>();

async function loadReference(referencePath: string): Promise<ReferenceState> {
  const absolute = path.isAbsolute(referencePath) ? referencePath : path.resolve(process.cwd(), referencePath);
  const file = path.basename(absolute);
  try {
    const stat = statSync(absolute);
    if (!stat.isFile()) {
      return { loaded: false, bytes: 0, file, base64: null, detail: `${file} is not a file.` };
    }
    if (stat.size === 0) {
      return { loaded: false, bytes: 0, file, base64: null, detail: `${file} is empty.` };
    }
    if (stat.size > MAX_REFERENCE_BYTES) {
      return {
        loaded: false,
        bytes: stat.size,
        file,
        base64: null,
        detail: `${file} is ${stat.size} bytes, larger than the ${MAX_REFERENCE_BYTES}-byte ceiling.`,
      };
    }
    const cached = referenceCache.get(absolute);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.bytes === stat.size) {
      return { loaded: true, bytes: stat.size, file, base64: cached.base64, detail: `${file}, ${stat.size} bytes.` };
    }
    const data = await readFile(absolute);
    const base64 = data.toString("base64");
    referenceCache.set(absolute, { mtimeMs: stat.mtimeMs, bytes: stat.size, base64 });
    return { loaded: true, bytes: stat.size, file, base64, detail: `${file}, ${stat.size} bytes.` };
  } catch {
    // Absent is the normal pre-deployment state and is reported as absent,
    // never substituted with another recording.
    return {
      loaded: false,
      bytes: 0,
      file,
      base64: null,
      detail: `${file} is not prepared. Run deploy/voxcpm/prepare-reference.sh from the repository.`,
    };
  }
}

export function createVoxCpmApi(readEnv?: ReadEnv): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  const limiter = createRateLimiter();

  function admit(req: ConnectLikeReq, res: ConnectLikeRes, bucket: string, limit: { max: number; windowMs: number }): boolean {
    const decision = limiter.take(`${bucket}:${clientKey(req)}`, limit);
    if (decision.ok) return true;
    res.setHeader("Retry-After", String(decision.retryAfterSeconds));
    sendJson(res, { ok: false, error: "Too many voice requests; slow down." }, 429);
    return false;
  }

  async function handleStatus(req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): Promise<void> {
    if ((req.method ?? "GET") !== "GET") {
      next();
      return;
    }
    const config = voxCpmConfig(readEnv);
    const reference = await loadReference(config.referencePath);
    const reasons: string[] = [];
    if (!config.baseUrl) reasons.push("VOXCPM_BASE_URL is unset — no inference server is configured.");
    if (!reference.loaded) reasons.push(reference.detail);
    if (!config.consentAttested) {
      reasons.push(
        "LELU_VOICE_CONSENT_ATTESTED is not \"true\" — cloning is gated until the speaker's authorisation is attested.",
      );
    }
    const configured = reasons.length === 0;
    // Presence, not health: no network call here, and nothing is claimed
    // about whether the inference server is currently up.
    sendJson(res, {
      configured,
      model: config.model,
      referenceLoaded: reference.loaded,
      referenceFile: reference.file,
      referenceBytes: reference.loaded ? reference.bytes : null,
      referenceTranscriptChars: config.referenceText.length,
      consentAttested: config.consentAttested,
      voiceIdentity: LELU_VOICE_IDENTITY.id,
      outputSampleRate: LELU_VOICE_IDENTITY.outputSampleRate,
      detail: configured
        ? `VoxCPM2 (${config.model}) is configured with ${reference.file}.`
        : reasons.join(" "),
      contacted: false,
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
    if (!admit(req, res, "voxcpm-tts", TTS_LIMIT)) return;
    void (async () => {
      const config = voxCpmConfig(readEnv);
      if (!config.consentAttested) {
        sendJson(
          res,
          {
            ok: false,
            error:
              "Voice cloning is gated: LELU_VOICE_CONSENT_ATTESTED is not \"true\". Nothing was generated.",
          },
          403,
        );
        return;
      }
      if (!config.baseUrl) {
        sendJson(res, { ok: false, error: "VoxCPM2 is not configured: VOXCPM_BASE_URL is unset." }, 503);
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
      const reference = await loadReference(config.referencePath);
      if (!reference.loaded || !reference.base64) {
        // Never synthesise with a different speaker because the asset is missing.
        sendJson(res, { ok: false, error: reference.detail }, 503);
        return;
      }
      const started = Date.now();
      try {
        const response = await fetch(`${config.baseUrl}/v1/audio/speech`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "audio/wav" },
          body: JSON.stringify({
            model: config.model,
            input: text,
            voice: "default",
            response_format: "wav",
            // Reference conditioning — the documented VoxCPM2 cloning inputs:
            // the audio and its exact transcript (prompt pairing), plus the same
            // clip as the isolated reference for "ultimate cloning" fidelity.
            prompt_audio: reference.base64,
            prompt_text: config.referenceText,
            reference_audio: reference.base64,
            reference_text: config.referenceText,
            stream: false,
            normalize: true,
          }),
          signal: AbortSignal.timeout(120_000),
        });
        if (!response.ok) {
          // Status only: an upstream body can echo the text or contain paths.
          sendJson(
            res,
            { ok: false, error: "VoxCPM2 refused the request.", upstreamStatus: response.status },
            502,
          );
          return;
        }
        const audio = new Uint8Array(await response.arrayBuffer());
        if (audio.byteLength === 0) {
          sendJson(res, { ok: false, error: "VoxCPM2 returned empty audio." }, 502);
          return;
        }
        if (audio.byteLength > MAX_UPSTREAM_BYTES) {
          sendJson(res, { ok: false, error: "VoxCPM2 returned more audio than the ceiling allows." }, 502);
          return;
        }
        res.statusCode = 200;
        res.setHeader("Content-Type", response.headers.get("content-type") ?? "audio/wav");
        res.setHeader("Content-Length", String(audio.byteLength));
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("X-Lelu-Voice-Identity", LELU_VOICE_IDENTITY.id);
        res.setHeader("X-Lelu-Vox-Ms", String(Date.now() - started));
        // Generated audio is not a place for a user's text to travel back out.
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.end(audio);
      } catch (error) {
        sendJson(
          res,
          { ok: false, error: `VoxCPM2 request failed: ${(error as Error).message}` },
          502,
        );
      }
    })();
  }

  return {
    attach(middlewares) {
      middlewares.use("/api/voice/voxcpm/status", (req, res, next) => {
        void handleStatus(req, res, next);
      });
      middlewares.use("/api/voice/voxcpm/tts", handleTts);
    },
  };
}

/** Fingerprint of the reference file, for evidence without shipping the audio. */
export function referenceFingerprint(referencePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const absolute = path.isAbsolute(referencePath) ? referencePath : path.resolve(process.cwd(), referencePath);
    const hash = createHash("sha256");
    const stream = createReadStream(absolute);
    stream.on("error", () => resolve(null));
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export function voxCpmApiPlugin(readEnv?: ReadEnv): {
  name: string;
  configureServer: (server: { middlewares: { use: (path: string, handler: Handler) => void } }) => void;
  configurePreviewServer: (server: { middlewares: { use: (path: string, handler: Handler) => void } }) => void;
} {
  const api = createVoxCpmApi(readEnv);
  return {
    name: "voxcpm-api",
    configureServer(server) {
      api.attach(server.middlewares);
    },
    configurePreviewServer(server) {
      api.attach(server.middlewares);
    },
  };
}
