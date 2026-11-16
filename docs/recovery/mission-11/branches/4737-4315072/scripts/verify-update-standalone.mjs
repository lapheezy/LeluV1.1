/**
 * LÉLU — APPLY & RESTART ON THE STANDALONE RUNTIME
 *
 * The dev server restarts itself with `server.restart()`. The standalone
 * runtime (`server.ts`) cannot: it is one process, so with
 * `LELU_UPDATE_SUPERVISOR=1` it closes its listener and exits with code 75,
 * and whatever supervises it starts the new version.
 *
 * This proves that end to end, over the real HTTP surface, against a
 * runtime started like this:
 *
 *   LELU_UPDATE_SUPERVISOR=1 PORT=4100 bun run server.ts
 *
 * under any supervisor, e.g.
 *
 *   while true; do PORT=4100 LELU_UPDATE_SUPERVISOR=1 bun run server.ts; \
 *     echo "supervisor: exited $?" >> /tmp/supervisor.log; sleep 1; done
 *
 * It asserts the things that are easy to claim and hard to prove:
 *   • the runtime reports the new id and that it can restart
 *   • a real change set passes typecheck, lint, the full suite and a build
 *   • the commit it made contains exactly those paths
 *   • apply makes the process EXIT (connection refused), not reload a page
 *   • the supervisor brings back a NEW generation, at the verified commit
 *   • the app itself answers, and only then is the update recorded applied
 *   • the supervisor log shows exit code 75 — the documented contract
 *
 * Usage: node scripts/verify-update-standalone.mjs
 *   LELU_STANDALONE       base url (default http://127.0.0.1:4100)
 *   LELU_SUPERVISOR_LOG   file the supervisor writes exits to
 *   LELU_UPDATE_PATHS     comma-separated files this update contains
 *   LELU_UPDATE_MESSAGE   commit message
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.LELU_STANDALONE ?? "http://127.0.0.1:4100";
const SUPERVISOR_LOG = process.env.LELU_SUPERVISOR_LOG ?? "/tmp/supervisor.log";
const MESSAGE = process.env.LELU_UPDATE_MESSAGE ?? "fix: reachable update panel and interrupted-apply recovery";
const PATHS = (
  process.env.LELU_UPDATE_PATHS ??
  [
    "src/app/scene/genesis/GenesisUpdatePanel.tsx",
    "src/app/scene/genesis/GenesisWindowFrame.tsx",
    "src/core/selfdev/UpdateLifecycle.ts",
    "src/core/selfdev/UpdateRuntime.ts",
    "scripts/verify-update-panel.mjs",
    "scripts/verify-update-standalone.mjs",
    "docs/LELU_UPDATE_PIPELINE_REPORT.md",
  ].join(",")
)
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean);

let failures = 0;
const check = (name, ok, note = "") => {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${note ? "  — " + note : ""}`);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function status() {
  const response = await fetch(`${BASE}/api/engineer/update/status`, { cache: "no-store" });
  if (!response.ok) throw new Error(`status HTTP ${response.status}`);
  return response.json();
}

async function post(path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...body, confirm: true }),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function waitFor(predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    try {
      const value = await predicate();
      if (value) return value;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await sleep(1500);
  }
  throw new Error(`${label} did not happen within ${Math.round(timeoutMs / 1000)}s${last ? ` (${last})` : ""}`);
}

/* ---- 1. the runtime under test ---- */
const before = await status();
check("the standalone runtime answers", before?.ok === true);
check("it identifies itself as the standalone runtime", before?.facts?.runtime === "node-server", String(before?.facts?.runtime));
check("it reports that it can restart (supervisor configured)", before?.facts?.restartSupported === true, String(before?.facts?.restartSupported));
const headBefore = String(before?.facts?.head ?? "");
const generationBefore = Number(before?.facts?.serverStartedAt ?? 0);
console.log(`  ..    starting from ${headBefore.slice(0, 7)}, generation ${generationBefore}`);

/* ---- 2. verify a real change set, through the pipeline ---- */
const prepared = await post("/api/engineer/update/prepare", { message: MESSAGE, paths: PATHS, checks: ["typecheck", "lint", "tests", "build"] });
check("the pipeline accepted the update", prepared.body?.ok === true, prepared.body?.error ?? `HTTP ${prepared.status}`);

