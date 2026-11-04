/**
 * ==========================================================
 * LÉLU — SUPABASE ENVIRONMENT, RESOLVED ONCE
 *
 * There were three Supabase client initialisation paths and
 * three different ideas of what "configured" means:
 *
 *   · SupabasePersistence  — SUPABASE_URL, VITE_SUPABASE_URL,
 *                            NEXT_PUBLIC_SUPABASE_URL, plus a
 *                            publicEnv() fallback
 *   · og/integrations/supabase/client.ts
 *                          — SUPABASE_URL only, but it would
 *                            accept SUPABASE_ANON_KEY as a key
 *   · og/integrations/supabase/auth-middleware.ts
 *                          — process.env.SUPABASE_URL only, so
 *                            it could not see a value delivered
 *                            through the runtime key bridge at
 *                            all
 *
 * Those are not three styles of the same lookup; they are three
 * answers. An operator who set NEXT_PUBLIC_SUPABASE_URL
 * configured persistence and left the middleware throwing. One
 * who set SUPABASE_ANON_KEY configured the OG client and left
 * persistence reporting "not configured". The symptom reaching
 * the user was the same either way — sign-in simply did not
 * work — with nothing on screen to say which half was blind.
 *
 * So the names live here, once, and all three paths read them
 * from here. Nothing is hard-coded: this module contains no
 * URL, no project ref and no key, only the names to look under.
 * ==========================================================
 */

import { resolveFirst } from "../resolveEnv.ts";
import { resolveEnvValue } from "../resolveEnv.ts";
import { SUPABASE_PUBLIC_DEFAULT } from "./supabasePublic.ts";

/**
 * Every name a Supabase URL may arrive under, in precedence order.
 *
 * The unprefixed form leads because that is what ENV_VARS.md asks for and
 * what the hosting environment actually delivers; the prefixed forms follow
 * for a Vite or Next deployment that sets them instead.
 */
export const SUPABASE_URL_NAMES = [
  "SUPABASE_URL",
  "VITE_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
] as const;

/**
 * Every name a publishable (client-safe) key may arrive under.
 *
 * SUPABASE_ANON_KEY is last and is accepted only as a legacy alias: the
 * OG client already honoured it, and dropping it would break a deployment
 * that works today. A SECRET key is deliberately not listed — it must
 * never reach a browser.
 */
export const SUPABASE_KEY_NAMES = [
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_ANON_KEY",
] as const;

export interface SupabaseConfig {
  url: string;
  publishableKey: string;
}

/** What is missing, for an error message that names it. */
export interface SupabaseConfigGap {
  missing: Array<"url" | "key">;
  /** The names that were looked under, so the message can list them. */
  looked: string[];
}

/**
 * The configured Supabase project, or null when it is not configured.
 *
 * `extra` lets a caller add values it alone can see — the browser's
 * `publicEnv()` snapshot of `import.meta.env`, which cannot be read
 * dynamically from a shared module (see resolveEnv's note on why). Those
 * are consulted after the shared names, never instead of them.
 */
export function resolveSupabaseConfig(extra: {
  url?: Array<string | undefined>;
  key?: Array<string | undefined>;
} = {}): SupabaseConfig | null {
  const { url, key } = resolveHalves(extra);
  if (!url || !key) return null;
  return { url, publishableKey: key };
}

/**
 * What a candidate Supabase key is, read from its shape alone. The value is
 * never logged or returned.
 *
 *   publishable — `sb_publishable_…`, issued for browsers
 *   anon        — a legacy JWT whose role is `anon`
 *   secret      — `sb_secret_…`, a service_role JWT, or an `sbp_…`
 *                 personal access token: admin credentials that bypass RLS
 *                 or control the account, and must never reach a page
 *   unknown     — anything else (kept for self-hosted setups)
 */
export type SupabaseKeyKind = "publishable" | "anon" | "secret" | "unknown";

export function classifySupabaseKey(raw: string): SupabaseKeyKind {
  const key = raw.trim();
  if (key.startsWith("sb_publishable_")) return "publishable";
  if (key.startsWith("sb_secret_") || key.startsWith("sbp_")) return "secret";
  const parts = key.split(".");
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(base64UrlDecode(parts[1])) as { role?: unknown };
      if (payload.role === "anon") return "anon";
      if (payload.role === "service_role") return "secret";
    } catch {
      /* not a JWT */
    }
  }
  return "unknown";
}

/** May this value be used as the browser's Supabase key? */
export function isBrowserSafeSupabaseKey(raw: string | undefined): boolean {
  return typeof raw === "string" && raw.trim() !== "" && classifySupabaseKey(raw) !== "secret";
}

/** Names whose value is set but refused as a browser key (names only). */
export function refusedSupabaseKeyNames(): string[] {
  return SUPABASE_KEY_NAMES.filter((name) => {
    const value = resolveEnvValue(name);
    return Boolean(value && value.trim()) && !isBrowserSafeSupabaseKey(value);
  });
}

