/**
 * LÉLU PROVIDER CREDENTIAL DIAGNOSTIC
 *
 * Answers, for the environment this actually runs in:
 *
 *   1. which credential variables LÉLU's code really expects
 *   2. which are PRESENT / MISSING in this process
 *   3. which are visible to the SERVER-side runtime that reads them
 *   4. which providers actually AUTHENTICATE against their real API
 *   5. what the fallback order is
 *
 * It never prints a value, a prefix, or a length — only PRESENT or
 * MISSING, and the upstream's own verdict on the credential.
 *
 * "Key present" is not the same as "key works": the existing
 * `lelu-doctor` reports presence, and a present-but-rejected key looks
 * identical to a good one there. This performs a real minimal request
 * per provider so an invalid key is reported as invalid.
 *
 * Usage:
 *   bun run dev &                                   # so the relay is up
 *   bun run scripts/verify-provider-credentials.ts [baseUrl]
 *
 * Without a running server it still reports 1 and 2, and says plainly
 * that 3-4 could not be checked rather than guessing.
 */

const BASE = process.argv[2] ?? "http://127.0.0.1:5173";

/**
 * The chat providers, in the registry's real priority order, with the
 * variable names the code actually reads, and the SAME default model
 * each provider class uses (mirrored deliberately — a diagnostic that
 * tests a different model than production reports a different reality). Sourced from
 * plugins/aiProxyApi.ts (server) and each provider's initialize().
 * No name here is invented — every one already exists in the codebase.
 */
const CHAT_PROVIDERS: Array<{
  id: string;
  label: string;
  priority: number;
  /** Accepted names, most-correct first. */
  vars: string[];
  path: string;
  body: (model: string) => unknown;
  model: string;
}> = [
  {
    id: "anthropic",
    label: "Anthropic (Claude)",
    priority: 1,
    vars: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY", "VITE_ANTHROPIC_API_KEY"],
    path: "/v1/messages",
    model: "claude-opus-5",
    body: (model) => ({ model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }),
  },
  {
    id: "groq",
    label: "Groq",
    priority: 2,
    vars: ["GROQ_API_KEY", "VITE_GROQ_API_KEY"],
    path: "/openai/v1/chat/completions",
    model: "openai/gpt-oss-120b",
    body: (model) => ({ model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }),
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    priority: 3,
    vars: ["OPENROUTER_API_KEY", "VITE_OPENROUTER_API_KEY"],
    path: "/api/v1/chat/completions",
    model: "openrouter/free",
    body: (model) => ({ model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }),
  },
  {
    id: "cerebras",
    label: "Cerebras",
    priority: 4,
    vars: ["CEREBRAS_API_KEY", "VITE_CEREBRAS_API_KEY"],
    path: "/v1/chat/completions",
    // Mirrors CerebrasProvider's default. Keep in sync — testing a model
    // the provider does not use makes this diagnostic lie.
    model: "gpt-oss-120b",
    body: (model) => ({ model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }),
  },
  {
    id: "mistral",
    label: "Mistral",
    priority: 5,
    vars: ["MISTRAL_API_KEY", "VITE_MISTRAL_API_KEY"],
    path: "/v1/chat/completions",
    model: "mistral-large-latest",
    body: (model) => ({ model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }),
  },
  {
    id: "fireworks",
    label: "Fireworks",
    priority: 6,
    vars: ["FIREWORKS_API_KEY", "VITE_FIREWORKS_API_KEY"],
    path: "/inference/v1/chat/completions",
    model: "accounts/fireworks/models/llama-v3p1-70b-instruct",
    body: (model) => ({ model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }),
  },
  {
    id: "githubmodels",
    label: "GitHub Models",
    priority: 7,
    vars: ["GITHUB_MODELS_TOKEN", "VITE_GITHUB_TOKEN"],
    path: "/inference/chat/completions",
    model: "openai/gpt-4o-mini",
    body: (model) => ({ model, max_tokens: 16, messages: [{ role: "user", content: "ping" }] }),
  },
];

/** Knowledge providers reached through /api/knowledge/relay. */
const KNOWLEDGE_PROVIDERS = [
  { id: "news", label: "NewsAPI", vars: ["NEWS_API_KEY", "VITE_NEWS_API_KEY"] },
  { id: "youtube", label: "YouTube Data", vars: ["YOUTUBE_API_KEY", "VITE_YOUTUBE_API_KEY"] },
];

/** Server-only, never client. */
const SERVER_ONLY = [
  { label: "AISStream (Earth vessels)", vars: ["AISSTREAM_API_KEY"] },
  { label: "Instagram Graph", vars: ["INSTAGRAM_ACCESS_TOKEN"] },
  { label: "Engineering API token (optional)", vars: ["LELU_ENGINEER_TOKEN"] },
];

function presentVar(names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim().length > 0) return name;
  }
  return null;
}

function row(label: string, state: string, note = ""): void {
  console.log(`  ${label.padEnd(30)} ${state.padEnd(22)} ${note}`);
}

