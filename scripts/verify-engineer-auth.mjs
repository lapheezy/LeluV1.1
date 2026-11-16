/**
 * LÉLU — IS THE ENGINEERING RUNTIME ACTUALLY CLOSED?
 *
 * Reports the answer a stranger on the internet would get, against the
 * real production runtime (`bun server.ts` serving `dist/`), twice:
 *
 *   A. NO LELU_ENGINEER_TOKEN configured  → every route must refuse (503)
 *   B. a token configured                 → missing/wrong → 401,
 *                                           correct → the real work
 *
 * It asserts the refusal bodies leak nothing (no workspace path, no cwd,
 * no operation list, no engine version) and that the origin guard still
 * rejects a foreign Origin even WITH a valid token — the token must not
 * buy a caller past CSRF.
 *
 * The servers are spawned and stopped by this script, so there is no
 * state to forget between runs.
 *
 * Evidence: docs/evidence/engineer-auth/<stamp>/auth.json
 * Usage: node scripts/verify-engineer-auth.mjs
 */

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const OUT = path.join("docs", "evidence", "engineer-auth", stamp);
mkdirSync(OUT, { recursive: true });

const TOKEN = `verify-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
const WRONG = `${TOKEN}-wrong`;
const CWD = process.cwd();
const PORT_A = 4181; // no token -> disabled
const PORT_B = 4182; // token required

const results = { stamp, node: process.version, checks: [], logs: {} };
let failures = 0;

function check(name, pass, detail) {
  results.checks.push({ name, pass: Boolean(pass), detail });
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer(port, token) {
  const env = { ...process.env, PORT: String(port) };
  // The token must come from THIS script, never from an inherited
  // environment or a .env file — otherwise "unset" is not being tested.
  delete env.LELU_ENGINEER_TOKEN;
  if (token) env.LELU_ENGINEER_TOKEN = token;

  const child = spawn("bun", ["server.ts"], { env, stdio: ["ignore", "pipe", "pipe"] });
  let log = "";
  child.stdout.on("data", (chunk) => (log += String(chunk)));
  child.stderr.on("data", (chunk) => (log += String(chunk)));

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { method: "HEAD" });
      if (response.status > 0) return { child, log: () => log };
    } catch {
      /* not listening yet */
    }
    await sleep(200);
  }
  child.kill("SIGKILL");
  throw new Error(`server did not start on :${port}\n${log}`);
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function call(port, route, options = {}) {
  const method = options.method ?? "POST";
  const headers = { "content-type": "application/json", ...(options.headers ?? {}) };
  if (options.token) headers["x-lelu-token"] = options.token;
  if (options.legacyToken) headers["x-lelu-engineer-token"] = options.legacyToken;
  if (options.origin) headers.origin = options.origin;
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers,
    body: method === "POST" ? JSON.stringify(options.body ?? {}) : undefined,
  });
  const text = await response.text();
  return { status: response.status, text, json: safeJson(text), headers: response.headers };
}

/** Nothing about the host may appear in a refusal. */
function leaksHost(body) {
  const leaks = [];
  if (body.includes(CWD)) leaks.push("absolute cwd");
  if (body.includes("workspaceRoot")) leaks.push("workspaceRoot");
  if (body.includes("runtimeInfo")) leaks.push("runtimeInfo");
  if (/"operations"\s*:/.test(body)) leaks.push("operation list");
  if (/\b(1|2)\d\.\d+\.\d+/.test(body)) leaks.push("engine version");
  if (body.includes(TOKEN)) leaks.push("the token itself");
  return leaks;
}

const ROUTES_POST = [
  "/api/engineer/command",
  "/api/engineer/read",
  "/api/engineer/list",
  "/api/engineer/write",
  "/api/engineer/workspace",
  "/api/engineer/git",
  "/api/engineer/search",
  "/api/engineer/preview",
  "/api/browser/capture",
];

async function main() {
  let a = null;
  let b = null;
  try {
    /* ============================================================ */
    /* A. NOTHING CONFIGURED — the default a fresh VPS would run     */
    /* ============================================================ */
    a = await startServer(PORT_A, null);

    const statusA = await call(PORT_A, "/api/engineer/status", { method: "GET" });
    check(
      "no token configured: status is refused, not served",
      statusA.status === 503,
      `HTTP ${statusA.status}`,
    );
    check(
      "no token configured: the refusal says the runtime is disabled",
      statusA.json?.disabled === true && statusA.json?.ok === false,
      `disabled=${statusA.json?.disabled} ok=${statusA.json?.ok}`,
    );
    if (statusA.json?.tokenRequired === true) {
      check(
        "the environment does not supply LELU_ENGINEER_TOKEN (test isolation)",
        false,
        "a token arrived from the environment or .env — unset it before running this check",
      );
    }

    const refused = [];
    for (const route of ROUTES_POST) {
      const response = await call(PORT_A, route, { body: { operation: "inspect", path: "package.json", query: "token", action: "create", workspace: "probe" } });
      refused.push(`${route}=${response.status}`);
      check(`no token configured: ${route} refuses`, response.status === 503, `HTTP ${response.status}`);
    }
    results.disabledResponses = refused;

    const leaked = leaksHost(statusA.text);
    check("no token configured: the refusal leaks nothing about the host", leaked.length === 0, leaked.join(", ") || `body: ${statusA.text.slice(0, 120)}`);

    // The command route must never have executed anything.
    check(
      "no token configured: no command output is returned",
      !/\d+\.\d+\.\d+/.test(statusA.text) && !statusA.text.includes("bun"),
      "no version strings in the body",
    );

    check(
      "the startup log states the runtime is disabled",
      /engineering|\/api\/engineer/i.test(a.log()),
      a.log().split("\n").filter((line) => /engineer/i.test(line)).slice(-1)[0] ?? "(no line)",
    );
    results.logs.disabled = a.log().slice(-1200);
    a.child.kill("SIGTERM");
    a = null;

    /* ============================================================ */
    /* B. A TOKEN CONFIGURED                                         */
    /* ============================================================ */
    b = await startServer(PORT_B, TOKEN);

    const noToken = await call(PORT_B, "/api/engineer/status", { method: "GET" });
    check("token configured: an unauthenticated status is 401", noToken.status === 401, `HTTP ${noToken.status}`);
    check("token configured: the 401 tells the client a token is required", noToken.json?.tokenRequired === true, `tokenRequired=${noToken.json?.tokenRequired}`);
    check("token configured: the 401 leaks no path, runtime info or operations", leaksHost(noToken.text).length === 0, leaksHost(noToken.text).join(", ") || "clean");

    const wrongToken = await call(PORT_B, "/api/engineer/status", { method: "GET", token: WRONG });
    check("token configured: an invalid token is 401", wrongToken.status === 401, `HTTP ${wrongToken.status}`);
    check("an invalid token is never echoed back", !wrongToken.text.includes(WRONG), "token absent from the body");

    const good = await call(PORT_B, "/api/engineer/status", { method: "GET", token: TOKEN });
    check("token configured: a valid token gets the real report", good.status === 200 && good.json?.ok === true, `HTTP ${good.status}`);
    check(
      "the authorized report carries the workspace root and runtime info",
      good.json?.workspaceRoot === CWD && Boolean(good.json?.runtimeInfo?.engine),
      `workspaceRoot=${good.json?.workspaceRoot} engine=${good.json?.runtimeInfo?.engine}`,
    );
    check("the authorized report says tokenRequired:true", good.json?.tokenRequired === true, `tokenRequired=${good.json?.tokenRequired}`);

    const legacy = await call(PORT_B, "/api/engineer/status", { method: "GET", legacyToken: TOKEN });
    check(
      "the legacy x-lelu-engineer-token header also authorizes (self-view routes use it)",
      legacy.status === 200,
      `HTTP ${legacy.status}`,
    );

    const commandAnonymous = await call(PORT_B, "/api/engineer/command", { body: { operation: "inspect" } });
    check("an unauthenticated command does not run", commandAnonymous.status === 401 && !commandAnonymous.text.includes("bun"), `HTTP ${commandAnonymous.status}`);

    const command = await call(PORT_B, "/api/engineer/command", { token: TOKEN, body: { operation: "inspect" } });
    check(
      "an authorized command still runs the real whitelisted operation",
      command.status === 200 && command.json?.ok === true && command.json.stdout.length > 0,
      `HTTP ${command.status}, stdout ${JSON.stringify((command.json?.stdout ?? "").slice(0, 40))}`,
    );

    const read = await call(PORT_B, "/api/engineer/read", { token: TOKEN, body: { path: "package.json" } });
    check("an authorized read still returns source", read.status === 200 && String(read.json?.content ?? "").includes('"name"'), `HTTP ${read.status}`);
    const readAnon = await call(PORT_B, "/api/engineer/read", { body: { path: "package.json" } });
    check("an unauthenticated read returns no source", readAnon.status === 401 && !readAnon.text.includes('"name"'), `HTTP ${readAnon.status}`);

    const writeAnon = await call(PORT_B, "/api/engineer/write", { body: { path: "package.json", content: "{}" } });
    check("an unauthenticated write is refused before any other check", writeAnon.status === 401, `HTTP ${writeAnon.status}`);
    const writeLive = await call(PORT_B, "/api/engineer/write", { token: TOKEN, body: { path: "package.json", content: "{}" } });
    check(
      "an authorized write STILL cannot touch the live project",
      writeLive.status === 403 && String(writeLive.json?.error ?? "").includes("workspace"),
      `HTTP ${writeLive.status}: ${String(writeLive.json?.error ?? "").slice(0, 70)}`,
    );

    const foreign = await call(PORT_B, "/api/engineer/command", {
      token: TOKEN,
      origin: "https://evil.example",
      body: { operation: "inspect" },
    });
    check(
      "a valid token does NOT buy a caller past the origin guard",
      foreign.status === 403,
      `HTTP ${foreign.status} for Origin: https://evil.example`,
    );

    const preflight = await call(PORT_B, "/api/engineer/command", { method: "OPTIONS", origin: "https://app.example" });
    check("a preflight is answered without authorizing anything", preflight.status === 204, `HTTP ${preflight.status}`);

    const search = await call(PORT_B, "/api/engineer/search", { token: TOKEN, body: { query: "engineerAuthVerdict", limit: 3 } });
    check(
      "search (self-view route) works with the token the app actually sends",
      search.status === 200 && (search.json?.matches?.length ?? 0) > 0,
      `HTTP ${search.status}, ${search.json?.matches?.length ?? 0} match(es)`,
    );

    const preview = await call(PORT_B, "/api/engineer/preview", { token: TOKEN, body: { action: "status" } });
    check("preview (self-view route) answers only when authorized", preview.status === 200, `HTTP ${preview.status}`);

    results.logs.token = b.log().slice(-1200);
    b.child.kill("SIGTERM");
    b = null;
  } finally {
    for (const running of [a, b]) {
      if (running) {
        running.child.kill("SIGKILL");
      }
    }
  }

  const pass = results.checks.filter((entry) => entry.pass).length;
  results.pass = pass;
  results.total = results.checks.length;
  writeFileSync(path.join(OUT, "auth.json"), JSON.stringify(results, null, 2));
  console.log(`\n${pass}/${results.checks.length} engineering-auth checks passed — evidence in ${OUT}/auth.json`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("verify-engineer-auth failed:", error);
  process.exit(1);
});
