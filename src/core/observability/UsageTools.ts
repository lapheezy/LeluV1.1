/**
 * LÉLU's own tools for WP19 and WP13, through the ONE tool registry and
 * dispatcher. LÉLU passes the person's words; the interpreter maps them to
 * real runtime changes; consequential changes need `confirm: true` after the
 * plan has been shown; every result reports what is now in force.
 */

import type { RiskLevel, ToolDefinition } from "../tools/ToolRegistry";
import { registerExecutor, type ToolExecutor } from "../tools/ToolDispatcher";
import { apply, interpret, report } from "./ResourceCommands";
import { alerts, series, systemRanges, topConversations, UNAVAILABLE } from "./UsageAnalytics";
import ConversationRegistry from "./ConversationRegistry";
import AgentDialogue from "../agents/AgentDialogue";
import AgentStore from "../agents/AgentStore";

const def = (id: string, name: string, description: string, inputSchema: Record<string, unknown>, risk: RiskLevel = 0): ToolDefinition => ({
  id,
  name,
  description,
  category: "System",
  permissions: risk ? ["READ", "WRITE"] : ["READ"],
  riskLevel: risk,
  available: true,
  inputSchema,
});

const CONTROL_SCHEMA = {
  type: "object",
  properties: {
    instruction: { type: "string", description: "The person's resource instruction, in their words." },
    confirm: { type: "boolean", description: "true only after the person approved the plan shown for a consequential change." },
  },
  required: ["instruction"],
  additionalProperties: false,
};
const REPORT_SCHEMA = { type: "object", properties: { resolution: { type: "string", enum: ["minute", "hour", "day", "week", "month"] }, hours: { type: "number" } }, additionalProperties: false };
const CONVERSE_SCHEMA = {
  type: "object",
  properties: {
    agents: { type: "array", items: { type: "string" }, description: "Agent names: one (self-dialogue), two (direct) or more (group)." },
    topic: { type: "string" },
    turns: { type: "number", description: "Turns to run now (1–6)." },
  },
  required: ["agents", "topic"],
  additionalProperties: false,
};

export const USAGE_TOOLS: ToolDefinition[] = [
  def("usage.report", "Usage report", "What LÉLU has consumed: model calls, provider-reported tokens, latency, active conversations, per agent, per model, the top conversations, current alerts and what cannot be measured.", REPORT_SCHEMA),
  def("resources.control", "Control resources", "Change LÉLU's resource limits from the person's words (concurrency, hourly caps, per-agent limits, background allowance, pause/throttle/terminate a workload, emergency stop) or answer a usage question. Shows the plan; consequential changes need confirm=true.", CONTROL_SCHEMA, 2),
  def("agents.converse", "Agent conversation", "Start a real model-backed conversation between agents (2 = direct, 3+ = group) or an agent's private self-dialogue (1), run some turns and return the transcript.", CONVERSE_SCHEMA, 1),
];

export const USAGE_EXECUTORS: ToolExecutor[] = [
  {
    id: "usage.report",
    parameters: REPORT_SCHEMA,
    run: async (args) => {
      const resolution = (["minute", "hour", "day", "week", "month"] as const).find((r) => r === args.resolution) ?? "hour";
      const hours = typeof args.hours === "number" ? Math.min(24 * 120, Math.max(1, args.hours)) : 24;
      const from = Date.now() - hours * 3_600_000;
      const pts = series(resolution, { from });
      const ranges = systemRanges(resolution, { from }).filter((r) => r.availability === "measured");
      const lines = [
        `Last ${hours} h at ${resolution} resolution: ${pts.reduce((s, p) => s + p.calls, 0)} model calls in ${pts.length} bucket(s).`,
        ...ranges.map((r) => `• ${r.metric}: lowest ${r.lowest} (${r.lowestAt}), highest ${r.highest} (${r.highestAt}), average ${r.average}, current ${r.current}${r.capacity !== null ? `, capacity ${r.capacity} (${r.pctUsed}% used)` : ""}`),
        "Top conversations:",
        ...topConversations(5, from).map((c) => `  – ${c.title} [${c.type}, ${c.status}]: ${c.modelCalls} calls, ${c.tokenReportedCalls ? `${c.inputTokens + c.outputTokens} reported tokens` : "tokens not reported"}`),
        ...alerts().map((a) => `⚠ ${a.title}: ${a.detail} → ${a.recommendation}`),
        `Not measurable here: ${UNAVAILABLE.map((u) => u.metric).join("; ")}.`,
      ];
      return { ok: true, content: lines.join("\n") };
    },
  },
  {
    id: "resources.control",
    parameters: CONTROL_SCHEMA,
    run: async (args, context) => {
      const instruction = typeof args.instruction === "string" ? args.instruction : "";
      const plan = interpret(instruction, { conversationId: context?.request.conversationId });
      if (plan.unsupported) return { ok: false, content: `Not changed: ${plan.unsupported}` };
      if (plan.report) return { ok: true, content: report(plan) };
      if (plan.consequential && args.confirm !== true)
        return { ok: true, content: `This needs your approval first. Planned:\n${plan.explanation.map((e) => `• ${e}`).join("\n")}\nSay yes to apply it.`, data: { plan, needsApproval: true } };
      const result = apply(plan, "lelu");
      return {
        ok: result.failed.length === 0,
        content: [...result.applied.map((a) => `✓ ${a}`), ...result.failed.map((f) => `✗ ${f}`)].join("\n"),
        data: result,
      };
    },
  },
  {
    id: "agents.converse",
    parameters: CONVERSE_SCHEMA,
    run: async (args, context) => {
      const store = AgentStore.getInstance();
      const names = Array.isArray(args.agents) ? args.agents.map(String) : [];
      const ids = names.map((n) => store.list().find((a) => a.name.toLowerCase() === n.toLowerCase())?.id).filter((x): x is string => Boolean(x));
      if (ids.length !== names.length || !ids.length) return { ok: false, content: `Unknown agent(s). Known: ${store.list().map((a) => a.name).join(", ")}` };
      const dialogue = AgentDialogue.getInstance();
      const d = dialogue.start({ kind: ids.length === 1 ? "self" : ids.length === 2 ? "direct" : "group", participants: ids, topic: String(args.topic ?? ""), initiator: "lelu", parentConversationId: context?.request.conversationId ?? null });
      const turns = await dialogue.run(d.id, typeof args.turns === "number" ? Math.min(6, args.turns) : ids.length === 1 ? 3 : 2);
      ConversationRegistry.getInstance().get(d.id);
      return {
        ok: turns.every((t) => t.state === "complete"),
        content: [`Conversation ${d.id}:`, ...turns.map((t) => `${t.agentName}${t.role ? ` (${t.role})` : ""} [${t.state}${t.provider ? `, ${t.provider}/${t.model}` : ""}]: ${t.text ?? t.error ?? ""}`)].join("\n\n"),
        data: { id: d.id },
      };
    },
  },
];

export function registerUsageTools(): void {
  for (const executor of USAGE_EXECUTORS) {
    const definition = USAGE_TOOLS.find((t) => t.id === executor.id);
    if (!definition) continue;
    const added = registerExecutor(executor, definition);
    if (!added.ok) console.warn(`[UsageTools] ${executor.id} was not registered: ${added.reason}`);
  }
}
