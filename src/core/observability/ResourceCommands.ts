/**
 * ==========================================================
 * LÉLU — RESOURCE CONTROL IN PLAIN WORDS (WP19.6)
 *
 * Turns an instruction ("limit each agent to two concurrent tasks",
 * "pause all nonessential background research") into a PLAN of concrete
 * changes to the real runtime authorities (ResourcePolicy, the UsageLedger
 * background allowance and pause, AgentStore), or into a report.
 *
 * Consequential plans are returned for approval first. Applying a plan
 * writes each change and then READS THE RUNTIME BACK: the result states
 * the value now in force, so a change that did not take is reported as
 * such. An instruction with no enforcement point is refused, with the
 * reason, rather than pretended.
 * ==========================================================
 */

import ResourcePolicy, { LIMITS, type NumericControl } from "./ResourcePolicy";
import UsageLedger, { BACKGROUND_BUDGET_SOURCE, nextUtcMidnight } from "./UsageLedger";
import ConversationRegistry from "./ConversationRegistry";
import { byAgent, series, topConversations } from "./UsageAnalytics";
import AgentStore from "../agents/AgentStore";

export type Change =
  | { kind: "limit"; control: NumericControl; to: number | null }
  | { kind: "background-cap"; to: number }
  | { kind: "background-pause"; untilMs: number; reason: string }
  | { kind: "background-resume" }
  | { kind: "workload"; id: string; state: "paused" | "terminated" | "throttled" | "resume"; minGapMs?: number }
  | { kind: "agent"; agentId: string; patch: { maxTasks?: number | null; hourlyCalls?: number | null; paused?: boolean } }
  | { kind: "emergency"; on: boolean };

export interface Plan {
  instruction: string;
  changes: Change[];
  report?: "top-conversations" | "per-agent-24h" | "status";
  reportLimit?: number;
  consequential: boolean;
  /** Plain words: what will change and what it will do. */
  explanation: string[];
  unsupported?: string;
}

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twenty: 20 };
const numberIn = (s: string): number | null => {
  const m = s.match(/(\d[\d,_.]*)\s*(k)?/i);
  if (m) return Number(m[1].replace(/[,_]/g, "")) * (m[2] ? 1000 : 1);
  const w = Object.keys(WORDS).find((k) => new RegExp(`\\b${k}\\b`, "i").test(s));
  return w ? WORDS[w] : null;
};

