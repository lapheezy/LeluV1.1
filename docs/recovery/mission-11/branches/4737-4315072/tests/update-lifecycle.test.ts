/**
 * The update lifecycle's DECISIONS.
 *
 * These are the rules that keep LÉLU honest about her own code:
 * a commit is not verification, a restart is not health, and a
 * failed check can never be reported as an applied update.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyDecision,
  appliedAnnouncement,
  describeJob,
  jobIsVerified,
  readyAnnouncement,
  shortCommit,
  stageViews,
  type UpdateCheckResult,
  type UpdateJob,
  type UpdateRuntimeFacts,
} from "../src/core/selfdev/UpdateLifecycle";

const COMMIT = "abcdef1234567890abcdef1234567890abcdef12";

function okCheck(id: UpdateCheckResult["id"], ok = true): UpdateCheckResult {
  return { id, ok, durationMs: 1_000, command: `run ${id}`, stdout: "", stderr: ok ? "" : "boom" };
}

function makeJob(patch: Partial<UpdateJob> = {}): UpdateJob {
  return {
    id: "job-1",
    target: "vite-dev",
    stage: "ready",
    message: "feat: something real",
    branch: "main",
    headBefore: "1".repeat(40),
    files: [{ path: "src/a.ts", status: "modified", addedLines: 3, removedLines: 1 }],
    checks: [okCheck("typecheck"), okCheck("lint"), okCheck("tests"), okCheck("build")],
    requestedChecks: ["typecheck", "lint", "tests", "build"],
    commit: COMMIT,
    commitPaths: ["src/a.ts"],
    commitVerified: true,
    failure: null,
    authority: "local development runtime",
    startedAt: 1_000,
    updatedAt: 2_000,
    appliedAt: null,
    restartedAt: null,
    health: null,
    rolledBackCommit: null,
    ...patch,
  };
}

function facts(patch: Partial<UpdateRuntimeFacts> = {}): UpdateRuntimeFacts {
  return {
    runtime: "vite-dev",
    branch: "main",
    head: COMMIT,
    serverStartedAt: 5_000,
    restartSupported: true,
    workspace: "lelu",
    identityVerification: false,
    authority: "local development runtime (same-origin)",
    available: true,
    ...patch,
  };
}

test("a commit on its own is not a verified update", () => {
  // The commit exists and git confirmed its contents, but a check failed.
  const failedTests = makeJob({ checks: [okCheck("typecheck"), okCheck("tests", false), okCheck("build")] });
  assert.equal(jobIsVerified(failedTests), false, "a failing test must not verify");

  const noCommit = makeJob({ commit: null, commitVerified: false });
  assert.equal(jobIsVerified(noCommit), false, "without a commit there is nothing to apply");

  const unconfirmed = makeJob({ commitVerified: false });
  assert.equal(jobIsVerified(unconfirmed), false, "a commit git could not confirm is not verified");

  const noChanges = makeJob({ files: [] });
  assert.equal(jobIsVerified(noChanges), false, "nothing changed means nothing to verify");

  const recordedFailure = makeJob({ failure: "typecheck failed" });
  assert.equal(jobIsVerified(recordedFailure), false, "a recorded failure always wins");
});

test("an update is verified only when every requested blocking check passed", () => {
  assert.equal(jobIsVerified(makeJob()), true);
  // Lint is optional: not requesting it does not block verification…
  assert.equal(jobIsVerified(makeJob({ requestedChecks: ["typecheck", "tests", "build"] })), true);
  // …but requesting it and failing does.
  const lintFails = makeJob({ checks: [okCheck("typecheck"), okCheck("lint", false), okCheck("tests"), okCheck("build")] });
  assert.equal(jobIsVerified(lintFails), false);
});

test("apply refuses a target or commit that no longer matches", () => {
  const job = makeJob();

  assert.equal(applyDecision(null, facts()).ok, false);
  assert.equal(applyDecision(job, facts({ available: false, error: "no runtime" })).ok, false);

  const wrongTarget = applyDecision(job, facts({ runtime: "preview" }));
  assert.equal(wrongTarget.ok, false);
  assert.match(wrongTarget.reason ?? "", /verified for/i);

  const wrongHead = applyDecision(job, facts({ head: "9".repeat(40) }));
  assert.equal(wrongHead.ok, false);
  assert.match(wrongHead.reason ?? "", /checkout is at/i);

  const noRestart = applyDecision(job, facts({ restartSupported: false }));
  assert.equal(noRestart.ok, false);
  assert.match(noRestart.reason ?? "", /cannot restart itself/i);

  const unverified = applyDecision(makeJob({ failure: "tests failed" }), facts());
  assert.equal(unverified.ok, false);
  assert.equal(unverified.reason, "tests failed", "the panel must show the real failure, not a generic one");
});

test("apply is allowed for a verified commit and is idempotent once applied", () => {
  const job = makeJob();
  assert.equal(applyDecision(job, facts()).ok, true);

  const applied = makeJob({
    stage: "applied",
    appliedAt: 9_000,
    health: { ok: true, detail: "app answered", at: 9_000, serverStartedAt: 9_100, checkedCommit: COMMIT, pageLoaded: true },
  });
  const decision = applyDecision(applied, facts({ head: COMMIT }));
  assert.equal(decision.ok, true);
  assert.equal(decision.alreadyApplied, true, "a second tap must not restart a second time");
});

test("the verification announcement names the exact commit and is stable", () => {
  const job = makeJob();
  const ready = readyAnnouncement(job);
  assert.ok(ready);
  assert.equal(ready!.title, "LÉLU update verified. Commit abcdef1 is ready to apply.");
  assert.equal(ready!.tag, `update-ready:${COMMIT}`);

  // Not verified → no announcement at all.
  assert.equal(readyAnnouncement(makeJob({ commit: null, commitVerified: false })), null);
  assert.equal(readyAnnouncement(makeJob({ failure: "build failed" })), null);
});

test("the applied announcement requires a healthy restarted app", () => {
  const commitOnly = makeJob({ stage: "commit-verified" });
  assert.equal(appliedAnnouncement(commitOnly), null, "a commit alone is not an applied update");

  const unhealthy = makeJob({
    appliedAt: null,
    health: { ok: false, detail: "did not answer", at: 1, serverStartedAt: 2, checkedCommit: COMMIT, pageLoaded: false },
  });
  assert.equal(appliedAnnouncement(unhealthy), null);

  const applied = makeJob({
    stage: "applied",
    appliedAt: 9_000,
    health: { ok: true, detail: "restarted and serving", at: 9_000, serverStartedAt: 9_100, checkedCommit: COMMIT, pageLoaded: true },
  });
  const announcement = appliedAnnouncement(applied);
  assert.ok(announcement);
  assert.equal(announcement!.title, "Update applied successfully. LÉLU is running the verified version.");
  assert.equal(announcement!.tag, `update-applied:${COMMIT}`);
});

test("stages report what really happened — including failures", () => {
  const running = stageViews(makeJob({ stage: "testing", checks: [okCheck("typecheck")] }));
  const testing = running.find((view) => view.id === "testing")!;
  assert.equal(testing.status, "running", "the stage being executed must read as running");
  const editing = running.find((view) => view.id === "editing")!;
  assert.equal(editing.status, "done", "the change set on disk is real evidence");
  assert.equal(running.find((view) => view.id === "applied")!.status, "pending");

  const failed = stageViews(makeJob({ stage: "failed", commit: null, commitVerified: false, checks: [okCheck("typecheck"), okCheck("tests", false)], failure: "tests failed (npm test)" }));
  assert.equal(failed.find((view) => view.id === "testing")!.status, "failed");
  assert.equal(failed.find((view) => view.id === "awaiting-commit")!.status, "failed");
  assert.equal(failed.find((view) => view.id === "commit-verified")!.status, "pending");

  const applied = stageViews(
    makeJob({
      stage: "applied",
      appliedAt: 9_000,
      health: { ok: true, detail: "ok", at: 9_000, serverStartedAt: 9_100, checkedCommit: COMMIT, pageLoaded: true },
    }),
  );
  assert.equal(applied.find((view) => view.id === "applied")!.status, "done");
  assert.equal(applied.find((view) => view.id === "health-check")!.status, "done");
});

test("the summary never claims more than the job proves", () => {
  assert.equal(describeJob(null), "No update has been prepared on this runtime yet.");
  assert.match(describeJob(makeJob()), /Verified commit abcdef1/);
  assert.match(describeJob(makeJob({ failure: "build failed" })), /build failed/);
  assert.equal(shortCommit(null), "");
});
