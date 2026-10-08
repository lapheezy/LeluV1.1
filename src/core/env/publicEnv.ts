/**
 * ==========================================================
 * LÉLU — BROWSER-SAFE ENVIRONMENT ACCESS
 *
 * WHY THIS EXISTS
 * ---------------
 * Reading `import.meta.env` as an OBJECT — `(import.meta as X).env ?? {}`
 * — makes Vite substitute the WHOLE env record at that call site. Six
 * modules did that (Environment, ProviderConfig, SupabasePersistence,
 * Avatar3DReconstructor, native/speech, native/push), so every `VITE_*`
 * value in `.env` was compiled into the bundle whether or not any code
 * ever read it. Measured with canary keys: two provider keys landed in
 * 11 separate chunks of `dist/assets/`, including chunks that have
 * nothing to do with providers.
 *
 * Referencing ONE name — `import.meta.env.VITE_GROQ_MODEL` — substitutes
 * only that name. So this module holds a static, explicit map of the
 * variables that are genuinely safe to ship to a browser, and nothing
 * else can reach the bundle.
 *
 * THE RULE
 * --------
 * A variable belongs here only if the BROWSER must have its value:
 * a model name, a public URL, a deliberately-public publishable key.
 *
 * The six chat-provider credentials are deliberately ABSENT. They are
 * read server-side by `plugins/aiProxyApi.ts` and never travel to the
 * client — see `src/providers/aiRelay.ts`.
 *
 * `scripts/verify-bundle-secrets.ts` builds with canary values and
 * fails if any of them reappear in `dist/`, so this cannot silently
 * regress.
 * ==========================================================
 */

/**
 * Every browser-safe variable, each read by its own literal name.
 *
 * Written out one-by-one on purpose: a loop or a dynamic key would put
 * the whole record back in the bundle and undo the point of the file.
 */
function publicEnvRecord(): Record<string, string | undefined> {
  try {
    return {
      /* ---- model / routing overrides (names, not credentials) ---- */
      VITE_GROQ_MODEL: import.meta.env.VITE_GROQ_MODEL,
      VITE_OPENROUTER_MODEL: import.meta.env.VITE_OPENROUTER_MODEL,
      VITE_CEREBRAS_MODEL: import.meta.env.VITE_CEREBRAS_MODEL,
      VITE_MISTRAL_MODEL: import.meta.env.VITE_MISTRAL_MODEL,
      VITE_FIREWORKS_MODEL: import.meta.env.VITE_FIREWORKS_MODEL,
      VITE_GITHUB_MODEL: import.meta.env.VITE_GITHUB_MODEL,
      VITE_DEFAULT_PROVIDER: import.meta.env.VITE_DEFAULT_PROVIDER,
      VITE_AI_PROXY_BASE_URL: import.meta.env.VITE_AI_PROXY_BASE_URL,

      /* ---- public URLs ---- */
      VITE_NEKO_URL: import.meta.env.VITE_NEKO_URL,
      VITE_EARTH_VESSELS_ENDPOINT: import.meta.env.VITE_EARTH_VESSELS_ENDPOINT,
      VITE_MESHY_API_BASE_URL: import.meta.env.VITE_MESHY_API_BASE_URL,
      VITE_ELPHERU_RSS_URL: import.meta.env.VITE_ELPHERU_RSS_URL,
      VITE_SAPIOLINGO_RSS_URL: import.meta.env.VITE_SAPIOLINGO_RSS_URL,
      VITE_GOOGLE_NEWS_RSS_URL: import.meta.env.VITE_GOOGLE_NEWS_RSS_URL,
      VITE_GOOGLE_NEWS_RSS_URL_2: import.meta.env.VITE_GOOGLE_NEWS_RSS_URL_2,

      /* ---- deliberately-public keys (documented as client-side) ----
       * Supabase publishable/anon keys are designed to be shipped and
       * are protected by row-level security, not by secrecy. The VAPID
       * public key is, by definition, the public half of the pair. */
      VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_URL: import.meta.env.NEXT_PUBLIC_SUPABASE_URL,
      VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      VITE_VAPID_PUBLIC_KEY: import.meta.env.VITE_VAPID_PUBLIC_KEY,

      /* ---- browser-called service keys ----
       * NewsAPI, the YouTube Data API and GitHub repo search have been
       * moved server-side and are deliberately ABSENT here: they relay
       * through /api/knowledge/relay and /api/github/proxy.
       *
       * The four below are still read in the browser, so they are still
       * shipped in the bundle. That is a real remaining exposure, stated
       * plainly rather than glossed over (see ENV_VARS.md). Each is used
       * by a browser-only feature — the Earth fire layer, avatar 3-D
       * reconstruction, and two secondary news fallbacks — and closing
       * them means giving each the same relay treatment. */
      VITE_GUARDIAN_API_KEY: import.meta.env.VITE_GUARDIAN_API_KEY,
      VITE_GNEWS_API_KEY: import.meta.env.VITE_GNEWS_API_KEY,
      VITE_NEWSDATA_API_KEY: import.meta.env.VITE_NEWSDATA_API_KEY,
      VITE_MESHY_API_KEY: import.meta.env.VITE_MESHY_API_KEY,
      VITE_FIRMS_API_KEY: import.meta.env.VITE_FIRMS_API_KEY,
    };
  } catch {
    // No import.meta.env at all (a plain bun/node verification run).
    return {};
  }
}

let cached: Record<string, string | undefined> | null = null;

/** The browser-safe environment record. Built once. */
export function publicEnv(): Record<string, string | undefined> {
  if (!cached) cached = publicEnvRecord();
  return cached;
}

/** One browser-safe variable by name, or undefined. */
export function publicEnvVar(name: string): string | undefined {
  return publicEnv()[name];
}

/** Rebuild the record (tests only). */
export function resetPublicEnv(): void {
  cached = null;
}
