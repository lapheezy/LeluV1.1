/**
 * ==========================================================
 * LÉLU — THE UPDATE LIFECYCLE, STATED ONCE
 *
 * The pipeline that takes a change LÉLU made to her own source and
 * turns it into a verified, running version has several states that
 * are easy to conflate and expensive to confuse:
 *
 *   the edit was written  ≠  the project compiles
 *   the project compiles  ≠  the tests pass
 *   the tests pass        ≠  a commit exists
 *   a commit exists       ≠  the commit CONTAINS the change
 *   the commit exists     ≠  the running app serves it
 *   the app restarted     ≠  the app is healthy
 *
 * This module holds the states, the labels and the DECISIONS those
 * distinctions imply. It is imported by the browser UI, by the
 * server pipeline and by the tests, so all three agree on what
 * "verified" and "applied" mean — the server cannot promise one
 * thing while the panel displays another.
 *
 * Pure: no `node:` imports, no DOM, no fetch, no storage.
 * ==========================================================
 */

/** Every state the pipeline can report, in the order it reaches them. */
export type UpdateStage =
  | "idle"
  | "analyzing"
  | "editing"
  | "testing"
  | "building"
  | "awaiting-commit"
  | "commit-verified"
  | "ready"
  | "restarting"
  | "health-check"
  | "applied"
  | "failed";

/** The checks the pipeline runs, in the order it runs them. */
export type UpdateCheckId = "typecheck" | "lint" | "tests" | "build";

export const ALL_CHECKS: UpdateCheckId[] = ["typecheck", "lint", "tests", "build"];

/** Checks that must pass before a commit is even attempted. */
export const REQUIRED_FOR_COMMIT: UpdateCheckId[] = ["typecheck", "tests", "build"];

export interface UpdateCheckResult {
  id: UpdateCheckId;
  ok: boolean;
  /** Real measured duration of the command. */
  durationMs: number;
  /** The exact command that ran, so the panel never implies another. */
  command: string;
  stdout: string;
  stderr: string;
  /** True when the caller asked for this check but the runtime could not run it. */
  skipped?: boolean;
}

export interface UpdateFileChange {
  path: string;
  status: "added" | "modified" | "deleted";
  addedLines: number;
  removedLines: number;
}

export interface UpdateHealth {
  ok: boolean;
  detail: string;
  at: number;
  /** The dev/runtime generation the check was made against. */
  serverStartedAt: number;
  checkedCommit: string;
  /** Whether the app's own HTML loaded (not just the API). */
  pageLoaded: boolean;
}

export interface UpdateJob {
  id: string;
  /** Which environment this job is allowed to be applied to. */
  target: string;
  stage: UpdateStage;
  /** The commit message the user asked for. */
  message: string;
  branch: string;
  /** HEAD before the change was committed — the rollback reference. */
  headBefore: string;
  files: UpdateFileChange[];
  checks: UpdateCheckResult[];
  requestedChecks: UpdateCheckId[];
  commit: string | null;
  /** Paths git reports as part of the commit (real, from `git show`). */
  commitPaths: string[];
  /**
   * True only when HEAD is the commit, every request is in the commit,
   * and the working tree no longer differs for those paths.
   */
  commitVerified: boolean;
  failure: string | null;
  /** Who authorized the privileged steps (identity, or the local dev runtime). */
  authority: string;
  startedAt: number;
  updatedAt: number;
  appliedAt: number | null;
  restartedAt: number | null;
  health: UpdateHealth | null;
  /** Commit this job rolled back, when it did. */
  rolledBackCommit?: string | null;
}

export interface UpdateRuntimeFacts {
  /** Which runtime is serving: "vite-dev", "node-server", "preview", … */
  runtime: string;
  branch: string;
  head: string;
  /** Generation timestamp — changes when the server is actually restarted. */
  serverStartedAt: number;
  /** False when the runtime cannot restart itself; apply then says so. */
  restartSupported: boolean;
  workspace: string;
  identityVerification: boolean;
  /** The trust boundary that authorizes commit/apply on this runtime. */
  authority: string;
  /** The runtime could not answer (static-only deployment, 404, …). */
  available: boolean;
  error?: string;
}

export interface UpdateSummary {
  id: string;
  commit: string;
  message: string;
  files: number;
  branch: string;
  target: string;
  appliedAt: number | null;
  healthOk: boolean;
  at: number;
}

export interface UpdateState {
  job: UpdateJob | null;
  facts: UpdateRuntimeFacts;
  history: UpdateSummary[];
}

/* ------------------------------------------------------------------ */
/* labels                                                              */
/* ------------------------------------------------------------------ */

/**
 * The ten states the interface shows. `idle` is not one of them: an
 * instance that has never run has no state to display.
 */
export const STAGE_LABELS: { id: UpdateStage; label: string }[] = [
  { id: "analyzing", label: "Analyzing changes" },
  { id: "editing", label: "Editing files" },
  { id: "testing", label: "Running tests" },
  { id: "building", label: "Build" },
  { id: "awaiting-commit", label: "Awaiting commit" },
  { id: "commit-verified", label: "Commit verified" },
  { id: "ready", label: "Update verified" },
  { id: "restarting", label: "Restarting application" },
  { id: "health-check", label: "Health check" },
  { id: "applied", label: "Update ready to use" },
];

