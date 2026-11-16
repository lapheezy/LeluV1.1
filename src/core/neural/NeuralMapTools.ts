/**
 * ==========================================================
 * LÉLU — NEURAL MAP TOOLS (M17.2)
 *
 *   neural.inspect   what an entity is, its state, where it is, what it
 *                    is related to (by type and direction), where it came
 *                    from, and which real tools can act on it
 *   neural.search    find entities by text, type or authority
 *
 * Both are READ (risk 0) and deterministic — no model call. They read
 * the same shared index every interface reads. Changing anything is
 * done with the existing tools the inspection lists (cosmos.object.*,
 * cosmos.workspace, interface.*), through the same dispatcher.
 * ==========================================================
 */

import type { ToolDefinition } from "../tools/ToolRegistry";
import ToolRegistry from "../tools/ToolRegistry";
import { registerExecutor, type ToolExecutor } from "../tools/ToolDispatcher";
import { neuralMap } from "./NeuralMap";
import { RELATION_WORDS, type NeuralEntity } from "./NeuralMapTypes";

const def = (id: string, name: string, description: string, inputSchema: Record<string, unknown>): ToolDefinition => ({
  id,
  name,
  description,
  category: "Cosmos",
  permissions: ["READ"],
  riskLevel: 0,
  available: true,
  inputSchema,
});

const INSPECT_SCHEMA = { type: "object", properties: { entity: { type: "string", description: "A canonical id (e.g. cosmos.object:obj-…), or a name" } }, required: ["entity"], additionalProperties: false };
const SEARCH_SCHEMA = {
  type: "object",
  properties: { text: { type: "string" }, type: { type: "string" }, authority: { type: "string" }, limit: { type: "number" } },
  additionalProperties: false,
};

export const NEURAL_TOOLS: ToolDefinition[] = [
  def("neural.inspect", "Inspect in the Neural Map", "Read one entity of LÉLU's Neural Map: identity, state, position, typed relationships in and out, provenance, and the real tools that can act on it.", INSPECT_SCHEMA),
  def("neural.search", "Search the Neural Map", "Find entities in LÉLU's Neural Map (Cosmos objects, rooms, placed records, Room objects, capabilities, interfaces, compositions) by text, type or authority.", SEARCH_SCHEMA),
];

/** An exact canonical id, or the one entity whose name matches. */
export function resolveEntity(ref: string): NeuralEntity | { ambiguous: NeuralEntity[] } | undefined {
  const map = neuralMap();
  const exact = map.get(ref.trim());
  if (exact) return exact;
  const hits = map.search({ text: ref, limit: 8 }).filter((e) => e.authority !== "referenced");
  const named = hits.filter((e) => e.label.toLowerCase() === ref.trim().toLowerCase());
  if (named.length === 1) return named[0];
  if (hits.length === 1) return hits[0];
  return hits.length ? { ambiguous: hits } : undefined;
}

/** Only tools that are actually registered right now. */
export function liveOperations(entity: NeuralEntity): string[] {
  const registry = ToolRegistry.getInstance();
  return entity.operations.filter((id) => Boolean(registry.get(id)));
}

export function describeEntity(entity: NeuralEntity): string {
  const map = neuralMap();
  const lines = [`${entity.label} [${entity.id}] — ${entity.type}, ${entity.state}, owned by ${entity.authority} (${entity.sourceId})`];
  if (entity.spatial) lines.push(`Position ${entity.spatial.position.map((n) => Number(n.toFixed(2))).join(", ")}${entity.spatial.space ? ` in ${map.get(entity.spatial.space)?.label ?? entity.spatial.space}` : ""}`);
  const rel = map.relations(entity.id);
  if (rel.length) {
    lines.push("Relationships:");
    for (const n of rel) {
      const words = RELATION_WORDS[n.relation.type][n.direction];
      const other = n.entity ? `${n.entity.label} [${n.entity.id}]` : `${n.direction === "out" ? n.relation.to : n.relation.from} (not in the map)`;
      lines.push(`  • ${words} ${other}`);
    }
  }
  if (entity.provenance.length) lines.push(`History: ${entity.provenance.slice(-6).map((p) => p.action).join(" → ")}`);
  const ops = liveOperations(entity);
  if (ops.length) lines.push(`Can be operated by: ${ops.join(", ")}`);
  return lines.join("\n");
}

export const NEURAL_EXECUTORS: ToolExecutor[] = [
  {
    id: "neural.inspect",
    parameters: INSPECT_SCHEMA,
    run: async (args) => {
      const ref = typeof args.entity === "string" ? args.entity : "";
      const found = resolveEntity(ref);
      if (!found) return { ok: false, content: `Nothing in the Neural Map matches “${ref}”.` };
      if ("ambiguous" in found) return { ok: false, content: `“${ref}” matches ${found.ambiguous.length} entities — use an id: ${found.ambiguous.map((e) => `${e.label} [${e.id}]`).join(", ")}` };
      return { ok: true, content: describeEntity(found), data: { id: found.id, relations: neuralMap().relations(found.id).map((n) => n.relation) } };
    },
  },
  {
    id: "neural.search",
    parameters: SEARCH_SCHEMA,
    run: async (args) => {
      const hits = neuralMap().search({
        text: typeof args.text === "string" ? args.text : undefined,
        types: typeof args.type === "string" ? [args.type as NeuralEntity["type"]] : undefined,
        authorities: typeof args.authority === "string" ? [args.authority as NeuralEntity["authority"]] : undefined,
        limit: typeof args.limit === "number" ? Math.min(100, Math.max(1, args.limit)) : 25,
      });
      const s = neuralMap().stats();
      return {
        ok: true,
        content: [`${hits.length} match(es) — the map holds ${s.entities} entities and ${s.relations} relations.`, ...hits.map((e) => `• ${e.label} [${e.id}] — ${e.type}, ${e.state}`)].join("\n"),
        data: { ids: hits.map((e) => e.id) },
      };
    },
  },
];

export function registerNeuralMapTools(): void {
  for (const executor of NEURAL_EXECUTORS) {
    const definition = NEURAL_TOOLS.find((t) => t.id === executor.id);
    if (!definition) continue;
    const added = registerExecutor(executor, definition);
    if (!added.ok) console.warn(`[NeuralMapTools] ${executor.id} was not registered: ${added.reason}`);
  }
}
