/**
 * ==========================================================
 * LÉLU
 * TOOL SCHEMAS — what a model is allowed to be told it has
 *
 * The set of tools offered to a model is derived, never authored:
 *
 *   ToolRegistry (what LÉLU declares)
 *     ∩ ToolDispatcher (what actually executes)
 *     ∩ AutonomyGate (what is permitted right now)
 *
 * All three must agree. A registry entry with no executor is not
 * offered; an executor for a tool the registry marks unavailable is
 * not offered; and neither is a tool above the current autonomy level.
 *
 * This is the mechanism that keeps native tool calling honest. A model
 * offered a tool it cannot actually run will call it, be told it
 * failed, and then — reliably — describe the result it expected. The
 * fix is not to prompt against that; it is to never make the offer.
 * ==========================================================
 */

import type { ToolSchema } from "../../providers/AIProvider";
import ToolRegistry from "./ToolRegistry";
import {
  executableToolIds,
  executorParameters,
  toolNameForModel,
  toolPermitted,
} from "./ToolDispatcher";

/**
 * Every tool that is registered, executable and currently permitted,
 * in provider-neutral form.
 */
export function toolSchemasForModel(): ToolSchema[] {
  const registry = ToolRegistry.getInstance();
  const schemas: ToolSchema[] = [];

  for (const id of executableToolIds()) {
    const definition = registry.get(id);
    if (!definition) continue;
    if (!toolPermitted(id)) continue;

    const parameters = executorParameters(id);
    if (!parameters) continue;

    schemas.push({
      name: toolNameForModel(id),
      // The registry description is what LÉLU already tells the rest of
      // the system this tool does; the model gets the same sentence
      // rather than a second, drifting one.
      description: `${definition.description} (category: ${definition.category})`,
      parameters,
    });
  }

  return schemas;
}

/**
 * An OPERATE-MY-ENVIRONMENT turn: it asks to build, change or present what
 * is on screen. Deliberately the same vocabulary the environment tools
 * themselves serve, so the narrowing below cannot drift from them.
 */
const ENVIRONMENT_REQUEST =
  /\b(?:environment|workspaces?|surfaces?|layout|artifact|diagram|table|chart|panel|window|cosmos)\b/i;

export const ENVIRONMENT_TOOL_PREFIX = "environment_";

/**
 * Narrow an already-derived tool list to the environment family.
 *
 * Fails OPEN: if the narrowing would leave nothing to offer, the full set
 * is returned instead — a turn is never left with no tools because a
 * category happened to be empty.
 */
export function scopeToolSchemas(
  schemas: ToolSchema[],
  prompt = "",
  intent?: string,
): ToolSchema[] {
  const environmentTurn = Boolean(intent && /environment/i.test(intent)) || ENVIRONMENT_REQUEST.test(prompt);
  if (!environmentTurn) return schemas;
  const narrowed = schemas.filter((schema) => schema.name.startsWith(ENVIRONMENT_TOOL_PREFIX));
  return narrowed.length > 0 ? narrowed : schemas;
}

/**
 * The tools offered for ONE turn.
 *
 * Offering every executable tool made each request ~19.5k tokens. Measured
 * against Groq: `413 Request too large … tokens per minute (TPM): Limit
 * 8000, Requested 19553`. The resolver then did what it is designed to do —
 * retried the SAME request without tool schemas — so the model never had a
 * single tool to choose from and answered with prose about a workspace it
 * could not build. Autonomy was not missing; it was refused by the request
 * size, on a payload the schemas were 90% of.
 *
 * So an environment turn is offered the environment tools, and every other
 * turn keeps the full set exactly as before. The narrowing is a filter over
 * the derived list (registry ∩ executor ∩ gate), never a second list.
 */
export function toolSchemasForRequest(prompt = "", intent?: string): ToolSchema[] {
  return scopeToolSchemas(toolSchemasForModel(), prompt, intent);
}

/**
 * How many tools a size-refused turn may still carry on its retry.
 *
 * Small on purpose: this is the middle rung, not a budget.
 */
export const REDUCED_TOOL_LIMIT = 3;

/**
 * The set offered on a retry after a size refusal.
 *
 * The resolver used to answer a 413 by sending the SAME request with NO tools
 * at all — which is why the model then described work it could not perform.
 * A refused turn now first retries with a smaller set: the environment family
 * when the turn is about the environment, otherwise the cheapest schemas to
 * carry, so a tool-calling turn keeps the ability to act while it shrinks.
 * Only if THAT is still refused does the turn fall back to no tools.
 */
export function reducedToolSchemas(prompt = "", intent?: string): ToolSchema[] {
  const scoped = toolSchemasForRequest(prompt, intent);
  if (scoped.length <= REDUCED_TOOL_LIMIT) return scoped;

  const environment = scoped.filter((schema) => schema.name.startsWith(ENVIRONMENT_TOOL_PREFIX));
  if (environment.length > 0) return environment.slice(0, REDUCED_TOOL_LIMIT);

  return [...scoped]
    .sort((a, b) => a.description.length - b.description.length)
    .slice(0, REDUCED_TOOL_LIMIT);
}

/**
 * Diagnostic: why each executable tool is or is not being offered.
 * Used by the verification script and the capability matrix so the
 * offered set can be inspected rather than assumed.
 */
export function toolSchemaDiagnostics(): Array<{
  id: string;
  registered: boolean;
  available: boolean;
  permitted: boolean;
  offered: boolean;
}> {
  const registry = ToolRegistry.getInstance();
  return executableToolIds().map((id) => {
    const definition = registry.get(id);
    const permitted = toolPermitted(id);
    return {
      id,
      registered: Boolean(definition),
      available: Boolean(definition?.available),
      permitted,
      offered: Boolean(definition) && permitted && Boolean(executorParameters(id)),
    };
  });
}
