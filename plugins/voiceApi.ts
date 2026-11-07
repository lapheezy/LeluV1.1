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
 *   GET  /api/voice/status  → { configured, voiceId, modelId }  (no key, no network)
 *   POST /api/voice/tts     → audio/mpeg for { text }
 *
 * Failure is reported as failure: a synthesis error returns a
 * JSON body with the upstream status, never silent audio and
 * never a 200 carrying an error string.
 * ==========================================================
 */

/** Anything that resolves an environment name, like vite's envReader. */
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

interface ConnectLikeReq {
  method?: string;
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

export function voiceSettings(): { voiceId: string; modelId: string } {
  return { voiceId: DEFAULT_VOICE_ID, modelId: DEFAULT_MODEL_ID };
}

export function createVoiceApi(readEnv?: ReadEnv): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  function voiceConfig(): { key: string; voiceId: string; modelId: string } {
    const configured = voiceSettings();
    return {
      key: readSecret(readEnv, ["ELEVENLABS_API_KEY", "Elevenlabs"]),
      voiceId: readSecret(readEnv, ["ELEVENLABS_VOICE_ID"]) || configured.voiceId,
      modelId: readSecret(readEnv, ["ELEVENLABS_MODEL_ID"]) || configured.modelId,
    };
  }

  function handleStatus(req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): void {
    if ((req.method ?? "GET") !== "GET") {
      next();
      return;
    }
    const { key, voiceId, modelId } = voiceConfig();
    // Presence, not health: this makes no network call and claims nothing
    // about whether the key is still accepted upstream.
    sendJson(res, { configured: Boolean(key), voiceId, modelId });
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
    void (async () => {
      const { key, voiceId, modelId } = voiceConfig();
      if (!key) {
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
        const upstream = await fetch(
          `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
          {
            method: "POST",
            headers: {
              "xi-api-key": key,
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
        if (!upstream.ok) {
          // Report the status, never an upstream body (it can echo the text).
          sendJson(
            res,
            { ok: false, error: "ElevenLabs refused the request.", upstreamStatus: upstream.status },
            upstream.status === 401 || upstream.status === 403 ? 502 : 502,
          );
          return;
        }
        const audio = new Uint8Array(await upstream.arrayBuffer());
        res.statusCode = 200;
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Content-Length", String(audio.byteLength));
        res.setHeader("Cache-Control", "no-store");
        res.end(audio);
      } catch (error) {
        sendJson(
          res,
          { ok: false, error: `ElevenLabs request failed: ${(error as Error).message}` },
          502,
        );
      }
    })();
  }

  return {
    attach(middlewares) {
      middlewares.use("/api/voice/status", handleStatus);
      middlewares.use("/api/voice/tts", handleTts);
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
