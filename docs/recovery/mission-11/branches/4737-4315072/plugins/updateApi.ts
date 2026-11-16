/**
 * ==========================================================
 * LÉLU — VERIFIED UPDATE PIPELINE (server side)
 *
 * The only place in LÉLU that may commit to her own repository and
 * restart the process serving her app. It exists because those are
 * three different claims that used to be made as one:
 *
 *   "the change was written"  →  git diff proves it
 *   "the project works"       →  typecheck, lint, tests and build ran
 *   "the version is live"     →  the process restarted AND the app
 *                                 answered AND HEAD is that commit
 *
 * Endpoints (mounted by vite.config.ts next to /api/engineer):
 *
 *   GET  /api/engineer/update/status   → runtime facts + current job
 *   POST /api/engineer/update/prepare  → {message, paths, checks, confirm}
 *   POST /api/engineer/update/apply    → {commit, confirm}
 *   POST /api/engineer/update/health   → {commit, ok, detail, …}
 *   POST /api/engineer/update/rollback → {commit, confirm}
 *   POST /api/engineer/update/diff     → {commit} (bounded patch)
 *
 * prepare is ASYNCHRONOUS: it returns the job immediately and advances
 * it stage by stage while the panel polls. That is not a convenience —
 * the project's own suite takes minutes, and a request that blocks for
 * those minutes cannot show the user which stage is running.
 *
 * Safety, in order of precedence:
 *   • same-origin only (cross-origin POSTs are rejected)
 *   • token gate when LELU_ENGINEER_TOKEN is set
 *   • prepare/apply/rollback require confirm:true
 *   • when a Supabase project is configured, the caller's identity is
 *     verified server-side and recorded in the job and the commit
 *   • commit stages exactly the paths it was given — never `git add -A`
 *   • apply requires a VERIFIED job, matching commit, matching target
 *     and a runtime that can actually restart
 *   • rollback is `git revert` (a new commit) — no reset, no force push
 *
 * Nothing here is reachable from a static deployment: without this
 * middleware the panel reports "no update runtime", it does not pretend.
 * ==========================================================
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import {
  ENGINEER_OPERATIONS,
  ENGINEER_OPERATION_TIMEOUT_MS,
  WorkspaceBoundaryError,
  type EngineerAdapter,
} from "./engineerApi.ts";
import { identityConfigured, verifyRequestIdentity } from "./engineerIdentity.ts";
import {
  ALL_CHECKS,
  jobIsVerified,
  shortCommit,
  type UpdateCheckId,
  type UpdateCheckResult,
  type UpdateFileChange,
  type UpdateJob,
  type UpdateState,
  type UpdateSummary,
} from "../src/core/selfdev/UpdateLifecycle.ts";

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

interface UpdateHooks {
  /** Generation timestamp of the running server; changes on restart. */
  serverStartedAt: () => number;
  /** Restart the process that serves the app, or null when it cannot. */
  restart: (() => Promise<void>) | null;
}

