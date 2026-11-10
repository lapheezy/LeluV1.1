/**
 * ==========================================================
 * LÉLU — MESHY BROKER (server-side middleware)
 *
 * The Meshy key is a server secret. The avatar pipeline used to
 * read `VITE_MESHY_API_KEY` from the browser bundle, which is
 * the exposure this broker exists to remove — and in this
 * deployment the key is injected as a platform secret named
 * `Meshy`, so the browser never saw it at all and true 3D
 * reconstruction reported itself unconfigured while the
 * credential sat right there on the server.
 *
 * Same contract as the model broker (plugins/modelApi.ts),
 * deliberately: one same-origin path, credential attached
 * server-side, a strict allowlist of upstream routes, no key
 * material in any response.
 *
 *   GET  /api/meshy/status            → { configured, source, upstream, balance? }
 *   POST /api/meshy/image-to-3d       → { result: <taskId> }
 *   GET  /api/meshy/image-to-3d/:id   → { status, progress, model_urls }
 *
 * `status` probes Meshy's balance endpoint, which costs no
 * generation credits — so "configured" means the key is
 * actually accepted upstream, not merely that a string exists.
 * ==========================================================
 */

import { endpoint } from "../src/core/Endpoints.ts";

export type EnvReader = (name: string) => string | undefined;

/**
 * Names the key may arrive under, in order of preference.
 *
 * `Meshy` is first-class, not a fallback: that is literally the
 * name this deployment's secret store uses, and a broker that only
 * understood `MESHY_API_KEY` would report "not configured" while
 * the credential was present.
 */
export const MESHY_KEY_NAMES = ["MESHY_API_KEY", "Meshy", "MESHY_KEY", "MESHY_TOKEN", "VITE_MESHY_API_KEY"] as const;

type ConnectLikeReq = {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  on?: (event: string, listener: (chunk?: unknown) => void) => void;
};

type ConnectLikeRes = {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
};

export interface MeshyMiddlewareHost {
  use: (path: string, handler: (req: ConnectLikeReq, res: ConnectLikeRes) => void) => void;
}

export interface MeshyApiOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
}

export type MeshyStatus = {
  configured: boolean;
  /** WHICH environment name supplied the key — never the key itself. */
  source: string | null;
  upstream: "reachable" | "unreachable" | "not-checked";
  balance?: number;
  error?: string;
};

const MAX_BODY_BYTES = 26_214_400; // a data-URI reference image, base64
const DEFAULT_TIMEOUT_MS = 90_000;

function headerValue(req: ConnectLikeReq, name: string): string {
  const raw = req.headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : "";
}

/**
 * A page from another origin must not drive a broker that attaches the
 * server's credential. Browsers always send Origin on cross-origin POSTs;
 * a request with neither Origin nor Referer is same-process or a CLI.
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

function readBody(req: ConnectLikeReq): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!req.on) return resolve(Buffer.alloc(0));
    const chunks: Buffer[] = [];
    let total = 0;
    req.on("data", (chunk) => {
      const buffer = Buffer.from(chunk as Buffer);
      total += buffer.length;
      if (total > MAX_BODY_BYTES) {
        reject(new Error("Request body too large."));
        return;
      }
      chunks.push(buffer);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", (error) => reject(error));
  });
}

/** Only the documented Meshy API surface is reachable. */
function safePath(path: string): boolean {
  return /^\/openapi\/v1\/[a-z0-9-]+(\/[A-Za-z0-9_-]+)?$/i.test(path);
}

