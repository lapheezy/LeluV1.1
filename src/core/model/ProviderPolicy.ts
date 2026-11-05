/**
 * ==========================================================
 * LÉLU — PROVIDER POLICY
 *
 * Operator policy that sits ABOVE credentials: a provider can have
 * a key configured and still be switched off.
 *
 * ANTHROPIC IS OPT-IN
 * -------------------
 * Anthropic (chat provider and the managed engineering agent) is
 * disabled unless LELU_ENABLE_ANTHROPIC is explicitly true. A key
 * being present is not consent to spend on it, and a failing
 * Fireworks/Kimi turn must never land on Claude without anyone
 * deciding that. With the flag off, Anthropic reports unavailable,
 * so it is absent from the fallback chain entirely — there is no
 * path by which a turn silently falls back to it.
 *
 * Resolved through resolveFirst(), so VITE_LELU_ENABLE_ANTHROPIC,
 * the __LELU_*__ runtime globals and process.env all work.
 * ==========================================================
 */

import { resolveFirst } from "../resolveEnv";

const TRUE = new Set(["1", "true", "yes", "on"]);

/** True only when the operator explicitly turned Anthropic on. */
export function anthropicEnabled(): boolean {
  const raw = resolveFirst("LELU_ENABLE_ANTHROPIC");
  return raw !== undefined && TRUE.has(raw.trim().toLowerCase());
}

export const ANTHROPIC_DISABLED_REASON =
  "Anthropic is disabled by policy (set LELU_ENABLE_ANTHROPIC=true to opt in).";