/** Classify an upstream reply without ever echoing credential material. */
function classify(status: number, body: string): { verdict: string; reason: string } {
  const lower = body.toLowerCase();
  if (status >= 200 && status < 300) {
    return { verdict: "AUTHENTICATED", reason: "real completion returned" };
  }
  if (status === 401 || status === 403 || lower.includes("invalid api key") || lower.includes("authentication")) {
    return { verdict: "AUTH FAILED", reason: "the upstream rejected the credential" };
  }
  if (
    status === 402 ||
    status === 412 ||
    lower.includes("suspended") ||
    lower.includes("past invoices") ||
    lower.includes("spending limit") ||
    lower.includes("insufficient") ||
    lower.includes("quota")
  ) {
    // Distinct from a bad key AND from a bad model: the credential is
    // valid and the account is the problem. Reporting this as "model
    // unavailable" sent me down the wrong path once already.
    return { verdict: "ACCOUNT BLOCKED", reason: "credential valid; account suspended / billing or quota problem" };
  }
  if (status === 404 || lower.includes("model_not_found") || lower.includes("does not exist") || lower.includes("not found")) {
    // The credential passed auth; the configured MODEL is the problem.
    return { verdict: "AUTH OK / MODEL BAD", reason: "credential accepted, configured model unavailable on this account" };
  }
  if (status === 429 || lower.includes("rate")) {
    return { verdict: "AUTH OK / RATE LIMITED", reason: "credential accepted, rate limited" };
  }
  if (lower.includes("brownout") || lower.includes("retirement")) {
    return { verdict: "UPSTREAM RETIRED", reason: "the service itself is unavailable" };
  }
  if (status === 503 && lower.includes("no server-side credential")) {
    return { verdict: "NOT CONFIGURED", reason: "the server holds no credential for this provider" };
  }
  return { verdict: `HTTP ${status}`, reason: body.slice(0, 120).replace(/\s+/g, " ") };
}