export function createMeshyApi(readEnv: EnvReader, options: MeshyApiOptions = {}) {
  const doFetch = options.fetchImpl ?? fetch;
  const base = (options.baseUrl ?? endpoint("meshy")).replace(/\/+$/, "");
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  function resolveKey(): { key: string; source: string } | null {
    for (const name of MESHY_KEY_NAMES) {
      const value = readEnv(name);
      if (typeof value === "string" && value.trim().length > 0) {
        return { key: value.trim(), source: name };
      }
    }
    return null;
  }

  async function upstream(path: string, init: RequestInit = {}): Promise<Response> {
    const resolved = resolveKey();
    if (!resolved) throw new Error("NOT_CONFIGURED");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await doFetch(`${base}${path}`, {
        ...init,
        headers: {
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers as Record<string, string> | undefined),
          Authorization: `Bearer ${resolved.key}`,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  function send(res: ConnectLikeRes, status: number, payload: unknown): void {
    res.statusCode = status;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify(payload));
  }

  /** Key presence plus a REAL upstream check that spends no credits. */
  async function status(): Promise<MeshyStatus> {
    const resolved = resolveKey();
    if (!resolved) {
      return {
        configured: false,
        source: null,
        upstream: "not-checked",
        error:
          `No Meshy key on the server. Looked for: ${MESHY_KEY_NAMES.join(", ")}. ` +
          "The browser is never given the key; this proxy reads it from the server environment.",
      };
    }
    try {
      const response = await upstream("/openapi/v1/balance", { method: "GET" });
      if (!response.ok) {
        return {
          configured: false,
          source: resolved.source,
          upstream: "unreachable",
          error: `Meshy rejected the credential (HTTP ${response.status}).`,
        };
      }
      const body = (await response.json().catch(() => ({}))) as { balance?: number };
      return {
        configured: true,
        source: resolved.source,
        upstream: "reachable",
        ...(typeof body.balance === "number" ? { balance: body.balance } : {}),
      };
    } catch (error) {
      return {
        configured: true,
        source: resolved.source,
        upstream: "unreachable",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function handle(req: ConnectLikeReq, res: ConnectLikeRes): Promise<void> {
    try {
      /* connect() strips the mount path; accept both shapes so this works
         under Vite dev, `vite preview` and the standalone server alike. */
      const raw = req.url ?? "/";
      const path = (raw.startsWith("/api/meshy") ? raw.slice("/api/meshy".length) : raw) || "/";
      const method = (req.method ?? "GET").toUpperCase();

      if (method === "GET" && path === "/status") {
        send(res, 200, await status());
        return;
      }

      if (crossOrigin(req)) {
        send(res, 403, { error: "Cross-origin requests cannot use the Meshy proxy." });
        return;
      }

      if (method === "POST" && path === "/image-to-3d") {
        if (!resolveKey()) {
          send(res, 503, {
            error:
              "The Meshy key is not configured on the server. Set MESHY_API_KEY (or Meshy) and restart the runtime — the browser is never given the key.",
          });
          return;
        }
        const body = await readBody(req);
        if (body.length > MAX_BODY_BYTES) {
          send(res, 413, { error: "Reference image too large." });
          return;
        }
        const response = await upstream("/openapi/v1/image-to-3d", { method: "POST", body });
        const text = await response.text();
        res.statusCode = response.status;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(text);
        return;
      }

      const pollMatch = path.match(/^\/image-to-3d\/([A-Za-z0-9_-]{1,64})$/);
      if (method === "GET" && pollMatch) {
        if (!resolveKey()) {
          send(res, 503, { error: "The Meshy key is not configured on the server." });
          return;
        }
        const target = `/openapi/v1/image-to-3d/${pollMatch[1]}`;
        if (!safePath(target)) {
          send(res, 400, { error: "Unsupported Meshy path." });
          return;
        }
        const response = await upstream(target, { method: "GET" });
        const text = await response.text();
        res.statusCode = response.status;
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(text);
        return;
      }

      send(res, 404, { error: `No Meshy route for ${method} ${path}` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      send(res, message === "NOT_CONFIGURED" ? 503 : 502, {
        error: message === "NOT_CONFIGURED" ? "The Meshy key is not configured on the server." : `Meshy proxy failed: ${message}`,
      });
    }
  }

  return {
    attach(middlewares: MeshyMiddlewareHost): void {
      middlewares.use("/api/meshy", (req, res) => {
        void handle(req, res);
      });
    },
    /** Exposed for tests and for /api/env-check style reporting. */
    status,
    handle,
  };
}
