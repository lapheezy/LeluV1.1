/**
 * ==========================================================
 * LÉLU — ENV / PROVIDER-HEALTH API (shared middleware)
 *
 * Previously inlined in vite.config.ts; extracted so the same
 * endpoints are mounted by the Vite dev server, the standalone
 * Node/Bun runtime server (server.ts) and the Deno entry
 * (main.ts).
 *
 *   GET /api/env-check        → which VITE_* keys are set (never values)
 *   GET /api/provider-health  → live Groq/OpenRouter connectivity check
 *
 * Routes are bound at mount time because connect-style servers
 * (Vite) rewrite `req.url` to the mount remainder.
 * ==========================================================
 */

import { bridgeReport } from "./runtimeKeyBridge.ts";
import { endpoint, endpointUrl, endpointDiagnostics } from "../src/core/Endpoints.ts";
import { defaultModel, type ProviderModelId } from "../src/core/ProviderModels.ts";
import {
  AUTHORIZED_CHAT_PROVIDERS,
  credentialReport,
  describeCredentialState,
  resolveProviderCredentials,
  type CredentialProviderId,
} from "../src/core/model/ProviderCredentials.ts";

type EnvReader = (key: string) => string | undefined;

interface ConnectLikeRes {
  statusCode?: number;
  setHeader: (name: string, value: string) => void;
  end: (body: string) => void;
}

interface ConnectLikeReq {
  method?: string;
  url?: string;
}

type Handler = (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void) => void;

function sendJson(res: ConnectLikeRes, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(payload));
}

/**
 * Optional live-provider probes wired in by the hosting runtime:
 * `aisStatus` returns the AIS bridge's real state (configured /
 * connected / vesselCount — never the key). The FIRMS probe is
 * implemented here directly (it only needs the env reader + fetch).
 */
export interface EnvApiExtras {
  aisStatus?: () => Record<string, unknown> | null;
}

/** Presence helper — never leaks the value, only length when set. */
function presence(value: string | undefined): string {
  return value && value.length > 0 ? `SET (${value.length} chars)` : "MISSING";
}

/**
 * Live FIRMS probe: fetch the VIIRS NRT hotspot CSV for the last day
 * (global bbox) using the configured key. Reports the real HTTP status
 * and hotspot count — never the key. Returns null when unconfigured.
 */
async function probeFirms(key: string | undefined): Promise<Record<string, unknown> | null> {
  if (!key || key.length === 0) return null;
  // Same URL shape the live FIRMS provider uses (src/core/earth/EarthProviders.ts):
  // /api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{DAY_RANGE} with
  // DAY_RANGE=2 → today + yesterday. Wide bbox for the health probe.
  const url = `${endpoint("firms")}/api/area/csv/${encodeURIComponent(key)}/VIIRS_SNPP_NRT/-180,-90,180,90/2`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    const dataLines = text.split(/\r?\n/).filter((l) => l.trim() && !/^[a-zA-Z_,;]+$/.test(l.trim()));
    return {
      configured: true,
      status: res.ok ? "connected" : "error",
      http: res.status,
      ok: res.ok,
      hotspotCount: res.ok ? Math.max(0, dataLines.length - 1) : 0,
      error: res.ok ? null : text.slice(0, 200),
    };
  } catch (error) {
    return {
      configured: true,
      status: "error",
      http: 0,
      ok: false,
      hotspotCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The model a probe should send.
 *
 * The probe MUST ask for the same model the provider would, or it
 * reports on something the app never calls. That is exactly how
 * /api/provider-health came to report Groq down: it probed a retired
 * `llama-3.3-70b-versatile` while GroqProvider was happily answering
 * on `openai/gpt-oss-120b`. The default now comes from the one
 * registry both sides read; only the override lookup differs, because
 * this runtime has its own env reader rather than resolveFirst().
 */
function probeModel(env: EnvReader, id: ProviderModelId, ...names: string[]): string {
  for (const name of names) {
    const value = env(`VITE_${name}`) || env(name);
    if (value && value.trim()) return value.trim();
  }
  return defaultModel(id);
}

/** Anthropic is opt-in: the same rule the broker and ProviderPolicy apply. */
const POLICY_TRUE = new Set(["1", "true", "yes", "on"]);
function anthropicAllowed(env: EnvReader): boolean {
  const raw = env("LELU_ENABLE_ANTHROPIC") ?? env("VITE_LELU_ENABLE_ANTHROPIC");
  return raw !== undefined && POLICY_TRUE.has(raw.trim().toLowerCase());
}

/** Presence of a provider credential, judged by the canonical contract. */
function credentialPresence(env: EnvReader, id: CredentialProviderId): string {
  const state = resolveProviderCredentials(id, env).state;
  return state === "configured" ? "SET" : state === "invalid" ? "INVALID" : "MISSING";
}

/**
 * Every chat provider's credential as the canonical contract sees it: state,
 * the name it came from, how many keys, what was rejected and why. Names and
 * counts only — this object is built without ever holding a key.
 */
function providerCredentialReports(env: EnvReader): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const id of [...AUTHORIZED_CHAT_PROVIDERS, "githubModels", "anthropic"] as CredentialProviderId[]) {
    const report = credentialReport(id, env);
    out[id] = {
      ...report,
      diagnosis: describeCredentialState(report),
      ...(id === "anthropic" ? { enabledByPolicy: anthropicAllowed(env) } : {}),
    };
  }
  return out;
}

