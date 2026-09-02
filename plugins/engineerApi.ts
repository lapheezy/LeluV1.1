/**
 * ==========================================================
 * LÉLU — ENGINEERING RUNTIME API (shared middleware)
 *
 * ONE implementation of the engineering endpoints, mounted by
 * every runtime that actually serves the app:
 *
 *   • Vite dev/preview server  (vite.config.ts)
 *   • standalone Node/Bun runtime server (server.ts)
 *   • Deno production entry    (main.ts)
 *
 * Endpoints:
 *   GET  /api/engineer/status   → runtime capability report
 *   POST /api/engineer/command  → { operation } (whitelisted)
 *   POST /api/engineer/read     → { path }       (workspace-bounded)
 *   POST /api/engineer/write    → { path, content } (workspace-bounded)
 *   POST /api/engineer/list     → { path }       (workspace-bounded)
 *
 * IMPORTANT: connect-style servers (Vite's middleware stack) rewrite
 * `req.url` to the mount-point remainder before invoking a handler,
 * so each route is bound at mount time — handlers never re-derive
 * their route from req.url.
 *
 * Safety model — this is deliberately NOT an open code-execution
 * endpoint:
 *   • command whitelist — the client names an operation and the
 *     server maps it to an exact command. A raw command string is
 *     accepted only when it matches a whitelist entry exactly.
 *   • workspace boundary — read/write paths must resolve inside
 *     the workspace root (path traversal is rejected).
 *   • origin guard — state-changing POSTs from a different origin
 *     are rejected (CSRF).
 *   • optional token — when LELU_ENGINEER_TOKEN is set, POSTs must
 *     carry `x-lelu-token`; without it the runtime returns 401 so
 *     the app reports "token required" honestly instead of failing
 *     silently.
 * ==========================================================
 */

