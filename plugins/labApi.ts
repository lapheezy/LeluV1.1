/**
 * ==========================================================
 * LÉLU — LABORATORY API
 *
 * The HTTP surface of the engineering environment. Every route
 * is a thin, honest wrapper over plugins/labEngine.ts — the same
 * engine the durable scheduler runs with no browser open.
 *
 * Three guarantees the interface depends on:
 *   • a cross-origin request is refused, not answered;
 *   • a mutating request needs the session token from /status;
 *   • a failure is returned as { ok:false, error } with its HTTP
 *     status, so a view can show the failure without blanking.
 * ==========================================================
 */

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  createLabEngine,
  EXPERIMENT_DIR,
  LAB_COMMANDS,
  LAB_DIR,
  LAB_STATE_DIR,
  parseCapabilityEvidence,
  safeRelativePath,
  sanitizeRemote,
  type LabDiscovery,
} from "./labEngine.ts";
// One scheduler implementation, imported rather than reimplemented: the
// concurrency guard used by "run one cycle now" is the same guard the daemon
// uses, so an interface action and a scheduled cycle can never interleave.
import { heartbeatStale, withCycleLock } from "../scripts/lab-scheduler.ts";

export { LAB_COMMANDS, LAB_STATE_DIR, parseCapabilityEvidence, sanitizeRemote };
export type {
  LabCommandSpec,
  LabDiff,
  LabDiffFile,
  LabDiscovery,
  LabExperiment,
  LabFinding,
  LabHead,
  LabPreview,
  LabResearchNote,
  LabSyncRecord,
} from "./labEngine.ts";

/* ------------------------------------------------------------------ */
/* connect-style middleware types (Vite, Express, node:http)           */
/* ------------------------------------------------------------------ */

interface ConnectLikeReq {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  on: (event: string, listener: (chunk?: unknown) => void) => void;
}

interface ConnectLikeRes {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (body?: string) => void;
}

type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

export interface LabApiOptions {
  root?: string;
}

const SCHEDULER_FILE = "scheduler.json";

function header(req: ConnectLikeReq, name: string): string {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

function readBody(req: ConnectLikeReq): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += String(chunk ?? "");
      if (raw.length > 4_000_000) reject(new Error("Request body too large."));
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw) as Record<string, unknown>);
      } catch {
        reject(new Error("Request body is not JSON."));
      }
    });
    req.on("error", () => reject(new Error("Request stream failed.")));
  });
}

/**
 * Origins permitted to reach the laboratory.
 *
 * The preview proxy rewrites Host, so a strict Origin === Host comparison
 * refuses the real interface — while a blanket allowance would let any site
 * the user visits drive git. An explicit allowlist is the middle that is
 * actually safe; an unlisted site still gets 403.
 */
function allowedOrigins(): string[] {
  return (process.env.LELU_LAB_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);
}

/**
 * Is this request from our own page?
 *
 * MEASURED (Mission 44.4, live): behind the hosted preview proxy the server
 * receives `Host: 127.0.0.1:3001` while the page's origin is the public
 * preview host. A GET omits `Origin` and passed; every POST carried it and
 * was refused with 403 "Cross-origin laboratory requests are not permitted".
 * The result was a model whose reads worked and whose actions all failed:
 * `lab.history` (windowed read) and `lab.experiment` were refused while the
 * laboratory was demonstrably working.
 *
 * The rules are the broker's (`crossOrigin` in plugins/modelApi.ts) — same
 * reason, same order: the browser's own `Sec-Fetch-Site` account cannot be
 * forged by a page, then the operator allowlist, then host equality INCLUDING
 * `X-Forwarded-Host`, because a reverse proxy terminates TLS and forwards with
 * its own Host. A cross-site page still fails all three and is refused.
 */
