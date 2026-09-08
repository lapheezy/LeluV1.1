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

function readBody(req: ConnectLikeReq): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!req.on) return resolve("");
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk as Buffer)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", (error) => reject(error));
  });
}

export function createModelApi(readEnv: EnvReader) {
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
          "Content-Type": "application/json",
          // The server's credential, always. Anything the page sent is
          // dropped: the browser is not a source of authority here.
          ...provider.authHeaders(key),
        },
        body: req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req),
      });

      res.statusCode = upstream.status;
      res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
      res.setHeader("Cache-Control", "no-store");
      // The upstream's own answer, verbatim — including its errors. A
      // broker that rewrote a 401 into something friendlier would hide
      // the one fact the caller needs.
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
