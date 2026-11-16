/**
 * ==========================================================
 * LÉLU — THE EMBEDDED NEURAL MAP CONTRACT (M17.2)
 *
 * How ANY interface participates in the Neural Map without a map of its
 * own. A host interface:
 *
 *   1. names its entities by canonical id (NID.* in NeuralMapTypes);
 *   2. reads them with useNeuralEntity / useNeuralRelations — live, and
 *      re-rendered only when THAT entity is touched by an update;
 *   3. offers "inspect" (NeuralView.inspect) and "open in the Neural
 *      Map" (NeuralView.openStandalone(id)) — both views read the same
 *      index, so the identity is the same everywhere;
 *   4. acts through runNeuralOperation → the existing tools.
 *
 * Cosmos (objects, via its object controls) and interface compositions
 * (via each region's bar) are the first hosts. Others join the same way.
 * ==========================================================
 */

import { useEffect, useState } from "react";
import { neuralMap, type Neighbor, type NeuralUpdate } from "../../../../core/neural/NeuralMap";
import { connectNeuralMap } from "../../../../core/neural/connectNeuralMap";
import type { NeuralEntity } from "../../../../core/neural/NeuralMapTypes";
export { useNeuralView } from "./useNeuralViewLite";

/** Make sure the map is live (idempotent; Bootstrap normally did it already). */
export function ensureNeuralMap(): void {
  connectNeuralMap();
}

function useTouched(id: string | null): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    ensureNeuralMap();
    return neuralMap().subscribe((u: NeuralUpdate) => {
      if (!id || u.changed.includes(id)) setTick((t) => t + 1);
    });
  }, [id]);
  return tick;
}

export function useNeuralEntity(id: string | null): NeuralEntity | undefined {
  useTouched(id);
  return id ? neuralMap().get(id) : undefined;
}

export function useNeuralRelations(id: string | null): Neighbor[] {
  useTouched(id);
  return id ? neuralMap().relations(id) : [];
}

/** Any update at all — for views that show counts or search results. */
export function useNeuralVersion(): number {
  const [v, setV] = useState(() => neuralMap().getVersion());
  useEffect(() => {
    ensureNeuralMap();
    setV(neuralMap().getVersion());
    return neuralMap().subscribe((u) => setV(u.version));
  }, []);
  return v;
}

/**
 * Run an operation the map lists for an entity, through the REAL
 * dispatcher (same AutonomyGate, events and activity trail as chat).
 */
export async function runNeuralOperation(tool: string, args: Record<string, unknown>): Promise<{ ok: boolean; content: string; data?: unknown }> {
  const { dispatchToolCall, toolNameForModel } = await import("../../../../core/tools/ToolDispatcher");
  const result = await dispatchToolCall({ id: `neural-${Date.now()}`, name: toolNameForModel(tool), arguments: args }, `neural-${Date.now()}`, undefined, { path: "direct" });
  return { ok: result.ok, content: result.content, data: (result as { data?: unknown }).data };
}