function findAgent(text: string) {
  const t = text.toLowerCase();
  return AgentStore.getInstance()
    .list()
    .filter((a) => t.includes(a.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
}

export function interpret(instruction: string, ctx: { conversationId?: string } = {}): Plan {
  const s = instruction.trim();
  const t = s.toLowerCase();
  const n = numberIn(t);
  const plan = (p: Omit<Plan, "instruction">): Plan => ({ instruction: s, ...p });
  const bg = UsageLedger.getInstance().backgroundDailyCap();

  if (/release|lift|end|turn off|cancel/.test(t) && /emergency/.test(t)) return plan({ changes: [{ kind: "emergency", on: false }], consequential: false, explanation: ["Release the emergency stop: model calls may be sent again."] });
  if (/emergency|stop everything|stop all (model|ai)|halt everything/.test(t)) return plan({ changes: [{ kind: "emergency", on: true }], consequential: true, explanation: ["Emergency stop: every model call (chat, agents, background) is refused at the gate until released."] });

  if (/(show|list|which|what).*(highest|most|top).*(conversation|consum)/.test(t) || /top \d+ conversations/.test(t))
    return plan({ changes: [], report: "top-conversations", reportLimit: n && n <= 50 ? n : 5, consequential: false, explanation: ["Read the conversation registry, ranked by model calls."] });
  if (/(how much|usage).*(each|per|every) agent/.test(t) || /agent.*(used|usage).*(24|day)/.test(t))
    return plan({ changes: [], report: "per-agent-24h", consequential: false, explanation: ["Read the last 24 hourly buckets, calls per agent."] });

  // A named agent wins over the generic rules ("pause Researcher" is not "pause research").
  const agent = findAgent(t);
  if (agent && /(pause|stop|suspend)/.test(t)) return plan({ changes: [{ kind: "agent", agentId: agent.id, patch: { paused: true } }], consequential: true, explanation: [`Pause ${agent.name}: its tasks and model calls are refused until resumed.`] });
  if (agent && /(resume|unpause|restart)/.test(t)) return plan({ changes: [{ kind: "agent", agentId: agent.id, patch: { paused: false } }], consequential: false, explanation: [`Resume ${agent.name}.`] });

  if (/(reduce|cut|lower|decrease).*background/.test(t) && /%|percent/.test(t) && n !== null) {
    const to = Math.max(0, Math.floor(bg * (1 - Math.min(100, n) / 100)));
    return plan({ changes: [{ kind: "background-cap", to }], consequential: n >= 50, explanation: [`Background allowance ${bg} → ${to} model calls per day (−${n}%). Conversation is not affected.`] });
  }
  if (/(increase|raise|more|boost).*(background|development|resources)/.test(t)) {
    const pct = n !== null && /%|percent/.test(t) ? n : 50;
    const to = Math.ceil(bg * (1 + pct / 100));
    return plan({
      changes: [{ kind: "background-cap", to }],
      consequential: true,
      explanation: [`Background allowance ${bg} → ${to} calls per day (+${pct}%).`, "Background work (self-study, objectives, development) draws from this allowance. Per-task priority by topic does not exist yet, so all background work shares the increase."],
    });
  }
  if (/(pause|stop|halt).*(background|nonessential|research|curiosity|self-study)/.test(t))
    return plan({ changes: [{ kind: "background-pause", untilMs: nextUtcMidnight(Date.now()), reason: "paused by the owner" }], consequential: true, explanation: ["Pause all background model use (self-study, curiosity, autonomous objectives) until midnight UTC. Conversations and agent tasks you start are not affected."] });
  if (/resume.*background/.test(t)) return plan({ changes: [{ kind: "background-resume" }], consequential: false, explanation: ["Resume background model use."] });

  if (/each agent|per agent|every agent/.test(t) && /(concurrent|at once|parallel|tasks)/.test(t) && n !== null)
    return plan({ changes: [{ kind: "limit", control: "maxTasksPerAgent", to: n }], consequential: false, explanation: [`Each agent may run at most ${n} task(s) at once; more are refused at AgentRunner.`] });
  if (/agent/.test(t) && /(concurrent|at once|parallel|total)/.test(t) && n !== null)
    return plan({ changes: [{ kind: "limit", control: "maxConcurrentAgentTasks", to: n }], consequential: false, explanation: [`At most ${n} agent tasks at once across LÉLU.`] });
  if (/conversation/.test(t) && /(concurrent|at once|parallel)/.test(t) && n !== null)
    return plan({ changes: [{ kind: "limit", control: "maxConcurrentConversations", to: n }], consequential: false, explanation: [`At most ${n} conversations calling models at once.`] });
  if (/(below|under|keep|limit|cap|max)/.test(t) && /hour/.test(t) && n !== null) {
    const control: NumericControl = /token/.test(t) ? "hourlyTokens" : "hourlyCalls";
    return plan({ changes: [{ kind: "limit", control, to: n }], consequential: false, explanation: [`${LIMITS[control].label}: at most ${n}. Calls past it are refused until the hour resets.`] });
  }
  if (/(longest|max(imum)?|timeout).*(call|duration|seconds|minutes)/.test(t) && n !== null) {
    const ms = /minute/.test(t) ? n * 60_000 : /ms|millisecond/.test(t) ? n : n * 1000;
    return plan({ changes: [{ kind: "limit", control: "maxCallMs", to: ms }], consequential: false, explanation: [`A model call running longer than ${Math.round(ms / 1000)} s is abandoned and recorded as failed.`] });
  }
  if (/cooldown|between calls|gap/.test(t) && n !== null) {
    const ms = /ms|millisecond/.test(t) ? n : n * 1000;
    return plan({ changes: [{ kind: "limit", control: "cooldownMs", to: ms }], consequential: false, explanation: [`Each conversation waits ${ms} ms between model calls.`] });
  }


  if (/(this|current) conversation/.test(t)) {
    if (!ctx.conversationId) return plan({ changes: [], consequential: false, explanation: [], unsupported: "I do not know which conversation 'this' is here." });
    if (/(stop|no more|terminate|end).*(consum|using|resources|calls)|terminate/.test(t))
      return plan({ changes: [{ kind: "workload", id: ctx.conversationId, state: "terminated" }], consequential: true, explanation: ["Terminate this conversation's resource use: further model calls for it are refused."] });
    if (/throttle|slow/.test(t)) return plan({ changes: [{ kind: "workload", id: ctx.conversationId, state: "throttled", minGapMs: (n ?? 10) * 1000 }], consequential: false, explanation: [`Throttle this conversation to one model call every ${n ?? 10} s.`] });
  }

  if (/priorit/.test(t))
    return plan({
      changes: [],
      consequential: false,
      explanation: [],
      unsupported: "Background priority is set per purpose (owner objectives > self-study > autonomous objectives > curiosity) and cannot yet be set per topic such as one development task. I can raise the background allowance or pause the other background purposes instead.",
    });
  return plan({ changes: [], consequential: false, explanation: [], unsupported: "I could not map that to a resource control I can actually change. Try a limit (per hour, per agent, concurrent), a pause, a throttle, or a report." });
}

/** Apply a plan and read back what is now in force. */
export function apply(plan: Plan, by: "user" | "lelu" = "lelu"): { applied: string[]; failed: string[] } {
  const policy = ResourcePolicy.getInstance();
  const ledger = UsageLedger.getInstance();
  const applied: string[] = [];
  const failed: string[] = [];
  for (const c of plan.changes) {
    switch (c.kind) {
      case "limit": {
        policy.setLimit(c.control, c.to, by);
        const now = policy.get()[c.control];
        (now === c.to || (c.to !== null && now !== null) ? applied : failed).push(`${LIMITS[c.control].label}: now ${now ?? "no limit"}${now !== c.to ? ` (requested ${c.to}, clamped to the allowed range ${LIMITS[c.control].min}–${LIMITS[c.control].max})` : ""}`);
        break;
      }
      case "background-cap": {
        ledger.setBudget("ai", BACKGROUND_BUDGET_SOURCE, { ...(ledger.budgetsSnapshot()[`ai:${BACKGROUND_BUDGET_SOURCE}`] ?? {}), dailyCalls: c.to });
        const now = ledger.backgroundDailyCap();
        (now === c.to ? applied : failed).push(`Background allowance: now ${now} calls/day`);
        break;
      }
      case "background-pause": {
        ledger.pauseBackground(c.untilMs, c.reason);
        const p = ledger.backgroundPaused();
        (p ? applied : failed).push(p ? `Background paused until ${new Date(p.until).toISOString()}` : "Background pause did not take");
        break;
      }
      case "background-resume": {
        ledger.pauseBackground(0, "resumed by the owner");
        (ledger.backgroundPaused() ? failed : applied).push(ledger.backgroundPaused() ? "Background is still paused" : "Background resumed");
        break;
      }
      case "workload": {
        policy.control(c.id, c.state, { minGapMs: c.minGapMs, by, reason: plan.instruction.slice(0, 120) });
        if (c.state === "terminated" || c.state === "paused") ConversationRegistry.getInstance().setStatus(c.id, c.state);
        const now = policy.workloadState(c.id)?.state ?? "running";
        (now === (c.state === "resume" ? "running" : c.state) ? applied : failed).push(`${c.id}: now ${now}`);
        break;
      }
      case "agent": {
        policy.setAgent(c.agentId, c.patch, by);
        const now = policy.get().agents[c.agentId] ?? {};
        applied.push(`${AgentStore.getInstance().get(c.agentId)?.name ?? c.agentId}: now ${JSON.stringify(now)}`);
        break;
      }
      case "emergency": {
        policy.emergencyStop(c.on, plan.instruction.slice(0, 120), by);
        (Boolean(policy.get().emergencyStop) === c.on ? applied : failed).push(`Emergency stop: now ${policy.get().emergencyStop ? "ON" : "off"}`);
        break;
      }
    }
  }
  return { applied, failed };
}

export function report(plan: Plan): string {
  if (plan.report === "top-conversations") {
    const since = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const top = topConversations(plan.reportLimit ?? 5, since);
    if (!top.length) return "No conversation has used a model today.";
    return top.map((r, i) => `${i + 1}. ${r.title} [${r.type}] — ${r.modelCalls} calls, ${r.tokenReportedCalls ? `${r.inputTokens + r.outputTokens} reported tokens` : "tokens not reported"}, ${r.toolCalls} tool calls, ${r.status}`).join("\n");
  }
  if (plan.report === "per-agent-24h") {
    const rows = byAgent(series("hour", { from: Date.now() - 86_400_000 }));
    if (!rows.length) return "No agent made a model call in the last 24 hours.";
    const store = AgentStore.getInstance();
    return rows.map((r) => `• ${store.get(r.agentId)?.name ?? r.agentId}: ${r.calls} model calls`).join("\n");
  }
  return "";
}