export interface EngineerCommandResult {
  ok: boolean;
  status: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/** Thrown by adapters when a path resolves outside the workspace root. */
export class WorkspaceBoundaryError extends Error {
  constructor(message = "Engineering path escapes workspace root.") {
    super(message);
    this.name = "WorkspaceBoundaryError";
  }
}

/**
 * Runtime-agnostic adapter. Node/Bun and Deno each supply their
 * own implementation so the request handling stays identical.
 */
export interface EngineerAdapter {
  /** Label reported in /status (e.g. "vite-dev", "node-server", "deno"). */
  runtime: string;
  workspaceRoot: string;
  /** Resolve a workspace-relative path to an absolute path; throw on escape. */
  resolve: (targetPath: string) => string;
  readFile: (absolutePath: string) => Promise<string> | string;
  writeFile: (absolutePath: string, content: string) => Promise<void> | void;
  /** Directory listing, workspace-bounded — how LÉLU discovers real files. */
  listDir: (absolutePath: string) => Promise<EngineerDirEntry[]> | EngineerDirEntry[];
  /** Live runtime facts (engine + versions + cwd) reported by /status. */
  runtimeInfo: () => EngineerRuntimeInfo;
  runCommand: (command: string, timeoutMs: number) => Promise<EngineerCommandResult>;
}

/** One entry of a workspace-bounded directory listing. */
export interface EngineerDirEntry {
  name: string;
  /** Workspace-relative path, always forward-slashed. */
  path: string;
  type: "file" | "dir";
  size?: number;
}

/** Live facts about the runtime actually serving this API. */
export interface EngineerRuntimeInfo {
  engine: string;
  version: string;
  platform: string;
  cwd: string;
  startedAt: number;
}

/** Whitelisted operations — the only commands the server will ever run. */
export const ENGINEER_OPERATIONS: Record<string, string> = {
  typecheck: "bun tsc -b --noEmit",
  build: "bun run build",
  test: "bun test",
  inspect: "node --version && bun --version && pwd",
};

const DEFAULT_TIMEOUT_MS = 180_000;

const ROUTES = [
  "/api/engineer/status",
  "/api/engineer/command",
  "/api/engineer/read",
  "/api/engineer/write",
  "/api/engineer/list",
] as const;

/* ------------------------------------------------------------------ */
/* request helpers                                                     */
/* ------------------------------------------------------------------ */

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

/**
 * Origins explicitly allowed to reach this runtime from a different
 * host, read from LELU_ENGINEER_ALLOWED_ORIGINS (comma-separated exact
 * origins, or "*"). Empty by default — same-origin only, exactly as
 * before. This is the switch that lets a deployed LÉLU front-end reach
 * a REAL development runtime instead of silently degrading to the
 * build-time snapshot.
 */
function allowedOrigins(): string[] {
  if (typeof process === "undefined") return [];
  return (process.env.LELU_ENGINEER_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function requestOrigin(req: ConnectLikeReq): string {
  const headers = req.headers ?? {};
  return typeof headers.origin === "string" ? headers.origin : "";
}

/** Reject state-changing requests whose Origin is neither the Host nor allowlisted. */
function isCrossOrigin(req: ConnectLikeReq): boolean {
  const headers = req.headers ?? {};
  const origin = requestOrigin(req);
  const host = typeof headers.host === "string" ? headers.host : "";
  if (!origin || !host) return false; // curl / non-browser clients — allowed
  try {
    if (new URL(origin).host === host) return false;
  } catch {
    return true;
  }
  // A different host is permitted only when explicitly allowlisted.
  const allowed = allowedOrigins();
  return !(allowed.includes("*") || allowed.includes(origin));
}

/** Echo CORS headers for an allowlisted cross-origin caller. */
function applyCors(req: ConnectLikeReq, res: ConnectLikeRes): void {
  const origin = requestOrigin(req);
  if (!origin) return;
  const allowed = allowedOrigins();
  if (!allowed.includes("*") && !allowed.includes(origin)) return;
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "content-type, x-lelu-token");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Max-Age", "600");
}

function tokenRequired(): boolean {
  return typeof process !== "undefined" && Boolean(process.env.LELU_ENGINEER_TOKEN);
}

/** Does this request carry the configured access token? */
function hasValidToken(req: ConnectLikeReq): boolean {
  if (typeof process === "undefined") return false;
  const header = req.headers?.["x-lelu-token"];
  const provided = Array.isArray(header) ? header[0] : header;
  return typeof provided === "string" && provided === process.env.LELU_ENGINEER_TOKEN;
}

/* ------------------------------------------------------------------ */
/* the API                                                             */
/* ------------------------------------------------------------------ */

export function createEngineerApi(adapter: EngineerAdapter): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  function handleRoute(route: (typeof ROUTES)[number]) {
    return (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): void => {
      const method = req.method ?? "GET";
      applyCors(req, res);

      /* ---- CORS preflight for an allowlisted cross-origin caller ---- */
      if (method === "OPTIONS") {
        res.statusCode = 204;
        res.end("");
        return;
      }

      /* ---- GET /api/engineer/status — runtime capability report ----
         Deliberately reachable without a token: the client has to be
         able to discover whether a runtime exists at all (and whether
         a token is even required) before it can present one.

         But an unauthenticated probe gets only the capability facts.
         Absolute filesystem paths and engine/version details are
         disclosed ONLY to a caller that already holds the token, so
         enabling LELU_ENGINEER_TOKEN does not leave server internals
         readable by anyone who can reach the port. */
      if (route === "/api/engineer/status") {
        if (method === "GET") {
          const trusted = !tokenRequired() || hasValidToken(req);
          sendJson(res, {
            ok: true,
            runtime: adapter.runtime,
            available: true,
            operations: Object.keys(ENGINEER_OPERATIONS),
            workspace: adapter.workspaceRoot.split(/[\\/]/).pop() ?? "",
            tokenRequired: tokenRequired(),
            ...(trusted
              ? {
                  workspaceRoot: adapter.workspaceRoot,
                  // Live runtime facts, so the client can report REAL
                  // DEVELOPMENT RUNTIME rather than assuming one exists.
                  runtimeInfo: adapter.runtimeInfo(),
                }
              : {}),
          });
          return;
        }
        next();
        return;
      }

      if (method !== "POST") {
        next();
        return;
      }

      /* ---- origin guard (CSRF) ---- */
      if (isCrossOrigin(req)) {
        sendJson(
          res,
          { ok: false, error: "Cross-origin engineering requests are not permitted." },
          403,
        );
        return;
      }

      /* ---- optional token gate ---- */
      if (tokenRequired() && !hasValidToken(req)) {
        sendJson(
          res,
          { ok: false, error: "Engineering runtime requires an access token (LELU_ENGINEER_TOKEN)." },
          401,
        );
        return;
      }

      void (async () => {
        try {
          const payload = await readJsonBody(req);

          /* ---- POST /api/engineer/command (whitelisted) ---- */
          if (route === "/api/engineer/command") {
            const operation = String(payload.operation ?? "");
            const rawCommand = String(payload.command ?? "");
            let command = "";
            if (operation && ENGINEER_OPERATIONS[operation]) {
              command = ENGINEER_OPERATIONS[operation];
            } else if (rawCommand && Object.values(ENGINEER_OPERATIONS).includes(rawCommand)) {
              command = rawCommand; // backward compat: exact whitelist match only
            } else {
              sendJson(
                res,
                {
                  ok: false,
                  error: `Operation not permitted. Allowed: ${Object.keys(ENGINEER_OPERATIONS).join(", ")}.`,
                },
                403,
              );
              return;
            }
            const timeoutMs = Number.isFinite(Number(payload.timeoutMs))
              ? Number(payload.timeoutMs)
              : DEFAULT_TIMEOUT_MS;
            const result = await adapter.runCommand(command, timeoutMs);
            sendJson(res, { ok: result.ok, status: result.status, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs });
            return;
          }

          /* ---- POST /api/engineer/read (workspace-bounded) ---- */
          if (route === "/api/engineer/read") {
            const filePath = String(payload.path ?? "");
            const absolutePath = adapter.resolve(filePath);
            const content = await adapter.readFile(absolutePath);
            sendJson(res, { ok: true, path: filePath, content });
            return;
          }

          /* ---- POST /api/engineer/list (workspace-bounded) ---- */
          if (route === "/api/engineer/list") {
            const dirPath = String(payload.path ?? "");
            const absolutePath = adapter.resolve(dirPath);
            const entries = await adapter.listDir(absolutePath);
            sendJson(res, { ok: true, path: dirPath, entries });
            return;
          }

          /* ---- POST /api/engineer/write (workspace-bounded) ---- */
          if (route === "/api/engineer/write") {
            const filePath = String(payload.path ?? "");
            const content = String(payload.content ?? "");
            const absolutePath = adapter.resolve(filePath);
            await adapter.writeFile(absolutePath, content);
            sendJson(res, { ok: true, path: filePath });
            return;
          }

          next();
        } catch (error) {
          const status = error instanceof WorkspaceBoundaryError ? 403 : 500;
          sendJson(
            res,
            { ok: false, error: error instanceof Error ? error.message : String(error) },
            status,
          );
        }
      })();
    };
  }

  return {
    attach(middlewares) {
      for (const route of ROUTES) {
        middlewares.use(route, handleRoute(route));
      }
    },
  };
}

/* ------------------------------------------------------------------ */
/* Vite plugin wrapper                                                  */
/* ------------------------------------------------------------------ */

export function engineerApiPlugin(adapter: EngineerAdapter): {
  name: string;
  configureServer: (server: { middlewares: { use: (path: string, handler: Handler) => void } }) => void;
  configurePreviewServer: (server: { middlewares: { use: (path: string, handler: Handler) => void } }) => void;
} {
  const api = createEngineerApi(adapter);
  return {
    name: "engineer-api",
    configureServer(server) {
      api.attach(server.middlewares);
    },
    configurePreviewServer(server) {
      api.attach(server.middlewares);
    },
  };
}
