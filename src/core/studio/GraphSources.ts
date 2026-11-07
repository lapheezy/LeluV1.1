/**
 * ==========================================================
 * LÉLU — GRAPH SOURCES
 * Graph specs built from LÉLU's real systems, not invented:
 * the agent hierarchy is LÉLU CORE → SHAMAN → executives →
 * the agents each one owns (ExecutiveOwnership.executiveOf,
 * the same resolver SHAMAN routes by) → the tools each agent
 * is granted. Pure: the caller passes the agents it has.
 * ==========================================================
 */

import { EXECUTIVE_IDS, executiveOf } from "../agents/ExecutiveOwnership";
import type { LeluAgent } from "../agents/AgentTypes";
import type { GraphEdgeSpec, GraphNodeSpec, GraphSpec } from "./StudioTypes";

const EXEC_COLOR = "#ddd6fe";
const AGENT_COLOR = "#cffafe";
const TOOL_COLOR = "#fef3c7";

export function agentHierarchyGraph(
  agents: Array<Pick<LeluAgent, "id" | "name" | "tools"> & { templateId?: string; executive?: string; status?: string }>,
  options: { toolsPerAgent?: number } = {},
): GraphSpec {
  const nodes: GraphNodeSpec[] = [];
  const edges: GraphEdgeSpec[] = [];
  const edge = (from: string, to: string, label?: string) => edges.push({ id: `e-${from}-${to}`, from, to, label });
  nodes.push({ id: "core", label: "LÉLU Core", type: "core", x: 0, y: 0, color: "#f5d0fe" });
  nodes.push({ id: "shaman", label: "SHAMAN", type: "router", x: 0, y: 140, color: "#e9d5ff" });
  edge("core", "shaman", "routes");
  const live = agents.filter((a) => a.status !== "archived");
  const byExec = new Map<string, typeof live>();
  for (const a of live) {
    const exec = executiveOf(a);
    byExec.set(exec, [...(byExec.get(exec) ?? []), a]);
  }
  const execs = EXECUTIVE_IDS.filter((e) => e !== "lelu");
  const span = 260;
  execs.forEach((exec, i) => {
    const x = (i - (execs.length - 1) / 2) * span;
    const id = `exec:${exec}`;
    nodes.push({ id, label: exec[0].toUpperCase() + exec.slice(1), type: "executive", x, y: 290, color: EXEC_COLOR, ref: exec });
    edge("shaman", id, "delegates");
    (byExec.get(exec) ?? []).forEach((agent, j) => {
      const aid = `agent:${agent.id}`;
      nodes.push({ id: aid, label: agent.name, type: "agent", x: x + (j % 2) * 120 - 60, y: 430 + Math.floor(j / 2) * 90, color: AGENT_COLOR, group: undefined, ref: agent.id });
      edge(id, aid, "owns");
      for (const tool of agent.tools.slice(0, options.toolsPerAgent ?? 0)) {
        const tid = `tool:${tool}`;
        if (!nodes.some((n) => n.id === tid)) nodes.push({ id: tid, label: tool, type: "tool", x: x, y: 900 + nodes.filter((n) => n.type === "tool").length * 10, color: TOOL_COLOR });
        edge(aid, tid, "uses");
      }
    });
  });
  return { kind: "graph", title: "LÉLU agent hierarchy", nodes, edges };
}
