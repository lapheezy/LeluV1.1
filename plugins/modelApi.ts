/**
 * ==========================================================
 * LÉLU — MODEL BROKER (server-side middleware)
 *
 * The browser cannot call a chat provider directly. Two
 * reasons, and only one of them is this container's:
 *
 *   1. providers do not serve CORS to arbitrary origins, and
 *      a sandboxed runtime may not have outbound egress at
 *      all — which is exactly why real-model cognition was
 *      NOT VERIFIED in the browser;
 *   2. calling one directly means shipping the API key into
 *      the page, where anyone with devtools can read it.
 *
 * This repository already answered both, for one provider:
 * /api/ai proxies GitHub Models with the token held
 * server-side "so the GITHUB_TOKEN never reaches the browser
 * bundle". Anthropic and the rest were the exception, not the
 * rule. This generalises the rule.
 *
 * It is NOT a second AI client. It has no idea what a
 * conversation, a tool call or a fallback is: it forwards one
 * HTTP request to one upstream and returns the answer
 * verbatim. Every decision about which provider to use, in
 * what order, with what payload, still belongs to the
 * existing AIRouter / AIProviderRegistry / ProviderResolver
 * chain, which is unchanged.
 *
 * Endpoints:
 *   POST /api/model/<provider>/<upstream path>
 *   GET  /api/model/status  → { <provider>: boolean }
 *
 * Safety model:
 *   - credentials are read from server env and NEVER returned
 *   - the client's own auth headers are dropped, not trusted
 *   - only the providers listed here can be reached
 *   - status reports whether a key exists, never what it is
 * ==========================================================
 */

import { endpoint, type EndpointId } from "../src/core/Endpoints.ts";

export type EnvReader = (name: string) => string | undefined;

/** How one provider is authenticated upstream. */
interface BrokeredProvider {
  /** The endpoint id whose base URL requests are forwarded to. */
  endpointId: EndpointId;
  /** Environment names carrying the credential, in order of preference. */
  keyNames: string[];
  /** Build the auth headers from the resolved credential. */
  authHeaders: (key: string) => Record<string, string>;
}

/**
 * The providers a browser may reach through the broker.
 *
 * An allowlist rather than a pass-through: a broker that forwards to
 * any URL a page names is an open proxy, and this one runs with
 * credentials attached.
 */
export const BROKERED: Record<string, BrokeredProvider> = {
  anthropic: {
    endpointId: "anthropic",
    keyNames: ["VITE_ANTHROPIC_API_KEY", "ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
    authHeaders: (key) => ({ "x-api-key": key, "anthropic-version": "2023-06-01" }),
  },
  groq: {
    endpointId: "groq",
    keyNames: ["VITE_GROQ_API_KEY", "GROQ_API_KEY"],
    authHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  openrouter: {
    endpointId: "openrouter",
    keyNames: ["VITE_OPENROUTER_API_KEY", "OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"],
    authHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  cerebras: {
    endpointId: "cerebras",
    keyNames: ["VITE_CEREBRAS_API_KEY", "CEREBRAS_API_KEY"],
    authHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  mistral: {
    endpointId: "mistral",
    keyNames: ["VITE_MISTRAL_API_KEY", "MISTRAL_API_KEY"],
    authHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  fireworks: {
    endpointId: "fireworks",
    keyNames: ["VITE_FIREWORKS_API_KEY", "FIREWORKS_API_KEY"],
    authHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  },
  // Gemini and GitHub Models are remote providers in the same registry and
  // fallback chain as the six above. Leaving them out meant two providers
  // still needed a real key in the browser, which is the whole exposure this
  // broker exists to remove — so they are brokered here rather than through
  // anything new.
  gemini: {
    endpointId: "gemini",
    keyNames: [
      "VITE_GEMINI_API_KEY",
      "GEMINI_API_KEY",
      "GOOGLE_API_KEY",
      "GOOGLE_GENERATIVE_AI_API_KEY",
    ],
    authHeaders: (key) => ({ "x-goog-api-key": key }),
  },
  githubModels: {
    endpointId: "githubModels",
    keyNames: ["VITE_GITHUB_TOKEN", "GITHUB_MODELS_TOKEN"],
    authHeaders: (key) => ({ Authorization: `Bearer ${key}` }),
  },
};

export type BrokeredProviderId = keyof typeof BROKERED;

/** The path a browser posts to for a given provider and upstream path. */
export function brokerPath(provider: string, path = ""): string {
  const tail = path.replace(/^\/+/, "");
  return tail ? `/api/model/${provider}/${tail}` : `/api/model/${provider}`;
}

interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
  /** Present on a real Node response; used to forward a stream chunk by chunk. */
  write?: (chunk: string | Uint8Array) => boolean;
  flushHeaders?: () => void;
}

interface ConnectLikeReq {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  on?: (event: "data" | "end" | "error", fn: (chunk?: unknown) => void) => void;
}

type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

interface MiddlewareHost {
  use: (path: string, handler: Handler) => void;
}

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

/**
 * The request body, as bytes.
 *
 * Deliberately NOT decoded to a string: voice posts multipart audio through
 * this same broker, and a utf8 round trip corrupts the audio part while
 * leaving the envelope readable — which fails upstream with a parse error that
 * looks like anything but an encoding bug.
 */
function readBody(req: ConnectLikeReq): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!req.on) return resolve(Buffer.alloc(0));
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk) => {
      const buffer = Buffer.from(chunk as Buffer);
      total += buffer.length;
      if (total > MAX_BODY_BYTES) {
        // A broker that will forward a body of any size, with a credential
        // attached, is a way to spend someone else's quota from a page.
        reject(new Error("Request body too large."));
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (error) => reject(error));
  });
}

