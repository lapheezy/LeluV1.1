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
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${encodeURIComponent(key)}/VIIRS_SNPP_NRT/-180,-90,180,90/2`;
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
          VITE_GROQ_API_KEY: presence(env("VITE_GROQ_API_KEY") || env("GROQ_API_KEY")),
          VITE_OPENROUTER_API_KEY: presence(
            env("VITE_OPENROUTER_API_KEY") || env("OPENROUTER_API_KEY"),
          ),
          VITE_ANTHROPIC_API_KEY: presence(
            env("VITE_ANTHROPIC_API_KEY") || env("ANTHROPIC_API_KEY") || env("CLAUDE_API_KEY"),
          ),
          VITE_FIRMS_API_KEY: presence(env("VITE_FIRMS_API_KEY")),
          AISSTREAM_API_KEY: presence(env("AISSTREAM_API_KEY")),
          INSTAGRAM_ACCESS_TOKEN: presence(env("INSTAGRAM_ACCESS_TOKEN") || env("VITE_INSTAGRAM_ACCESS_TOKEN")),
          INSTAGRAM_USERNAME: env("INSTAGRAM_USERNAME") || env("VITE_INSTAGRAM_USERNAME") || "MISSING",
          RSS_SAPIOLINGO: presence(env("VITE_SAPIOLINGO_RSS_URL") || env("SAPIOLINGO_RSS_URL")),
          RSS_ELPHERU: presence(env("VITE_ELPHERU_RSS_URL") || env("ELPHERU_RSS_URL")),
          RSS_GOOGLE_NEWS_1: presence(env("VITE_GOOGLE_NEWS_RSS_URL") || env("GOOGLE_NEWS_RSS_URL")),
          RSS_GOOGLE_NEWS_2: presence(env("VITE_GOOGLE_NEWS_RSS_URL_2") || env("GOOGLE_NEWS_RSS_URL_2")),
          NEKO_URL: env("VITE_NEKO_URL") || env("NEKO_URL") || "MISSING",
          VITE_GROQ_MODEL: env("VITE_GROQ_MODEL") ?? "MISSING",
          VITE_ANTHROPIC_MODEL: env("VITE_ANTHROPIC_MODEL") || env("ANTHROPIC_MODEL") || "MISSING",
          VITE_DEFAULT_PROVIDER: env("VITE_DEFAULT_PROVIDER") ?? "MISSING",
        });
        return;
      }

      void (async () => {
        const results: Record<string, unknown> = {};
        const groqKey = env("VITE_GROQ_API_KEY") || env("GROQ_API_KEY") || "";
        const openrouterKey = env("VITE_OPENROUTER_API_KEY") || env("OPENROUTER_API_KEY") || "";
        const anthropicKey =
          env("VITE_ANTHROPIC_API_KEY") || env("ANTHROPIC_API_KEY") || env("CLAUDE_API_KEY") || "";

        if (groqKey) {
          try {
            const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${groqKey}`,
              },
              body: JSON.stringify({
                model: env("VITE_GROQ_MODEL") || "llama-3.3-70b-versatile",
                messages: [{ role: "user", content: "Say OK" }],
                max_tokens: 5,
              }),
              signal: AbortSignal.timeout(15000),
            });
            const body = await groqRes.text();
            results.groq = {
              status: groqRes.status,
              ok: groqRes.ok,
              response: groqRes.ok ? "OK" : body.slice(0, 200),
            };
          } catch (error) {
            results.groq = { status: "error", error: error instanceof Error ? error.message : String(error) };
          }
        } else {
          results.groq = { status: "missing-key" };
        }

        if (openrouterKey) {
          try {
            const orRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${openrouterKey}`,
                "HTTP-Referer": "https://freebuff.com",
                "X-Title": "Lélu",
              },
              body: JSON.stringify({
                model: "openrouter/free",
                messages: [{ role: "user", content: "Say OK" }],
                max_tokens: 5,
              }),
              signal: AbortSignal.timeout(15000),
            });
            const body = await orRes.text();
            results.openrouter = {
              status: orRes.status,
              ok: orRes.ok,
              response: orRes.ok ? "OK" : body.slice(0, 200),
            };
          } catch (error) {
            results.openrouter = { status: "error", error: error instanceof Error ? error.message : String(error) };
          }
        } else {
          results.openrouter = { status: "missing-key" };
        }

        if (anthropicKey) {
          try {
            const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": anthropicKey,
                "anthropic-version": "2023-06-01",
              },
              body: JSON.stringify({
                model: env("VITE_ANTHROPIC_MODEL") || env("ANTHROPIC_MODEL") || "claude-sonnet-4-5",
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
