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
  runCommand: (command: string, timeoutMs: number) => Promise<EngineerCommandResult>;
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

/** Reject state-changing requests whose Origin does not match the Host. */
function isCrossOrigin(req: ConnectLikeReq): boolean {
  const headers = req.headers ?? {};
  const origin = typeof headers.origin === "string" ? headers.origin : "";
  const host = typeof headers.host === "string" ? headers.host : "";
  if (!origin || !host) return false; // curl / non-browser clients — allowed
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

function tokenRequired(): boolean {
  return typeof process !== "undefined" && Boolean(process.env.LELU_ENGINEER_TOKEN);
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

      /* ---- GET /api/engineer/status — runtime capability report ---- */
      if (route === "/api/engineer/status") {
        if (method === "GET") {
          sendJson(res, {
            ok: true,
            runtime: adapter.runtime,
            available: true,
            operations: Object.keys(ENGINEER_OPERATIONS),
            workspace: adapter.workspaceRoot.split(/[\\/]/).pop() ?? "",
            tokenRequired: tokenRequired(),
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
      if (tokenRequired()) {
        const header = req.headers?.["x-lelu-token"];
        const provided = Array.isArray(header) ? header[0] : header;
        if (provided !== process.env.LELU_ENGINEER_TOKEN) {
          sendJson(
            res,
            { ok: false, error: "Engineering runtime requires an access token (LELU_ENGINEER_TOKEN)." },
            401,
          );
          return;
        }
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