interface UpdateDeps {
  adapter: EngineerAdapter;
  hooks: UpdateHooks;
  /** Where the job record lives so it survives the restart it describes. */
  stateFile: string;
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

interface PersistedState {
  job: UpdateJob | null;
  history: UpdateSummary[];
}

/* ------------------------------------------------------------------ */
/* the check commands                                                  */
/* ------------------------------------------------------------------ */

/**
 * Each check is the project's OWN script, run through the same
 * whitelisted command map the engineering runtime already uses. Nothing
 * is invented here: if `npm test` is what the project defines, that is
 * what verification runs.
 */
const CHECKS: Record<UpdateCheckId, { command: string; timeoutMs: number; stage: "testing" | "building" }> = {
  typecheck: { command: ENGINEER_OPERATIONS.typecheck, timeoutMs: 240_000, stage: "testing" },
  lint: { command: "npm run lint", timeoutMs: 180_000, stage: "testing" },
  tests: {
    command: ENGINEER_OPERATIONS.test,
    timeoutMs: ENGINEER_OPERATION_TIMEOUT_MS.test ?? 900_000,
    stage: "testing",
  },
  build: { command: ENGINEER_OPERATIONS.build, timeoutMs: 360_000, stage: "building" },
};

const MAX_OUTPUT = 6_000;
const MAX_HISTORY = 8;

/* ------------------------------------------------------------------ */
/* request helpers                                                     */
/* ------------------------------------------------------------------ */

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

function clip(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  return `…${text.slice(text.length - MAX_OUTPUT)}`;
}

function tokenRequired(): boolean {
  return typeof process !== "undefined" && Boolean(process.env.LELU_ENGINEER_TOKEN);
}

function hasValidToken(req: ConnectLikeReq): boolean {
  if (typeof process === "undefined") return false;
  const header = req.headers?.["x-lelu-token"];
  const provided = Array.isArray(header) ? header[0] : header;
  return typeof provided === "string" && provided === process.env.LELU_ENGINEER_TOKEN;
}

function isCrossOrigin(req: ConnectLikeReq): boolean {
  const origin = typeof req.headers?.origin === "string" ? req.headers.origin : "";
  const host = typeof req.headers?.host === "string" ? req.headers.host : "";
  if (!origin || !host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/**
 * Who authorized a privileged step, and on what basis.
 *
 * With a Supabase project configured, identity is verified server-side
 * and named. Without one this is a local development runtime — the same
 * process the developer launched, reached same-origin — so the dev
 * server itself is the trust boundary. That is reported as the authority
 * rather than dressed up as an identity check that did not happen.
 */
async function authorize(
  req: ConnectLikeReq,
): Promise<{ ok: boolean; status: number; authority: string; reason?: string }> {
  if (identityConfigured()) {
    const who = await verifyRequestIdentity(req);
    if (!who.ok || !who.identity) {
      return { ok: false, status: who.status, authority: "", reason: who.reason };
    }
    return {
      ok: true,
      status: 200,
      authority: `Supabase identity ${who.identity.email ?? who.identity.userId}`,
    };
  }
  return { ok: true, status: 200, authority: "local development runtime (same-origin, no identity provider configured)" };
}

/** A path LÉLU is allowed to commit. */
function assertCommittablePath(candidate: string): string {
  const cleaned = candidate.trim().replace(/^\.\//, "");
  if (!cleaned) throw new WorkspaceBoundaryError("Empty path in the change set.");
  if (cleaned.startsWith("/") || cleaned.includes("..")) {
    throw new WorkspaceBoundaryError(`Path must be project-relative: ${candidate}`);
  }
  // Never commit secrets, never commit the pipeline's own state.
  if (/(^|\/)\.env(\.|$)/.test(cleaned) || cleaned.startsWith(".lelu/")) {
    throw new WorkspaceBoundaryError(`Refusing to commit ${cleaned}: secrets and pipeline state are never committed.`);
  }
  return cleaned;
}

/* ------------------------------------------------------------------ */
/* the pipeline                                                        */
/* ------------------------------------------------------------------ */

export function createUpdateApi(deps: UpdateDeps): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  const { adapter } = deps;
  let state: PersistedState | null = null;
  let running = false;
  let loaded: Promise<PersistedState> | null = null;

  async function load(): Promise<PersistedState> {
    if (state) return state;
    if (loaded) return loaded;
    loaded = (async () => {
      try {
        const raw = await fs.readFile(deps.stateFile, "utf8");
        const parsed = JSON.parse(raw) as PersistedState;
        const next: PersistedState = {
          job: parsed.job ?? null,
          history: Array.isArray(parsed.history) ? parsed.history : [],
        };
        state = next;
        return next;
      } catch {
        const next: PersistedState = { job: null, history: [] };
        state = next;
        return next;
      }
    })();
    return loaded;
  }

  async function persist(): Promise<void> {
    const current = await load();
    try {
      await fs.mkdir(path.dirname(deps.stateFile), { recursive: true });
      await fs.writeFile(deps.stateFile, JSON.stringify(current, null, 2), "utf8");
    } catch {
      // The job still exists in memory for this process; a failed write
      // is reported through /status only as "not persisted".
    }
  }

  function job(): UpdateJob | null {
    return state?.job ?? null;
  }

  function touch(patch: Partial<UpdateJob>): void {
    const current = job();
    if (!current) return;
    state!.job = { ...current, ...patch, updatedAt: Date.now() };
    void persist();
  }

  async function facts(): Promise<UpdateState["facts"]> {
    const head = await adapter.git(["rev-parse", "HEAD"]);
    const branch = await adapter.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    return {
      runtime: adapter.runtime,
      branch: head.ok ? branch.stdout.trim() || "HEAD" : "unknown",
      head: head.ok ? head.stdout.trim() : "unknown",
      serverStartedAt: deps.hooks.serverStartedAt(),
      restartSupported: deps.hooks.restart !== null,
      workspace: adapter.workspaceRoot.split(/[\\/]/).pop() ?? "",
      identityVerification: identityConfigured(),
      authority: identityConfigured()
        ? "Supabase identity"
        : "local development runtime (same-origin)",
      available: true,
    };
  }

  /** Real change set for the given paths, from git itself. */
  async function changeSet(paths: string[]): Promise<UpdateFileChange[]> {
    const changes: UpdateFileChange[] = [];
    const status = await adapter.git(["status", "--porcelain=v1", "--", ...paths]);
    if (!status.ok) {
      throw new Error(`git status failed: ${status.stderr || status.stdout}`);
    }
    const numstat = await adapter.git(["diff", "--numstat", "HEAD", "--", ...paths]);
    const lineCounts = new Map<string, { added: number; removed: number }>();
    if (numstat.ok) {
      for (const line of numstat.stdout.split("\n")) {
        const [added, removed, file] = line.split("\t");
        if (!file) continue;
        lineCounts.set(file.trim(), {
          added: Number(added) || 0,
          removed: Number(removed) || 0,
        });
      }
    }

    for (const line of status.stdout.split("\n")) {
      if (!line.trim()) continue;
      const code = line.slice(0, 2);
      let file = line.slice(3).trim();
      if (file.includes(" -> ")) file = file.split(" -> ").pop()!.trim();
      file = file.replace(/^"|"$/g, "");
      if (!file) continue;
      const counts = lineCounts.get(file);
      changes.push({
        path: file,
        status: code.includes("?") || code.includes("A") ? "added" : code.includes("D") ? "deleted" : "modified",
        addedLines: counts?.added ?? 0,
        removedLines: counts?.removed ?? 0,
      });
    }
    return changes;
  }

  async function runCheck(id: UpdateCheckId): Promise<UpdateCheckResult> {
    const spec = CHECKS[id];
    const started = Date.now();
    try {
      const result = await adapter.runCommand(spec.command, spec.timeoutMs);
      return {
        id,
        command: spec.command,
        ok: result.ok,
        durationMs: result.durationMs || Date.now() - started,
        stdout: clip(result.stdout ?? ""),
        stderr: clip(result.stderr ?? ""),
      };
    } catch (error) {
      return {
        id,
        command: spec.command,
        ok: false,
        durationMs: Date.now() - started,
        stdout: "",
        stderr: clip(error instanceof Error ? error.message : String(error)),
      };
    }
  }

  async function runPipeline(jobId: string, paths: string[], checks: UpdateCheckId[]): Promise<void> {
    running = true;
    try {
      const current = job();
      if (!current || current.id !== jobId) return;

      /* ---- analyze: prove the change set exists, from git ---- */
      touch({ stage: "analyzing" });
      const headBefore = await adapter.git(["rev-parse", "HEAD"]);
      const branch = await adapter.git(["rev-parse", "--abbrev-ref", "HEAD"]);
      const files = await changeSet(paths);
      touch({
        headBefore: headBefore.ok ? headBefore.stdout.trim() : "",
        branch: branch.ok ? branch.stdout.trim() : "HEAD",
        files,
        stage: "editing",
      });

      if (files.length === 0) {
        touch({
          stage: "failed",
          failure:
            "Nothing to verify: git reports no change for the requested paths. Nothing was committed and nothing was restarted.",
        });
        return;
      }

      /* ---- checks: the project's own scripts, one at a time ---- */
      const results: UpdateCheckResult[] = [];
      for (const id of checks) {
        const spec = CHECKS[id];
        if (!spec) {
          results.push({
            id,
            command: "(unknown)",
            ok: false,
            durationMs: 0,
            stdout: "",
            stderr: `Unknown check: ${id}`,
            skipped: true,
          });
          continue;
        }
        touch({ stage: spec.stage });
        const result = await runCheck(id);
        results.push(result);
        touch({ checks: [...results] });
        if (!result.ok) {
          const detail = (result.stderr || result.stdout).split("\n").filter(Boolean).slice(-6).join("\n");
          touch({
            stage: "failed",
            checks: [...results],
            failure:
              `${id} failed (${spec.command}). Nothing was committed; the changes are still in the working tree.` +
              (detail ? `\n${detail}` : ""),
          });
          return;
        }
      }

      /* ---- commit: exactly the paths that were verified ---- */
      touch({ stage: "awaiting-commit" });
      const added = await adapter.git(["add", "--", ...paths]);
      if (!added.ok) {
        touch({ stage: "failed", failure: `git add failed: ${added.stderr || added.stdout}. Nothing was committed.` });
        return;
      }
      const body = `${current.message}\n\nVerified-By: ${current.authority}\nChecks: ${checks.join(", ")}`;
      const committed = await adapter.git(["commit", "-m", body, "--", ...paths], 120_000);
      if (!committed.ok) {
        touch({
          stage: "failed",
          failure: `git commit failed: ${committed.stderr || committed.stdout}. The changes are still staged.`,
        });
        return;
      }

      /* ---- verify the commit really contains the change ---- */
      const head = await adapter.git(["rev-parse", "HEAD"]);
      const commit = head.ok ? head.stdout.trim() : null;
      const show = commit ? await adapter.git(["show", "--name-only", "--pretty=format:", commit]) : null;
      const commitPaths = show?.ok
        ? show.stdout
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean)
        : [];
      const missing = paths.filter((candidate) => !commitPaths.includes(candidate));
      const remaining = await adapter.git(["status", "--porcelain", "--", ...paths]);
      const treeClean = remaining.ok && remaining.stdout.trim() === "";
      const commitVerified = Boolean(commit) && missing.length === 0 && treeClean;

      touch({
        stage: commitVerified ? "ready" : "failed",
        commit,
        commitPaths,
        commitVerified,
        failure: commitVerified
          ? null
          : missing.length > 0
            ? `The commit does not contain: ${missing.join(", ")}. Not applying anything.`
            : !treeClean
              ? `The working tree still differs for the committed paths: ${remaining.stdout.trim().split("\n").join(", ")}`
              : "Could not confirm the commit.",
      });
    } catch (error) {
      touch({
        stage: "failed",
        failure: `The update pipeline stopped: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      running = false;
    }
  }

  return {
    attach(middlewares) {
      middlewares.use("/api/engineer/update/status", (req, res, next) => {
        if ((req.method ?? "GET") !== "GET") {
          next();
          return;
        }
        void (async () => {
          const current = await load();
          sendJson(res, {
            ok: true,
            available: true,
            job: current.job,
            history: current.history,
            running,
            facts: await facts(),
          });
        })().catch((error: unknown) => {
          sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
        });
      });

      /* ---- prepare: verify, then commit ---- */
      middlewares.use("/api/engineer/update/prepare", (req, res, next) => {
        if ((req.method ?? "GET") !== "POST") {
          next();
          return;
        }
        void (async () => {
          if (isCrossOrigin(req)) {
            sendJson(res, { ok: false, error: "Cross-origin update requests are not permitted." }, 403);
            return;
          }
          if (tokenRequired() && !hasValidToken(req)) {
            sendJson(res, { ok: false, error: "The update runtime requires LELU_ENGINEER_TOKEN." }, 401);
            return;
          }
          const body = await readJsonBody(req);
          if (body.confirm !== true) {
            sendJson(res, { ok: false, error: "prepare commits to the repository, so it requires confirm:true." }, 403);
            return;
          }
          if (running) {
            sendJson(res, { ok: false, error: "An update is already being verified. Wait for it to finish." }, 409);
            return;
          }
          const current = await load();
          if (current.job && (current.job.stage === "restarting" || current.job.stage === "health-check")) {
            sendJson(res, { ok: false, error: "An applied update is still being health-checked." }, 409);
            return;
          }

          const message = String(body.message ?? "").trim();
          if (!message) {
            sendJson(res, { ok: false, error: "An update needs a commit message." }, 400);
            return;
          }
          const requestedPaths = Array.isArray(body.paths)
            ? (body.paths as unknown[]).map((entry) => assertCommittablePath(String(entry)))
            : [];
          if (requestedPaths.length === 0) {
            sendJson(
              res,
              { ok: false, error: "An update needs an explicit list of the files it changes. Staging everything is not permitted." },
              400,
            );
            return;
          }
          const requestedChecks = Array.isArray(body.checks)
            ? (body.checks as unknown[])
                .map((entry) => String(entry))
                .filter((entry): entry is UpdateCheckId => (ALL_CHECKS as string[]).includes(entry))
            : ALL_CHECKS;
          if (requestedChecks.length === 0) {
            sendJson(res, { ok: false, error: "At least one verification check must run before committing." }, 400);
            return;
          }

          const who = await authorize(req);
          if (!who.ok) {
            sendJson(res, { ok: false, error: who.reason }, who.status);
            return;
          }

          const headBefore = await adapter.git(["rev-parse", "HEAD"]);
          const created: UpdateJob = {
            id: `upd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
            target: adapter.runtime,
            stage: "analyzing",
            message,
            branch: "",
            headBefore: headBefore.ok ? headBefore.stdout.trim() : "",
            files: [],
            checks: [],
            requestedChecks,
            commit: null,
            commitPaths: [],
            commitVerified: false,
            failure: null,
            authority: who.authority,
            startedAt: Date.now(),
            updatedAt: Date.now(),
            appliedAt: null,
            restartedAt: null,
            health: null,
            rolledBackCommit: null,
          };
          current.job = created;
          await persist();
          sendJson(res, { ok: true, job: created, started: true });
          // The pipeline continues after the response so the panel can
          // show "Analyzing changes" instead of a spinning request.
          void runPipeline(created.id, requestedPaths, requestedChecks);
        })().catch((error: unknown) => {
          const status = error instanceof WorkspaceBoundaryError ? 403 : 500;
          sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, status);
        });
      });

