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
 *   POST /api/engineer/command  → { operation, workspace? } (whitelisted)
 *   POST /api/engineer/read     → { path, workspace? }      (bounded)
 *   POST /api/engineer/write    → { path, content, workspace? } (bounded)
 *   POST /api/engineer/list     → { path, workspace? }      (bounded)
 *   POST /api/engineer/delete   → { path, workspace }  (COPY ONLY)
 *   POST /api/engineer/workspace→ { action, ... }      (isolated copies)
 *
 * WORKSPACE COPIES — the isolation boundary.
 *
 * Without a `workspace` field every operation targets the live project,
 * which is the right behaviour for inspection but means an edit would
 * change the running source. A workspace is a REAL directory holding a
 * REAL copy of the project, created by `workspace:create`; when a
 * request names one, every path resolves inside that copy and commands
 * run with it as their working directory.
 *
 * Two rules keep the source project safe:
 *   • write and delete REQUIRE a workspace. The live project is never
 *     modified by an ordinary edit — only by an explicit apply.
 *   • apply requires `confirm: true` AND a grant nonce this server
 *     issued for that exact workspace, so a change reaches the real
 *     project only through a deliberate, separately authorized step.
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
  runCommand: (
    command: string,
    timeoutMs: number,
    /** Working directory; defaults to the workspace root. */
    cwd?: string,
  ) => Promise<EngineerCommandResult>;

  /* ---- isolated project copies ---- */

  /** Absolute path of the directory holding all workspace copies. */
  sandboxRoot: string;
  /** Resolve a path INSIDE a named workspace copy; throw on escape. */
  resolveInWorkspace: (workspaceId: string, targetPath: string) => string;
  /** Real recursive copy of the project into a new workspace. */
  createWorkspace: (workspaceId: string) => Promise<EngineerWorkspace>;
  listWorkspaces: () => EngineerWorkspace[];
  removeWorkspace: (workspaceId: string) => void;
  deleteFile: (absolutePath: string) => void;
  /** Compare a workspace against the source project, file by file. */
  diffWorkspace: (workspaceId: string) => Promise<EngineerDiffEntry[]>;
  /** Copy the named changed files from the workspace back to the source. */
  applyWorkspace: (workspaceId: string, paths: string[]) => Promise<string[]>;
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

/** One isolated copy of the project that LÉLU may modify. */
export interface EngineerWorkspace {
  id: string;
  /** Absolute path of the copy. */
  root: string;
  createdAt: number;
  /** Files copied when it was created. */
  fileCount: number;
}

/** One changed file, as a real comparison against the source project. */
export interface EngineerDiffEntry {
  path: string;
  status: "added" | "modified" | "deleted";
  /** Unified-ish line counts, computed from the real contents. */
  addedLines: number;
  removedLines: number;
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
  "/api/engineer/delete",
  "/api/engineer/workspace",
] as const;

/**
 * Apply grants issued by this server, keyed by workspace id.
 *
 * A grant is a single-use nonce handed out by `workspace:request-apply`
 * and consumed by `workspace:apply`. It does NOT decide whether the
 * user authorized anything — that judgement belongs to the client,
 * which holds the authenticated identity. Its job is narrower and
 * still worth having: it makes applying a change a distinct, explicit
 * second call that cannot happen as a side effect of an edit.
 */
const applyGrants = new Map<string, { nonce: string; issuedAt: number }>();
const GRANT_TTL_MS = 10 * 60 * 1000;

