/**
 * The guard shared by both M14.5 real-cloud harnesses.
 *
 * Only the isolated lelu-v11-test project is accepted. This is intentionally
 * stricter than "a URL with a matching ref": a production ref supplied by
 * mistake is refused before a client is created.
 *
 * It also refuses a SECRET/ADMIN key. A publishable key is the only correct
 * credential for an authenticated RLS test: a secret key bypasses row-level
 * security, so a run with one would neither prove isolation nor say anything
 * about what a browser can do. The local classifier below mirrors
 * `src/core/config/supabaseEnv.ts#classifySupabaseKey` because this module is
 * also loaded by plain `node` (see scripts/verify-m145-two-profile.mjs), where
 * a TypeScript import is not available. Values are only ever classified; none
 * is logged, returned or written.
 */
export const M145_TEST_PROJECT_REF = "ugshflwlyakipeduifkd";

const TEST_URL_PREFIXES = [
  `https://${M145_TEST_PROJECT_REF}.supabase.co`,
  `https://${M145_TEST_PROJECT_REF}.supabase.in`,
];

/**
 * Strip matching surrounding quotes from an env-file value.
 *
 * The platform writes project secrets into `.env.local` quoted, and Vite's
 * `loadEnv` (and plugins/loadEnvFiles.ts) strip those quotes. The harnesses
 * parse the file themselves, so they must strip them too — otherwise a
 * correct publishable key arrives as `"sb_publishable_…"` and Supabase
 * answers 401 before Auth is reached.
 */
export function unquoteEnvValue(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    return value.slice(1, -1).trim();
  }
  return value;
}

/**
 * May this value be used as the browser/test publishable key?
 *
 * publishable — `sb_publishable_…`, issued for browsers
 * anon        — legacy JWT whose role is `anon`; RLS still applies
 * secret      — `sb_secret_…`, a service_role JWT, or an `sbp_` personal
 *               access token: admin credentials that bypass RLS
 * unknown     — kept for self-hosted keys, matching the app's behaviour
 */
export function isBrowserSafeM145Key(raw) {
  const key = unquoteEnvValue(raw);
  if (!key) return false;
  if (key.startsWith("sb_publishable_")) return true;
  if (key.startsWith("sb_secret_") || key.startsWith("sbp_")) return false;
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const whole = padded + "=".repeat((4 - (padded.length % 4)) % 4);
      const payload = JSON.parse(Buffer.from(whole, "base64").toString("binary"));
      if (payload?.role === "service_role") return false;
      if (payload?.role === "anon") return true;
    } catch {
      /* not a JWT: fall through to unknown */
    }
  }
  return true;
}

export function validateM145Target({ url, projectRef, publishableKey, allowReal }) {
  const missing = [
    ["LELU_M145_SUPABASE_URL", url],
    ["LELU_M145_SUPABASE_PUBLISHABLE_KEY", publishableKey],
    ["LELU_M145_PROJECT_REF", projectRef],
  ].filter(([, value]) => !unquoteEnvValue(value)).map(([name]) => name);

  if (allowReal !== "1" && allowReal !== true) {
    return {
      ok: false,
      status: "BLOCKED",
      reason: "LELU_M145_ALLOW_REAL is not 1; real cloud execution is opt-in.",
      ...(missing.length > 0 ? { missing } : {}),
    };
  }
  if (missing.length > 0) {
    return { ok: false, status: "BLOCKED", reason: `Missing ${missing.join(", ")}.`, missing };
  }
  if (!isBrowserSafeM145Key(publishableKey)) {
    return {
      ok: false,
      status: "FAIL",
      reason:
        "Refusing to run: the configured Supabase key is a secret/admin credential, not a " +
        "browser-safe publishable key. A secret key bypasses RLS, so it cannot demonstrate " +
        "authenticated cloud acceptance. Use the isolated project's publishable key.",
    };
  }
  if (projectRef !== M145_TEST_PROJECT_REF) {
    return {
      ok: false,
      status: "FAIL",
      reason: `Refusing to run: ${projectRef} is not the isolated ${M145_TEST_PROJECT_REF} test project.`,
    };
  }
  if (!TEST_URL_PREFIXES.some((prefix) => url === prefix || url.startsWith(`${prefix}/`))) {
    return {
      ok: false,
      status: "FAIL",
      reason: "Refusing to run: the URL is not the isolated lelu-v11-test project URL.",
    };
  }
  return { ok: true, projectRef };
}
