/**
 * ==========================================================
 * LÉLU — BARE SECRET NAMES
 *
 * This project's `.env.local` is WRITTEN BY THE PLATFORM, from
 * the project's secret store:
 *
 *   # Written by Freebuff from this project's secrets
 *   # (Settings → Projects). Changes here are replaced.
 *   Anthropic='…'
 *   Groq='…'
 *   Supabase='…'
 *
 * Those are the SECRET names. None of them is a name LÉLU reads:
 * the browser asks for `VITE_ANTHROPIC_API_KEY` (Vite's
 * `envPrefix` exposes only `VITE_*` / `NEXT_PUBLIC_*`) and the
 * server providers ask for `ANTHROPIC_API_KEY`.
 *
 * The symptom, observed live and not inferred: seven real
 * credentials sat in the file while every provider reported
 * itself unconfigured, LÉLU answered through her offline branch
 * instead of calling a model, and Supabase persistence stayed
 * `disabled` because its key was filed under `Supabase`.
 *
 * Renaming the lines by hand fixes it until the next time the
 * file is regenerated — which is what happened here: a working
 * hand-rename was replaced, and everything went dark again. So
 * the mapping lives in code instead, and survives regeneration.
 *
 * RULES
 * -----
 * 1. A DOCUMENTED NAME ALWAYS WINS. If `VITE_GROQ_API_KEY` (or
 *    `GROQ_API_KEY`) is set, the bare name is ignored entirely.
 *    This module can only fill a hole, never redirect a working
 *    configuration.
 * 2. WHAT THE BARE NAME SUPPLIES IS WHAT THE CODE ALREADY ASKS
 *    FOR. No new resolvers, no new precedence, no second
 *    configuration system.
 * 3. IT INVENTS NOTHING. A bare name supplies exactly one value.
 *    `Supabase` carries a publishable key, so it fills the key and
 *    NEVER a URL — the project URL is a separate fact and stays
 *    reported as missing until it is actually provided.
 * 4. NOTHING SECRET IS LOGGED. Callers receive the NAMES they
 *    filled, never a value.
 * ==========================================================
 */

/** Anything that can be read from and written to, like `process.env`. */
export interface EnvLookup {
  get: (name: string) => string | undefined;
  set: (name: string, value: string) => void;
}

export interface BareSecretAlias {
  /** The name the platform's secret store uses. */
  readonly bare: string;
  /** The documented names it supplies, in precedence order. */
  readonly names: readonly string[];
  /** Why the mapping is correct, for whoever reads this next. */
  readonly why: string;
}

/**
 * The closed list. Only names that are actually provisioned in this
 * project's secret store appear here, and each maps to the canonical
 * names the corresponding subsystem reads.
 */
export const BARE_SECRET_ALIASES: readonly BareSecretAlias[] = [
  {
    bare: "Anthropic",
    names: ["ANTHROPIC_API_KEY"],
    why:
      "Model credentials are brokered: the request goes to /api/model/<id> and the " +
      "SERVER attaches the key (plugins/modelApi.ts keyNames lists ANTHROPIC_API_KEY). " +
      "A VITE_ name would only publish the secret to the page.",
  },
  {
    bare: "Groq",
    names: ["GROQ_API_KEY"],
    why:
      "Brokered, so the server-side GROQ_API_KEY is what /api/model/groq resolves " +
      "first, and the key never reaches the bundle.",
  },
  {
    bare: "Openrouter",
    names: ["OPENROUTER_API_KEY"],
    why:
      "Brokered, so the server-side OPENROUTER_API_KEY is what /api/model/openrouter " +
      "resolves; OPEN_ROUTER_API_KEY remains accepted as the operator's own alias.",
  },
  {
    bare: "Github",
    names: ["GITHUB_MODELS_TOKEN", "GITHUB_TOKEN"],
    why:
      "One GitHub PAT serves two documented names: GITHUB_MODELS_TOKEN for brokered " +
      "inference (plugins/modelApi.ts keyNames) and GITHUB_TOKEN for the server-side " +
      "repo proxy and the engineering agent (plugins/githubApi.ts, " +
      "AnthropicEngineeringAgent.ts). Neither is a VITE_ name, so the token never " +
      "reaches the browser. Environment.ts NEVER_ADOPT_BARE still blocks an AMBIENT " +
      "GITHUB_TOKEN from being adopted as VITE_GITHUB_TOKEN — that rule is about " +
      "tokens the platform sets for git tooling, not about this provisioned secret.",
  },
  {
    bare: "Meshy",
    names: ["MESHY_API_KEY"],
    why: "Server-side only: assistant-mesh generation is relayed, so this must never become a VITE_ name.",
  },
  {
    bare: "Elevenlabs",
    names: ["ELEVENLABS_API_KEY"],
    why: "Voice synthesis reads ELEVENLABS_API_KEY on the server.",
  },
  {
    bare: "Supabase",
    names: ["VITE_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_PUBLISHABLE_KEY"],
    why:
      "The secret is a publishable (client-safe) key — designed to be public, with RLS " +
      "protecting the data — so it belongs in both the browser and server names. It is " +
      "not a URL, so no URL name is filled from it.",
  },
];

/**
 * Read a secret, removing ALL whitespace, and treat whitespace-only as absent.
 *
 * A credential never contains whitespace, and this project's store delivered one
 * that did: the GitHub PAT arrived as `ghp_` + 36 characters with a space
 * injected near the end — 43 raw characters for a 40-character token. The token
 * itself was valid (`GET api.github.com/user` answered 200 once the space was
 * gone), but every request that used it verbatim came back 401. A stray space is
 * a copy or line-wrap artifact and never part of a key, so it is removed here
 * rather than forwarded to a provider.
 */
function read(lookup: EnvLookup, name: string): string {
  const raw = lookup.get(name);
  return typeof raw === "string" ? raw.replace(/\s+/g, "") : "";
}

/**
 * Fill every documented name from its bare counterpart, ONLY where no
 * documented name is already set.
 *
 * Returns the names that were filled — names only, never values, so the
 * result is safe to log or serve from a diagnostics route.
 */
export function fillBareSecretAliases(lookup: EnvLookup): string[] {
  const filled: string[] = [];
  for (const alias of BARE_SECRET_ALIASES) {
    const bare = read(lookup, alias.bare);
    if (!bare) continue;
    // A documented name always wins: this can fill a hole, never redirect.
    if (alias.names.some((name) => read(lookup, name) !== "")) continue;
    for (const name of alias.names) {
      lookup.set(name, bare);
      filled.push(name);
    }
  }
  return filled;
}

/**
 * Diagnostic view: which bare names are present and which documented
 * names each one supplies. Carries no value, so it is safe to serve.
 */
export function bareSecretAliasReport(
  lookup: Pick<EnvLookup, "get">,
): Array<{ bare: string; supplies: string[] }> {
  const report: Array<{ bare: string; supplies: string[] }> = [];
  for (const alias of BARE_SECRET_ALIASES) {
    if (read(lookup as EnvLookup, alias.bare)) {
      report.push({ bare: alias.bare, supplies: [...alias.names] });
    }
  }
  return report;
}
