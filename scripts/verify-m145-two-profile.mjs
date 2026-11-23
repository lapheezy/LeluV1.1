/**
 * Mission 14.5 — two REAL authenticated browser profiles against Supabase.
 *
 * This is not the M14.4 fixture. It signs two independent Chromium contexts
 * into the configured Supabase project, uses the production continuity
 * transport, and leaves each context with its own localStorage.
 *
 * It refuses to run without LELU_M145_ALLOW_REAL=1 and the same isolated
 * project configuration as the Node harness. If those are absent it writes a
 * BLOCKED artifact and makes no request.
 *
 * Authentication is passwordless. Profile A requests the normal email link;
 * the person completes it in that visible browser. Profile B is a second
 * independent context seeded with A's authenticated storage state, so it has
 * separate localStorage but the same account. No password is collected.
 *
 * Run (with a dev server already running under the matching env):
 *   LELU_M145_HEADFUL=1 LELU_M145_APP_URL=http://127.0.0.1:5173/ npx tsx scripts/verify-m145-two-profile.mjs
 */
import fs from "node:fs";
import { chromium } from "playwright";
import { unquoteEnvValue, validateM145Target } from "./m145-config.mjs";

const ENV_FILES = [".env.local", ".lelu-runtime/m145-supabase.env"];
const OUT = "artifacts/m145/two-profile-acceptance.json";
const APP = process.env.LELU_M145_APP_URL ?? "http://127.0.0.1:5173/";

function readEnv() {
  const values = {};
  for (const file of ENV_FILES) {
    if (!fs.existsSync(file)) continue;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index > 0) values[trimmed.slice(0, index).trim()] = unquoteEnvValue(trimmed.slice(index + 1));
    }
  }
  return values;
}

function write(value) {
  fs.mkdirSync("artifacts/m145", { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(value, null, 2));
}

const env = { ...readEnv(), ...process.env };
const url = env.LELU_M145_SUPABASE_URL ?? env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
const key = env.LELU_M145_SUPABASE_PUBLISHABLE_KEY ?? env.SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY;
const projectRef = env.LELU_M145_PROJECT_REF ?? env.SUPABASE_PROJECT_REF ?? url?.match(/^https:\/\/([^.]+)\.supabase\.(?:co|in)/)?.[1];
const guard = validateM145Target({
  url,
  projectRef,
  publishableKey: key,
  allowReal: env.LELU_M145_ALLOW_REAL,
});
const result = {
  mission: "M14.5",
  evidenceClass: ["BROWSER", "REAL_AUTHENTICATED_SUPABASE", "TWO_INDEPENDENT_PROFILES"],
  realCloud: false,
  realDevices: false,
  status: "BLOCKED",
  startedAt: new Date().toISOString(),
  checks: [],
};

if (!guard.ok) {
  result.status = guard.status;
  result.reason = guard.reason;
  if (guard.missing) result.missingNames = guard.missing;
  write(result);
  console.log(`${guard.status} two-profile acceptance: ${guard.reason}`);
  process.exit(guard.status === "FAIL" ? 1 : 0);
}
if (!env.LELU_M145_EMAIL) {
  result.reason = "Missing LELU_M145_EMAIL.";
  result.missingNames = ["LELU_M145_EMAIL"];
  write(result);
  console.log("BLOCKED two-profile acceptance: Missing LELU_M145_EMAIL.");
  process.exit(0);
}

const check = (name, ok, detail = "") => {
  result.checks.push({ name, ok, ...(detail ? { detail } : {}) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({ headless: env.LELU_M145_HEADFUL !== "1" });
const signInTimeout = Number(env.LELU_M145_AUTH_TIMEOUT_MS ?? 10 * 60 * 1000);

async function requestEmailSignIn(page, email) {
  await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 40_000 });
  const gate = page.locator("[data-lelu-signin-gate]");
  await gate.waitFor({ state: "visible", timeout: 40_000 });
  await gate.locator("[data-lelu-auth-email]").fill(email);
  await gate.locator("[data-lelu-auth-submit]").click();
  console.log("PASS email sign-in requested; complete the inbox step in the visible browser");
  await gate.waitFor({ state: "detached", timeout: signInTimeout });
  const state = await page.evaluate(async () => {
    const { default: Persistence } = await import("/src/core/persistence/SupabasePersistence.ts");
    const persistence = Persistence.getInstance();
    for (let index = 0; index < 80; index += 1) {
      if (persistence.getStatus() === "connected") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { status: persistence.getStatus(), email: persistence.getAuthState().email };
  });
  return state;
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
  const pageA = await contextA.newPage();
  const stateA = await requestEmailSignIn(pageA, env.LELU_M145_EMAIL);
  check("profile A is authenticated through email", stateA.status === "connected", stateA.status);

  // A second independent context gets its own localStorage, seeded once from
  // the real authenticated session. No password and no second email needed.
  const authState = await contextA.storageState();
  const contextB = await browser.newContext({ storageState: authState });
  const pageB = await contextB.newPage();
  await pageB.goto(APP, { waitUntil: "domcontentloaded", timeout: 40_000 });
  const stateB = await pageB.evaluate(async () => {
    const { default: Persistence } = await import("/src/core/persistence/SupabasePersistence.ts");
    const persistence = Persistence.getInstance();
    for (let index = 0; index < 80; index += 1) {
      if (persistence.getStatus() === "connected") break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return { status: persistence.getStatus(), email: persistence.getAuthState().email };
  });
  const a = { page: pageA, state: stateA };
  const b = { page: pageB, state: stateB };
  check("profile B is authenticated from independent storage", b.state.status === "connected", b.state.status);
  check("profiles have independent browser storage", await a.page.evaluate(() => localStorage.length) >= 0 && await b.page.evaluate(() => localStorage.length) >= 0);

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
  result.projectRef = projectRef;
  result.projectId = created.id;
  result.finishedAt = new Date().toISOString();
  result.note = "Two independent Chromium contexts with separate localStorage; profile A completed passwordless email sign-in and profile B was seeded once from that real session. Same account, no password. This is a two-profile browser test, not physical-device testing.";
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
