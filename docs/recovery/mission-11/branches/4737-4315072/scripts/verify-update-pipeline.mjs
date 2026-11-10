#!/usr/bin/env node
/**
 * LÉLU — ACCEPTANCE: the whole update lifecycle, against a real runtime.
 *
 * Everything here goes through the same HTTP endpoints the interface
 * uses. Nothing is simulated: the failing case really runs the
 * typechecker over a deliberately broken file, and the passing case
 * really commits and really restarts the dev server.
 *
 *   node scripts/verify-update-pipeline.mjs
 *
 * Steps
 *   1. status        → is a real update runtime answering?
 *   2. fail path     → a broken file makes verification fail, and NOTHING
 *                      is committed (HEAD unchanged, job has no commit)
 *   3. verify path   → paths from LELU_UPDATE_PATHS are checked, committed
 *                      and the commit is confirmed by git
 *   4. apply         → the runtime restarts; health requires a NEW
 *                      generation, the verified commit as HEAD, and the
 *                      app itself answering
 *   5. idempotency   → a second apply does not restart again
 *   6. nothing       → a second prepare with no changes is refused, not
 *                      committed as an empty change
 *   7. rollback gate → a commit outside this history cannot be reverted
 *
 * Env:
 *   LELU_BASE           default http://localhost:3000
 *   LELU_UPDATE_PATHS   comma-separated paths to verify+commit (step 3).
 *                       When unset, steps 3-5 are skipped and reported.
 *   LELU_UPDATE_MESSAGE commit message for step 3
 */

import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const BASE = (process.env.LELU_BASE ?? "http://localhost:3000").replace(/\/+$/, "");
const ROOT = process.cwd();
const PROBE = "src/core/selfdev/__update_acceptance_probe.ts";

let passed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    failures.push(name);
    console.log(`  ✕ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

function git(...args) {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

async function getStatus() {
  const response = await fetch(`${BASE}/api/engineer/update/status`, { cache: "no-store" });
  if (!response.ok) throw new Error(`status HTTP ${response.status}`);
  const data = await response.json();
  if (!data.ok) throw new Error(data.error ?? "status refused");
  return data;
}

async function post(route, body) {
  const response = await fetch(`${BASE}/api/engineer/update/${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = { ok: false, error: `unreadable response (HTTP ${response.status})` };
  }
  return { status: response.status, data };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForJob(predicate, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const state = await getStatus();
    last = state.job;
    if (last && predicate(last)) return last;
    await sleep(1_500);
    if (last && Date.now() % 15_000 < 1_600) {
      console.log(`    … ${last.stage}${last.failure ? ` (${last.failure.split("\n")[0]})` : ""}`);
    }
  }
  throw new Error(`${label} did not reach the expected state in ${Math.round(timeoutMs / 1000)}s (last: ${last?.stage ?? "none"})`);
}

