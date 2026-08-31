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

import { publicEnv } from "./env/publicEnv";
import { relayStatus } from "../providers/aiRelay";

// -- raw env access (browser-safe allowlist only) ----------

/**
 * Browser-safe variables only.
 *
 * This used to return `import.meta.env` itself, which made Vite inline
 * the ENTIRE env record here — every VITE_* value in `.env`, including
 * the provider API keys, compiled straight into the shipped bundle.
 * `publicEnv()` reads an explicit allowlist of names instead, so a
 * credential cannot reach the client through this module. Chat-provider
 * keys are read server-side (plugins/aiProxyApi.ts) and are absent here
 * by design.
 */
function rawEnv(): Record<string, string | undefined> {
  return publicEnv();
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
  const val = rawEnv()[key];
  return typeof val === "string" && val.trim().length > 0;
}

function opt(key: string, fallback: string): string {
  const val = rawEnv()[key];
  if (typeof val === "string" && val.trim().length > 0) return val.trim();
  return fallback;
}

/**
 * Which chat providers the SERVER holds a credential for.
 *
 * Chat-provider keys are no longer readable from the browser at all —
 * that was the leak. So this module can no longer answer "is Groq
 * configured?" from `import.meta.env`; asking anyway would report every
 * provider MISSING even while the relay was happily serving them, which
 * is precisely the kind of false diagnostic this codebase is trying to
 * remove. `refreshProviderCredentials()` fills this in from the relay's
 * capability report; until it does, the entries below say `unknown`
 * rather than claiming either answer.
 */
let serverCredentials: Record<string, boolean> | null = null;

/**
 * Ask the runtime which chat-provider credentials it holds, then rebuild
 * the cached config so warnings and diagnostics reflect reality.
 * Called by Bootstrap before it reports environment status.
 */
export async function refreshProviderCredentials(): Promise<void> {
  try {
    serverCredentials = await relayStatus();
  } catch {
    serverCredentials = {};
  }
  cached = build();
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

  /**
   * A chat provider, whose credential lives on the SERVER.
   *
   * `keyVar` names the server-side variable to set (the VITE_ form is
   * still accepted by the relay, but is no longer the documented place
   * for it). `hasKey` is honestly false: this runtime holds no key. Only
   * `configured` — the relay's answer — says whether the provider can
   * actually be used, and it warns only once that answer is known, so a
   * still-loading state never prints a false "unavailable".
   */
  function chatProviderEnv(relayId: string, keyVar: string, priority: number): ProviderEnv {
    const known = serverCredentials;
    const configured = known ? known[relayId] === true : false;
    if (known && !configured) {
      warnings.push(`${keyVar} is not set on the server — provider will be unavailable.`);
    }
    return { configured, keyVar, hasKey: false, priority, required: true };
  }

  const supabaseConfigured = has("VITE_SUPABASE_URL") || has("NEXT_PUBLIC_SUPABASE_URL");

  const config: LeluEnvironment = {
    valid: true,
    warnings,

    // AI providers — priority 1-7 in fallback order
    groq:            chatProviderEnv("groq", "GROQ_API_KEY", 1),
    openrouter:      chatProviderEnv("openrouter", "OPENROUTER_API_KEY", 2),
    cerebras:        chatProviderEnv("cerebras", "CEREBRAS_API_KEY", 3),
    mistral:         chatProviderEnv("mistral", "MISTRAL_API_KEY", 4),
    fireworks:       chatProviderEnv("fireworks", "FIREWORKS_API_KEY", 5),
    githubModels:    chatProviderEnv("githubmodels", "GITHUB_MODELS_TOKEN", 6),
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

// Backward compat: exports expected by existing ProviderConfig consumers.
// `groqApiKey` is gone — nothing consumed it, and it existed only to hand
// a chat-provider credential to browser code. That credential now lives
// on the server (plugins/aiProxyApi.ts).
export default {
  get githubToken(): string { return rawEnv()["VITE_GITHUB_TOKEN"] ?? ""; },
  get youtubeApiKey(): string { return rawEnv()["VITE_YOUTUBE_API_KEY"] ?? ""; },
  get newsApiKey(): string { return rawEnv()["VITE_NEWS_API_KEY"] ?? ""; },
  get meshyApiKey(): string { return rawEnv()["VITE_MESHY_API_KEY"] ?? ""; },
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