      /* ---- apply: restart the runtime, then let the client verify ---- */
      middlewares.use("/api/engineer/update/apply", (req, res, next) => {
        if ((req.method ?? "GET") !== "POST") {
          next();
          return;
        }
        void (async () => {
          if (isCrossOrigin(req)) {
            sendJson(res, { ok: false, error: "Cross-origin update requests are not permitted." }, 403);
            return;
          }
          if (tokenRequired() && !hasValidToken(req)) {
            sendJson(res, { ok: false, error: "The update runtime requires LELU_ENGINEER_TOKEN." }, 401);
            return;
          }
          const body = await readJsonBody(req);
          const current = await load();
          const target = current.job;
          if (!target) {
            sendJson(res, { ok: false, error: "There is no verified update to apply." }, 400);
            return;
          }
          if (body.confirm !== true) {
            sendJson(res, { ok: false, error: "Applying restarts the application, so it requires confirm:true." }, 403);
            return;
          }
          const wanted = String(body.commit ?? "");
          if (wanted && target.commit !== wanted) {
            sendJson(
              res,
              { ok: false, error: `This runtime verified ${shortCommit(target.commit)}, not ${shortCommit(wanted)}.` },
              409,
            );
            return;
          }
          if (!jobIsVerified(target)) {
            sendJson(res, { ok: false, error: target.failure ?? "This update has not passed its checks." }, 409);
            return;
          }
          // Idempotent: a second tap does not restart a second time.
          if (target.appliedAt && target.health?.ok) {
            sendJson(res, { ok: true, alreadyApplied: true, commit: target.commit });
            return;
          }
          if (!deps.hooks.restart) {
            sendJson(
              res,
              {
                ok: false,
                restartSupported: false,
                error:
                  "This runtime cannot restart itself. The commit is verified but was not applied — " +
                  "release it with your normal deploy step, or run the dev server, which can restart itself.",
              },
              409,
            );
            return;
          }
          const head = await adapter.git(["rev-parse", "HEAD"]);
          if (!head.ok || head.stdout.trim() !== target.commit) {
            sendJson(
              res,
              {
                ok: false,
                error: `The checkout is at ${shortCommit(head.stdout.trim())} but this update verified ${shortCommit(target.commit)}. Reevaluate before applying.`,
              },
              409,
            );
            return;
          }
          const who = await authorize(req);
          if (!who.ok) {
            sendJson(res, { ok: false, error: who.reason }, who.status);
            return;
          }

          const previousServerStartedAt = deps.hooks.serverStartedAt();
          touch({ stage: "restarting", authority: who.authority, health: null, appliedAt: null });
          sendJson(res, {
            ok: true,
            restarting: true,
            commit: target.commit,
            target: target.target,
            previousServerStartedAt,
            healthPath: "/api/engineer/update/status",
          });
          const restart = deps.hooks.restart;
          setTimeout(() => {
            void restart().catch((error: unknown) => {
              touch({
                stage: "failed",
                failure: `The restart failed: ${error instanceof Error ? error.message : String(error)}`,
              });
            });
          }, 250);
        })().catch((error: unknown) => {
          sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
        });
      });