function sameOrigin(req: ConnectLikeReq): boolean {
  const origin = header(req, "origin");
  if (!origin) return true; // a same-origin GET/HEAD usually omits Origin

  // 1. The browser's own statement about the request's site.
  if (header(req, "sec-fetch-site").trim().toLowerCase() === "same-origin") return true;

  // 2. The deployment's declared origin.
  const normalize = (value: string): string => value.trim().replace(/\/$/, "");
  if (allowedOrigins().includes(normalize(origin))) return true;

  // 3. Host equality, with the proxy's forwarded host included.
  const forwarded = header(req, "x-forwarded-host").split(",")[0]?.trim() ?? "";
  const hosts = new Set([header(req, "host"), forwarded].filter(Boolean));
  try {
    return hosts.has(new URL(origin).host);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* scheduler control                                                   */
/* ------------------------------------------------------------------ */

interface SchedulerState {
  running: boolean;
  pid: number | null;
  startedAt: number | null;
  intervalMs: number;
  nextAt: number | null;
  cycles: number;
  ok: boolean | null;
  lastCycleAt: number | null;
  lastDiscoveryId: string | null;
  lastFindings: number | null;
  lastError: string | null;
  logFile: string;
  mode: "daemon" | "manual";
  failures?: number;
  /** `running` is a claim; this is what the process table and clock say. */
  stale: boolean;
  staleReason?: string;
}

export function readSchedulerState(root: string): SchedulerState {
  const file = path.join(root, LAB_STATE_DIR, SCHEDULER_FILE);
  let state: SchedulerState = {
    running: false,
    pid: null,
    startedAt: null,
    intervalMs: 86_400_000,
    nextAt: null,
    cycles: 0,
    ok: null,
    lastCycleAt: null,
    lastDiscoveryId: null,
    lastFindings: null,
    lastError: null,
    logFile: path.join(LAB_STATE_DIR, "scheduler.log"),
    mode: "manual",
    stale: false,
  };
  try {
    state = { ...state, ...(JSON.parse(readFileSync(file, "utf8")) as Partial<SchedulerState>) };
  } catch {
    return state;
  }
  const verdict = heartbeatStale(state as Parameters<typeof heartbeatStale>[0]);
  return { ...state, stale: verdict.stale, ...(verdict.reason ? { staleReason: verdict.reason } : {}) };
}

/* ------------------------------------------------------------------ */
/* the api                                                             */
/* ------------------------------------------------------------------ */

export function createLabApi(options: LabApiOptions = {}): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  const root = path.resolve(options.root ?? process.cwd());
  const engine = createLabEngine(root);
  const token = randomBytes(18).toString("hex");
  const startedAt = Date.now();

  function handle(route: string) {
    return (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): void => {
      const method = req.method ?? "GET";

      if (!sameOrigin(req)) {
        sendJson(res, { ok: false, error: "Cross-origin laboratory requests are not permitted." }, 403);
        return;
      }

      const mutating = method !== "GET" && method !== "HEAD";
      if (mutating && header(req, "x-lelu-lab") !== token) {
        sendJson(
          res,
          {
            ok: false,
            error:
              "The laboratory requires the session token issued by /api/lab/status. Reload the workspace and retry.",
          },
          403,
        );
        return;
      }

      void (async () => {
        try {
          if (route === "/api/lab/status" && method === "GET") {
            const status = await engine.status();
            sendJson(res, {
              ok: true,
              token,
              startedAt,
              root: path.basename(root),
              scheduler: readSchedulerState(root),
              ...status,
            });
            return;
          }

          if (route === "/api/lab/sync" && method === "POST") {
            const result = await engine.sync();
            sendJson(res, { ok: result.sync.ok, sync: result.sync, fetch: result.fetch });
            return;
          }

          if (route === "/api/lab/inspect" && method === "POST") {
            sendJson(res, { ok: true, discovery: await engine.inspect() });
            return;
          }

          /*
           * The client posts to every laboratory route so the session token is
           * attached uniformly; a GET-only route here answered 404 to a real
           * tool call. Reads accept either method, and nothing is written.
           */
          if (route === "/api/lab/discoveries" && (method === "GET" || method === "POST")) {
            sendJson(res, { ok: true, discoveries: engine.discoveries() });
            return;
          }

          if (route === "/api/lab/scheduler") {
            if (method === "GET") {
              sendJson(res, { ok: true, scheduler: readSchedulerState(root) });
              return;
            }
            const body = await readBody(req);
            const action = String(body.action ?? "");
            const stateFile = path.join(root, LAB_STATE_DIR, SCHEDULER_FILE);
            mkdirSync(path.join(root, LAB_STATE_DIR), { recursive: true });

            if (action === "start") {
              const intervalMs = Math.max(60_000, Number(body.intervalMs ?? 86_400_000) || 86_400_000);
              const existing = readSchedulerState(root);
              if (existing.running) {
                sendJson(res, { ok: false, error: `The scheduler is already running (pid ${existing.pid}).` }, 409);
                return;
              }
              const logFile = path.join(root, LAB_STATE_DIR, "scheduler.log");
              const child = spawn(
                "npx",
                ["tsx", "scripts/lab-scheduler.ts", "--interval-ms", String(intervalMs)],
                {
                  cwd: root,
                  detached: true,
                  stdio: ["ignore", "pipe", "pipe"],
                  env: { ...process.env },
                },
              );
              // The daemon writes its own heartbeat file; the API only detaches it.
              const log = createWriteStream(logFile, { flags: "a" });
              child.stdout?.pipe(log);
              child.stderr?.pipe(log);
              child.unref();
              writeFileSync(
                stateFile,
                `${JSON.stringify(
                  {
                    running: true,
                    pid: child.pid ?? null,
                    startedAt: Date.now(),
                    intervalMs,
                    nextAt: Date.now() + intervalMs,
                    cycles: existing.cycles,
                    ok: existing.ok,
                    lastCycleAt: existing.lastCycleAt,
                    lastDiscoveryId: existing.lastDiscoveryId,
                    lastFindings: existing.lastFindings,
                    lastError: null,
                    logFile: path.join(LAB_STATE_DIR, "scheduler.log"),
                    mode: "daemon",
                  },
                  null,
                  2,
                )}\n`,
                "utf8",
              );
              sendJson(res, { ok: true, scheduler: readSchedulerState(root), spawned: child.pid ?? null });
              return;
            }

            if (action === "stop") {
              const state = readSchedulerState(root);
              if (!state.pid) {
                sendJson(res, { ok: false, error: "No scheduler process is recorded as running." }, 409);
                return;
              }
              try {
                process.kill(state.pid, "SIGTERM");
              } catch (error) {
                sendJson(
                  res,
                  { ok: false, error: `Could not stop pid ${state.pid}: ${error instanceof Error ? error.message : String(error)}` },
                  409,
                );
                return;
              }
              let current: Record<string, unknown> = {};
              try {
                current = JSON.parse(readFileSync(stateFile, "utf8")) as Record<string, unknown>;
              } catch {
                current = {};
              }
              writeFileSync(stateFile, `${JSON.stringify({ ...current, running: false, pid: null, nextAt: null }, null, 2)}\n`, "utf8");
              sendJson(res, { ok: true, stopped: state.pid, scheduler: readSchedulerState(root) });
              return;
            }

            if (action === "run-once") {
              // Runs the real cycle in-process and reports what it did. This is
              // the same function the daemon calls, not a simulation of it — and
              // it takes the same lock, so it cannot overlap a scheduled cycle.
              const guarded = await withCycleLock(root, () => engine.inspect());
              if (!guarded.ran) {
                sendJson(res, { ok: false, error: `A cycle is already running: ${guarded.reason}` }, 409);
                return;
              }
              const startedCycle = Date.now();
              const discovery: LabDiscovery = guarded.value!;
              engine.appendJournal({
                at: Date.now(),
                kind: "scheduler-manual-cycle",
                discoveryId: discovery.id,
                findings: discovery.findings.length,
                priority: discovery.priority.score,
                durationMs: Date.now() - startedCycle,
              });
              const previous = readSchedulerState(root);
              writeFileSync(
                stateFile,
                `${JSON.stringify(
                  {
                    ...previous,
                    cycles: previous.cycles + 1,
                    ok: true,
                    lastCycleAt: Date.now(),
                    lastDiscoveryId: discovery.id,
                    lastFindings: discovery.findings.length,
                    lastError: null,
                    mode: "manual",
                  },
                  null,
                  2,
                )}\n`,
                "utf8",
              );
              sendJson(res, { ok: true, discovery, scheduler: readSchedulerState(root) });
              return;
            }

            sendJson(res, { ok: false, error: `Unknown scheduler action: ${action}` }, 400);
            return;
          }

          if (route === "/api/lab/genealogy" && method === "POST") {
            const body = await readBody(req);
            sendJson(res, { ok: true, genealogy: await engine.genealogy(String(body.path ?? "")) });
            return;
          }

          if (route === "/api/lab/experiment" && method === "POST") {
            const body = await readBody(req);
            const action = String(body.action ?? "");

            if (action === "create") {
              const experiment = await engine.experiments.create({
                ...(body.id ? { id: String(body.id) } : {}),
                ...(body.discoveryId ? { discoveryId: String(body.discoveryId) } : {}),
                ...(body.findingId ? { findingId: String(body.findingId) } : {}),
                ...(body.reason ? { reason: String(body.reason) } : {}),
              });
              sendJson(res, { ok: true, experiment });
              return;
            }
            if (action === "list") {
              sendJson(res, { ok: true, experiments: engine.experiments.list() });
              return;
            }

            const id = String(body.id ?? "");
            if (!id) {
              sendJson(res, { ok: false, error: "This action needs an experiment id." }, 400);
              return;
            }

            if (action === "remove") {
              await engine.experiments.remove(id);
              sendJson(res, { ok: true, removed: id });
              return;
            }
            if (action === "read") {
              sendJson(res, { ok: true, ...engine.experiments.read(id, String(body.path ?? "")) });
              return;
            }
            if (action === "write") {
              sendJson(
                res,
                { ok: true, ...engine.experiments.write(id, String(body.path ?? ""), String(body.content ?? "")) },
              );
              return;
            }
            if (action === "patch") {
              sendJson(res, {
                ok: true,
                ...engine.experiments.patch(
                  id,
                  String(body.path ?? ""),
                  String(body.find ?? ""),
                  String(body.replace ?? ""),
                ),
              });
              return;
            }
            if (action === "diff") {
              sendJson(res, { ok: true, diff: await engine.experiments.diff(id) });
              return;
            }
            if (action === "commit") {
              sendJson(res, await engine.experiments.commit(id, String(body.message ?? "")));
              return;
            }
            if (action === "command") {
              sendJson(res, await engine.experiments.command(id, String(body.command ?? "")));
              return;
            }
            if (action === "preview-start") {
              const preview = await engine.experiments.previewStart(id, Number(body.port ?? 3002));
              sendJson(res, { ok: true, preview });
              return;
            }
            if (action === "preview-stop") {
              engine.experiments.previewStop(id);
              sendJson(res, { ok: true, stopped: id });
              return;
            }
            if (action === "screenshot") {
              const viewport = {
                width: Number(body.width ?? 1440) || 1440,
                height: Number(body.height ?? 900) || 900,
              };
              sendJson(res, await engine.experiments.screenshot(id, viewport, String(body.label ?? "shot")));
              return;
            }
            if (action === "conclude") {
              const status = body.status === "abandoned" ? "abandoned" : "verified";
              sendJson(res, {
                ok: true,
                experiment: engine.experiments.conclude(id, status, body.note ? String(body.note) : undefined),
              });
              return;
            }

            sendJson(res, { ok: false, error: `Unknown experiment action: ${action}` }, 400);
            return;
          }

          if (route === "/api/lab/tree" && method === "POST") {
            const body = await readBody(req);
            const relative = body.path ? safeRelativePath(body.path) : ".";
            sendJson(res, { ok: true, path: relative, entries: engine.tree(relative === "." ? "" : relative) });
            return;
          }

          if (route === "/api/lab/file" && method === "POST") {
            const body = await readBody(req);
            sendJson(res, { ok: true, ...engine.file(String(body.path ?? "")) });
            return;
          }

          if (route === "/api/lab/search" && method === "POST") {
            const body = await readBody(req);
            const query = String(body.query ?? "").trim();
            if (query.length < 2) {
              sendJson(res, { ok: false, error: "A search needs at least two characters." }, 400);
              return;
            }
            sendJson(res, { ok: true, query, hits: engine.search(query) });
            return;
          }

          if (route === "/api/lab/commits" && method === "POST") {
            const body = await readBody(req);
            const limit = Math.min(Math.max(Number(body.limit ?? 12) || 12, 1), 50);
            sendJson(res, { ok: true, commits: await engine.commits(limit) });
            return;
          }

          if (route === "/api/lab/evidence" && (method === "GET" || method === "POST")) {
            sendJson(res, { ok: true, files: engine.evidence() });
            return;
          }

          if (route === "/api/lab/journal" && (method === "GET" || method === "POST")) {
            sendJson(res, { ok: true, entries: engine.journal(160) });
            return;
          }

          next();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          /*
           * The status has to mean something: a missing experiment is 404, a
           * refused path is 400, and collapsing both into 400 made a client
           * unable to tell "you asked for nothing" from "your request was bad".
           */
          const status = /No experiment|does not exist/.test(message)
            ? 404
            : /Invalid experiment id|Refusing path|Path escapes|anchors?/.test(message)
              ? 400
              : 500;
          sendJson(res, { ok: false, error: message }, status);
        }
      })();
    };
  }

  const routes = [
    "/api/lab/status",
    "/api/lab/sync",
    "/api/lab/inspect",
    "/api/lab/discoveries",
    "/api/lab/scheduler",
    "/api/lab/genealogy",
    "/api/lab/experiment",
    "/api/lab/tree",
    "/api/lab/file",
    "/api/lab/search",
    "/api/lab/commits",
    "/api/lab/evidence",
    "/api/lab/journal",
  ];

  return {
    attach(middlewares) {
      for (const route of routes) middlewares.use(route, handle(route));
    },
  };
}

export function labApiPlugin(options: LabApiOptions = {}): {
  name: string;
  configureServer: (server: { middlewares: { use: (path: string, handler: Handler) => void } }) => void;
  configurePreviewServer: (server: { middlewares: { use: (path: string, handler: Handler) => void } }) => void;
} {
  const api = createLabApi(options);
  return {
    name: "lelu-lab-api",
    configureServer(server) {
      api.attach(server.middlewares);
    },
    configurePreviewServer(server) {
      api.attach(server.middlewares);
    },
  };
}

/** Kept for callers that only need the paths the laboratory owns. */
export const LAB_ROOT_DIR = LAB_DIR;
export const LAB_EXPERIMENT_DIR = EXPERIMENT_DIR;
