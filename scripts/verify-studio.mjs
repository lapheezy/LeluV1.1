/**
 * Studio verification — end to end, against the real runtime.
 *
 * Starts the app's own dev server, then drives the studio API exactly as
 * the panel and the tools do: seed the three demonstrations, build them,
 * run their tests, fetch their previews, call the application's real
 * backend through the preview proxy, and prove that a production
 * deployment is blocked until a person approves it.
 *
 * Every assertion is on a value the runtime returned. Evidence is written
 * to docs/evidence/studio/<stamp>/.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const PORT = 5199;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const STUDIO = path.join(ROOT, ".lelu-studio");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const EVIDENCE = path.join(ROOT, "docs", "evidence", "studio", STAMP);

const results = [];
let server;

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function post(route, body = {}, headers = {}) {
  const response = await fetch(`${ORIGIN}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({ ok: false, error: `HTTP ${response.status}` }));
  return { status: response.status, data };
}

async function waitForServer() {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    try {
      const { data } = await post("/api/studio/health");
      if (data.ok) return true;
    } catch {
      /* not up yet */
    }
    await sleep(700);
  }
  return false;
}

async function project(slug) {
  const built = await post("/api/studio/build", { slug });
  const tested = await post("/api/studio/test", { slug });
  return { built: built.data, tested: tested.data };
}

