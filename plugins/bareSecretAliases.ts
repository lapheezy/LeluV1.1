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
 * the browser asks for `VITE_SUPABASE_PUBLISHABLE_KEY` (Vite's
 * `envPrefix` exposes only `VITE_*` / `NEXT_PUBLIC_*`) and the
 * server providers ask for `SUPABASE_PUBLISHABLE_KEY` /
 * `ANTHROPIC_API_KEY`.
 *
 * The symptom, observed live and not inferred: real credentials
 * sit in the file while every provider reports itself
 * unconfigured, LÉLU answers through her offline branch instead
 * of calling a model, and Supabase persistence stays `disabled`
 * because its key is filed under `Supabase`.
 *
 * Renaming the lines by hand fixes it until the next time the
 * file is regenerated — so the mapping lives in code instead,
 * and survives regeneration.
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

import { isBrowserSafeSupabaseKey } from "../src/core/config/supabaseEnv.ts";

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
  /** Optional guard: a bare value it rejects fills nothing. */
  readonly accept?: (value: string) => boolean;
}

/** How many numbered slots the secret store provisions per provider. */
const NUMBERED_SLOTS = 3;

/**
 * One provider's numbered credentials (`Groq1`…`Groq3`).
 *
 * Slot 1 also supplies the BASE name, because the single-key paths in the
 * app (`plugins/modelApi.ts` keyNames, `/api/env-check`, and the
 * `__LELU_GROQ_API_KEY__` channel voice transcription reads) ask only for
 * the base name. The numbered ring names are what
 * `src/core/model/ProviderKeyRing.ts` rotates through.
 */
function numberedSlots(barePrefix: string, documentedBase: string, why: string): BareSecretAlias[] {
  const aliases: BareSecretAlias[] = [];
  for (let slot = 1; slot <= NUMBERED_SLOTS; slot += 1) {
    aliases.push({
      bare: `${barePrefix}${slot}`,
      names: slot === 1 ? [documentedBase, `${documentedBase}_${slot}`] : [`${documentedBase}_${slot}`],
      why,
    });
  }
  return aliases;
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
    names: ["GITHUB_MODELS_TOKEN"],
    why:
      "GITHUB_MODELS_TOKEN is the documented name for a GitHub Models inference token " +
      "(plugins/modelApi.ts keyNames). The ambient GITHUB_TOKEN is deliberately NOT " +
      "used — Environment.ts NEVER_ADOPT_BARE blocks it, because a dev container sets " +
      "one for git tooling that is not an inference key.",
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
    names: ["SUPABASE_PUBLISHABLE_KEY"],
    why:
      "The secret is a publishable (client-safe) key — designed to be public, with RLS " +
      "protecting the data — so it belongs under the server name every Supabase path " +
      "reads. The VITE_ name is deliberately NOT filled: a value written only into the " +
      "config's own env copy never reaches import.meta.env, and setting the VITE_ name " +
      "there would make plugins/runtimeKeyBridge.ts skip the key (its VITE_-wins rule), " +
      "leaving the browser with no key at all. The bridge publishes " +
      "__LELU_SUPABASE_PUBLISHABLE_KEY__ from this name instead. It is not a URL, so no " +
      "URL name is filled from it. Observed live: this secret held an sbp_ personal " +
      "access token, which is NOT a publishable key, so only a browser-safe key fills.",
    accept: isBrowserSafeSupabaseKey,
  },

  // The secret store now holds several credentials per provider, named
  // `Groq1`…`Groq3` and `Openrouter1`…`Openrouter3`. Those are the names that
  // arrive; nothing read them, so three valid keys per provider sat unused while
  // the ring reported none — the same failure this module exists to prevent,
  // one layer along.
  ...numberedSlots(
    "Groq",
    "GROQ_API_KEY",
    "Groq credentials are brokered; slot 1 also supplies the base name every single-key path reads, and the numbered names are what ProviderKeyRing rotates.",
  ),
  ...numberedSlots(
    "Openrouter",
    "OPENROUTER_API_KEY",
    "OpenRouter credentials are brokered; slot 1 also supplies the base name every single-key path reads, and the numbered names are what ProviderKeyRing rotates.",
  ),
];

/** Trim, and treat whitespace-only as absent. */
function read(lookup: EnvLookup, name: string): string {
  const raw = lookup.get(name);
  return typeof raw === "string" ? raw.trim() : "";
}

/**
 * Fill every documented name from its bare counterpart, ONLY where that
 * documented name is not already set.
 *
 * The hole is judged per NAME, not per alias: `Groq1` supplies both
 * `GROQ_API_KEY` and `GROQ_API_KEY_1`, and an operator who sets only
 * `GROQ_API_KEY` by hand must still get the numbered slots filled from
 * `Groq2` / `Groq3`. A documented name still always wins for itself, so this
 * can fill a hole and never redirect a working configuration.
 *
 * Returns the names that were filled — names only, never values, so the
 * result is safe to log or serve from a diagnostics route.
 */
export function fillBareSecretAliases(lookup: EnvLookup): string[] {
  const filled: string[] = [];
  for (const alias of BARE_SECRET_ALIASES) {
    const bare = read(lookup, alias.bare);
    if (!bare) continue;
    if (alias.accept && !alias.accept(bare)) continue;
    for (const name of alias.names) {
      if (read(lookup, name) !== "") continue;
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
export function bareSecretAliasReport(lookup: Pick<EnvLookup, "get">): Array<{ bare: string; supplies: string[] }> {
  const report: Array<{ bare: string; supplies: string[] }> = [];
  for (const alias of BARE_SECRET_ALIASES) {
    if (read(lookup as EnvLookup, alias.bare)) {
      report.push({ bare: alias.bare, supplies: [...alias.names] });
    }
  }
  return report;
}
