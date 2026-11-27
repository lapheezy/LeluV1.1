/**
 * ==========================================================
 * LÉLU — NEURAL MAP MULTIVERSE: THE THREE ASPECTS
 *
 * Pure derivations from the authorities that already own each thing.
 * Nothing is stored here and nothing is invented: an aspect with no
 * record of something says so in `gaps` instead of drawing it.
 *
 *   v1Graph   NeuralMapIndex          (the canonical index, as is)
 *   v2Graph   cognitiveArchitecture   (src/core subsystems + imports,
 *                                      generated from the source)
 *   v3Graph   ExecutiveBoard + AgentStore (executives, persistent
 *                                      agents, their delegated tasks)
 * ==========================================================
 */

import type { NeuralMapIndex } from "../NeuralMap";
import type { LeluAgent } from "../../agents/AgentTypes";
import { ownershipOf } from "../../agents/ExecutiveOwnership";
import type { MvEdge, MvGraph, MvNode } from "./MultiverseTypes";
import architecture from "./cognitiveArchitecture.generated.json";

/* ---------------------------------------------------------- V1 */

export function v1Graph(map: NeuralMapIndex, opts: { includeReferenced?: boolean; limit?: number } = {}): MvGraph {
  const limit = opts.limit ?? 600;
  const all = map.all().filter((e) => opts.includeReferenced || e.authority !== "referenced");
  const entities = all.slice(0, limit);
  const ids = new Set(entities.map((e) => e.id));
  const nodes: MvNode[] = entities.map((e) => ({
    id: e.id,
    label: e.label,
    kind: e.type,
    group: e.type,
    evidence: "declared",
    weight: e.provenance.length,
    time: e.updatedAt || undefined,
    source: { authority: e.authority, id: e.sourceId },
    facts: { authority: e.authority, state: e.state, ...e.facts },
  }));
  const edges: MvEdge[] = [];
  for (const e of entities)
    for (const n of map.relations(e.id, { direction: "out" }))
      if (ids.has(n.relation.to) && n.relation.type !== "operated-by")
        edges.push({ id: n.relation.id, from: n.relation.from, to: n.relation.to, kind: n.relation.type, evidence: "declared" });
  const gaps: string[] = [];
  if (all.length > limit) gaps.push(`${all.length - limit} more entities are in the index; narrow with search to see them.`);
  if (all.length === 0) gaps.push("The index is empty: no authority has reported yet.");
  return { aspect: "v1", nodes, edges, gaps };
}

/* ---------------------------------------------------------- V2 */

export interface ArchitectureData {
  nodes: Array<{ id: string; path: string; function: string; files: number; lines: number }>;
  edges: Array<{ from: string; to: string; imports: number }>;
}

export const FUNCTION_LABEL: Record<string, string> = {
  perception: "Perception",
  memory: "Memory",
  cognition: "Cognition",
  evaluation: "Evaluation & safety",
  planning: "Planning",
  conversation: "Conversation",
  tools: "Tools",
  "provider-routing": "Provider routing",
  reflection: "Reflection & initiative",
  feedback: "Feedback",
  development: "Development & learning",
  embodiment: "Embodiment & spaces",
  runtime: "Runtime",
  unclassified: "Unclassified",
};