      /* ---- health: the client's post-restart evidence, recorded ---- */
      middlewares.use("/api/engineer/update/health", (req, res, next) => {
        if ((req.method ?? "GET") !== "POST") {
          next();
          return;
        }
        void (async () => {
          const body = await readJsonBody(req);
          const current = await load();
          const target = current.job;
          if (!target || !target.commit) {
            sendJson(res, { ok: false, error: "No applied update to check." }, 400);
            return;
          }
          const commit = String(body.commit ?? "");
          if (commit !== target.commit) {
            sendJson(res, { ok: false, error: "This health check is for a different commit." }, 409);
            return;
          }
          const ok = body.ok === true;
          const serverStartedAt = Number(body.serverStartedAt ?? deps.hooks.serverStartedAt());
          const restarted = serverStartedAt > 0 && target.stage !== "restarting" ? true : ok;
          const health = {
            ok,
            detail: String(body.detail ?? (ok ? "The app answered after the restart." : "The health check failed.")),
            at: Date.now(),
            serverStartedAt,
            checkedCommit: commit,
            pageLoaded: body.pageLoaded === true,
          };
          touch({
            stage: ok ? "applied" : "failed",
            health,
            restartedAt: ok ? health.at : target.restartedAt,
            appliedAt: ok ? health.at : null,
            failure: ok
              ? null
              : `The update was committed but the restarted application did not pass its health check. ${health.detail}`,
          });
          if (ok) {
            const record: UpdateSummary = {
              id: target.id,
              commit: target.commit,
              message: target.message,
              files: target.files.length,
              branch: target.branch,
              target: target.target,
              appliedAt: health.at,
              healthOk: true,
              at: Date.now(),
            };
            current.history = [record, ...current.history.filter((entry) => entry.commit !== record.commit)].slice(
              0,
              MAX_HISTORY,
            );
            await persist();
          }
          sendJson(res, { ok: true, job: job(), restarted });
        })().catch((error: unknown) => {
          sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
        });
      });

