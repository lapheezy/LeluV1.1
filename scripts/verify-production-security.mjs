/**
 * LÉLU — live security checks against a RUNNING production server
 * (bun run server.ts) configured with the isolated test Supabase project.
 *
 *   node scripts/verify-production-security.mjs http://127.0.0.1:4190
 *
 * Signs in the two synthetic test identities (.lelu-runtime/test-supabase.env)
 * and exercises the guarded routes over HTTP. Prints statuses only — never a
 * token or a password.
 */

import { readFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:4190";
const env = Object.fromEntries(readFileSync(new URL("../.lelu-runtime/test-supabase.env", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
if (!env.LELU_TEST_SUPABASE_URL.includes("ugshflwlyakipeduifkd")) throw new Error("not the test project");

async function signIn(email, password) {
  const r = await fetch(`${env.LELU_TEST_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: env.LELU_TEST_SUPABASE_PUBLISHABLE_KEY, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`sign-in failed for ${email}: ${j.msg ?? r.status}`);
  return j.access_token;
}
const admin = await signIn(env.LELU_TEST_ADMIN_EMAIL, env.LELU_TEST_ADMIN_PASSWORD);
const user = await signIn(env.LELU_TEST_USER_EMAIL, env.LELU_TEST_USER_PASSWORD);
const forged = (() => { const [h, p, s] = user.split("."); const c = JSON.parse(Buffer.from(p, "base64url")); c.app_metadata = { ...c.app_metadata, lelu_role: "admin" }; return `${h}.${Buffer.from(JSON.stringify(c)).toString("base64url")}.${s}`; })();

const results = [];
async function expect(name, path, token, want, init = {}) {
  const res = await fetch(BASE + path, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
  const body = await res.text();
  const ok = Array.isArray(want) ? want.includes(res.status) : want(res.status, body);
  results.push({ name, status: res.status, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${res.status} ${name}`);
  return { status: res.status, body };
}
const post = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

await expect("integration status — anonymous", "/api/integration/status", null, [401]);
await expect("integration scan — anonymous (Phase 0 finding)", "/api/integration/scan", null, [401], post({ target: "plugins" }));
await expect("integration scan — invalid token", "/api/integration/scan", "not.a.token", [401], post({ target: "plugins" }));
await expect("integration scan — forged admin token", "/api/integration/scan", forged, [401], post({ target: "plugins" }));
await expect("integration scan — standard user", "/api/integration/scan", user, [403], post({ target: "plugins" }));
await expect("integration policy — standard user", "/api/integration/policy", user, [403], post({}));
const st = await expect("integration status — standard user", "/api/integration/status", user, [200]);
const stBody = JSON.parse(st.body);
results.push({ name: "status hides the workspace path from a standard user", ok: stBody.workspaceRoot === undefined, status: 0 });
console.log(`${stBody.workspaceRoot === undefined ? "PASS" : "FAIL"} status hides the workspace path from a standard user`);
await expect("integration scan — administrator", "/api/integration/scan", admin, (s) => s !== 401 && s !== 403, post({ target: "plugins", scanners: [] }));
await expect("browse — anonymous", "/api/browse?url=https://example.com/", null, [401]);
await expect("browse — internal target (cloud metadata), signed in", `/api/browse?url=${encodeURIComponent("http://169.254.169.254/latest/meta-data/")}`, user, [403]);
await expect("browse — localhost target, signed in", `/api/browse?url=${encodeURIComponent("http://127.0.0.1:4190/api/integration/status")}`, user, [403]);
await expect("browse — public page, signed in", "/api/browse?url=https://example.com/", user, (s) => s === 200 || s === 502 || s === 504);
await expect("knowledge relay — anonymous", "/api/knowledge/relay?provider=news&path=/v2/everything", null, [401]);
await expect("knowledge providers report — public booleans", "/api/knowledge/providers", null, [200]);
await expect("GitHub Models relay — anonymous", "/api/ai/chat/completions", null, [401], post({}));
await expect("autonomy — anonymous", "/api/engineer/autonomy", null, [401], post({ action: "get" }));
const auto = await expect("autonomy — standard user reads the server level", "/api/engineer/autonomy", user, [200, 503], post({ action: "get" }));
try { const a = JSON.parse(auto.body); const ok = a.applyLevel === 5; results.push({ name: "server reports applyLevel 5", ok, status: 0 }); console.log(`${ok ? "PASS" : "FAIL"} server reports applyLevel ${a.applyLevel}`); } catch { /* reported above */ }

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ server: BASE, checks: results.length, failed: failed.length }));
process.exit(failed.length ? 1 : 0);