export type StageStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StageView {
  id: UpdateStage;
  label: string;
  status: StageStatus;
  detail: string;
}

export function stageLabel(stage: UpdateStage): string {
  return STAGE_LABELS.find((entry) => entry.id === stage)?.label ?? stage;
}

function checkResult(job: UpdateJob, id: UpdateCheckId): UpdateCheckResult | undefined {
  return job.checks.find((check) => check.id === id);
}

function requested(job: UpdateJob, id: UpdateCheckId): boolean {
  return job.requestedChecks.includes(id);
}

function checksView(job: UpdateJob, ids: UpdateCheckId[]): { status: StageStatus; detail: string } {
  const active = ids.filter((id) => requested(job, id));
  if (active.length === 0) return { status: "skipped", detail: "Not requested" };
  const results = active.map((id) => checkResult(job, id)).filter((entry): entry is UpdateCheckResult => Boolean(entry));
  const failed = results.filter((entry) => !entry.ok);
  if (failed.length > 0) {
    return {
      status: "failed",
      detail: failed.map((entry) => `${entry.id} failed`).join(", "),
    };
  }
  const done = results.filter((entry) => entry.ok && !entry.skipped);
  if (done.length === active.length) {
    return {
      status: "done",
      detail: done.map((entry) => `${entry.id} ${Math.round(entry.durationMs / 100) / 10}s`).join(" · "),
    };
  }
  const skipped = results.filter((entry) => entry.skipped);
  if (skipped.length + done.length === active.length) {
    return { status: "skipped", detail: `not available here: ${skipped.map((entry) => entry.id).join(", ")}` };
  }
  return { status: "running", detail: `running ${active.filter((id) => !checkResult(job, id)).join(", ") || "…"}` };
}

/**
 * Present the job as the nine-stage list the panel renders.
 *
 * Each status is derived from a fact the pipeline actually recorded —
 * never from "how far along it feels". A stage with no evidence is
 * pending; a stage whose evidence is a failure is failed.
 */
export function stageViews(job: UpdateJob | null): StageView[] {
  if (!job) {
    return STAGE_LABELS.map((entry) => ({ ...entry, status: "pending" as StageStatus, detail: "—" }));
  }
  const at = job.stage;
  const failedEarly = Boolean(job.failure) && job.checks.length === 0 && job.files.length === 0;

  const views: StageView[] = [];
  for (const entry of STAGE_LABELS) {
    let status: StageStatus = "pending";
    let detail = "";

    switch (entry.id) {
      case "analyzing": {
        if (at === "analyzing") status = "running";
        else if (failedEarly) status = "failed";
        else if (job.files.length > 0 || job.checks.length > 0 || job.stage !== "idle") status = "done";
        detail =
          job.files.length > 0
            ? `${job.files.length} file(s), ${job.files.reduce((sum, file) => sum + file.addedLines, 0)}+/${job.files.reduce((sum, file) => sum + file.removedLines, 0)}−`
            : job.branch
              ? `on ${job.branch}`
              : "—";
        break;
      }
      case "editing": {
        // The edits already exist on disk when a job starts; the job
        // proves it by listing them. Nothing here was written by the
        // pipeline, so it is never "running".
        status = job.files.length > 0 ? "done" : failedEarly ? "failed" : "pending";
        detail = job.files.length > 0 ? `${job.files.length} file(s) changed in the working tree` : "no changes";
        break;
      }
      case "testing": {
        const view = checksView(job, ["typecheck", "lint", "tests"]);
        status = at === "testing" && view.status === "running" ? "running" : view.status;
        detail = view.detail;
        break;
      }
      case "building": {
        const view = checksView(job, ["build"]);
        status = at === "building" && view.status === "running" ? "running" : view.status;
        detail = view.detail;
        break;
      }
      case "awaiting-commit": {
        if (job.commit) status = "done";
        else if (at === "awaiting-commit") status = "running";
        else if (job.failure && job.files.length > 0) status = "failed";
        detail = job.commit ? shortCommit(job.commit) : job.failure ? "blocked" : "waiting for verification";
        break;
      }
      case "commit-verified": {
        if (job.commitVerified) status = "done";
        else if (job.commit) status = "failed";
        else if (job.failure && job.commit === null && at === "failed") status = "pending";
        detail = job.commitVerified
          ? `${job.commitPaths.length} path(s) confirmed in the commit`
          : job.commit
            ? "the commit does not contain every expected path"
            : "no commit yet";
        break;
      }
      case "ready": {
        if (job.appliedAt || job.commitVerified) status = "done";
        detail = job.commitVerified ? "waiting for you to apply" : "—";
        break;
      }
      case "restarting": {
        if (job.restartedAt) status = "done";
        else if (at === "restarting") status = "running";
        detail = job.restartedAt ? "runtime restarted" : at === "restarting" ? "requesting restart" : "—";
        break;
      }
      case "health-check": {
        if (job.health?.ok) status = "done";
        else if (job.health && !job.health.ok) status = "failed";
        else if (at === "health-check") status = "running";
        detail = job.health ? job.health.detail : "—";
        break;
      }
      case "applied": {
        status = job.appliedAt && job.health?.ok ? "done" : "pending";
        detail = job.appliedAt && job.health?.ok ? "the running version is this commit" : "—";
        break;
      }
      default:
        status = "pending";
        break;
    }

    views.push({ ...entry, status, detail: detail || "—" });
  }
  return views;
}