async function main() {
  console.log(`LÉLU update pipeline acceptance — ${BASE}\n`);

  /* ---------------- 1. runtime ---------------- */
  console.log("1. Runtime");
  const initial = await getStatus();
  const facts = initial.facts;
  const headAtStart = git("rev-parse", "HEAD");
  check("an update runtime is answering", facts?.available === true, `${facts?.runtime}`);
  check("it reports the environment it serves", facts?.target === undefined ? Boolean(facts?.runtime) : true, facts?.runtime);
  check("it can restart itself", facts?.restartSupported === true);
  check("its HEAD is the real repository HEAD", facts?.head === headAtStart, `${facts?.head?.slice(0, 7)}`);

  /* ---------------- 2. the failing path ---------------- */
  console.log("\n2. A failing check must not commit");
  await fs.mkdir(path.join(ROOT, path.dirname(PROBE)), { recursive: true });
  await fs.writeFile(path.join(ROOT, PROBE), 'export const probe: number = "deliberately not a number";\n', "utf8");
  try {
    const started = await post("prepare", {
      message: "test: deliberate verification failure",
      paths: [PROBE],
      checks: ["typecheck"],
      confirm: true,
    });
    check("prepare accepts the request", started.data.ok === true, started.data.error ?? "");
    if (started.data.ok) {
      const failed = await waitForJob((job) => job.stage === "failed" || job.stage === "ready", "the failing job", 300_000);
      check("the job ends failed", failed.stage === "failed", failed.stage);
      check("no commit was created", !failed.commit, `commit: ${failed.commit ?? "none"}`);
      check("HEAD did not move", git("rev-parse", "HEAD") === headAtStart);
      check("the failure names the check", /typecheck/i.test(failed.failure ?? ""), (failed.failure ?? "").split("\n")[0]);
      check("the file is preserved for debugging", await fs.readFile(path.join(ROOT, PROBE), "utf8").then(() => true));
    }
  } finally {
    await fs.rm(path.join(ROOT, PROBE), { force: true });
  }

  /* ---------------- 3. the real path ---------------- */
  const paths = (process.env.LELU_UPDATE_PATHS ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (paths.length === 0) {
    console.log("\n3-5. SKIPPED — set LELU_UPDATE_PATHS to verify+commit+apply real files.");
  } else {
    console.log(`\n3. Verify and commit ${paths.length} file(s)`);
    const started = await post("prepare", {
      message: process.env.LELU_UPDATE_MESSAGE ?? "chore: verified update",
      paths,
      checks: ["typecheck", "lint", "tests", "build"],
      confirm: true,
    });
    check("prepare accepts the request", started.data.ok === true, started.data.error ?? "");
    let job = null;
    if (started.data.ok) {
      job = await waitForJob((entry) => entry.stage === "ready" || entry.stage === "failed", "verification", 1_200_000);
    }
    if (job) {
      console.log(`    checks: ${job.checks.map((entry) => `${entry.id}=${entry.ok ? "ok" : "FAIL"}`).join(" ")}`);
      check("verification passed", job.stage === "ready", (job.failure ?? "").split("\n")[0]);
      check("a commit exists", Boolean(job.commit), job.commit?.slice(0, 7));
      check("git confirms the commit is HEAD", job.commit === git("rev-parse", "HEAD"));
      check("git lists every verified path in the commit", paths.every((entry) => job.commitPaths.includes(entry)), job.commitPaths.join(", "));
      check("the changed files were measured", job.files.length === paths.length, `${job.files.length} file(s)`);
    }

    /* ---------------- 4. apply + health ---------------- */
    if (job?.commit) {
      console.log("\n4. Apply & restart → health");
      const before = await getStatus();
      const applied = await post("apply", { commit: job.commit, confirm: true });
      check("apply is accepted", applied.data.ok === true, applied.data.error ?? "");
      check("the runtime reports a restart", applied.data.restarting === true);
      check("the previous generation was reported", typeof applied.data.previousServerStartedAt === "number");

      const deadline = Date.now() + 60_000;
      let after = null;
      let pageLoaded = false;
      let pageStatus = 0;
      while (Date.now() < deadline) {
        await sleep(1_000);
        try {
          after = await getStatus();
          if (after.facts.serverStartedAt > before.facts.serverStartedAt) {
            const page = await fetch(`${BASE}/`, { cache: "no-store" });
            pageStatus = page.status;
            pageLoaded = page.ok;
            break;
          }
        } catch {
          // expected while the server is down
        }
      }
      check("the server restarted (new generation)", Boolean(after && after.facts.serverStartedAt > before.facts.serverStartedAt));
      check("the application itself answered", pageLoaded, `HTTP ${pageStatus}`);
      check("the running HEAD is the verified commit", after?.facts.head === job.commit, after?.facts.head?.slice(0, 7));

      const health = await post("health", {
        commit: job.commit,
        ok: Boolean(after && after.facts.serverStartedAt > before.facts.serverStartedAt && pageLoaded && after.facts.head === job.commit),
        detail: `acceptance: generation ${before.facts.serverStartedAt} → ${after?.facts.serverStartedAt}, app ${pageStatus}`,
        serverStartedAt: after?.facts.serverStartedAt ?? 0,
        pageLoaded,
      });
      check("health is recorded", health.data.ok === true, health.data.error ?? "");
      check("the job is applied", health.data.job?.stage === "applied", health.data.job?.stage);

      /* ---------------- 5. idempotency ---------------- */
      console.log("\n5. Idempotency");
      const again = await post("apply", { commit: job.commit, confirm: true });
      check("a second apply does not restart again", again.data.alreadyApplied === true, again.data.error ?? "");

      /* ---------------- 6. nothing to verify ---------------- */
      console.log("\n6. A second prepare with no changes");
      const empty = await post("prepare", { message: "chore: nothing", paths, checks: ["typecheck"], confirm: true });
      if (empty.data.ok) {
        const emptyJob = await waitForJob((entry) => entry.stage === "failed" || entry.stage === "ready", "the empty job", 120_000);
        check("no-change prepare fails instead of committing", emptyJob.stage === "failed", (emptyJob.failure ?? "").split("\n")[0]);
        check("it created no commit", !emptyJob.commit);
      } else {
        check("no-change prepare is refused", true, empty.data.error ?? "");
      }

      /* ---------------- 7. rollback gate ---------------- */
      console.log("\n7. Rollback refuses a commit outside this history");
      const bogus = await post("rollback", { commit: "0".repeat(40), confirm: true });
      check("an unknown commit is refused", bogus.data.ok === false);
      check("HEAD is untouched by the refusal", git("rev-parse", "HEAD") === job.commit);
    }
  }

  console.log(`\n${failures.length === 0 ? "ALL UPDATE CHECKS PASSED" : `${failures.length} UPDATE CHECK(S) FAILED`} — ${passed} passed`);
  if (failures.length > 0) {
    console.log(failures.map((name) => `  ✕ ${name}`).join("\n"));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`\nThe acceptance run stopped: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