      /* ---- rollback: revert the commit, never reset ---- */
      middlewares.use("/api/engineer/update/rollback", (req, res, next) => {
        if ((req.method ?? "GET") !== "POST") {
          next();
          return;
        }
        void (async () => {
          if (isCrossOrigin(req)) {
            sendJson(res, { ok: false, error: "Cross-origin update requests are not permitted." }, 403);
            return;
          }
          if (tokenRequired() && !hasValidToken(req)) {
            sendJson(res, { ok: false, error: "The update runtime requires LELU_ENGINEER_TOKEN." }, 401);
            return;
          }
          const body = await readJsonBody(req);
          if (body.confirm !== true) {
            sendJson(res, { ok: false, error: "Rollback requires confirm:true." }, 403);
            return;
          }
          const commit = String(body.commit ?? "").trim();
          if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
            sendJson(res, { ok: false, error: "Rollback needs the commit to revert." }, 400);
            return;
          }
          const who = await authorize(req);
          if (!who.ok) {
            sendJson(res, { ok: false, error: who.reason }, who.status);
            return;
          }
          // Only a commit that is actually in this history can be reverted.
          const ancestor = await adapter.git(["merge-base", "--is-ancestor", commit, "HEAD"]);
          if (!ancestor.ok) {
            sendJson(
              res,
              { ok: false, error: `${shortCommit(commit)} is not in the history of the checked-out branch; nothing was reverted.` },
              409,
            );
            return;
          }
          const reverted = await adapter.git(["revert", "--no-edit", commit], 120_000);
          if (!reverted.ok) {
            await adapter.git(["revert", "--abort"]);
            sendJson(
              res,
              {
                ok: false,
                error: `git revert failed, so nothing was changed: ${reverted.stderr || reverted.stdout}`,
              },
              409,
            );
            return;
          }
          const head = await adapter.git(["rev-parse", "HEAD"]);
          const current = await load();
          if (current.job) {
            current.job = {
              ...current.job,
              rolledBackCommit: commit,
              failure: `Rolled back ${shortCommit(commit)}; HEAD is now ${shortCommit(head.stdout.trim())}. The runtime still needs a restart to serve it.`,
              appliedAt: null,
              health: null,
              stage: "failed",
              updatedAt: Date.now(),
            };
          }
          await persist();
          sendJson(res, {
            ok: true,
            reverted: commit,
            head: head.stdout.trim(),
            authority: who.authority,
            restartSupported: deps.hooks.restart !== null,
          });
        })().catch((error: unknown) => {
          sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
        });
      });

      /* ---- diff: what the commit actually contains ---- */
      middlewares.use("/api/engineer/update/diff", (req, res, next) => {
        if ((req.method ?? "GET") !== "POST") {
          next();
          return;
        }
        void (async () => {
          const body = await readJsonBody(req);
          const commit = String(body.commit ?? "").trim();
          if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
            sendJson(res, { ok: false, error: "A commit hash is required." }, 400);
            return;
          }
          const show = await adapter.git(["show", "--stat", "--patch", "--no-color", commit], 60_000);
          sendJson(res, {
            ok: show.ok,
            patch: clip(show.stdout),
            error: show.ok ? undefined : show.stderr,
          });
        })().catch((error: unknown) => {
          sendJson(res, { ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
        });
      });
    },
  };
}

