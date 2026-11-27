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
  nodes: Array<{ id: string; path: string; function: string; files: number; lines: number; commits?: number; lastChanged?: string | null; daily?: number[] }>;
  history?: { from: string; to: string; days: number };
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
      facts: {
        path: n.path,
        files: n.files,
        lines: n.lines,
        function: FUNCTION_LABEL[n.function] ?? n.function,
        ...(data.history?.days ? { [`commits (${data.history.from} → ${data.history.to})`]: n.commits ?? 0, "last changed": n.lastChanged ?? `before ${data.history.from}` } : {}),
      },
      ...(n.daily ? { series: n.daily } : {}),
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
    ...(data.history?.days ? { meta: { historyFrom: data.history.from, historyTo: data.history.to, historyDays: data.history.days } } : {}),
    gaps: [
      "Wiring is from static imports (what can call what), not runtime calls.",
      "Live activity is shown only in the 3D views, counted from the event bus in this session; with no events it shows none.",
      ...(data.history?.days ? [`Change history covers ${data.history.from} → ${data.history.to} only (the history this clone has).`] : []),
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

/** WP13: what the society knows beyond the agents themselves. */
export interface SocietyExtras {
  /** Real dialogues (from the ConversationRegistry / AgentStore): who talked, how many turns. */
  dialogues?: Array<{ id: string; kind: "direct" | "group" | "self"; participants: string[]; turns: number; topic: string }>;
  /** Agents the owner paused (ResourcePolicy). */
  paused?: Set<string>;
}

/** An agent's state from its own records: never assumed. */
export function agentState(a: LeluAgent, paused = false): "active" | "queued" | "paused" | "offline" | "failed" | "idle" | "archived" {
  if (a.status === "archived") return "archived";
  if (paused || a.status === "paused" || !a.enabled) return "paused";
  if (a.tasks.some((t) => t.status === "running")) return "active";
  if (a.tasks.some((t) => t.status === "queued")) return "queued";
  const last = [...a.tasks].sort((x, y) => (y.completedAt ?? y.createdAt) - (x.completedAt ?? x.createdAt))[0];
  if (last?.status === "failed") return "failed";
  const exec = last?.executionId ? a.executions.find((e) => e.id === last.executionId) : undefined;
  if (exec?.offline) return "offline";
  return "idle";
}

export function v3Graph(executives: ExecutiveLike[], agents: LeluAgent[], extras: SocietyExtras = {}): MvGraph {
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
        state: agentState(a, extras.paused?.has(a.id)),
        conversations: (extras.dialogues ?? []).filter((d) => d.participants.includes(a.id)).length,
        ...(a.goals?.length ? { goals: a.goals.join(" · ") } : {}),
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
  // Conversations: one edge per pair that really talked, weighted by turns.
  const pairs = new Map<string, number>();
  for (const d of extras.dialogues ?? []) {
    if (d.kind === "self" || d.turns === 0) continue;
    const ps = d.participants.filter((p) => agentIds.has(p)).sort();
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++) pairs.set(`${ps[i]}|${ps[j]}`, (pairs.get(`${ps[i]}|${ps[j]}`) ?? 0) + d.turns);
  }
  for (const [k, turns] of pairs) {
    const [x, y] = k.split("|");
    edges.push({ id: `agent:${x}|conversed|agent:${y}`, from: `agent:${x}`, to: `agent:${y}`, kind: "conversed", evidence: "measured", weight: turns });
  }
  const dialogues = extras.dialogues ?? [];
  return {
    aspect: "v3",
    nodes,
    edges,
    gaps: [
      ...(agents.length === 0 ? ["No persistent agents are in the Agent Store on this device yet."] : []),
      ...(dialogues.length === 0 ? ["No agent conversation or self-dialogue has been held yet, so none is drawn."] : []),
      "Private self-dialogue is counted on the agent, not drawn as an edge.",
    ],
  };
}
