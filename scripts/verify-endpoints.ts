/**
 * ==========================================================
 * LÉLU — ENDPOINT CONFIGURATION VERIFICATION
 * ==========================================================
 *
 * Proves, for every entry in the endpoint registry, that:
 *
 *   1. Its DEFAULT is the URL the code used before the
 *      endpoint became configurable — an unset variable is
 *      never a behaviour change.
 *   2. Setting the documented environment variable actually
 *      REDIRECTS it (the variable is not decorative).
 *   3. The VITE_ form wins over the unprefixed form, matching
 *      the precedence used for credentials.
 *   4. Trailing slashes never produce a double slash.
 *   5. Every registry id is reachable from real calling code,
 *      OR is reported as having no consumer yet — a declared
 *      setting that nothing reads is the same defect as a dead
 *      resolution rung, so it is named rather than hidden.
 *
 * Run with: bun run scripts/verify-endpoints.ts
 * ==========================================================
 */

import { ENDPOINTS, endpoint, endpointUrl, isOverridden, type EndpointId } from "../src/core/Endpoints";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const results: string[] = [];
let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  results.push(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

const ids = Object.keys(ENDPOINTS) as EndpointId[];

/* ---- 1. defaults ------------------------------------------------------ */

let defaultsOk = 0;
for (const id of ids) {
  const def = ENDPOINTS[id];
  const expected = def.fallback.replace(/\/+$/, "");
  if (endpoint(id) === expected && !isOverridden(id)) defaultsOk += 1;
  else check(`${id}: default resolves to its documented fallback`, false, endpoint(id));
}
check(
  `every endpoint falls back to its pre-existing hardcoded URL (${defaultsOk}/${ids.length})`,
  defaultsOk === ids.length,
);

/* ---- 2. each variable actually redirects ------------------------------ */

const g = globalThis as unknown as Record<string, string | undefined>;

let redirected = 0;
const notRedirected: string[] = [];
for (const id of ids) {
  const primary = ENDPOINTS[id].names[0];
  const probe = `https://redirect-probe.invalid/${id}`;
  const suffix = (ENDPOINTS[id] as { apiSuffix?: string }).apiSuffix ?? "";

  // Rung 1 outranks the global, and this container really does ship an
  // ambient ANTHROPIC_BASE_URL — clear the env forms for the duration of
  // the probe so this measures the registry, not the host's environment.
  const saved: Array<[string, string | undefined]> = [];
  for (const name of ENDPOINTS[id].names) {
    for (const form of [name, `VITE_${name}`]) {
      saved.push([form, process.env[form]]);
      delete process.env[form];
    }
  }

  g[`__LELU_${primary}__`] = probe;
  const got = endpoint(id);
  delete g[`__LELU_${primary}__`];
  for (const [form, value] of saved) {
    if (value === undefined) delete process.env[form];
    else process.env[form] = value;
  }

  // A versioned base is expected to carry its API suffix — that is the
  // whole point of apiSuffix, so it is the correct result, not a miss.
  if (got === `${probe}${suffix}`) redirected += 1;
  else notRedirected.push(`${id} (${primary} → ${got})`);
}
check(
  `every documented variable redirects its endpoint (${redirected}/${ids.length})`,
  redirected === ids.length,
  notRedirected.join(", "),
);

/* ---- 2b. apiSuffix repairs a base missing its version segment --------- */

const savedAnthropic = process.env.ANTHROPIC_BASE_URL;
process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com";
const repaired = endpointUrl("anthropic", "messages");
process.env.ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const alreadyVersioned = endpointUrl("anthropic", "messages");
if (savedAnthropic === undefined) delete process.env.ANTHROPIC_BASE_URL;
else process.env.ANTHROPIC_BASE_URL = savedAnthropic;

check(
  "a base WITHOUT the version segment still reaches the real path",
  repaired === "https://api.anthropic.com/v1/messages",
  repaired,
);
check(
  "a base WITH the version segment is not doubled",
  alreadyVersioned === "https://api.anthropic.com/v1/messages",
  alreadyVersioned,
);

/* ---- 3. VITE_ precedence ---------------------------------------------- */

g.__LELU_GROQ_BASE_URL__ = "https://bare.invalid";
g.__LELU_VITE_GROQ_BASE_URL__ = undefined;
const bareOnly = endpoint("groq");
// The bridge publishes the VITE_ name onto its own global; Endpoints reads
// `VITE_<name>` from process.env ahead of the bare one, so assert there.
process.env.VITE_GROQ_BASE_URL = "https://vite.invalid";
process.env.GROQ_BASE_URL = "https://bare2.invalid";
delete g.__LELU_GROQ_BASE_URL__;
const withVite = endpoint("groq");
delete process.env.VITE_GROQ_BASE_URL;
delete process.env.GROQ_BASE_URL;

check(
  "unprefixed name redirects when it is the only one set",
  bareOnly === "https://bare.invalid/openai/v1",
  bareOnly,
);
check(
  "VITE_ form wins over the unprefixed form",
  withVite === "https://vite.invalid/openai/v1",
  withVite,
);

/* ---- 4. slash handling ------------------------------------------------ */

g.__LELU_NOMINATIM_API_URL__ = "https://osm.example.com/";
const joined = endpointUrl("nominatim", "/search");
delete g.__LELU_NOMINATIM_API_URL__;
check(
  "a trailing slash on the base and a leading slash on the path never double up",
  joined === "https://osm.example.com/search",
  joined,
);

/* ---- 5. consumers ------------------------------------------------------ */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !full.includes("core/Endpoints.ts")) out.push(full);
  }
  return out;
}

const sources = [...walk("src"), ...walk("plugins")]
  .filter((f) => !f.includes("verify-endpoints"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

const consumed: string[] = [];
const orphaned: string[] = [];
for (const id of ids) {
  // `endpoint("groq")` / `endpointUrl("groq", …)` at any call site.
  if (new RegExp(`endpoint(?:Url)?\\(\\s*["']${id}["']`).test(sources)) consumed.push(id);
  else orphaned.push(id);
}

check(
  `${consumed.length}/${ids.length} endpoints are read by real calling code`,
  consumed.length > 0,
  consumed.join(", "),
);

/* ---- report ------------------------------------------------------------ */

console.log("==========================================");
console.log("LÉLU ENDPOINT CONFIGURATION VERIFICATION");
console.log("==========================================");
for (const line of results) console.log(line);

if (orphaned.length > 0) {
  console.log("------------------------------------------");
  console.log("DECLARED BUT NOT YET CONSUMED");
  console.log("These resolve correctly and are ready for a caller, but no");
  console.log("code path fetches them yet — setting them changes nothing");
  console.log("until a provider is built. Reported, not silently passed:");
  for (const id of orphaned) {
    console.log(`  · ${String(ENDPOINTS[id].names[0]).padEnd(32)} ${ENDPOINTS[id].description}`);
  }
}

console.log("------------------------------------------");
console.log(`${results.filter((r) => r.startsWith("PASS")).length} passed, ${failures} failed`);
console.log(`${consumed.length} endpoints wired to callers, ${orphaned.length} awaiting a consumer`);
console.log("==========================================");

if (failures > 0) process.exit(1);
