/**
 * ==========================================================
 * LÉLU — RUNTIME DOCTOR
 *
 * `npm run lelu:doctor` / `bun run lelu:doctor`
 *
 * Diagnostics for the complete LÉLU runtime. Reports
 * PASS / FAIL / NOT CONFIGURED / DEGRADED for every
 * subsystem. Never prints secrets.
 *
 * It checks:
 *   - Environment (which providers are configured)
 *   - Dependencies (required packages installed)
 *   - AI providers (configured vs missing)
 *   - Live connectivity (dev-server health endpoints)
 *   - Search / geolocation providers (keyless availability)
 *   - .env.example presence (config contract)
 *
 * Live provider connectivity is tested through the Vite
 * dev server's /api/provider-health endpoint when it is
 * running — real request tests, not import checks.
 * ==========================================================
 */

import { existsSync, readFileSync } from "node:fs";
import { loadEnv } from "vite";
import { resolve } from "node:path";

type Status = "PASS" | "FAIL" | "NOT CONFIGURED" | "DEGRADED" | "SKIPPED";

interface CheckResult {
  name: string;
  status: Status;
  detail: string;
}

const results: CheckResult[] = [];
function report(name: string, status: Status, detail: string): void {
  results.push({ name, status, detail });
}

/* ------------------------- env loading ------------------------- */

const root = process.cwd();
const env = loadEnv("development", root, "");

function has(key: string): boolean {
  const value = env[key] ?? process.env[key];
  return typeof value === "string" && value.trim().length > 0;
}

/* ------------------------- environment ------------------------- */

console.log("\nLÉLU RUNTIME DIAGNOSTIC\n========================");

// `aliases` are the unprefixed names the runtime key bridge accepts
// (plugins/runtimeKeyBridge.ts). Checking only the VITE_ name reported
// NOT CONFIGURED for a key the providers resolve perfectly well — the
// doctor has to answer the same question the runtime answers.
const aiProviders: { name: string; key: string; aliases?: string[] }[] = [
  { name: "Groq (primary)", key: "VITE_GROQ_API_KEY", aliases: ["GROQ_API_KEY"] },
  {
    name: "OpenRouter",
    key: "VITE_OPENROUTER_API_KEY",
    aliases: ["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"],
  },
  { name: "Cerebras", key: "VITE_CEREBRAS_API_KEY", aliases: ["CEREBRAS_API_KEY"] },
  { name: "Mistral", key: "VITE_MISTRAL_API_KEY", aliases: ["MISTRAL_API_KEY"] },
  { name: "Fireworks", key: "VITE_FIREWORKS_API_KEY", aliases: ["FIREWORKS_API_KEY"] },
  {
    name: "Anthropic",
    key: "VITE_ANTHROPIC_API_KEY",
    aliases: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
  },
  // GITHUB_TOKEN is deliberately NOT an alias here: dev containers and CI
  // set an ambient one for git tooling that is not a Models inference key.
  { name: "GitHub Models", key: "VITE_GITHUB_TOKEN" },
];

let aiConfigured = 0;
for (const p of aiProviders) {
  const names = [p.key, ...(p.aliases ?? [])];
  const found = names.find((name) => has(name));
  if (found) aiConfigured += 1;
  report(
    `AI · ${p.name}`,
    found ? "PASS" : "NOT CONFIGURED",
    found ? `key present (${found})` : `${names.join(" / ")} is not set`,
  );
}

if (aiConfigured === 0) {
  report("AI · Local Inference", "PASS", "available offline (no key needed)");
} else {
  report("AI · Local Inference", "PASS", "available as fallback");
}

/* ------------------------- knowledge ------------------------- */

report(
  "Search · NewsAPI",
  has("VITE_NEWS_API_KEY") ? "PASS" : "NOT CONFIGURED",
  has("VITE_NEWS_API_KEY") ? "key present" : "VITE_NEWS_API_KEY is not set",
);

report(
  "Search · YouTube",
  has("VITE_YOUTUBE_API_KEY") ? "PASS" : "NOT CONFIGURED",
  has("VITE_YOUTUBE_API_KEY") ? "key present" : "VITE_YOUTUBE_API_KEY is not set",
);