function issueGrant(workspaceId: string): string {
  const nonce = `grant_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  applyGrants.set(workspaceId, { nonce, issuedAt: Date.now() });
  return nonce;
}

function consumeGrant(workspaceId: string, nonce: string): boolean {
  const held = applyGrants.get(workspaceId);
  if (!held) return false;
  applyGrants.delete(workspaceId);
  if (Date.now() - held.issuedAt > GRANT_TTL_MS) return false;
  return held.nonce === nonce;
}

/** Workspace ids are ours to choose — keep them boring and safe. */
function safeWorkspaceId(raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new WorkspaceBoundaryError(`Invalid workspace id: ${JSON.stringify(value)}`);
  }
  return value;
}

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
            // Validation runs INSIDE the copy when one is named, so a
            // typecheck/test/build reports on the changed code rather
            // than on the untouched source project.
            const cwd = payload.workspace
              ? adapter.resolveInWorkspace(safeWorkspaceId(payload.workspace), ".")
              : undefined;
            const result = await adapter.runCommand(command, timeoutMs, cwd);
            sendJson(res, { ok: result.ok, status: result.status, stdout: result.stdout, stderr: result.stderr, durationMs: result.durationMs });
            return;
          }

          /* ---- POST /api/engineer/read (workspace-bounded) ---- */
          if (route === "/api/engineer/read") {
            const filePath = String(payload.path ?? "");
            const absolutePath = payload.workspace
              ? adapter.resolveInWorkspace(safeWorkspaceId(payload.workspace), filePath)
              : adapter.resolve(filePath);
            const content = await adapter.readFile(absolutePath);
            sendJson(res, { ok: true, path: filePath, content });
            return;
          }

          /* ---- POST /api/engineer/list (workspace-bounded) ---- */
          if (route === "/api/engineer/list") {
            const dirPath = String(payload.path ?? "");
            const absolutePath = payload.workspace
              ? adapter.resolveInWorkspace(safeWorkspaceId(payload.workspace), dirPath)
              : adapter.resolve(dirPath);
            const entries = await adapter.listDir(absolutePath);
            sendJson(res, { ok: true, path: dirPath, entries });
            return;
          }

          /* ---- POST /api/engineer/write (COPY ONLY) ---- */
          if (route === "/api/engineer/write") {
            const filePath = String(payload.path ?? "");
            const content = String(payload.content ?? "");

            // An edit NEVER touches the live project.
            //
            // Before workspaces existed this wrote straight into
            // process.cwd(), so any edit changed the running source with
            // no copy, no diff and no authorization step. Reaching the
            // real project is now exclusively the job of workspace:apply.
            if (!payload.workspace) {
              sendJson(
                res,
                {
                  ok: false,
                  error:
                    "Writes require a workspace copy. Create one with " +
                    "POST /api/engineer/workspace {action:'create'} and pass its id. " +
                    "The source project is only changed by workspace:apply.",
                },
                403,
              );
              return;
            }

            const absolutePath = adapter.resolveInWorkspace(
              safeWorkspaceId(payload.workspace),
              filePath,
            );
            await adapter.writeFile(absolutePath, content);
            sendJson(res, { ok: true, path: filePath, workspace: payload.workspace });
            return;
          }

          /* ---- POST /api/engineer/delete (COPY ONLY) ---- */
          if (route === "/api/engineer/delete") {
            if (!payload.workspace) {
              sendJson(
                res,
                { ok: false, error: "Deletes require a workspace copy; the source project is never deleted from." },
                403,
              );
              return;
            }
            const filePath = String(payload.path ?? "");
            const absolutePath = adapter.resolveInWorkspace(
              safeWorkspaceId(payload.workspace),
              filePath,
            );
            adapter.deleteFile(absolutePath);
            sendJson(res, { ok: true, path: filePath, workspace: payload.workspace });
            return;
          }

          /* ---- POST /api/engineer/workspace ---- */
          if (route === "/api/engineer/workspace") {
            const action = String(payload.action ?? "");

            if (action === "list") {
              sendJson(res, { ok: true, workspaces: adapter.listWorkspaces() });
              return;
            }

            if (action === "create") {
              const id = safeWorkspaceId(payload.workspace ?? `ws-${Date.now().toString(36)}`);
              const workspace = await adapter.createWorkspace(id);
              sendJson(res, { ok: true, workspace });
              return;
            }

            if (action === "remove") {
              const id = safeWorkspaceId(payload.workspace);
              adapter.removeWorkspace(id);
              applyGrants.delete(id);
              sendJson(res, { ok: true, workspace: id, removed: true });
              return;
            }

            if (action === "diff") {
              const id = safeWorkspaceId(payload.workspace);
              const changes = await adapter.diffWorkspace(id);
              sendJson(res, { ok: true, workspace: id, changes });
              return;
            }

            if (action === "request-apply") {
              const id = safeWorkspaceId(payload.workspace);
              const changes = await adapter.diffWorkspace(id);
              if (changes.length === 0) {
                sendJson(res, { ok: false, error: "Nothing to apply: the workspace matches the source project." }, 400);
                return;
              }
              sendJson(res, { ok: true, workspace: id, changes, grant: issueGrant(id) });
              return;
            }

            if (action === "apply") {
              const id = safeWorkspaceId(payload.workspace);
              // Two independent conditions, both required. `confirm`
              // makes the intent explicit; the grant proves this is the
              // second half of a request-apply that already reported
              // exactly which files would change.
              if (payload.confirm !== true) {
                sendJson(res, { ok: false, error: "Apply requires confirm:true." }, 403);
                return;
              }
              if (!consumeGrant(id, String(payload.grant ?? ""))) {
                sendJson(
                  res,
                  {
                    ok: false,
                    error:
                      "Apply requires a valid, unused grant from workspace:request-apply. " +
                      "Nothing was written to the source project.",
                  },
                  403,
                );
                return;
              }
              const requested = Array.isArray(payload.paths)
                ? (payload.paths as unknown[]).map((entry) => String(entry))
                : [];
              const applied = await adapter.applyWorkspace(id, requested);
              sendJson(res, { ok: true, workspace: id, applied });
              return;
            }

            sendJson(res, { ok: false, error: `Unknown workspace action: ${action}` }, 400);
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