/**
 * Upper bound on a forwarded body. Chat payloads are kilobytes; the ceiling
 * is set by audio — Whisper accepts uploads up to 25 MB, and transcription
 * shares this broker.
 */
const MAX_BODY_BYTES = 26_214_400;

/** How long to wait on an upstream before giving up. */
const UPSTREAM_TIMEOUT_MS = 120_000;

function headerValue(req: ConnectLikeReq, name: string): string {
  const raw = req.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : "";
}

/**
 * Is this request driven by a page from somewhere else?
 *
 * The broker attaches the server's credential to whatever it forwards, so a
 * third-party page must not be able to drive it. Browsers always send Origin
 * on a cross-origin POST; a request with no Origin and no Referer is a
 * same-process or CLI caller and is allowed through, matching the behaviour
 * the dedicated relay had before this became the single mechanism.
 */
function crossOrigin(req: ConnectLikeReq): boolean {
  const origin = headerValue(req, "origin");
  const referer = headerValue(req, "referer");
  const host = headerValue(req, "host");
  if (!origin && !referer) return false;
  if (!host) return false;
  for (const candidate of [origin, referer]) {
    if (!candidate) continue;
    try {
      if (new URL(candidate).host !== host) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/**
 * Reject a path that tries to leave the provider's own API surface.
 *
 * The upstream target is built by concatenation, so `..` segments or an
 * absolute/scheme-relative path would aim the credential at a host the
 * allowlist never approved — which is the open-proxy failure the allowlist
 * exists to prevent.
 */
function safeUpstreamPath(path: string): boolean {
  if (!path) return true;
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (path.includes("..")) return false;
  if (/[\r\n]/.test(path)) return false;
  try {
    if (/^[a-z][a-z0-9+.-]*:/i.test(decodeURIComponent(path))) return false;
    if (decodeURIComponent(path).includes("..")) return false;
  } catch {
    return false;
  }
  return true;
}

/**
 * The caller's own Content-Type, when it has one.
 *
 * JSON is the default because that is what every chat request sends. But a
 * multipart body carries its boundary in this header, so replacing it with
 * application/json makes the parts unreadable upstream — that single
 * substitution was why audio needed a second relay of its own.
 */
function forwardedContentType(req: ConnectLikeReq): string {
  const raw = req.headers?.["content-type"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" && value.length > 0 ? value : "application/json";
}

/**
 * Warn when a model credential is stored under a `VITE_` name.
 *
 * Vite inlines every `VITE_` variable for the DEV server, so such a key is
 * readable by anyone who can reach it even though the broker reads it
 * server-side and the production bundle stays clean. The only complete fix is
 * the rename, so this makes it impossible to miss. Names only — never a
 * value, never a length.
 */
function warnAboutPrefixedCredentials(readEnv: EnvReader): void {
  const exposed = new Set<string>();
  for (const provider of Object.values(BROKERED)) {
    for (const name of provider.keyNames) {
      if (!name.startsWith("VITE_")) continue;
      const value = readEnv(name);
      if (typeof value === "string" && value.trim().length > 0) exposed.add(name);
    }
  }
  if (exposed.size === 0) return;
  console.warn(
    `[LÉLU] ${exposed.size} model credential(s) are stored under a VITE_ prefix: ` +
      `${[...exposed].sort().join(", ")}.\n` +
      "        These still work — the broker reads them server-side — but Vite's DEV\n" +
      "        server exposes every VITE_ variable to the browser, so they are\n" +
      "        readable by anyone who can reach it. Rename them to their unprefixed\n" +
      "        server-side names (see ENV_VARS.md) and rotate the old values.",
  );
}

export function createModelApi(readEnv: EnvReader) {
  warnAboutPrefixedCredentials(readEnv);
  const credentialFor = (provider: BrokeredProvider): string => {
    for (const name of provider.keyNames) {
      const value = readEnv(name);
      if (value && value.trim()) return value.trim();
    }
    return "";
  };

  async function handle(req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): Promise<void> {
    const url = req.url ?? "";

    // WHICH PROVIDERS THE SERVER CAN REACH. Booleans only — a status
    // route that leaked the key would defeat the point of the broker.
    if (url === "/status" || url.startsWith("/status?")) {
      const status: Record<string, boolean> = {};
      for (const [id, provider] of Object.entries(BROKERED)) {
        status[id] = credentialFor(provider).length > 0;
      }
      sendJson(res, { ok: true, providers: status });
      return;
    }

    const match = /^\/([A-Za-z0-9_-]+)(\/.*)?$/.exec(url.split("?")[0] ?? "");
    if (!match) return next();

    const [, providerId, rest] = match;
    const provider = BROKERED[providerId];
    if (!provider) {
      sendJson(
        res,
        {
          ok: false,
          error: `No brokered provider "${providerId}".`,
          providers: Object.keys(BROKERED),
        },
        404,
      );
      return;
    }

    // A page from another origin must not be able to drive a broker that
    // attaches the server's credential to what it forwards.
    if (crossOrigin(req)) {
      sendJson(res, { ok: false, error: "Cross-origin broker requests are refused." }, 403);
      return;
    }

    if (!safeUpstreamPath(rest ?? "")) {
      sendJson(res, { ok: false, error: "Invalid upstream path." }, 400);
      return;
    }

    const key = credentialFor(provider);
    if (!key) {
      // A missing credential is reported as a missing credential, not as
      // a network error — the difference is what an operator has to fix.
      sendJson(
        res,
        {
          ok: false,
          error: `No credential configured for "${providerId}" on the server.`,
          expected: provider.keyNames,
        },
        503,
      );
      return;
    }

    const target = `${endpoint(provider.endpointId)}${rest ?? ""}`;
    try {
      const upstream = await fetch(target, {
        method: req.method ?? "POST",
        headers: {
          "Content-Type": forwardedContentType(req),
          // The server's credential, always. Anything the page sent is
          // dropped: the browser is not a source of authority here.
          ...provider.authHeaders(key),
        },
        body: req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });

      const contentType = upstream.headers.get("content-type") ?? "application/json";
      res.statusCode = upstream.status;
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "no-store");

      // STREAMING. Groq and Anthropic ask for `stream: true` whenever a turn
      // carries an onDelta handler, and read the reply with getReader(). If
      // the broker buffered that with upstream.text() the whole answer would
      // land in one piece at the end: the text would be correct and the
      // progressive reveal — the thing streaming is for — would be gone.
      //
      // So an event-stream is forwarded chunk by chunk, unaltered. Anything
      // else is still returned whole, including the upstream's own errors: a
      // broker that rewrote a 401 into something friendlier would hide the
      // one fact the caller needs.
      const isEventStream = contentType.includes("text/event-stream");
      if (isEventStream && upstream.body && typeof res.write === "function") {
        res.flushHeaders?.();
        const reader = upstream.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) res.write(value);
          }
        } finally {
          reader.releaseLock();
          res.end();
        }
        return;
      }

      res.end(await upstream.text());
    } catch (error) {
      sendJson(
        res,
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          target: endpoint(provider.endpointId),
        },
        502,
      );
    }
  }

  return {
    attach(host: MiddlewareHost): void {
      host.use("/api/model", (req, res, next) => {
        void handle(req, res, next);
      });
    },
  };
}