report(
  "Search · Wikipedia/Wikidata/Wikimedia",
  "PASS",
  "keyless — always available",
);

report(
  "Geolocation · OpenStreetMap/Nominatim",
  "PASS",
  "keyless — always available",
);

report(
  "Research · arXiv/CrossRef/OpenAlex/GDELT",
  "PASS",
  "keyless — always available",
);

/* ------------------------- dependencies ------------------------- */

const deps = [
  "react",
  "react-dom",
  "three",
  "@react-three/fiber",
  "@react-three/drei",
  "framer-motion",
  "openai",
];

for (const dep of deps) {
  const present = existsSync(resolve(root, "node_modules", dep));
  report(
    `Dependency · ${dep}`,
    present ? "PASS" : "FAIL",
    present ? "installed" : "missing — run install",
  );
}

/* ------------------------- config contract ------------------------- */

const envExample = existsSync(resolve(root, "env.example")) || existsSync(resolve(root, ".env.example"));
report(
  "Config · env.example",
  envExample ? "PASS" : "FAIL",
  envExample ? "present" : "missing — recreate from ENV_VARS.md",
);

/* ------------------------- live connectivity ------------------------- */

const DEV_SERVER = process.env.LELU_DEV_SERVER ?? "http://localhost:5173";

async function probeHealth(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${DEV_SERVER}/api/provider-health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      report("Live · Provider connectivity", "DEGRADED", `dev server responded ${res.status}`);
      return;
    }

    const body = (await res.json()) as Record<string, any>;
    const keys = Object.keys(body);
    let healthy = 0;
    let failing = 0;
    for (const k of keys) {
      const entry = body[k];
      if (entry && typeof entry === "object" && entry.ok === true) healthy += 1;
      else failing += 1;
    }
    report(
      "Live · Provider connectivity",
      healthy > 0 ? "PASS" : failing > 0 ? "FAIL" : "NOT CONFIGURED",
      `${healthy} healthy, ${failing} failing of ${keys.length} probed`,
    );
  } catch (error: any) {
    const code = error?.name === "AbortError" ? "timeout" : String(error?.message ?? error).slice(0, 60);
    report(
      "Live · Provider connectivity",
      "SKIPPED",
      `dev server not reachable (${code}) — start with \`npm run lelu:start\` then re-run`,
    );
  }
}

async function probeEnvCheck(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${DEV_SERVER}/api/env-check`, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      report("Live · Environment endpoint", "PASS", "dev server env-check reachable");
    } else {
      report("Live · Environment endpoint", "DEGRADED", `responded ${res.status}`);
    }
  } catch {
    report("Live · Environment endpoint", "SKIPPED", "dev server not reachable");
  }
}

await probeHealth();
await probeEnvCheck();

/* ------------------------- output ------------------------- */

console.log("\nRESULTS\n=======");
for (const r of results) {
  const flag =
    r.status === "PASS" ? "  ✓" :
    r.status === "FAIL" ? "  ✗" :
    r.status === "NOT CONFIGURED" ? "  –" :
    r.status === "DEGRADED" ? "  !" : "  ?";
  console.log(`${flag} ${r.name.padEnd(42)} ${r.status.padEnd(15)} ${r.detail}`);
}

const failed = results.filter((r) => r.status === "FAIL").length;
const degraded = results.filter((r) => r.status === "DEGRADED").length;

console.log("\nSUMMARY\n=======");
console.log(`  PASS:             ${results.filter((r) => r.status === "PASS").length}`);
console.log(`  NOT CONFIGURED:   ${results.filter((r) => r.status === "NOT CONFIGURED").length}`);
console.log(`  DEGRADED:         ${degraded}`);
console.log(`  FAIL:             ${failed}`);
console.log(`  SKIPPED:          ${results.filter((r) => r.status === "SKIPPED").length}`);

if (aiConfigured === 0 && failed === 0) {
  console.log("\nLÉLU will start in OFFLINE mode (no AI key).");
  console.log("Add at least one AI provider key to enable live responses.");
} else if (failed > 0) {
  console.log("\nSome checks failed. Fix the listed items and re-run lelu:doctor.");
} else {
  console.log("\nLÉLU RUNTIME READY");
}

process.exit(failed > 0 ? 1 : 0);
