/**
 * ==========================================================
 * LÉLU — SECRET WIRING AUDIT
 * ==========================================================
 *
 * Answers three questions that are easy to confuse:
 *
 *   1. DECLARED — which credential names does LÉLU know about?
 *   2. WIRED    — is each one actually read by code that would
 *                 use it, or is it a name nothing consumes?
 *   3. PRESENT  — which are set in THIS environment?
 *
 * A name can be declared and unwired (dead config), wired and
 * absent (feature simply off), or present and unread (a secret
 * you configured that LÉLU never looks at — the failure this
 * audit exists to catch).
 *
 * NEVER PRINTS A VALUE. Presence is reported as a length.
 *
 * Run with: bun run scripts/verify-secrets.ts
 * ==========================================================
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { BRIDGED_KEYS } from "../plugins/runtimeKeyBridge.ts";

interface Secret {
  /** Canonical unprefixed name an operator sets. */
  name: string;
  /** What it enables. */
  purpose: string;
  /** Other accepted spellings. */
  aliases?: string[];
}

/**
 * Every credential LÉLU can consume. Base URLs live in the endpoint
 * registry and are audited by verify-endpoints.ts instead — this file is
 * only about secrets.
 */
const SECRETS: Secret[] = [
  { name: "GROQ_API_KEY", purpose: "Groq chat (priority 1) + voice transcription" },
  { name: "OPENROUTER_API_KEY", purpose: "OpenRouter chat (priority 2)", aliases: ["OPEN_ROUTER_API_KEY"] },
  { name: "CEREBRAS_API_KEY", purpose: "Cerebras chat (priority 3)" },
  { name: "MISTRAL_API_KEY", purpose: "Mistral chat (priority 4)" },
  { name: "FIREWORKS_API_KEY", purpose: "Fireworks chat (priority 5)" },
  { name: "VITE_GITHUB_TOKEN", purpose: "GitHub Models chat (priority 6) + repo tool — VITE_ form only" },
  { name: "ANTHROPIC_API_KEY", purpose: "Anthropic chat (priority 7)", aliases: ["CLAUDE_API_KEY"] },
  { name: "GEMINI_API_KEY", purpose: "Gemini chat (priority 8)", aliases: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY"] },

  { name: "NEWS_API_KEY", purpose: "NewsAPI.org" },
  { name: "GNEWS_API_KEY", purpose: "GNews" },
  { name: "GUARDIAN_API_KEY", purpose: "The Guardian" },
  { name: "NEWSDATA_API_KEY", purpose: "NewsData.io" },
  { name: "YOUTUBE_API_KEY", purpose: "YouTube Data API" },
  { name: "NASA_API_KEY", purpose: "NASA science family (falls back to DEMO_KEY)" },
  { name: "GEOAPIFY_API_KEY", purpose: "Geoapify geocoding" },
  { name: "MESHY_API_KEY", purpose: "Avatar image-to-3D" },
  { name: "VITE_FIRMS_API_KEY", purpose: "NASA FIRMS hotspots (server-side)" },

  { name: "AISSTREAM_API_KEY", purpose: "AIS vessel bridge (server-only, never bundled)" },
  { name: "INSTAGRAM_ACCESS_TOKEN", purpose: "Instagram publishing (server-only)" },
  { name: "NEKO_PASSWORD", purpose: "Neko browser join password (server-only)" },
  { name: "NEXT_PUBLIC_SUPABASE_URL", purpose: "Supabase persistence", aliases: ["SUPABASE_URL", "VITE_SUPABASE_URL"] },
];

/* ---- collect sources ---- */

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const sourceFiles = [...walk("src"), ...walk("plugins")].filter(
  (f) => !f.includes("verify-secrets") && !f.includes("runtimeKeyBridge"),
);
const sources = sourceFiles.map((f) => readFileSync(f, "utf8")).join("\n");

const bridged = new Set<string>();
for (const key of BRIDGED_KEYS) {
  for (const alias of key.aliases) bridged.add(alias);
  bridged.add(key.viteName);
}

function isSet(name: string): number {
  const value = process.env[name] ?? process.env[`VITE_${name}`];
  return typeof value === "string" ? value.trim().length : 0;
}

/* ---- audit ---- */

const rows: Array<{
  name: string;
  wired: boolean;
  bridged: boolean;
  presentAs: string | null;
  length: number;
  purpose: string;
}> = [];

for (const secret of SECRETS) {
  const names = [secret.name, ...(secret.aliases ?? [])];
  const bare = secret.name.replace(/^VITE_/, "");

  // Read by real code under any accepted spelling?
  const wired = names.some((n) => {
    const b = n.replace(/^VITE_/, "");
    return (
      new RegExp(`["'\`]${n}["'\`]`).test(sources) ||
      new RegExp(`["'\`]${b}["'\`]`).test(sources) ||
      // Environment.ts reads these under the documented VITE_ spelling.
      new RegExp(`["'\`]VITE_${b}["'\`]`).test(sources) ||
      new RegExp(`\\b__LELU_${b}__\\b`).test(sources) ||
      new RegExp(`\\.${n}\\b`).test(sources)
    );
  });

  const presentName = names.find((n) => isSet(n) > 0) ?? null;
  rows.push({
    name: secret.name,
    wired,
    bridged: names.some((n) => bridged.has(n) || bridged.has(`VITE_${n.replace(/^VITE_/, "")}`)),
    presentAs: presentName,
    length: presentName ? isSet(presentName) : 0,
    purpose: secret.purpose,
  });
}

/* ---- report ---- */

const pad = (s: string, n: number) => s.padEnd(n);
console.log("==========================================");
console.log("LÉLU SECRET WIRING AUDIT");
console.log("==========================================");
console.log(`${pad("SECRET", 28)}${pad("WIRED", 7)}${pad("BRIDGED", 9)}PRESENT HERE`);
console.log("-".repeat(72));

for (const row of rows) {
  const present = row.presentAs ? `yes (${row.presentAs}, ${row.length} chars)` : "—";
  console.log(
    `${pad(row.name, 28)}${pad(row.wired ? "yes" : "NO", 7)}${pad(row.bridged ? "yes" : "n/a", 9)}${present}`,
  );
}

const unwired = rows.filter((r) => !r.wired);
const presentUnwired = rows.filter((r) => r.presentAs && !r.wired);
const configured = rows.filter((r) => r.presentAs);

console.log("-".repeat(72));
console.log(`${rows.length} secrets declared · ${rows.length - unwired.length} wired to code · ${configured.length} present in this environment`);

if (unwired.length > 0) {
  console.log("\nDECLARED BUT NOT READ BY ANY CODE:");
  for (const row of unwired) console.log(`  · ${row.name} — ${row.purpose}`);
}

if (presentUnwired.length > 0) {
  console.log("\n!! SET IN THE ENVIRONMENT BUT NEVER READ — configured for nothing:");
  for (const row of presentUnwired) console.log(`  · ${row.name}`);
}

if (configured.length === 0) {
  console.log("\nNo LÉLU credentials are present in this environment.");
  console.log("Codespaces secrets do not propagate to other containers, so this");
  console.log("proves the code path, not any particular key. Run this script");
  console.log("where the keys actually live to audit them.");
}

console.log("==========================================");
process.exit(presentUnwired.length > 0 || unwired.length > 0 ? 1 : 0);