async function main(): Promise<void> {
  console.log("LÉLU PROVIDER CREDENTIAL DIAGNOSTIC");
  console.log("===================================\n");

  console.log("ENVIRONMENT");
  console.log("-----------");
  const isCodespace = Boolean(process.env.CODESPACES || process.env.CODESPACE_NAME);
  const isClaudeRemote = Boolean(process.env.CLAUDE_CODE_REMOTE);
  row(
    "runtime",
    isCodespace ? "GitHub Codespace" : isClaudeRemote ? "Claude Code remote" : "local / other",
    isCodespace ? (process.env.CODESPACE_NAME ?? "") : "",
  );
  console.log();

  console.log("2. CHAT PROVIDER CREDENTIALS IN THIS PROCESS (name only, never a value)");
  console.log("----------------------------------------------------------------------");
  for (const provider of CHAT_PROVIDERS) {
    const found = presentVar(provider.vars);
    row(
      `p${provider.priority} ${provider.label}`,
      found ? "PRESENT" : "MISSING",
      found ? `via ${found}` : `set one of: ${provider.vars.join(" | ")}`,
    );
  }
  console.log();

  console.log("   KNOWLEDGE + SERVER-ONLY");
  for (const provider of [...KNOWLEDGE_PROVIDERS, ...SERVER_ONLY]) {
    const found = presentVar(provider.vars);
    row(`   ${provider.label}`, found ? "PRESENT" : "MISSING", found ? `via ${found}` : provider.vars.join(" | "));
  }
  console.log();

  // ---- 3. What the SERVER-side runtime can actually see ----------------
  console.log("3. WHAT LÉLU'S SERVER RUNTIME SEES (GET /api/ai/providers)");
  console.log("---------------------------------------------------------");
  let serverSees: Record<string, boolean> = {};
  let serverUp = false;
  try {
    const response = await fetch(`${BASE}/api/ai/providers`, { signal: AbortSignal.timeout(8000) });
    const payload = (await response.json()) as {
      providers?: Record<string, { configured?: boolean }>;
      knowledge?: Record<string, { configured?: boolean }>;
    };
    serverUp = true;
    for (const [id, entry] of Object.entries({ ...(payload.providers ?? {}), ...(payload.knowledge ?? {}) })) {
      serverSees[id] = entry?.configured === true;
    }
    for (const provider of CHAT_PROVIDERS) {
      row(`p${provider.priority} ${provider.label}`, serverSees[provider.id] ? "VISIBLE" : "NOT VISIBLE");
    }
  } catch {
    console.log(`  server not reachable at ${BASE} — start it with \`bun run dev\` and re-run.`);
    console.log("  (sections 3 and 4 need the running runtime; nothing is being guessed here.)");
  }
  console.log();

  if (!serverUp) {
    console.log("Stopping: live authentication cannot be checked without the runtime.");
    process.exit(1);
  }

  // ---- 4. Real authentication --------------------------------------------
  console.log("4. LIVE AUTHENTICATION (one minimal real request per configured provider)");
  console.log("------------------------------------------------------------------------");
  const results: Array<{ label: string; priority: number; verdict: string; reason: string }> = [];
  for (const provider of CHAT_PROVIDERS) {
    if (!serverSees[provider.id]) {
      results.push({
        label: provider.label,
        priority: provider.priority,
        verdict: "NOT CONFIGURED",
        reason: "no credential reachable by the runtime",
      });
      row(`p${provider.priority} ${provider.label}`, "NOT CONFIGURED", "skipped — nothing to authenticate");
      continue;
    }
    try {
      const response = await fetch(`${BASE}/api/ai/relay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.id,
          path: provider.path,
          body: provider.body(provider.model),
        }),
        signal: AbortSignal.timeout(45000),
      });
      const text = await response.text();
      const { verdict, reason } = classify(response.status, text);
      results.push({ label: provider.label, priority: provider.priority, verdict, reason });
      row(`p${provider.priority} ${provider.label}`, verdict, reason);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      results.push({ label: provider.label, priority: provider.priority, verdict: "NETWORK ERROR", reason });
      row(`p${provider.priority} ${provider.label}`, "NETWORK ERROR", reason);
    }
  }
  console.log();

  // ---- 5. Fallback consequence -------------------------------------------
  console.log("5. WHAT THIS MEANS FOR FALLBACK ROUTING");
  console.log("---------------------------------------");
  const usable = results.filter((entry) => entry.verdict === "AUTHENTICATED");
  const ordered = [...results].sort((a, b) => a.priority - b.priority);
  console.log(`  chain order: ${ordered.map((entry) => entry.label).join(" → ")}`);
  if (usable.length === 0) {
    console.log("  NO provider authenticates — LÉLU will answer from her offline brain only.");
  } else {
    console.log(`  first provider that actually answers: ${usable.sort((a, b) => a.priority - b.priority)[0].label}`);
    console.log(`  usable providers: ${usable.map((entry) => entry.label).join(", ")}`);
  }
  const rejected = results.filter((entry) => entry.verdict === "AUTH FAILED");
  if (rejected.length > 0) {
    console.log(`  credentials REJECTED by the upstream: ${rejected.map((entry) => entry.label).join(", ")}`);
  }
  console.log();

  // ---- 6. Injection-path summary ------------------------------------------
  //
  // Sections 1-5 answer "does the credential work". This one answers the
  // separate question: WHERE does it stop being available. The two are
  // routinely confused — a provider can hold a perfectly good key and
  // still be unreachable because nothing routes to it.
  //
  // RUNTIME  — which side actually holds the credential for this
  //            provider. SERVER means the relay attaches it and it never
  //            enters the bundle; CLIENT would mean a key is reachable
  //            from the browser, which is a finding, not a success.
  // ROUTING  — whether the relay will actually carry a call for this
  //            provider, i.e. whether /api/ai/providers reports it
  //            configured. DISCONNECTED means the provider client has
  //            nowhere to send a request even if a key exists elsewhere.
  console.log("6. INJECTION PATH — where the credential stops");
  console.log("-----------------------------------------------");
  console.log("  configuration → runtime env → relay → provider registry → AIRuntime → cognition\n");

  let serverStatus: Record<string, { configured?: boolean }> = {};
  try {
    const response = await fetch(`${BASE}/api/ai/providers`, { signal: AbortSignal.timeout(8000) });
    const payload = (await response.json()) as { providers?: Record<string, { configured?: boolean }> };
    serverStatus = payload.providers ?? {};
  } catch {
    // No server reachable: every provider is DISCONNECTED, which is
    // exactly what the block below should then report.
  }

  for (const provider of CHAT_PROVIDERS) {
    const varName = presentVar(provider.vars);
    const authed = results.find((entry) => entry.label === provider.label);
    const routed = serverStatus[provider.id]?.configured === true;
    // A VITE_-prefixed name is readable by the browser in a dev server,
    // so the credential is not purely server-held. Naming it CLIENT is
    // the honest reading even though the relay also works.
    const runtime = varName === null ? "—" : varName.startsWith("VITE_") ? "CLIENT-READABLE" : "SERVER";

    console.log(`  PROVIDER:   ${provider.label}`);
    console.log(`  CREDENTIAL: ${varName ? "PRESENT" : "ABSENT"}${varName ? ` (via ${varName})` : ""}`);
    console.log(`  AUTH TEST:  ${authed?.verdict === "AUTHENTICATED" ? "PASS" : "FAIL"}${authed && authed.verdict !== "AUTHENTICATED" ? ` (${authed.verdict})` : ""}`);
    console.log(`  RUNTIME:    ${runtime}`);
    console.log(`  ROUTING:    ${routed ? "CONNECTED" : "DISCONNECTED"}`);
    console.log();
  }

  const clientReadable = CHAT_PROVIDERS.filter((provider) => {
    const name = presentVar(provider.vars);
    return name !== null && name.startsWith("VITE_");
  });
  if (clientReadable.length > 0) {
    console.log(
      `  NOTE: ${clientReadable.length} credential(s) are stored under a VITE_ name. The relay reads them\n` +
        "        server-side, so routing works — but Vite's DEV server also exposes every VITE_ variable\n" +
        "        to the browser. Renaming them to the unprefixed server-side name (see ENV_VARS.md)\n" +
        "        closes that without changing any provider code.",
    );
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("Diagnostic crashed:", error);
  process.exit(1);
});