function resolveHalves(extra: { url?: Array<string | undefined>; key?: Array<string | undefined> } = {}): {
  url: string;
  key: string;
} {
  const configuredUrl = firstValue([resolveFirst(...SUPABASE_URL_NAMES), ...(extra.url ?? [])]);
  const configuredKey = firstValue(
    [...SUPABASE_KEY_NAMES.map((n) => resolveEnvValue(n)), ...(extra.key ?? [])].filter(isBrowserSafeSupabaseKey),
  );
  // The default URL fills in only when no key from some OTHER project is
  // configured — a foreign key must be reported as missing its URL, never
  // silently paired with this project.
  const keyIsOurs = !configuredKey || configuredKey === SUPABASE_PUBLIC_DEFAULT.publishableKey;
  const url = configuredUrl || (keyIsOurs ? SUPABASE_PUBLIC_DEFAULT.url : "");
  // The default key only ever travels with the default project.
  const key = configuredKey || (sameProject(url, SUPABASE_PUBLIC_DEFAULT.url) ? SUPABASE_PUBLIC_DEFAULT.publishableKey : "");
  return { url, key };
}

function sameProject(a: string, b: string): boolean {
  try {
    return new URL(a).host === new URL(b).host;
  } catch {
    return false;
  }
}

/** Which half is missing. Returns null when nothing is. */
export function supabaseConfigGap(extra?: Parameters<typeof resolveSupabaseConfig>[0]): SupabaseConfigGap | null {
  const { url, key } = resolveHalves(extra);
  const missing: Array<"url" | "key"> = [];
  if (!url) missing.push("url");
  if (!key) missing.push("key");
  if (missing.length === 0) return null;
  return {
    missing,
    looked: [
      ...(url ? [] : SUPABASE_URL_NAMES),
      ...(key ? [] : SUPABASE_KEY_NAMES),
    ],
  };
}

/**
 * The project ref a Supabase URL points at — the subdomain of a hosted
 * project URL, e.g. `https://abcdefgh.supabase.co` → `abcdefgh`.
 *
 * Returns null for a self-hosted or local URL, which has no ref to read.
 */
export function projectRefFromUrl(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    if (!hostname.endsWith(".supabase.co") && !hostname.endsWith(".supabase.in")) return null;
    const ref = hostname.split(".")[0];
    return ref && ref !== "www" ? ref : null;
  } catch {
    return null;
  }
}

/**
 * The project ref a key was issued for, where the key says so.
 *
 * A legacy anon key is a JWT and carries `ref` in its payload, so a key
 * from the wrong project is detectable BEFORE any request is made. A modern
 * `sb_publishable_…` key is an opaque string that carries nothing, so this
 * returns null for one — and a null here means "cannot tell", never "fine".
 * That distinction is the whole point: claiming a match we cannot see would
 * be worse than admitting we cannot see it.
 *
 * The key is never logged, echoed or returned — only the ref claim is read.
 */
export function projectRefFromKey(key: string): string | null {
  const parts = key.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as { ref?: unknown };
    return typeof payload.ref === "string" && payload.ref ? payload.ref : null;
  } catch {
    return null;
  }
}

export type SupabaseProjectCheck =
  /** URL and key demonstrably name the same project. */
  | { verdict: "match"; ref: string }
  /** The key was issued for a different project than the URL points at. */
  | { verdict: "mismatch"; urlRef: string; keyRef: string; message: string }
  /** The key carries no project claim, so nothing can be concluded. */
  | { verdict: "unverifiable"; reason: string };

/**
 * Do the configured URL and key belong to the same project?
 *
 * This is the check that was missing when a deployment ran for weeks with a
 * key issued for another project: sign-in failed with "Invalid API key",
 * which reads as a user's bad password, and nothing said the two halves of
 * the configuration disagreed.
 */
export function checkSupabaseProject(config: SupabaseConfig): SupabaseProjectCheck {
  const urlRef = projectRefFromUrl(config.url);
  if (!urlRef) {
    return { verdict: "unverifiable", reason: "the configured URL is not a hosted supabase.co project URL" };
  }
  const keyRef = projectRefFromKey(config.publishableKey);
  if (!keyRef) {
    return {
      verdict: "unverifiable",
      reason:
        "a modern sb_publishable_ key carries no project claim, so the pairing can only be " +
        "confirmed by a request to the project",
    };
  }
  if (keyRef !== urlRef) {
    return {
      verdict: "mismatch",
      urlRef,
      keyRef,
      message:
        `The configured Supabase key was issued for project "${keyRef}" but the configured ` +
        `URL points at project "${urlRef}". Sign-in cannot work until both come from the ` +
        `same project.`,
    };
  }
  return { verdict: "match", ref: urlRef };
}

function firstValue(values: Array<string | undefined>): string {
  return values.find((value) => typeof value === "string" && value.trim().length > 0)?.trim() ?? "";
}

function base64UrlDecode(segment: string): string {
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/");
  const whole = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  if (typeof atob === "function") return atob(whole);
  return Buffer.from(whole, "base64").toString("binary");
}