export function v2Graph(data: ArchitectureData = architecture as ArchitectureData, opts: { minImports?: number } = {}): MvGraph {
  const min = opts.minImports ?? 1;
  const functions = [...new Set(data.nodes.map((n) => n.function))].sort();
  const nodes: MvNode[] = [
    ...functions.map<MvNode>((f) => ({
      id: `function:${f}`,
      label: FUNCTION_LABEL[f] ?? f,
      kind: "function",
      group: f,
      evidence: "classified",
      weight: data.nodes.filter((n) => n.function === f).reduce((s, n) => s + n.lines, 0),
      source: { authority: "architecture", id: f },
      facts: { subsystems: data.nodes.filter((n) => n.function === f).length },
    })),
    ...data.nodes.map<MvNode>((n) => ({
      id: `subsystem:${n.id}`,
      label: n.id,
      kind: "subsystem",
      group: n.function,
      evidence: "measured",
      weight: n.lines,
      source: { authority: "architecture", id: n.path },
      facts: { path: n.path, files: n.files, lines: n.lines, function: FUNCTION_LABEL[n.function] ?? n.function },
    })),
  ];
  const edges: MvEdge[] = [
    ...data.nodes.map<MvEdge>((n) => ({ id: `subsystem:${n.id}|serves|function:${n.function}`, from: `subsystem:${n.id}`, to: `function:${n.function}`, kind: "serves", evidence: "classified" })),
    ...data.edges
      .filter((e) => e.imports >= min)
      .map<MvEdge>((e) => ({ id: `subsystem:${e.from}|imports|subsystem:${e.to}`, from: `subsystem:${e.from}`, to: `subsystem:${e.to}`, kind: "imports", evidence: "inferred", weight: e.imports })),
  ];
  return {
    aspect: "v2",
    nodes,
    edges,
    gaps: [
      "Wiring is from static imports (what can call what), not runtime calls.",
      "Live activity is not shown: no runtime telemetry feeds this aspect yet.",
      "Function groupings are editorial (scripts/neural/build-cognitive-architecture.ts).",
    ],
  };
}

/* ---------------------------------------------------------- V3 */

export interface ExecutiveLike {
  id: string;
  name: string;
  role: string;
  domain: string;
  systems: string[];
}

export function v3Graph(executives: ExecutiveLike[], agents: LeluAgent[]): MvGraph {
  const nodes: MvNode[] = executives.map((x) => ({
    id: `executive:${x.id}`,
    label: x.name,
    kind: "executive",
    group: x.id,
    evidence: "declared",
    weight: agents.filter((a) => ownershipOf(a).executive === x.id).length,
    source: { authority: "executive-board", id: x.id },
    facts: { role: x.role, domain: x.domain, systems: x.systems.join(", ") },
  }));
  const edges: MvEdge[] = [];
  const agentIds = new Set(agents.map((a) => a.id));
  for (const a of agents) {
    const own = ownershipOf(a);
    const done = a.tasks.filter((t) => t.status === "complete").length;
    const failed = a.tasks.filter((t) => t.status === "failed").length;
    nodes.push({
      id: `agent:${a.id}`,
      label: a.name,
      kind: "agent",
      group: own.executive,
      evidence: "declared",
      weight: a.tasks.length,
      time: a.createdAt,
      source: { authority: "agents", id: a.id },
      facts: {
        role: a.role,
        status: a.status,
        enabled: a.enabled,
        provider: a.provider ?? "default chain",
        memory: a.memoryAccess,
        tools: a.tools.join(", "),
        tasks: a.tasks.length,
        complete: done,
        failed,
        // Reliability only when there is a record to measure it from.
        ...(done + failed > 0 ? { reliability: `${Math.round((done / (done + failed)) * 100)}% of ${done + failed}` } : {}),
        owner: `${own.executive} (${own.basis})`,
      },
    });
    edges.push({ id: `agent:${a.id}|reports-to|executive:${own.executive}`, from: `agent:${a.id}`, to: `executive:${own.executive}`, kind: "reports-to", evidence: own.basis === "default" ? "inferred" : "declared" });
    // Delegations: who handed this agent work, counted from its real tasks.
    const by = new Map<string, number>();
    for (const t of a.tasks) if (t.delegatedBy) by.set(t.delegatedBy, (by.get(t.delegatedBy) ?? 0) + 1);
    for (const [who, count] of by) {
      const from = agentIds.has(who) ? `agent:${who}` : executives.some((x) => x.id === who) ? `executive:${who}` : null;
      if (from) edges.push({ id: `${from}|delegated|agent:${a.id}`, from, to: `agent:${a.id}`, kind: "delegated", evidence: "measured", weight: count });
    }
  }
  return {
    aspect: "v3",
    nodes,
    edges,
    gaps: [
      ...(agents.length === 0 ? ["No persistent agents are in the Agent Store on this device yet."] : []),
      "Agent-to-agent conversations and private self-dialogue have no record in the Agent Store yet, so none is drawn.",
    ],
  };
}