/* ------------------------------------------------------------------ */
/* decisions                                                           */
/* ------------------------------------------------------------------ */

export function shortCommit(commit: string | null | undefined): string {
  return (commit ?? "").slice(0, 7);
}

/**
 * Is this update verified?
 *
 * A commit is NOT enough. Verification needs a non-empty change set,
 * every requested blocking check passing, a commit that git itself
 * confirms contains those paths, and no failure recorded. The last
 * condition matters most: a failed run must never read as verified
 * even if an earlier stage left a commit behind.
 */
export function jobIsVerified(job: UpdateJob | null): boolean {
  if (!job) return false;
  if (job.failure) return false;
  if (job.files.length === 0) return false;
  if (!job.commit || !job.commitVerified) return false;

  // Every check that was ASKED for must have passed — including the ones
  // that are optional to request. A requested lint run that failed is a
  // failing check, not a check that can be left out of the verdict.
  for (const id of job.requestedChecks) {
    const result = checkResult(job, id);
    if (!result || !result.ok) return false;
  }

  // And the blocking minimum must genuinely have been requested: a job
  // that only typechecked cannot claim the project works.
  for (const id of REQUIRED_FOR_COMMIT) {
    if (!requested(job, id)) return false;
  }
  return true;
}

export interface ApplyDecision {
  ok: boolean;
  reason?: string;
  /** Already applied and healthy — applying again must be a no-op. */
  alreadyApplied?: boolean;
}

/**
 * Decide whether this update may be applied to this environment right
 * now. Checked on the server before anything restarts, and used by the
 * panel to keep a button disabled for a reason it can state.
 */
export function applyDecision(job: UpdateJob | null, facts: UpdateRuntimeFacts | null): ApplyDecision {
  if (!job) return { ok: false, reason: "There is no verified update to apply." };
  if (!facts?.available) return { ok: false, reason: facts?.error ?? "No development runtime is reachable." };
  if (!jobIsVerified(job)) {
    return { ok: false, reason: job.failure ?? "This update has not passed its checks, so it cannot be applied." };
  }
  if (!job.commit) return { ok: false, reason: "The update has no commit." };
  if (job.target !== facts.runtime) {
    return {
      ok: false,
      reason: `This update was verified for “${job.target}” but the running environment is “${facts.runtime}”.`,
    };
  }
  if (job.appliedAt && job.health?.ok) {
    return { ok: true, alreadyApplied: true };
  }
  if (!facts.restartSupported) {
    return {
      ok: false,
      reason:
        "This runtime cannot restart itself, so applying would reload a page that still serves the old process. " +
        "Deploy it with your normal release step (or run the dev server, which can restart itself).",
    };
  }
  if (facts.head !== job.commit) {
    return {
      ok: false,
      reason: `The checkout is at ${shortCommit(facts.head)} but this update verified ${shortCommit(job.commit)}.`,
    };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* notifications                                                       */
/* ------------------------------------------------------------------ */

export interface UpdateAnnouncement {
  title: string;
  body: string;
  tag: string;
}

/** "LÉLU update verified. Commit abc1234 is ready to apply." */
export function readyAnnouncement(job: UpdateJob): UpdateAnnouncement | null {
  if (!jobIsVerified(job) || !job.commit) return null;
  const short = shortCommit(job.commit);
  const files = job.files.length;
  const checks = job.checks.filter((check) => check.ok && !check.skipped).map((check) => check.id);
  return {
    title: `LÉLU update verified. Commit ${short} is ready to apply.`,
    body: `${files} file${files === 1 ? "" : "s"} changed · ${checks.join(", ") || "checks"} passed · ${job.branch}`,
    tag: `update-ready:${job.commit}`,
  };
}

/** "Update applied successfully. LÉLU is running the verified version." */
export function appliedAnnouncement(job: UpdateJob): UpdateAnnouncement | null {
  if (!job.commit || !job.appliedAt || !job.health?.ok) return null;
  return {
    title: "Update applied successfully. LÉLU is running the verified version.",
    body: `Commit ${shortCommit(job.commit)} · ${job.health.detail}`,
    tag: `update-applied:${job.commit}`,
  };
}

/** The one-line summary the committed update reads as. */
export function describeJob(job: UpdateJob | null): string {
  if (!job) return "No update has been prepared on this runtime yet.";
  if (job.failure) return `${stageLabel(job.stage)} — ${job.failure}`;
  if (job.appliedAt && job.health?.ok) return `Running verified commit ${shortCommit(job.commit)}.`;
  if (job.commitVerified) return `Verified commit ${shortCommit(job.commit)} — ready to apply.`;
  return `${stageLabel(job.stage)}…`;
}