/* ------------------------------------------------------------------ */
/* Vite plugin wrapper                                                 */
/* ------------------------------------------------------------------ */

/**
 * Mount the pipeline on the Vite dev/preview server.
 *
 * `server.restart()` is the supported runtime control: it closes and
 * re-creates the server, which re-runs `configureServer` — so the
 * generation timestamp below changes exactly when the server really
 * restarted. That is the evidence the health check compares against;
 * without it, "applied" would only mean "we asked".
 */
export function updateApiPlugin(adapter: EngineerAdapter): {
  name: string;
  configureServer: (server: {
    middlewares: { use: (path: string, handler: Handler) => void };
    restart: () => Promise<void>;
  }) => void;
  configurePreviewServer: (server: { middlewares: { use: (path: string, handler: Handler) => void } }) => void;
} {
  let generation = Date.now();
  let restartHook: (() => Promise<void>) | null = null;
  const api = createUpdateApi({
    adapter,
    hooks: {
      serverStartedAt: () => generation,
      get restart() {
        return restartHook;
      },
    },
    stateFile: path.join(adapter.workspaceRoot, ".lelu", "update-state.json"),
  });
  return {
    name: "update-api",
    configureServer(server) {
      generation = Date.now();
      restartHook = async () => {
        await server.restart();
      };
      api.attach(server.middlewares);
    },
    configurePreviewServer(server) {
      generation = Date.now();
      // A preview server serves built output; there is nothing to
      // restart, so apply reports that honestly instead of reloading.
      restartHook = null;
      api.attach(server.middlewares);
    },
  };
}
