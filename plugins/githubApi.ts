/**
 * ==========================================================
 * LÉLU — GITHUB API PROXY (server-side middleware)
 *
 * Proxies GitHub REST API calls through the server so the
 * GITHUB_TOKEN never reaches the browser bundle. Mounted
 * by the same middleware stack as the engineer API.
 *
 * Endpoints:
 *   GET  /api/github/status   → { configured: boolean, user?: object }
 *   POST /api/github/proxy    → { endpoint, method?, body? }
 *
 * Safety model:
 *   - Token is server-only (process.env.GITHUB_TOKEN)
 *   - CORS/origin guard rejects cross-origin POSTs
 *   - Rate-limited to prevent abuse
 *   - Only proxied endpoints are allowed
 * ==========================================================
 */

import { endpoint } from "../src/core/Endpoints.ts";

const GITHUB_API_BASE = endpoint("github");
const RATE_LIMIT_MS = 500;
let lastRequestTime = 0;

interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
}

interface ConnectLikeReq {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[] | undefined>;
  on?: (event: "data" | "end" | "error", fn: (chunk?: unknown) => void) => void;
}

type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

function readJsonBody(req: ConnectLikeReq): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    if (typeof req.on !== "function") {
      resolve({});
      return;
    }
    let body = "";
    req.on("data", (chunk) => {
      body += String(chunk ?? "");
    });
    req.on("end", () => {
      try {
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

function getToken(): string {
  return (
    process.env.VITE_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GITHUB_CODESPACE_TOKEN ||
    ""
  );
}

/** Only allow proxying to specific GitHub API paths. */
const ALLOWED_PREFIXES = [
  "/user",
  "/repos",
  "/git/",
  "/pulls",
  "/issues",
  "/commits",
  "/branches",
  "/contents",
  "/compare",
  "/rate_limit",
];

function isAllowedEndpoint(endpoint: string): boolean {
  const normalized = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;
  return ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/* ------------------------------------------------------------------ */
/* the API                                                             */
/* ------------------------------------------------------------------ */

export function createGithubApi(): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  function handleRoute(route: "/api/github/status" | "/api/github/proxy") {
    return (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): void => {
      const method = req.method ?? "GET";
      const token = getToken();

      /* ---- GET /api/github/status ---- */
      if (route === "/api/github/status") {
        if (method !== "GET") { next(); return; }
        if (!token) {
          sendJson(res, { configured: false, error: "No GitHub token configured." });
          return;
        }
        // Verify token by calling /user
        void (async () => {
          try {
            const response = await fetch(`${GITHUB_API_BASE}/user`, {
              headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${token}`,
                "User-Agent": "LÉLU-Runtime",
              },
            });
            if (!response.ok) {
              sendJson(res, { configured: false, error: `GitHub API returned ${response.status}` }, 401);
              return;
            }
            const user = await response.json() as Record<string, unknown>;
            sendJson(res, {
              configured: true,
              user: {
                login: user.login,
                id: user.id,
                name: user.name,
                avatar_url: user.avatar_url,
                type: user.type,
              },
            });
          } catch (error) {
            sendJson(res, { configured: false, error: error instanceof Error ? error.message : String(error) }, 502);
          }
        })();
        return;
      }

      /* ---- POST /api/github/proxy ---- */
      if (route === "/api/github/proxy") {
        if (method !== "POST") { next(); return; }
        if (!token) {
          sendJson(res, { ok: false, error: "No GitHub token configured." }, 401);
          return;
        }
        if (isCrossOrigin(req)) {
          sendJson(res, { ok: false, error: "Cross-origin GitHub requests are not permitted." }, 403);
          return;
        }

        // Rate limit
        const now = Date.now();
        if (now - lastRequestTime < RATE_LIMIT_MS) {
          sendJson(res, { ok: false, error: "Rate limited — too many requests." }, 429);
          return;
        }
        lastRequestTime = now;

        void (async () => {
          try {
            const payload = await readJsonBody(req);
            const endpoint = String(payload.endpoint ?? "");
            const httpMethod = String(payload.method ?? "GET").toUpperCase();
            const body = payload.body;

            if (!endpoint) {
              sendJson(res, { ok: false, error: "Missing 'endpoint' field." }, 400);
              return;
            }
            if (!isAllowedEndpoint(endpoint)) {
              sendJson(res, { ok: false, error: `Endpoint '${endpoint}' is not in the allowlist.` }, 403);
              return;
            }

            const url = `${GITHUB_API_BASE}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
            const fetchOptions: RequestInit = {
              method: httpMethod,
              headers: {
                Accept: "application/vnd.github+json",
                Authorization: `Bearer ${token}`,
                "User-Agent": "LÉLU-Runtime",
                ...(body ? { "Content-Type": "application/json" } : {}),
              },
              ...(body && httpMethod !== "GET" && httpMethod !== "HEAD"
                ? { body: JSON.stringify(body) }
                : {}),
            };

            const response = await fetch(url, fetchOptions);
            const responseText = await response.text();
            let responseData: unknown;
            try {
              responseData = JSON.parse(responseText);
            } catch {
              responseData = responseText;
            }

            sendJson(res, {
              ok: response.ok,
              status: response.status,
              data: responseData,
              headers: {
                "x-ratelimit-remaining": response.headers.get("x-ratelimit-remaining"),
                "x-ratelimit-limit": response.headers.get("x-ratelimit-limit"),
              },
            });
          } catch (error) {
            sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
          }
        })();
        return;
      }

      next();
    };
  }

  return {
    attach(middlewares) {
      middlewares.use("/api/github/status", handleRoute("/api/github/status"));
      middlewares.use("/api/github/proxy", handleRoute("/api/github/proxy"));
    },
  };
}

/* ------------------------------------------------------------------ */
/* Vite plugin wrapper                                                 */
/* ------------------------------------------------------------------ */

export function githubApiPlugin(): {
  name: string;
  configureServer: (server: { middlewares: { use: (path: string, handler: Handler) => void } }) => void;
  configurePreviewServer: (server: { middlewares: { use: (path: string, handler: Handler) => void } }) => void;
} {
  const api = createGithubApi();
  return {
    name: "github-api",
    configureServer(server) {
      api.attach(server.middlewares);
    },
    configurePreviewServer(server) {
      api.attach(server.middlewares);
    },
  };
}
