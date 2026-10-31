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
 *   - Requests are spaced (queued), not refused, to stay polite
 *   - Only proxied endpoints are allowed
 *   - WRITES (anything but GET) carry the same three conditions as
 *     `git push` on the engineering runtime: a verified Supabase
 *     identity, LELU_ALLOW_PUSH=1, and never the default branch.
 *     Until this, any same-origin request — or a plain curl — could
 *     create branches and commits with the server's token.
 * ==========================================================
 */

import { endpoint } from "../src/core/Endpoints.ts";
import { verifyRequestIdentity } from "./engineerIdentity.ts";

const GITHUB_API_BASE = endpoint("github");
const RATE_LIMIT_MS = 500;
let lastRequestTime = 0;
let queue: Promise<void> = Promise.resolve();

/**
 * Wait for this request's turn, RATE_LIMIT_MS after the previous one.
 *
 * Requests closer together than that used to be refused with 429, so a
 * normal sequence — read a branch's head, then create a branch from it —
 * failed on its second step whenever GitHub answered the first quickly.
 */
function nextSlot(): Promise<void> {
  const turn = queue.then(async () => {
    const wait = lastRequestTime + RATE_LIMIT_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastRequestTime = Date.now();
  });
  queue = turn.catch(() => {});
  return turn;
}

/** The branch a write would change, when it changes one. */
export function writeTargetBranch(endpointPath: string, method: string, body: unknown): string | null {
  const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const refs = endpointPath.match(/^\/repos\/[^/]+\/[^/]+\/git\/refs\/heads\/(.+)$/);
  if (refs && (method === "PATCH" || method === "DELETE")) return decodeURIComponent(refs[1]);
  if (/^\/repos\/[^/]+\/[^/]+\/contents\//.test(endpointPath) && (method === "PUT" || method === "DELETE")) {
    // Without a branch the contents API writes to the DEFAULT branch.
    return typeof record.branch === "string" && record.branch ? record.branch : "";
  }
  if (/^\/repos\/[^/]+\/[^/]+\/merges$/.test(endpointPath)) {
    return typeof record.base === "string" ? record.base : "";
  }
  return null;
}

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
  // Read-only repository search. GitHubProvider.search() called this
  // endpoint directly from the browser with a VITE_GITHUB_TOKEN, which
  // Vite compiled into the bundle; routing it through this existing
  // proxy is what lets that browser-side token go away.
  "/search/",
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
            const path = endpoint.startsWith("/") ? endpoint : `/${endpoint}`;

            if (httpMethod !== "GET" && httpMethod !== "HEAD") {
              const who = await verifyRequestIdentity(req);
              if (!who.ok || !who.identity) {
                sendJson(res, { ok: false, error: `GitHub write refused: ${who.reason}` }, who.status);
                return;
              }
              if (process.env.LELU_ALLOW_PUSH !== "1") {
                sendJson(
                  res,
                  {
                    ok: false,
                    error:
                      "GitHub write refused: publishing is not enabled on this runtime (LELU_ALLOW_PUSH is not set). Nothing was written to GitHub.",
                  },
                  403,
                );
                return;
              }
              const target = writeTargetBranch(path.split("?")[0], httpMethod, body);
              if (target !== null) {
                const repoPath = path.split("/").slice(0, 4).join("/");
                await nextSlot();
                const repoResponse = await fetch(`${GITHUB_API_BASE}${repoPath}`, {
                  headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "User-Agent": "LÉLU-Runtime" },
                });
                const repoData = (await repoResponse.json().catch(() => ({}))) as { default_branch?: string };
                const defaultBranch = repoData.default_branch ?? "";
                if (!repoResponse.ok || !defaultBranch || target === "" || target === defaultBranch) {
                  sendJson(
                    res,
                    {
                      ok: false,
                      error: repoResponse.ok
                        ? `GitHub write refused: it would change the default branch${defaultBranch ? ` (${defaultBranch})` : ""}. Work on another branch.`
                        : `GitHub write refused: could not confirm the repository's default branch (HTTP ${repoResponse.status}).`,
                    },
                    403,
                  );
                  return;
                }
              }
            }

            await nextSlot();
            const url = `${GITHUB_API_BASE}${path}`;
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
