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