const settled = await waitFor(
  async () => {
    const current = await status();
    const stage = current?.job?.stage;
    if (stage === "ready" || stage === "failed") return current;
    if (stage && stage !== "applied") process.stdout.write(`\r  ..    ${stage}            `);
    return null;
  },
  20 * 60_000,
  "verification",
);
process.stdout.write("\r");
const job = settled.job;
check("every check passed", job?.checks?.length >= 4 && job.checks.every((entry) => entry.ok), (job?.checks ?? []).map((entry) => `${entry.id}:${entry.ok}`).join(" "));
check("the commit is verified by git", job?.commitVerified === true, job?.failure ?? "");
check(
  "the commit contains exactly this update's files",
  Array.isArray(job?.commitPaths) && job.commitPaths.length === PATHS.length && PATHS.every((name) => job.commitPaths.includes(name)),
  (job?.commitPaths ?? []).join(", ").slice(0, 200),
);
const commit = String(job?.commit ?? "");
console.log(`  ..    verified ${commit.slice(0, 7)}`);

/* ---- 3. apply: the process must exit, not pretend ---- */
const applied = await post("/api/engineer/update/apply", { commit });
check("apply accepted the verified commit", applied.body?.ok === true, applied.body?.error ?? `HTTP ${applied.status}`);

/* The listener going away is the restart, not an error: wait for the
   runtime to stop answering, then for a NEW generation to answer. */
let sawExit = false;
try {
  await waitFor(
    async () => {
      try {
        await status();
        return false;
      } catch {
        sawExit = true;
        return true;
      }
    },
    30_000,
    "the runtime to exit",
  );
} catch {
  /* If the supervisor restarts faster than we poll, the generation check
     below still proves the process was replaced. */
}
check("the process stopped serving (a real exit, not a page reload)", sawExit, sawExit ? "connection refused while restarting" : "restarted between polls");

const restarted = await waitFor(
  async () => {
    try {
      const current = await status();
      return Number(current?.facts?.serverStartedAt ?? 0) > generationBefore ? current : null;
    } catch {
      return null;
    }
  },
  120_000,
  "the supervisor to bring the runtime back",
);
check(
  "a new generation is serving",
  Number(restarted?.facts?.serverStartedAt ?? 0) > generationBefore,
  `${generationBefore} → ${restarted?.facts?.serverStartedAt}`,
);
check("the restarted runtime serves the verified commit", String(restarted?.facts?.head ?? "") === commit, String(restarted?.facts?.head ?? "").slice(0, 7));

const page = await fetch(`${BASE}/`, { cache: "no-store" }).catch(() => null);
const pageOk = page?.ok === true;
check("the app itself answers after the restart", pageOk, page ? `HTTP ${page.status}` : "no response");

/* ---- 4. record the health evidence the browser client would send ---- */
const health = await post("/api/engineer/update/health", {
  commit,
  ok: pageOk && String(restarted?.facts?.head ?? "") === commit,
  detail: `standalone runtime restarted by its supervisor · serving ${commit.slice(0, 7)} · app answered HTTP ${page?.status ?? "?"}`,
  serverStartedAt: Number(restarted?.facts?.serverStartedAt ?? 0),
  pageLoaded: pageOk,
});
check("the health check was recorded", health.body?.ok === true, health.body?.error ?? "");
const final = await status();
check("the update is recorded as applied", final?.job?.stage === "applied", String(final?.job?.stage));
check("the applied record holds a healthy check", final?.job?.health?.ok === true, final?.job?.health?.detail ?? "");

/* ---- 5. the supervisor really did the restarting ---- */
let supervisorLog = "";
try {
  supervisorLog = readFileSync(SUPERVISOR_LOG, "utf8");
} catch {
  supervisorLog = "";
}
const exitLine = supervisorLog.split("\n").filter((line) => /exited/.test(line)).pop() ?? "";
check("the supervisor log shows the documented exit code 75", /exited( code)? 75/.test(exitLine), exitLine.trim() || `no log at ${SUPERVISOR_LOG}`);

mkdirSync("artifacts/logs", { recursive: true });
writeFileSync(
  "artifacts/logs/update-standalone.json",
  JSON.stringify(
    {
      runtime: final?.facts?.runtime,
      commit,
      message: MESSAGE,
      paths: PATHS,
      checks: final?.job?.checks?.map((entry) => ({ id: entry.id, ok: entry.ok, command: entry.command, durationMs: entry.durationMs })),
      generationBefore,
      generationAfter: final?.facts?.serverStartedAt,
      health: final?.job?.health,
      exitLine: exitLine.trim(),
      sawExit,
    },
    null,
    2,
  ),
);

console.log(failures === 0 ? "\nALL STANDALONE CHECKS PASSED" : `\n${failures} STANDALONE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
