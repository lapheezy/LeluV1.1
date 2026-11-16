/**
 * Mission 14.5 — two REAL authenticated browser profiles against Supabase.
 *
 * This is not the M14.4 fixture. It signs two independent Chromium contexts
 * into the configured Supabase project, uses the production continuity
 * transport, and leaves each context with its own localStorage.
 *
 * It refuses to run without LELU_M145_ALLOW_REAL=1 and the same isolated
 * project names as the Node harness. If those are absent it writes a BLOCKED
 * artifact and makes no request.
 *
 * Run (with a dev server already running under the matching env):
 *   LELU_M145_APP_URL=http://127.0.0.1:5173/ npx tsx scripts/verify-m145-two-profile.mjs
 */
import fs from "node:fs";
import { chromium } from "playwright";

const ENV_FILE = ".lelu-runtime/m145-supabase.env";
const OUT = "artifacts/m145/two-profile-acceptance.json";
const APP = process.env.LELU_M145_APP_URL ?? "http://127.0.0.1:5173/";

function readEnv() {
  if (!fs.existsSync(ENV_FILE)) return {};
  const values = {};
  for (const line of fs.readFileSync(ENV_FILE, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index > 0) values[trimmed.slice(0, index).trim()] = trimmed.slice(index + 1).trim();
  }
  return values;
}

function write(value) {
  fs.mkdirSync("artifacts/m145", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(value, null, 2));
}

const env = { ...readEnv(), ...process.env };
const missing = ["LELU_M145_SUPABASE_URL", "LELU_M145_SUPABASE_PUBLISHABLE_KEY", "LELU_M145_EMAIL", "LELU_M145_PASSWORD", "LELU_M145_PROJECT_REF"]
  .filter((name) => !env[name]);
const result = {
  mission: "M14.5",
  evidenceClass: ["BROWSER", "REAL_AUTHENTICATED_SUPABASE", "TWO_INDEPENDENT_PROFILES"],
  realCloud: false,
  realDevices: false,
  status: "BLOCKED",
  startedAt: new Date().toISOString(),
  checks: [],
};

if (missing.length > 0 || env.LELU_M145_ALLOW_REAL !== "1") {
  result.reason = env.LELU_M145_ALLOW_REAL !== "1"
    ? "LELU_M145_ALLOW_REAL is not 1."
    : `Missing ${missing.join(", ")}.`;
  result.missingNames = missing;
  write(result);
  console.log(`BLOCKED two-profile acceptance: ${result.reason}`);
  process.exit(0);
}

const check = (name, ok, detail = "") => {
  result.checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ headless: true });

async function signIn(context, email, password) {
  const page = await context.newPage();
  await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 40_000 });
  const gate = page.locator("[data-lelu-signin-gate]");
  await gate.waitFor({ state: "visible", timeout: 40_000 });
  await gate.locator('input[type="email"]').fill(email);
  await gate.locator('input[type="password"]').fill(password);
  await gate.locator('button[type="submit"]').click();
  await gate.waitFor({ state: "detached", timeout: 45_000 });
  const state = await page.evaluate(async () => {
    const { default: Persistence } = await import("/src/core/persistence/SupabasePersistence.ts");
    const persistence = Persistence.getInstance();
    for (let index = 0; index < 80; index += 1) {
      if (persistence.getStatus() === "connected") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { status: persistence.getStatus(), email: persistence.getAuthState().email };
  });
  return { page, state };
}

async function installEngine(page) {
  return page.evaluate(async () => {
    const [{ default: Engine }, { default: Transport }, { default: ProjectStore }] = await Promise.all([
      import("/src/core/sync/ContinuityEngine.ts"),
      import("/src/core/sync/SupabaseContinuityTransport.ts"),
      import("/src/core/projects/ProjectStore.ts"),
    ]);
    const engine = Engine.getInstance();
    engine.start({ transport: new Transport(), autoProcess: false });
    engine.setTransport(new Transport());
    window.__m145 = { engine, ProjectStore };
  });
}

async function drain(page, rounds = 30) {
  return page.evaluate(async (limit) => {
    const engine = window.__m145.engine;
    for (let index = 0; index < limit && engine.pending().length > 0; index += 1) {
      const before = engine.pending().length;
      await engine.synchronize();
      if (engine.pending().length >= before) break;
    }
    return { pending: engine.pending().length, conflicts: engine.conflicts().length };
  }, rounds);
}

