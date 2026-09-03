/**
 * ==========================================================
 * LÉLU — RUNTIME KEY BRIDGE
 *
 * WHY THIS EXISTS
 * ---------------
 * Every AI chat provider resolves its key through four rungs,
 * in this order (see OpenRouterProvider / GroqProvider / …):
 *
 *   1. import.meta.env.VITE_<NAME>      ← browser + server
 *   2. globalThis.__LELU_<NAME>__       ← browser + server
 *   3. window.__LELU_<NAME>__           ← browser only
 *   4. process.env.<NAME>               ← server only
 *
 * Rung 4 is the only rung that accepts an UNPREFIXED name, and
 * it does not exist in the browser: `process` is undefined
 * there. Rung 1 cannot see an unprefixed name either, because
 * `envPrefix` in vite.config.ts is deliberately restricted to
 * VITE_ / NEXT_PUBLIC_ so that server-only secrets are never
 * inlined into the bundle.
 *
 * Rungs 2 and 3 were dead: NOTHING in the repository ever
 * assigned a `__LELU_*__` global. They were written for "the
 * platform's Keys UI", which does not exist here.
 *
 * The consequence — and this is the actual defect this module
 * repairs — is that a secret provisioned under its ORDINARY
 * name (`OPENROUTER_API_KEY`, `GROQ_API_KEY` — the shape GitHub
 * Codespaces, Vercel, Fly, Render and a plain shell export all
 * produce, none of which have a VITE_ convention) is present in
 * the process yet completely invisible to LÉLU's browser
 * runtime. The provider reports `hasKey: false` and the
 * fallback chain walks past it, so the symptom is "no provider
 * configured" while the key sits right there in the environment.
 *
 * WHAT THIS DOES
 * --------------
 * It fills rung 3 — the existing channel — from the unprefixed
 * process environment, and ONLY when the VITE_ name for that
 * same provider is absent. No new configuration system, no new
 * variable names, no change to the fallback priority: VITE_
 * still wins, and a provider that was already working keeps
 * resolving exactly the key it resolved before.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * --------------------------------
 * The allowlist is closed and contains ONLY the AI chat
 * provider keys that the browser providers already read and
 * already send from the client. Bridging does not change those
 * keys' exposure: a client-side SPA calling Groq or OpenRouter
 * directly necessarily ships the key to the client, which is
 * exactly what VITE_GROQ_API_KEY does today.
 *
 * Server-only secrets are NOT in the allowlist and never reach
 * the client: AISSTREAM_API_KEY, INSTAGRAM_ACCESS_TOKEN and
 * anything else not named below stay exactly where they are.
 *
 * GITHUB_TOKEN / GITHUB_CODESPACE_TOKEN are NOT bridged either.
 * GitHubModelsProvider documents the reason and it is correct:
 * dev containers, Codespaces and CI runners set an ambient
 * GITHUB_TOKEN for git tooling that is not a GitHub Models
 * inference key. Adopting it would make the provider falsely
 * report "available" and spend a repo-scoped token against an
 * unrelated API. That token must be supplied explicitly as
 * VITE_GITHUB_TOKEN.
 * ==========================================================
 */

/** Reads a name out of the host environment. Returns undefined when unset. */
export type EnvReader = (key: string) => string | undefined;

/**
 * The closed allowlist: the VITE_ name LÉLU documents, the
 * `__LELU_*__` global the providers already read, and the
 * unprefixed names a platform is likely to have provisioned.
 *
 * `aliases` is ordered — the first one carrying a value wins.
 */
export interface BridgedKey {
  /** The documented configuration name; always takes precedence. */
  readonly viteName: string;
  /** The runtime global the providers already read (rungs 2 and 3). */
  readonly globalName: string;
  /** Unprefixed names accepted as a lower-priority fallback. */
  readonly aliases: readonly string[];
}