/**
 * Model discovery: list the provider's models with the server's credential.
 *
 * A GET on the models endpoint authenticates the key and proves the
 * configured model exists, without generating a token — it costs nothing,
 * which is why it is the check for the providers that had no probe at all.
 */
async function probeModels(
  id: "groq" | "cerebras" | "mistral" | "fireworks" | "gemini",
  key: string,
  model: string,
): Promise<Record<string, unknown>> {
  const gemini = id === "gemini";
  const url = gemini ? endpointUrl("gemini", "v1beta/models?pageSize=1000") : endpointUrl(id, "models");
  const headers: Record<string, string> = gemini ? { "x-goog-api-key": key } : { Authorization: `Bearer ${key}` };
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    if (!res.ok) return { check: "models", status: res.status, ok: false, response: text.slice(0, 200) };
    const body = JSON.parse(text) as { data?: Array<{ id?: string }>; models?: Array<{ name?: string }> };
    const ids = gemini
      ? (body.models ?? []).map((entry) => String(entry.name ?? "").replace(/^models\//, ""))
      : (body.data ?? []).map((entry) => String(entry.id ?? ""));
    return {
      check: "models",
      status: res.status,
      ok: true,
      modelCount: ids.length,
      configuredModel: model,
      configuredModelListed: ids.includes(model),
    };
  } catch (error) {
    return { check: "models", status: "error", ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export function createEnvApi(env: EnvReader, runtime: string, extras: EnvApiExtras = {}): {
  attach: (middlewares: { use: (path: string, handler: Handler) => void }) => void;
} {
  function handleRoute(route: "/api/env-check" | "/api/provider-health") {
    return (req: ConnectLikeReq, res: ConnectLikeRes, next: () => void): void => {
      if (req.method !== "GET") {
        next();
        return;
      }

      if (route === "/api/env-check") {
        sendJson(res, {
          runtime,
          // Which provider keys arrived under an UNPREFIXED platform
          // name and are therefore being bridged onto the __LELU_*__
          // channel. Names only — never values. Without this, a key
          // supplied as GROQ_API_KEY rather than VITE_GROQ_API_KEY
          // showed up here as MISSING even though it was present in
          // the environment and is what the provider actually uses.
          bridgedFromUnprefixedNames: bridgeReport(env),
          // Where requests actually go. Base URLs are not credentials, so
          // the resolved value is shown — an operator debugging a blocked
          // or mis-pointed host needs to see the URL, and `overridden`
          // flags anything redirected away from its built-in default.
          endpoints: endpointDiagnostics()
            .filter((e) => e.overridden)
            .map((e) => ({ id: e.id, url: e.url })),
          // The canonical credential contract's view of every chat provider
          // (src/core/model/ProviderCredentials.ts): configured / missing /
          // invalid, the name a key came from, and why a present value was
          // rejected. Names and counts only.
          providers: providerCredentialReports(env),
          // Legacy fields, kept for existing readers, now judged by the same
          // contract (SET / INVALID / MISSING — no lengths).
          VITE_GROQ_API_KEY: credentialPresence(env, "groq"),
          VITE_OPENROUTER_API_KEY: credentialPresence(env, "openrouter"),
          VITE_ANTHROPIC_API_KEY: credentialPresence(env, "anthropic"),
          // Supabase needs BOTH halves, and neither was reported here at
          // all — so a project with a key and no URL looked fine from
          // this endpoint while being unable to connect.
          VITE_SUPABASE_URL: presence(
            env("VITE_SUPABASE_URL") || env("NEXT_PUBLIC_SUPABASE_URL") || env("SUPABASE_URL"),
          ),
          VITE_SUPABASE_PUBLISHABLE_KEY: presence(
            env("VITE_SUPABASE_PUBLISHABLE_KEY") ||
              env("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
              env("SUPABASE_PUBLISHABLE_KEY") ||
              env("SUPABASE_ANON_KEY"),
          ),
          VITE_FIRMS_API_KEY: presence(env("VITE_FIRMS_API_KEY")),
          AISSTREAM_API_KEY: presence(env("AISSTREAM_API_KEY")),
          INSTAGRAM_ACCESS_TOKEN: presence(env("INSTAGRAM_ACCESS_TOKEN") || env("VITE_INSTAGRAM_ACCESS_TOKEN")),
          INSTAGRAM_USERNAME: env("INSTAGRAM_USERNAME") || env("VITE_INSTAGRAM_USERNAME") || "MISSING",
          RSS_SAPIOLINGO: presence(env("VITE_SAPIOLINGO_RSS_URL") || env("SAPIOLINGO_RSS_URL") || env("RSS_SAPIOLINGO_URL")),
          RSS_ELPHERU: presence(env("VITE_ELPHERU_RSS_URL") || env("ELPHERU_RSS_URL") || env("RSS_ELPHERU_URL")),
          RSS_GOOGLE_NEWS_1: presence(env("VITE_GOOGLE_NEWS_RSS_URL") || env("GOOGLE_NEWS_RSS_URL") || env("RSS_GOOGLE_NEWS_URL")),
          RSS_GOOGLE_NEWS_2: presence(env("VITE_GOOGLE_NEWS_RSS_URL_2") || env("GOOGLE_NEWS_RSS_URL_2") || env("RSS_GOOGLE_NEWS_ALT_URL")),
          NEKO_URL: env("VITE_NEKO_URL") || env("NEKO_URL") || "MISSING",
          VITE_GROQ_MODEL: env("VITE_GROQ_MODEL") ?? "MISSING",
          VITE_ANTHROPIC_MODEL: env("VITE_ANTHROPIC_MODEL") || env("ANTHROPIC_MODEL") || "MISSING",
          VITE_DEFAULT_PROVIDER: env("VITE_DEFAULT_PROVIDER") ?? "MISSING",
        });
        return;
      }

      void (async () => {
        const results: Record<string, unknown> = {};
        // Keys from the canonical contract — the same first credential the
        // broker would attach — so a health answer describes the real path.
        const keyFor = (id: CredentialProviderId) => resolveProviderCredentials(id, env).credentials[0]?.key ?? "";

        // Groq and OpenRouter keep their chat probe, but now try each
        // configured key in order, as the broker does. Probing only the first
        // key reported OpenRouter failing (that key's daily free quota spent,
        // 429) while the broker rotated to the next key and answered — a
        // false negative. Stops at the first key that answers; never logs one.
        const chatProbe = async (
          id: "groq" | "openrouter",
          extraHeaders: Record<string, string>,
          model: string,
        ): Promise<Record<string, unknown>> => {
          const resolution = resolveProviderCredentials(id, env);
          if (resolution.credentials.length === 0) {
            return { status: resolution.state === "invalid" ? "invalid-key" : "missing-key", ok: false };
          }
          const attempts: Array<{ key: string; status: number | string }> = [];
          for (const credential of resolution.credentials) {
            try {
              const res = await fetch(endpointUrl(id, "chat/completions"), {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${credential.key}`, ...extraHeaders },
                body: JSON.stringify({ model, messages: [{ role: "user", content: "Say OK" }], max_tokens: 5 }),
                signal: AbortSignal.timeout(15000),
              });
              const body = await res.text();
              attempts.push({ key: credential.label, status: res.status });
              if (res.ok) return { status: res.status, ok: true, response: "OK", answeredWith: credential.label, attempts };
              if (credential === resolution.credentials[resolution.credentials.length - 1]) {
                return { status: res.status, ok: false, response: body.slice(0, 200), attempts };
              }
            } catch (error) {
              attempts.push({ key: credential.label, status: "error" });
              if (credential === resolution.credentials[resolution.credentials.length - 1]) {
                return { status: "error", ok: false, error: error instanceof Error ? error.message : String(error), attempts };
              }
            }
          }
          return { status: "error", ok: false, attempts };
        };

        results.groq = await chatProbe("groq", {}, probeModel(env, "groq", "GROQ_MODEL"));
        results.openrouter = await chatProbe(
          "openrouter",
          { "HTTP-Referer": "https://freebuff.com", "X-Title": "Lélu" },
          probeModel(env, "openrouter", "OPENROUTER_MODEL"),
        );

        // ANTHROPIC IS NOT PROBED unless the operator opted in. This probe
        // used to send a live Anthropic request whenever any Anthropic key
        // was present, ignoring LELU_ENABLE_ANTHROPIC — the one Anthropic
        // request path that bypassed the policy the broker and the provider
        // both enforce. Its key is not even resolved here when the policy is off.
        if (!anthropicAllowed(env)) {
          results.anthropic = {
            status: "disabled-by-policy",
            ok: false,
            credential: resolveProviderCredentials("anthropic", env).state,
          };
        } else {
          const anthropicKey = keyFor("anthropic");
          if (anthropicKey) {
            try {
              const anthropicRes = await fetch(endpointUrl("anthropic", "messages"), {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-api-key": anthropicKey,
                  "anthropic-version": "2023-06-01",
                },
                body: JSON.stringify({
                  model: probeModel(env, "anthropic", "ANTHROPIC_MODEL"),
                  max_tokens: 5,
                  messages: [{ role: "user", content: "Say OK" }],
                }),
                signal: AbortSignal.timeout(15000),
              });
              const body = await anthropicRes.text();
              results.anthropic = {
                status: anthropicRes.status,
                ok: anthropicRes.ok,
                response: anthropicRes.ok ? "OK" : body.slice(0, 200),
              };
            } catch (error) {
              results.anthropic = {
                status: "error",
                error: error instanceof Error ? error.message : String(error),
              };
            }
          } else {
            results.anthropic = { status: "missing-key" };
          }
        }

        // Cerebras, Mistral, Fireworks and Gemini had no health check at all:
        // a key existing was the only evidence. Model discovery authenticates
        // the key and confirms the configured model, at no token cost.
        const discovery: Array<["cerebras" | "mistral" | "fireworks" | "gemini", ProviderModelId, string]> = [
          ["cerebras", "cerebras", "CEREBRAS_MODEL"],
          ["mistral", "mistral", "MISTRAL_MODEL"],
          ["fireworks", "fireworks", "FIREWORKS_MODEL"],
          ["gemini", "gemini", "GEMINI_MODEL"],
        ];
        await Promise.all(
          discovery.map(async ([id, modelId, modelName]) => {
            const resolution = resolveProviderCredentials(id, env);
            const key = resolution.credentials[0]?.key;
            if (!key) {
              results[id] = {
                status: resolution.state === "invalid" ? "invalid-key" : "missing-key",
                ok: false,
                diagnosis: describeCredentialState(credentialReport(id, env)),
              };
              return;
            }
            results[id] = { source: resolution.source, ...(await probeModels(id, key, probeModel(env, modelId, modelName))) };
          }),
        );

        // FIRMS — live probe with the configured key (count only, never the key).
        const firms = await probeFirms(env("VITE_FIRMS_API_KEY"));
        results.firms = firms ?? { configured: false, status: "not_configured", ok: false };

        // AIS — the shared bridge's real state (same instance the Earth UI reads).
        const aisState = extras.aisStatus?.() ?? null;
        if (aisState) {
          results.ais = {
            configured: aisState.configured ?? false,
            status: aisState.status ?? "unknown",
            connected: aisState.connected ?? false,
            vesselCount: aisState.vesselCount ?? 0,
            error: aisState.error ?? null,
          };
        } else {
          results.ais = { configured: false, status: "not_configured", connected: false, vesselCount: 0 };
        }

        sendJson(res, results);
      })();
    };
  }

  return {
    attach(middlewares) {
      middlewares.use("/api/env-check", handleRoute("/api/env-check"));
      middlewares.use("/api/provider-health", handleRoute("/api/provider-health"));
    },
  };
}
