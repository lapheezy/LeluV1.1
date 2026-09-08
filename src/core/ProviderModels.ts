/**
 * ==========================================================
 * LÉLU — DEFAULT CHAT MODEL REGISTRY
 *
 * Single source of truth for the DEFAULT CHAT MODEL ID of every
 * remote provider.
 *
 * WHY THIS EXISTS
 * ---------------
 * Each default used to be written three times: once as the
 * provider's field initializer, once again inside the same
 * provider's initialize(), and a third time in the health probe
 * in plugins/envApi.ts. Nothing kept the copies in agreement, and
 * they drifted exactly as you would expect:
 *
 *   - The health endpoint probed Groq with `llama-3.3-70b-versatile`
 *     long after that model was retired, so /api/provider-health
 *     reported Groq DOWN (404 model_not_found) while the provider
 *     itself — on `openai/gpt-oss-120b` — was answering normally.
 *     A green provider was being reported red.
 *   - Cerebras still defaulted to `llama-3.3-70b` and Fireworks to
 *     `llama-v3p1-70b-instruct`, neither of which those platforms
 *     serve any more. Both 404'd, so two of the four fallback rungs
 *     were dead and nothing noticed, because no probe covered them.
 *
 * A default model ID is not a secret and it is not a base URL — it
 * belongs with neither the credentials in Environment.ts nor the
 * hosts in Endpoints.ts, so it lives here, resolved the same way
 * both of those are.
 *
 * RESOLUTION
 * ----------
 * `resolveModel(id)` walks the standard four-rung chain via
 * resolveFirst() (VITE_-prefixed first at every rung), so an
 * operator can pin any provider to a different model without
 * touching source:
 *
 *   VITE_GROQ_MODEL / GROQ_MODEL, VITE_CEREBRAS_MODEL / …
 *
 * Runtimes that read configuration through their own env reader
 * rather than resolveFirst() — the health probe in envApi.ts — use
 * `defaultModel(id)` for the fallback and apply their own override
 * lookup in front of it.
 * ==========================================================
 */

import { resolveFirst } from "./resolveEnv.ts";

export interface ModelDefault {
  /** Environment names accepted as an override, in precedence order. */
  readonly names: readonly string[];
  /** The model used when nothing is configured. */
  readonly fallback: string;
  /** Why this ID and not another — read this before changing one. */
  readonly note: string;
}

/**
 * Verified live against each platform's own /models catalog and a
 * real completion. When a platform retires a model, change it HERE
 * and every caller follows.
 */
export const MODEL_DEFAULTS = {
  groq: {
    names: ["GROQ_MODEL"],
    fallback: "openai/gpt-oss-120b",
    note: "Groq's current production chat model; llama-3.3-70b-versatile was retired.",
  },
  openrouter: {
    names: ["OPENROUTER_MODEL"],
    fallback: "openrouter/free",
    note: "OpenRouter's auto-routed free tier — an alias, not a specific model.",
  },
  cerebras: {
    names: ["CEREBRAS_MODEL"],
    fallback: "gpt-oss-120b",
    note: "Cerebras serves gpt-oss-120b / gemma-4-31b / qwen-3.8-27b; it no longer serves any llama.",
  },
  mistral: {
    names: ["MISTRAL_MODEL"],
    fallback: "mistral-large-latest",
    note: "Mistral's rolling alias — tracks their current large model.",
  },
  fireworks: {
    names: ["FIREWORKS_MODEL"],
    fallback: "accounts/fireworks/models/gpt-oss-120b",
    note: "Serverless, tool-capable, 131k context; llama-v3p1-70b-instruct is no longer deployed.",
  },
  anthropic: {
    names: ["ANTHROPIC_MODEL"],
    fallback: "claude-sonnet-4-5",
    note: "Anthropic Messages API model id.",
  },
  gemini: {
    names: ["GEMINI_MODEL"],
    fallback: "gemini-2.0-flash",
    note: "Google's fast generateContent model.",
  },
  githubModels: {
    names: ["GITHUB_MODEL"],
    fallback: "openai/gpt-4o",
    note: "GitHub Models inference catalog id.",
  },
} as const satisfies Record<string, ModelDefault>;

export type ProviderModelId = keyof typeof MODEL_DEFAULTS;

/** The built-in default for a provider, ignoring any override. */
export function defaultModel(id: ProviderModelId): string {
  return MODEL_DEFAULTS[id].fallback;
}

/** The configured model for a provider, falling back to the default. */
export function resolveModel(id: ProviderModelId): string {
  const definition = MODEL_DEFAULTS[id];
  return resolveFirst(...definition.names) ?? definition.fallback;
}

/** Every default, for diagnostics that want to show what is in use. */
export function modelDiagnostics(): Array<{
  id: ProviderModelId;
  model: string;
  overridden: boolean;
}> {
  return (Object.keys(MODEL_DEFAULTS) as ProviderModelId[]).map((id) => {
    const model = resolveModel(id);
    return { id, model, overridden: model !== MODEL_DEFAULTS[id].fallback };
  });
}
