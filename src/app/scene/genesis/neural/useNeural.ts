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
import { homePartition } from "../../../../core/neural/adapters";
import { INTERFACES } from "../../../../core/interface/InterfaceCatalog";
import { APPS } from "../home/homeCatalog";
export { useNeuralView } from "./useNeuralViewLite";

/** Make sure the map is live (idempotent; Bootstrap normally did it already). */
export function ensureNeuralMap(): void {
  connectNeuralMap();
  if (!homeIndexed) {
    // The Home's catalog is static: index it once (WP02).
    homeIndexed = true;
    neuralMap().setPartition(homePartition([...APPS.map((a) => ({ ...a, operations: APP_TOOLS[a.id] })), ...SHELL_APPS], INTERFACES.map((i) => i.id), { genesisv2: "lelu-room" }));
  }
}
let homeIndexed = false;

/** Reached from the shell (Home, dock) but not panels of the Home's catalog. */
const SHELL_APPS = [
  { id: "chat-universe", label: "Chat Universe", hint: "Every conversation at once", group: "business" },
  { id: "eng-studio", label: "Engineering Studio", hint: "Execution, verification, engines", group: "development", operations: ["engineering.remote"] },
];

/** The tools an app's own work goes through — read from each panel's code, not guessed. */
const APP_TOOLS: Record<string, string[] | undefined> = {
  engineering: ["sandbox.read", "sandbox.write"],
  creation: ["studio.open", "studio.read"],
  projects: ["project.manage"],
};

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