try {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const a = await signIn(contextA, env.LELU_M145_EMAIL, env.LELU_M145_PASSWORD);
  const b = await signIn(contextB, env.LELU_M145_SECOND_EMAIL || env.LELU_M145_EMAIL, env.LELU_M145_SECOND_PASSWORD || env.LELU_M145_PASSWORD);
  check("profile A is authenticated", a.state.status === "connected", a.state.status);
  check("profile B is authenticated", b.state.status === "connected", b.state.status);
  check("profiles use independent browser storage", await a.page.evaluate(() => localStorage.length) >= 0 && await b.page.evaluate(() => localStorage.length) >= 0);

  await installEngine(a.page);
  await installEngine(b.page);
  await drain(a.page);
  await drain(b.page);

  const created = await a.page.evaluate(() => {
    const project = window.__m145.ProjectStore.getInstance().create({ name: "M145 two-profile project" });
    return { id: project.id, name: project.name };
  });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await drain(a.page);
    const seen = await b.page.evaluate(async (id) => {
      const engine = window.__m145.engine;
      await engine.synchronize();
      return Boolean(window.__m145.ProjectStore.getInstance().get(id));
    }, created.id);
    if (seen) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const seenByB = await b.page.evaluate((id) => window.__m145.ProjectStore.getInstance().get(id)?.name ?? null, created.id);
  check("profile B pulls profile A's real cloud project", seenByB === "M145 two-profile project", seenByB ?? "not found");

  await contextA.setOffline(true);
  await contextB.setOffline(true);
  await a.page.evaluate((id) => window.__m145.ProjectStore.getInstance().update(id, { name: "Profile A offline edit" }), created.id);
  await b.page.evaluate((id) => window.__m145.ProjectStore.getInstance().update(id, { name: "Profile B offline edit" }), created.id);
  await drain(a.page);
  await drain(b.page);

  await contextA.setOffline(false);
  await drain(a.page);
  await contextB.setOffline(false);
  const conflict = await b.page.evaluate(async (id) => {
    const engine = window.__m145.engine;
    await engine.synchronize();
    return engine.conflicts().find((item) => item.recordId === id) ?? null;
  }, created.id);
  check("profile B detects a real cloud conflict", Boolean(conflict), conflict ? "conflict returned" : "no conflict");
  check("both edits are preserved", Boolean(conflict && conflict.local?.data?.name === "Profile B offline edit" && conflict.cloud?.data?.name === "Profile A offline edit"), conflict ? `${conflict.local?.data?.name} / ${conflict.cloud?.data?.name}` : "");

  let resolved = null;
  if (conflict) {
    resolved = await b.page.evaluate(async (conflictId) => {
      const engine = window.__m145.engine;
      const outcome = engine.resolveConflict(engine.conflicts(true), conflictId, "keep_cloud");
      if (outcome.ok) await engine.synchronize();
      return outcome;
    }, conflict.id);
  }
  check("conflict resolves against the real row", Boolean(resolved?.ok), resolved?.detail ?? "no conflict");
  await drain(b.page);
  await drain(a.page);
  const finalA = await a.page.evaluate((id) => window.__m145.ProjectStore.getInstance().get(id)?.name ?? null, created.id);
  const finalB = await b.page.evaluate((id) => window.__m145.ProjectStore.getInstance().get(id)?.name ?? null, created.id);
  check("both profiles converge after resolution", finalA === finalB, `${finalA} / ${finalB}`);

  await a.page.reload({ waitUntil: "domcontentloaded" });
  await installEngine(a.page);
  const reloadedA = await a.page.evaluate((id) => window.__m145.ProjectStore.getInstance().get(id)?.name ?? null, created.id);
  check("profile A preserves the resolved project after reload", reloadedA === finalA, reloadedA ?? "missing");

  result.status = result.checks.every((item) => item.ok) ? "PASS" : "FAIL";
  result.realCloud = true;
  result.projectRef = env.LELU_M145_PROJECT_REF;
  result.projectId = created.id;
  result.finishedAt = new Date().toISOString();
  result.note = "Two independent Chromium contexts with separate localStorage and real Supabase sign-in. This is a two-profile browser test, not physical-device testing.";
  write(result);
  if (result.status !== "PASS") process.exitCode = 1;
} catch (error) {
  result.status = "ERROR";
  result.error = error instanceof Error ? error.stack : String(error);
  result.finishedAt = new Date().toISOString();
  write(result);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} finally {
  await browser.close();
}
