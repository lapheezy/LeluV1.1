/**
 * ==========================================================
 * LÉLU — CENTRALIZED ENVIRONMENT LOADER
 *
 * Single source of truth for ALL runtime configuration.
 *
 * Every feature flows through this module — no file should
 * independently parse import.meta.env or process.env.
 *
 * Design rules:
 *   - Secrets live in .env / environment — never in source.
 *   - Adding a VITE_ variable here makes the provider
 *     discoverable automatically by the runtime.
 *   - Validation distinguishes required vs optional vars.
 *   - Never returns credentials in stringified output.
 * ==========================================================
 */

// -- raw env access (Vite-injected, available in browser bundle) ----------

function rawEnv(): Record<string, string | undefined> {
  try {
    return (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
  } catch {
    return {};
  }
}

/**
 * The other three rungs a provider resolves a key through.
 *
 * `rawEnv()` alone only sees rung 1 (import.meta.env.VITE_*), so this
 * module — which declares itself the single source of truth — used to
 * report a provider MISSING while that provider was resolving a key
 * perfectly well from a later rung, and report every provider MISSING
 * in the non-Vite runtimes (server.ts / main.ts), where
 * `import.meta.env` does not exist at all. That divergence is why the
 * Providers panel and /api/env-check could disagree with the runtime.
 *
 * Order here mirrors the providers exactly, so a diagnostic answer and
 * the provider's own answer can never differ:
 *
 *   1. import.meta.env.VITE_<NAME>   (rawEnv, checked first by callers)
 *   2. globalThis.__LELU_<NAME>__
 *   3. window.__LELU_<NAME>__        (same object as 2 in a browser)
 *   4. process.env.<NAME>            (unprefixed; server runtimes only)
 */

/**
 * Names whose UNPREFIXED form must never be adopted, because the
 * platform sets them for something else entirely.
 *
 * GITHUB_TOKEN / GITHUB_CODESPACE_TOKEN are ambient git-tooling
 * credentials in dev containers, Codespaces and CI runners — not
 * GitHub Models inference keys. GitHubModelsProvider refuses them for
 * that reason, so this module must refuse them too; otherwise it would
 * report the provider "configured" while the provider itself reports
 * no key, which is precisely the divergence this rung-walk exists to
 * remove. VITE_GITHUB_TOKEN must be supplied explicitly.
 */
const NEVER_ADOPT_BARE = new Set(["VITE_GITHUB_TOKEN"]);

function fallbackRungs(viteKey: string): string | undefined {
  // VITE_GROQ_API_KEY → __LELU_GROQ_API_KEY__ ; the bare platform name
  // is the same string with the VITE_ prefix removed.
  const bare = viteKey.startsWith("VITE_") ? viteKey.slice("VITE_".length) : viteKey;
  const globalName = `__LELU_${bare}__`;

  const runtimeEnv = globalThis as unknown as Record<string, string | undefined>;
  const fromGlobal = runtimeEnv[globalName];
  if (typeof fromGlobal === "string" && fromGlobal.trim().length > 0) {
    return fromGlobal.trim();
  }

  const processEnv =
    typeof process !== "undefined"
      ? (process.env as Record<string, string | undefined> | undefined)
      : undefined;

  // The VITE_-named variable is always acceptable from process env; the
  // bare name only when it is not one of the ambient platform tokens.
  const fromProcess = NEVER_ADOPT_BARE.has(viteKey)
    ? processEnv?.[viteKey]
    : (processEnv?.[viteKey] ?? processEnv?.[bare]);
  if (typeof fromProcess === "string" && fromProcess.trim().length > 0) {
    return fromProcess.trim();
  }

  return undefined;
}

/** Resolve a documented VITE_ name across every rung a provider uses. */
function resolve(viteKey: string): string | undefined {
  const primary = rawEnv()[viteKey];
  if (typeof primary === "string" && primary.trim().length > 0) {
    return primary.trim();
  }
  return fallbackRungs(viteKey);
}

// -- typed configuration -------------------------------------------------

export interface LeluEnvironment {
  /** Whether the environment loaded without fatal errors */
  valid: boolean;
  /** Human-readable validation messages */
  warnings: string[];

  /* ---- AI chat providers (fallback priority order) ---- */
  groq: ProviderEnv;
  openrouter: ProviderEnv;
  cerebras: ProviderEnv;
  mistral: ProviderEnv;
  fireworks: ProviderEnv;
  githubModels: ProviderEnv;
  anthropic: ProviderEnv;
  localInference: ProviderEnv;

  /* ---- Knowledge / research providers ---- */
  news: ProviderEnv;
  youtube: ProviderEnv;
  github: ProviderEnv;

  /* ---- Social / publishing ---- */
  instagram: ProviderEnv;

  /* ---- Additional news sources (fallback chain) ---- */
  guardian: ProviderEnv;
  elpheruRssUrl: string;
  sapiolingoRssUrl: string;
  googleNewsRssUrl: string;
  googleNewsRssUrl2: string;
  rssFeeds: string[];
  gnews: ProviderEnv;
  newsdata: ProviderEnv;

  /* ---- Avatar true-3D reconstruction (image → GLB) ---- */
  meshy: ProviderEnv;

  /* ---- Optional persistence ---- */
  supabase: ProviderEnv;

  /* ---- VLY integrations ---- */
  vly: ProviderEnv;

  /* ---- Neko self-hosted browser (m1k1o/neko) ---- */
  nekoUrl: string;
  neko: ProviderEnv;

  /* ---- Optional model overrides ---- */
  groqModel: string;
  openrouterModel: string;
  cerebrasModel: string;
  mistralModel: string;
  fireworksModel: string;
  githubModel: string;
  anthropicModel: string;
  defaultProvider: string;
  aiProxyBaseUrl: string;
}

export interface ProviderEnv {
  /** Whether the required key is present */
  configured: boolean;
  /** Environment variable name for the API key/token */
  keyVar: string;
  /** Whether the key was found in the environment */
  hasKey: boolean;
  /** Provider priority (lower = higher priority) */
  priority: number;
  /** Whether this provider requires a key to work */
  required: boolean;
}

/** Human-readable label for diagnostics — never the key value. */
export function providerLabel(env: ProviderEnv): string {
  return env.configured ? "configured" : "MISSING";
}

// -- validation helpers --------------------------------------------------

function has(key: string): boolean {
  return resolve(key) !== undefined;
}

function opt(key: string, fallback: string): string {
  return resolve(key) ?? fallback;
}

// -- build the config ----------------------------------------------------

function build(): LeluEnvironment {
  const warnings: string[] = [];

  function providerEnv(
    keyVar: string,
    priority: number,
    required: boolean,
  ): ProviderEnv {
    const configured = has(keyVar);
    if (required && !configured) {
      warnings.push(`${keyVar} is not set — provider will be unavailable.`);
    }
    return { configured, keyVar, hasKey: configured, priority, required };
  }

  const supabaseConfigured = has("VITE_SUPABASE_URL") || has("NEXT_PUBLIC_SUPABASE_URL");

  const config: LeluEnvironment = {
    valid: true,
    warnings,

    // AI providers — priority 1-7 in fallback order
    groq:            providerEnv("VITE_GROQ_API_KEY", 1, true),
    openrouter:      providerEnv("VITE_OPENROUTER_API_KEY", 2, true),
    cerebras:        providerEnv("VITE_CEREBRAS_API_KEY", 3, true),
    mistral:         providerEnv("VITE_MISTRAL_API_KEY", 4, true),
    fireworks:       providerEnv("VITE_FIREWORKS_API_KEY", 5, true),
    githubModels:    providerEnv("VITE_GITHUB_TOKEN", 6, true),
    // Anthropic is appended at the END of the chain on purpose: the
    // existing fallback order is unchanged, so every provider that
    // resolved a key before resolves the same key in the same position.
    // Promote it with VITE_DEFAULT_PROVIDER=anthropic when wanted.
    anthropic:       providerEnv("VITE_ANTHROPIC_API_KEY", 7, true),
    localInference:  { configured: true, keyVar: "", hasKey: true, priority: 0, required: false },

    // Knowledge providers
    news:         providerEnv("VITE_NEWS_API_KEY", 1, false),
    youtube:      providerEnv("VITE_YOUTUBE_API_KEY", 1, false),
    github:       providerEnv("VITE_GITHUB_TOKEN", 1, false),

    // Social publishing (Instagram Graph API — server-only account token)
    instagram:    providerEnv("INSTAGRAM_ACCESS_TOKEN", 1, false),

    // Additional news sources — consulted in order when the primary
    // news source fails or is unconfigured.
    guardian:     providerEnv("VITE_GUARDIAN_API_KEY", 2, false),
    // Accept both the documented VITE_ names and unprefixed variants.
    elpheruRssUrl: opt("VITE_ELPHERU_RSS_URL", "") || opt("ELPHERU_RSS_URL", ""),
    sapiolingoRssUrl: opt("VITE_SAPIOLINGO_RSS_URL", "") || opt("SAPIOLINGO_RSS_URL", ""),
    googleNewsRssUrl: opt("VITE_GOOGLE_NEWS_RSS_URL", "") || opt("GOOGLE_NEWS_RSS_URL", "") || "https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en",
    googleNewsRssUrl2: opt("VITE_GOOGLE_NEWS_RSS_URL_2", "") || opt("GOOGLE_NEWS_RSS_URL_2", ""),
    rssFeeds: [
      opt("VITE_SAPIOLINGO_RSS_URL", "") || opt("SAPIOLINGO_RSS_URL", ""),
      opt("VITE_ELPHERU_RSS_URL", "") || opt("ELPHERU_RSS_URL", ""),
      opt("VITE_GOOGLE_NEWS_RSS_URL_2", "") || opt("GOOGLE_NEWS_RSS_URL_2", ""),
    ].filter(Boolean),
    gnews:        providerEnv("VITE_GNEWS_API_KEY", 3, false),
    newsdata:     providerEnv("VITE_NEWSDATA_API_KEY", 4, false),

    // Image-to-3D reconstruction of the saved avatar (Meshy). Optional:
    // without it the avatar falls back to the saved-image presence.
    meshy:        providerEnv("VITE_MESHY_API_KEY", 1, false),

    // Optional browser-safe Supabase configuration. The publishable key is
    // intentionally treated as public; service-role credentials are never read.
    supabase: {
      configured: supabaseConfigured,
      keyVar: has("VITE_SUPABASE_URL") ? "VITE_SUPABASE_URL" : "NEXT_PUBLIC_SUPABASE_URL",
      hasKey: supabaseConfigured,
      priority: 0,
      required: false,
    },

    // VLY
    vly: providerEnv("VLY_INTEGRATION_KEY", 0, false),

    // Neko self-hosted virtual browser (m1k1o/neko). VITE_NEKO_URL is the
    // public URL of the Neko web client (not a secret); the optional join
    // password is server-side only (NEKO_PASSWORD) and is applied as a
    // URL hash fragment by the browser panel — never sent to a server.
    nekoUrl: opt("VITE_NEKO_URL", ""),
    neko: providerEnv("NEKO_PASSWORD", 0, false),

    // Model overrides
    groqModel:        opt("VITE_GROQ_MODEL", "openai/gpt-oss-120b"),
    openrouterModel:  opt("VITE_OPENROUTER_MODEL", "openrouter/auto"),
    cerebrasModel:    opt("VITE_CEREBRAS_MODEL", "llama3.1-8b"),
    mistralModel:     opt("VITE_MISTRAL_MODEL", "mistral-small-latest"),
    fireworksModel:   opt("VITE_FIREWORKS_MODEL", "accounts/fireworks/models/llama-v3p1-8b-instruct"),
    githubModel:      opt("VITE_GITHUB_MODEL", "gpt-4o-mini"),
    anthropicModel:   opt("VITE_ANTHROPIC_MODEL", "claude-sonnet-4-5"),
    defaultProvider:  opt("VITE_DEFAULT_PROVIDER", "groq"),
    aiProxyBaseUrl:   opt("VITE_AI_PROXY_BASE_URL", ""),
  };

  // Overall valid if at least one AI provider has a key (or local is available)
  const anyAiConfigured =
    config.groq.configured ||
    config.openrouter.configured ||
    config.cerebras.configured ||
    config.mistral.configured ||
    config.fireworks.configured ||
    config.githubModels.configured ||
    config.anthropic.configured ||
    config.localInference.configured;

  if (!anyAiConfigured) {
    warnings.push("No AI provider configured — LÉLU will run offline.");
  }

  return config;
}

// -- singleton -----------------------------------------------------------

let cached: LeluEnvironment | null = null;

/**
 * Return the canonical environment config. Safe to call
 * repeatedly — the result is built once and cached.
 */
export function getEnvironment(): LeluEnvironment {
  if (!cached) cached = build();
  return cached;
}

/** Rebuild (e.g., after env change). Use sparingly. */
export function reloadEnvironment(): LeluEnvironment {
  cached = build();
  return cached;
}

/** Safe diagnostic snapshot — never includes key values. */
export function environmentDiagnostics(): Record<string, string> {
  const config = getEnvironment();
  const out: Record<string, string> = {};

  const aiProviders: [string, ProviderEnv][] = [
    ["Groq", config.groq],
    ["OpenRouter", config.openrouter],
    ["Cerebras", config.cerebras],
    ["Mistral", config.mistral],
    ["Fireworks", config.fireworks],
    ["GitHub Models", config.githubModels],
    ["Anthropic", config.anthropic],
    ["Local Inference", config.localInference],
  ];

  for (const [name, p] of aiProviders) {
    out[`ai.${name.toLowerCase().replace(" ", "-")}`] = providerLabel(p);
  }

  out["knowledge.news"] = providerLabel(config.news);
  out["knowledge.youtube"] = providerLabel(config.youtube);
  out["persistence.supabase"] = providerLabel(config.supabase);
  out["models.primary"] = config.defaultProvider;
  out["network.neko"] = config.nekoUrl ? `configured (${config.nekoUrl})` : "not configured";

  return out;
}

// Backward compat: exports expected by existing ProviderConfig consumers
export default {
  get githubToken(): string { return resolve("VITE_GITHUB_TOKEN") ?? ""; },
  get youtubeApiKey(): string { return resolve("VITE_YOUTUBE_API_KEY") ?? ""; },
  get newsApiKey(): string { return resolve("VITE_NEWS_API_KEY") ?? ""; },
  get groqApiKey(): string { return resolve("VITE_GROQ_API_KEY") ?? ""; },
  get anthropicApiKey(): string { return resolve("VITE_ANTHROPIC_API_KEY") ?? ""; },
  get meshyApiKey(): string { return resolve("VITE_MESHY_API_KEY") ?? ""; },
};

export function validateProviderConfig(): void {
  const config = getEnvironment();
  const missing: string[] = [];

  if (!config.groq.configured)        missing.push("VITE_GROQ_API_KEY");
  if (!config.youtube.configured)     missing.push("VITE_YOUTUBE_API_KEY");
  if (!config.news.configured)        missing.push("VITE_NEWS_API_KEY");
  if (!config.githubModels.configured) missing.push("VITE_GITHUB_TOKEN");

  if (missing.length) {
    throw new Error(
      `Missing Provider Configuration:\n${missing.join("\n")}`,
    );
  }
}