export const BRIDGED_KEYS: readonly BridgedKey[] = [
  // ---- AI chat provider credentials (fallback priority order) ----
  {
    viteName: "VITE_GROQ_API_KEY",
    globalName: "__LELU_GROQ_API_KEY__",
    aliases: ["GROQ_API_KEY"],
  },
  {
    viteName: "VITE_OPENROUTER_API_KEY",
    globalName: "__LELU_OPENROUTER_API_KEY__",
    aliases: ["OPENROUTER_API_KEY", "OPEN_ROUTER_API_KEY"],
  },
  {
    viteName: "VITE_CEREBRAS_API_KEY",
    globalName: "__LELU_CEREBRAS_API_KEY__",
    aliases: ["CEREBRAS_API_KEY"],
  },
  {
    viteName: "VITE_MISTRAL_API_KEY",
    globalName: "__LELU_MISTRAL_API_KEY__",
    aliases: ["MISTRAL_API_KEY"],
  },
  {
    viteName: "VITE_FIREWORKS_API_KEY",
    globalName: "__LELU_FIREWORKS_API_KEY__",
    aliases: ["FIREWORKS_API_KEY"],
  },
  {
    // ANTHROPIC_API_KEY is the name the Anthropic SDK, the Codespaces
    // secret UI and every shell export use; it is the ONLY name most
    // environments will ever carry, so the alias is what actually
    // resolves in practice and VITE_ANTHROPIC_API_KEY is the override.
    viteName: "VITE_ANTHROPIC_API_KEY",
    globalName: "__LELU_ANTHROPIC_API_KEY__",
    aliases: ["ANTHROPIC_API_KEY", "CLAUDE_API_KEY"],
  },

  // ---- Model overrides (not secrets, same resolution shape) ----
  {
    viteName: "VITE_GROQ_MODEL",
    globalName: "__LELU_GROQ_MODEL__",
    aliases: ["GROQ_MODEL"],
  },
  {
    viteName: "VITE_OPENROUTER_MODEL",
    globalName: "__LELU_OPENROUTER_MODEL__",
    aliases: ["OPENROUTER_MODEL"],
  },
  {
    viteName: "VITE_CEREBRAS_MODEL",
    globalName: "__LELU_CEREBRAS_MODEL__",
    aliases: ["CEREBRAS_MODEL"],
  },
  {
    viteName: "VITE_MISTRAL_MODEL",
    globalName: "__LELU_MISTRAL_MODEL__",
    aliases: ["MISTRAL_MODEL"],
  },
  {
    viteName: "VITE_FIREWORKS_MODEL",
    globalName: "__LELU_FIREWORKS_MODEL__",
    aliases: ["FIREWORKS_MODEL"],
  },
  {
    viteName: "VITE_ANTHROPIC_MODEL",
    globalName: "__LELU_ANTHROPIC_MODEL__",
    aliases: ["ANTHROPIC_MODEL"],
  },
];

function value(read: EnvReader, key: string): string {
  const raw = read(key);
  return typeof raw === "string" ? raw.trim() : "";
}

export interface BridgeEntry {
  /** The `__LELU_*__` global that will be defined. */
  globalName: string;
  /** The environment variable NAME the value came from (never the value). */
  sourceName: string;
  /** The value to publish. */
  value: string;
}

/**
 * Work out which globals need publishing. A key whose VITE_ name is
 * already set is SKIPPED — rung 1 wins and must keep winning, so the
 * bridge never changes which key a working provider resolves.
 */
export function resolveBridge(read: EnvReader): BridgeEntry[] {
  const entries: BridgeEntry[] = [];
  for (const key of BRIDGED_KEYS) {
    if (value(read, key.viteName)) continue; // documented name wins
    for (const alias of key.aliases) {
      const found = value(read, alias);
      if (found) {
        entries.push({ globalName: key.globalName, sourceName: alias, value: found });
        break; // first alias carrying a value wins
      }
    }
  }
  return entries;
}

/**
 * Diagnostic view: which globals the bridge publishes and which
 * environment variable NAME each came from. Never carries a value, so
 * it is safe to log and safe to serve from /api/env-check.
 */
export function bridgeReport(
  read: EnvReader,
): Array<{ globalName: string; sourceName: string }> {
  return resolveBridge(read).map(({ globalName, sourceName }) => ({
    globalName,
    sourceName,
  }));
}

/** Escape for safe embedding inside a <script> block. */
function jsString(raw: string): string {
  return JSON.stringify(raw).replace(/</g, "\\u003c");
}

/**
 * The script BODY that publishes the bridged globals, or "" when there
 * is nothing to bridge. Assigns onto `globalThis` so rungs 2 and 3 are
 * both satisfied (in a browser `window === globalThis`).
 */
export function bridgeScriptBody(read: EnvReader): string {
  const entries = resolveBridge(read);
  if (entries.length === 0) return "";
  const assignments = entries
    .map((e) => `  g[${jsString(e.globalName)}] = ${jsString(e.value)};`)
    .join("\n");
  return [
    "// LÉLU runtime key bridge — see plugins/runtimeKeyBridge.ts.",
    "// Publishes unprefixed provider keys onto the __LELU_*__ channel the",
    "// providers already read. VITE_-named keys are never overridden here.",
    "(function () {",
    "  var g = typeof globalThis !== 'undefined' ? globalThis : window;",
    assignments,
    "})();",
  ].join("\n");
}

/**
 * Apply the bridge directly to the current process globals. Used by the
 * non-Vite runtimes (server.ts / main.ts) so that a server-side
 * provider initialize() resolves the same key the browser would.
 */
export function applyBridgeToGlobals(read: EnvReader): Array<{
  globalName: string;
  sourceName: string;
}> {
  const target = globalThis as unknown as Record<string, string>;
  const applied: Array<{ globalName: string; sourceName: string }> = [];
  for (const entry of resolveBridge(read)) {
    target[entry.globalName] = entry.value;
    applied.push({ globalName: entry.globalName, sourceName: entry.sourceName });
  }
  return applied;
}

/**
 * Vite plugin. Injects the bridge script at the top of <head>, so the
 * globals exist before any module — including /src/main.tsx and every
 * provider's initialize() — evaluates.
 */
export function runtimeKeyBridgePlugin(read: EnvReader) {
  return {
    name: "lelu-runtime-key-bridge",
    transformIndexHtml() {
      const body = bridgeScriptBody(read);
      if (!body) return [];
      return [
        {
          tag: "script",
          injectTo: "head-prepend" as const,
          children: body,
        },
      ];
    },
  };
}