async function main() {
  mkdirSync(EVIDENCE, { recursive: true });

  server = spawn(path.join(ROOT, "node_modules", ".bin", "vite"), ["--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    cwd: ROOT,
    env: { ...process.env, BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => {
    serverLog = `${serverLog}${chunk.toString("utf8")}`.slice(-8000);
  });
  server.stderr.on("data", (chunk) => {
    serverLog = `${serverLog}${chunk.toString("utf8")}`.slice(-8000);
  });

  check("dev server becomes reachable", await waitForServer(), ORIGIN);
  if (results.at(-1).ok === false) {
    writeFileSync(path.join(EVIDENCE, "server.log"), serverLog);
    throw new Error("The dev server never became reachable; see server.log.");
  }

  const health = await post("/api/studio/health");
  check("studio runtime reports itself", health.data.ok === true, String(health.data.runtime));
  check(
    "all three templates are present",
    ["website", "application", "game"].every((kind) => (health.data.templates ?? []).includes(kind)),
    (health.data.templates ?? []).join(", "),
  );

  /* A repeatable demo run: only the three demo directories are reset. */
  for (const slug of ["aurora-site", "pulse-board", "rift-runner-3d"]) {
    rmSync(path.join(STUDIO, slug), { recursive: true, force: true });
  }
  // Approvals are deliberately runtime state with a 15-minute life, not a
  // durable permission. A verification run starts with none, so "refused
  // without approval" is tested against a genuinely empty queue.
  rmSync(path.join(STUDIO, ".approvals.json"), { force: true });

  const seeded = await post("/api/studio/demo");
  const demos = seeded.data.projects ?? [];
  check(
    "the three demonstration projects are written to disk",
    seeded.data.ok === true && demos.length === 3 && demos.every((demo) => demo.files > 0),
    demos.map((demo) => `${demo.slug}:${demo.files}`).join(" "),
  );

  const builds = {};
  const tests = {};

  /* Project A — website */
  const website = await project("aurora-site");
  builds["aurora-site"] = website.built;
  tests["aurora-site"] = website.tested;
  check("website builds (exit 0)", website.built.exitCode === 0 && website.built.ok === true, `${website.built.bytes} B`);
  check("website tests pass", website.tested.passed >= 9 && website.tested.failed === 0, `${website.tested.passed}/${website.tested.passed + website.tested.failed}`);
  const sitePreview = await fetch(`${ORIGIN}/api/studio/serve/aurora-site/`);
  const siteHtml = await sitePreview.text();
  check("website preview serves the real built page", sitePreview.ok && siteHtml.includes("Aurora"), `HTTP ${sitePreview.status}`);
  const siteCss = await fetch(`${ORIGIN}/api/studio/serve/aurora-site/styles.css`);
  check("website preview serves its stylesheet", siteCss.ok && (await siteCss.text()).includes("--accent"), `HTTP ${siteCss.status}`);

  /* Project B — application with its real backend */
  const app = await project("pulse-board");
  builds["pulse-board"] = app.built;
  tests["pulse-board"] = app.tested;
  check("application builds (exit 0)", app.built.exitCode === 0 && app.built.ok === true, `${app.built.bytes} B`);
  check("application tests pass against its real HTTP server", app.tested.passed >= 9 && app.tested.failed === 0, `${app.tested.passed}/${app.tested.passed + app.tested.failed}`);

  const appPreview = await fetch(`${ORIGIN}/api/studio/serve/pulse-board/`);
  const appHtml = await appPreview.text();
  check("application preview serves its UI", appPreview.ok && appHtml.includes("Pulse Board"), `HTTP ${appPreview.status}`);
  const createdTask = await fetch(`${ORIGIN}/api/studio/serve/pulse-board/api/tasks`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Studio verification task", lane: "todo" }),
  });
  const createdBody = await createdTask.json().catch(() => ({}));
  check(
    "the application's real backend is reached through the preview",
    createdTask.status === 201 && createdBody.task?.title === "Studio verification task",
    `HTTP ${createdTask.status}`,
  );
  const stats = await fetch(`${ORIGIN}/api/studio/serve/pulse-board/api/stats`).then((response) => response.json());
  check("the backend's stats reflect the created task", stats.total >= 1, `total ${stats.total}`);
  await fetch(`${ORIGIN}/api/studio/serve/pulse-board/api/tasks`, { method: "DELETE" });

  /* Project C — 3D game */
  const game = await project("rift-runner-3d");
  builds["rift-runner-3d"] = game.built;
  tests["rift-runner-3d"] = game.tested;
  check("3D game builds (exit 0)", game.built.exitCode === 0 && game.built.ok === true, `${game.built.bytes} B`);
  check("3D game world logic tests pass", game.tested.passed >= 11 && game.tested.failed === 0, `${game.tested.passed}/${game.tested.passed + game.tested.failed}`);
  const gamePreview = await fetch(`${ORIGIN}/api/studio/serve/rift-runner-3d/`);
  const gameHtml = await gamePreview.text();
  check("game preview serves the real built game", gamePreview.ok && gameHtml.includes("Rift Runner"), `HTTP ${gamePreview.status}`);
  const three = await fetch(`${ORIGIN}/api/studio/serve/rift-runner-3d/vendor/three.module.js`);
  const threeText = three.ok ? await three.text() : "";
  check("vendored three.js is served for offline play", three.ok && threeText.length > 500_000, `${threeText.length} chars`);
  const card = await fetch(`${ORIGIN}/api/studio/serve/rift-runner-3d/assets/character-card.png`);
  check("Session 3B's character card is in the build", card.ok, `HTTP ${card.status}`);

  /* Assets are reported from the real ledger. */
  const assets = await post("/api/studio/assets");
  const pending = (assets.data.assets ?? []).filter((asset) => asset.state === "awaiting_approval");
  check(
    "asset pipeline reports unrun Mesh jobs honestly",
    assets.data.ok === true && pending.length >= 2,
    pending.map((asset) => asset.id).join(", "),
  );

  /* Protected deployment. */
  const withoutApproval = await post("/api/studio/deploy", { slug: "aurora-site", environment: "production" });
  check(
    "production deployment is refused without human approval",
    withoutApproval.data.ok === false && withoutApproval.data.status === "blocked",
    String(withoutApproval.data.error ?? "").slice(0, 80),
  );

  const requested = await post("/api/studio/approvals/request", {
    slug: "aurora-site",
    action: "production-deploy",
    reason: "Publish the verified build of the Aurora site to the production host.",
  });
  const approvalId = requested.data.approvalId;
  check("an approval can be requested for a protected action", requested.data.ok === true && Boolean(approvalId), approvalId ?? "");

  const modelAttempt = await post("/api/studio/approvals/decide", {
    approvalId,
    decision: "approved",
    decidedBy: "lelu",
  });
  check(
    "an approval cannot be granted without the person's explicit confirmation",
    modelAttempt.data.ok === false && /only be decided by the person/.test(String(modelAttempt.data.error ?? "")),
    String(modelAttempt.data.error ?? "").slice(0, 70),
  );

  const decided = await post(
    "/api/studio/approvals/decide",
    { approvalId, decision: "approved", decidedBy: "owner@example.com" },
    { "x-lelu-user-confirmed": "1" },
  );
  check("a person can approve it", decided.data.ok === true && decided.data.approval?.status === "approved", "");

  const deployed = await post("/api/studio/deploy", {
    slug: "aurora-site",
    environment: "production",
    approvalId,
  });
  const deployManifest = path.join(STUDIO, "aurora-site", "deploy", "production", "studio-deploy.json");
  check(
    "an approved production deployment is prepared, with a real manifest",
    deployed.data.ok === true && deployed.data.status === "prepared" && existsSync(deployManifest),
    `${deployed.data.target ?? ""} · ${deployed.data.note ?? ""}`.slice(0, 120),
  );
  const manifest = existsSync(deployManifest) ? JSON.parse(readFileSync(deployManifest, "utf8")) : null;
  check(
    "the deployment manifest records the approving person and the files",
    manifest?.approvedBy === "owner@example.com" && manifest.files?.includes("index.html"),
    `${manifest?.files?.length ?? 0} files`,
  );

  /* A write that would ship a credential is refused by the runtime. */
  const secretWrite = await post("/api/studio/write", {
    slug: "aurora-site",
    path: "src/leak.js",
    content: 'const key = "sk-live_abcdefghijklmnopqrstuvwxyz012345";',
  });
  check(
    "a credential in frontend source is refused",
    secretWrite.data.ok === false && /credential/.test(String(secretWrite.data.error ?? "")),
    "",
  );

  const evidence = {
    stamp: STAMP,
    origin: ORIGIN,
    health: health.data,
    demos: demos.map((demo) => ({ slug: demo.slug, files: demo.files, notes: demo.notes })),
    builds: Object.fromEntries(
      Object.entries(builds).map(([slug, build]) => [slug, { ...build, output: String(build.output ?? "").slice(0, 3000) }]),
    ),
    tests: Object.fromEntries(
      Object.entries(tests).map(([slug, run]) => [slug, { ...run, output: String(run.output ?? "").slice(0, 4000) }]),
    ),
    deployment: deployed.data,
    approval: decided.data.approval ?? null,
    results,
    passed: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
  };
  writeFileSync(path.join(EVIDENCE, "results.json"), `${JSON.stringify(evidence, null, 2)}\n`);

  console.log(`\n${evidence.passed}/${results.length} checks passed. Evidence: ${path.relative(ROOT, EVIDENCE)}`);
  if (evidence.failed > 0) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
} finally {
  try {
    await fetch(`${ORIGIN}/api/studio/backends/stop`, { method: "POST" });
  } catch {
    /* the server may already be gone */
  }
  if (server) {
    try {
      server.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}
