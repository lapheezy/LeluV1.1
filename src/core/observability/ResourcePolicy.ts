/**
 * ==========================================================
 * LÉLU — RESOURCE POLICY (WP19.5)
 *
 * The owner's limits on how much LÉLU may use, and the state of every
 * workload they paused, throttled or terminated. It is ENFORCED where the
 * work happens, not displayed beside it:
 *
 *   UsageBudgetGate.reserve   every model call: emergency stop, workload
 *                             state, throttle/cooldown, per-conversation
 *                             and hourly caps, concurrency
 *   gatedGenerate             max execution duration (the call is aborted)
 *   AgentRunner.run           concurrent agent tasks, per-agent limits
 *   UsageLedger budgets       daily caps and the background allowance
 *                             (existing; set through applyControl)
 *
 * A control that has no enforcement point is not offered.
 * Persisted through KvStore so limits survive restarts.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type WorkloadState = "paused" | "terminated" | "throttled";

export interface WorkloadControl {
  state: WorkloadState;
  /** Throttle: minimum ms between this workload's model calls. */
  minGapMs?: number;
  at: number;
  reason: string;
}

export interface Policy {
  emergencyStop: { at: number; reason: string } | null;
  /** Model calls in flight at once, across LÉLU. */
  maxConcurrentCalls: number | null;
  /** Conversations with a model call in flight at once. */
  maxConcurrentConversations: number | null;
  /** Agent tasks running at once (AgentRunner). */
  maxConcurrentAgentTasks: number | null;
  /** Running tasks per agent. */
  maxTasksPerAgent: number | null;
  /** Model calls per conversation per hour. */
  perConversationHourlyCalls: number | null;
  /** Model calls across LÉLU per hour. */
  hourlyCalls: number | null;
  /** Reported tokens across LÉLU per hour (provider-reported only). */
  hourlyTokens: number | null;
  /** Abort a model call that runs longer than this. */
  maxCallMs: number | null;
  /** Minimum gap between two model calls of the same conversation. */
  cooldownMs: number | null;
  /** Per-agent overrides: max running tasks, calls per hour. */
  agents: Record<string, { maxTasks?: number; hourlyCalls?: number; paused?: boolean }>;
  workloads: Record<string, WorkloadControl>;
  /** Alert thresholds (WP19.7). */
  alerts: { spikeFactor: number; repeatedToolCalls: number; stalledMinutes: number; budgetWarnPct: number };
  /** Audit trail of every change: who, what, before → after. */
  changes: Array<{ at: number; by: "user" | "lelu"; what: string; before: string; after: string }>;
}

export const DEFAULT_POLICY: Policy = {
  emergencyStop: null,
  maxConcurrentCalls: null,
  maxConcurrentConversations: null,
  maxConcurrentAgentTasks: null,
  maxTasksPerAgent: null,
  perConversationHourlyCalls: null,
  hourlyCalls: null,
  hourlyTokens: null,
  maxCallMs: null,
  cooldownMs: null,
  agents: {},
  workloads: {},
  alerts: { spikeFactor: 3, repeatedToolCalls: 8, stalledMinutes: 15, budgetWarnPct: 80 },
  changes: [],
};

/** Numeric controls with the ranges the runtime can honour. */
export const LIMITS: Record<NumericControl, { label: string; min: number; max: number; step: number; unit: string }> = {
  maxConcurrentCalls: { label: "Model calls at once", min: 1, max: 64, step: 1, unit: "calls" },
  maxConcurrentConversations: { label: "Conversations calling models at once", min: 1, max: 64, step: 1, unit: "conversations" },
  maxConcurrentAgentTasks: { label: "Agent tasks at once", min: 1, max: 32, step: 1, unit: "tasks" },
  maxTasksPerAgent: { label: "Tasks per agent at once", min: 1, max: 16, step: 1, unit: "tasks" },
  perConversationHourlyCalls: { label: "Model calls per conversation per hour", min: 1, max: 2000, step: 1, unit: "calls/h" },
  hourlyCalls: { label: "Model calls per hour (all of LÉLU)", min: 1, max: 20000, step: 10, unit: "calls/h" },
  hourlyTokens: { label: "Reported tokens per hour (all of LÉLU)", min: 1000, max: 50_000_000, step: 1000, unit: "tokens/h" },
  maxCallMs: { label: "Longest a model call may run", min: 5000, max: 600_000, step: 1000, unit: "ms" },
  cooldownMs: { label: "Gap between a conversation's calls", min: 0, max: 120_000, step: 500, unit: "ms" },
};

export type NumericControl = "maxConcurrentCalls" | "maxConcurrentConversations" | "maxConcurrentAgentTasks" | "maxTasksPerAgent" | "perConversationHourlyCalls" | "hourlyCalls" | "hourlyTokens" | "maxCallMs" | "cooldownMs";

export class ResourceRefusal extends Error {
  constructor(
    public readonly rule: string,
    message: string,
  ) {
    super(message);
    this.name = "ResourceRefusal";
  }
}

const KEY = "lelu.resource.policy.v1";
type Listener = (p: Policy) => void;

export default class ResourcePolicy {
  private static instance: ResourcePolicy | null = null;
  static getInstance(): ResourcePolicy {
    return (ResourcePolicy.instance ??= new ResourcePolicy());
  }
  static resetForTests(): void {
    ResourcePolicy.instance = null;
  }

  private policy: Policy;
  private listeners = new Set<Listener>();
  /** Last model-call time per conversation (cooldown / throttle). */
  private lastCall = new Map<string, number>();
  /** Model calls per conversation and per agent in the current hour, and globally. */
  private hour = { key: "", global: 0, tokens: 0, byConversation: new Map<string, number>(), byAgent: new Map<string, number>() };

  constructor(
    private readonly kv: { get<T>(k: string): T | null; set<T>(k: string, v: T): boolean } = KvStore.getInstance(),
    private readonly now: () => number = () => Date.now(),
  ) {
    const saved = kv.get<Partial<Policy>>(KEY);
    this.policy = { ...DEFAULT_POLICY, ...(saved ?? {}), alerts: { ...DEFAULT_POLICY.alerts, ...(saved?.alerts ?? {}) } };
  }

  get(): Policy {
    return this.policy;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  /* ---------------------------------------------------------- changing */

  setLimit(name: NumericControl, value: number | null, by: "user" | "lelu" = "user"): number | null {
    const range = LIMITS[name];
    const v = value === null ? null : Math.min(range.max, Math.max(range.min, Math.round(value / range.step) * range.step));
    this.write(by, name, String(this.policy[name] ?? "none"), String(v ?? "none"), { [name]: v } as Partial<Policy>);
    return v;
  }

  setAgent(agentId: string, patch: { maxTasks?: number | null; hourlyCalls?: number | null; paused?: boolean }, by: "user" | "lelu" = "user"): void {
    const before = this.policy.agents[agentId] ?? {};
    const next = { ...before } as Policy["agents"][string];
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === undefined) delete (next as Record<string, unknown>)[k];
      else (next as Record<string, unknown>)[k] = v;
    }
    this.write(by, `agent ${agentId}`, JSON.stringify(before), JSON.stringify(next), { agents: { ...this.policy.agents, [agentId]: next } });
  }

  control(workloadId: string, state: WorkloadState | "resume", opts: { minGapMs?: number; reason?: string; by?: "user" | "lelu" } = {}): void {
    const before = this.policy.workloads[workloadId];
    const workloads = { ...this.policy.workloads };
    if (state === "resume") delete workloads[workloadId];
    else workloads[workloadId] = { state, at: this.now(), reason: opts.reason ?? "", ...(state === "throttled" ? { minGapMs: opts.minGapMs ?? 10_000 } : {}) };
    this.write(opts.by ?? "user", `workload ${workloadId}`, before?.state ?? "running", state === "resume" ? "running" : state, { workloads });
  }

  emergencyStop(on: boolean, reason = "emergency stop", by: "user" | "lelu" = "user"): void {
    this.write(by, "emergency stop", this.policy.emergencyStop ? "on" : "off", on ? "on" : "off", { emergencyStop: on ? { at: this.now(), reason } : null });
  }

  setAlerts(patch: Partial<Policy["alerts"]>, by: "user" | "lelu" = "user"): void {
    this.write(by, "alert thresholds", JSON.stringify(this.policy.alerts), JSON.stringify({ ...this.policy.alerts, ...patch }), { alerts: { ...this.policy.alerts, ...patch } });
  }

  private write(by: "user" | "lelu", what: string, before: string, after: string, patch: Partial<Policy>): void {
    this.policy = { ...this.policy, ...patch, changes: [...this.policy.changes, { at: this.now(), by, what, before, after }].slice(-200) };
    this.kv.set(KEY, this.policy);
    for (const l of this.listeners) l(this.policy);
  }

  /* ---------------------------------------------------------- enforcing */

  /** Where the current hour's totals come from after a restart (the ledger's hour rollup). */
  seedHour: ((hourKey: string) => { calls: number; tokens: number; byConversation: Record<string, number>; byAgent: Record<string, number> } | null) | null = null;

  private rollHour(): void {
    const key = new Date(this.now()).toISOString().slice(0, 13);
    if (this.hour.key === key) return;
    const seed = this.seedHour?.(key) ?? null;
    this.hour = {
      key,
      global: seed?.calls ?? 0,
      tokens: seed?.tokens ?? 0,
      byConversation: new Map(Object.entries(seed?.byConversation ?? {})),
      byAgent: new Map(Object.entries(seed?.byAgent ?? {})),
    };
  }

  /**
   * Checked by UsageBudgetGate.reserve BEFORE a model call leaves.
   * Throws ResourceRefusal with the rule and a plain reason.
   */
  /** The most recent refusal per conversation / agent / "*" (so a turn can say WHY it stopped). */
  private refusals = new Map<string, { at: number; rule: string; message: string }>();

  /** A refusal for this conversation or agent at or after `since`, if any. */
  refusalSince(since: number, keys: Array<string | undefined>): { rule: string; message: string } | null {
    for (const k of [...keys, "*"]) {
      const r = k ? this.refusals.get(k) : undefined;
      if (r && r.at >= since) return r;
    }
    return null;
  }

  checkCall(input: { conversationId?: string; agentId?: string; inFlight: Array<{ conversationId?: string }> }): void {
    try {
      this.checkCallInner(input);
    } catch (error) {
      if (error instanceof ResourceRefusal) {
        const r = { at: this.now(), rule: error.rule, message: error.message };
        this.refusals.set("*", r);
        if (input.conversationId) this.refusals.set(input.conversationId, r);
        if (input.agentId) this.refusals.set(`agent:${input.agentId}`, r);
      }
      throw error;
    }
  }

  private checkCallInner(input: { conversationId?: string; agentId?: string; inFlight: Array<{ conversationId?: string }> }): void {
    const p = this.policy;
    const t = this.now();
    if (p.emergencyStop) throw new ResourceRefusal("emergency-stop", `Emergency stop is on (${p.emergencyStop.reason}). No model calls are sent until it is released.`);
    const conv = input.conversationId;
    const w = conv ? p.workloads[conv] : undefined;
    if (w?.state === "terminated") throw new ResourceRefusal("terminated", `This conversation was terminated (${w.reason || "by the owner"}); it consumes nothing more.`);
    if (w?.state === "paused") throw new ResourceRefusal("paused", `This conversation is paused (${w.reason || "by the owner"}). Resume it to continue.`);
    if (input.agentId && (p.agents[input.agentId]?.paused || p.workloads[`agent:${input.agentId}`]?.state === "paused"))
      throw new ResourceRefusal("agent-paused", "This agent is paused by the owner.");
    const gap = Math.max(w?.state === "throttled" ? (w.minGapMs ?? 0) : 0, p.cooldownMs ?? 0);
    if (conv && gap > 0) {
      const last = this.lastCall.get(conv);
      if (last !== undefined && t - last < gap) throw new ResourceRefusal(w?.state === "throttled" ? "throttled" : "cooldown", `Throttled: this conversation may make a model call every ${Math.round(gap / 1000)} s; the next one is allowed in ${Math.ceil((gap - (t - last)) / 1000)} s.`);
    }
    if (p.maxConcurrentCalls !== null && input.inFlight.length >= p.maxConcurrentCalls)
      throw new ResourceRefusal("concurrency", `${input.inFlight.length} model calls are already running; the limit is ${p.maxConcurrentCalls}.`);
    if (p.maxConcurrentConversations !== null && conv) {
      const active = new Set(input.inFlight.map((r) => r.conversationId).filter(Boolean));
      if (!active.has(conv) && active.size >= p.maxConcurrentConversations)
        throw new ResourceRefusal("concurrent-conversations", `${active.size} conversations are already calling models; the limit is ${p.maxConcurrentConversations}.`);
    }
    this.rollHour();
    if (p.hourlyCalls !== null && this.hour.global >= p.hourlyCalls) throw new ResourceRefusal("hourly-calls", `The hourly limit of ${p.hourlyCalls} model calls is reached; it resets at the top of the hour.`);
    if (p.hourlyTokens !== null && this.hour.tokens >= p.hourlyTokens) throw new ResourceRefusal("hourly-tokens", `The hourly limit of ${p.hourlyTokens} reported tokens is reached.`);
    if (conv && p.perConversationHourlyCalls !== null && (this.hour.byConversation.get(conv) ?? 0) >= p.perConversationHourlyCalls)
      throw new ResourceRefusal("conversation-hourly", `This conversation used its ${p.perConversationHourlyCalls} model calls for this hour.`);
    const agentCap = input.agentId ? p.agents[input.agentId]?.hourlyCalls : undefined;
    if (input.agentId && agentCap !== undefined && (this.hour.byAgent.get(input.agentId) ?? 0) >= agentCap)
      throw new ResourceRefusal("agent-hourly", `This agent used its ${agentCap} model calls for this hour.`);
  }

  /** A call was sent (counted for hourly caps and cooldown). */
  noteCall(input: { conversationId?: string; agentId?: string }): void {
    this.rollHour();
    this.hour.global += 1;
    if (input.conversationId) {
      this.hour.byConversation.set(input.conversationId, (this.hour.byConversation.get(input.conversationId) ?? 0) + 1);
      this.lastCall.set(input.conversationId, this.now());
    }
    if (input.agentId) this.hour.byAgent.set(input.agentId, (this.hour.byAgent.get(input.agentId) ?? 0) + 1);
  }

  /** Reported tokens of a settled call (hourly token cap). */
  noteTokens(tokens: number): void {
    this.rollHour();
    this.hour.tokens += tokens;
  }

  /** Checked by AgentRunner.run before an agent task starts. */
  checkAgentTask(agentId: string, running: { total: number; forAgent: number }): void {
    const p = this.policy;
    if (p.emergencyStop) throw new ResourceRefusal("emergency-stop", `Emergency stop is on (${p.emergencyStop.reason}).`);
    if (p.agents[agentId]?.paused || p.workloads[`agent:${agentId}`]?.state === "paused") throw new ResourceRefusal("agent-paused", "This agent is paused by the owner.");
    if (p.maxConcurrentAgentTasks !== null && running.total >= p.maxConcurrentAgentTasks)
      throw new ResourceRefusal("agent-concurrency", `${running.total} agent tasks are already running; the limit is ${p.maxConcurrentAgentTasks}.`);
    const own = p.agents[agentId]?.maxTasks ?? p.maxTasksPerAgent;
    if (own !== null && own !== undefined && running.forAgent >= own)
      throw new ResourceRefusal("agent-tasks", `This agent already runs ${running.forAgent} task(s); its limit is ${own}.`);
  }

  workloadState(id: string): WorkloadControl | undefined {
    return this.policy.workloads[id];
  }

  /** What the hourly counters hold now (shown as "current" usage). */
  hourCounters(): { hour: string; calls: number; tokens: number } {
    this.rollHour();
    return { hour: this.hour.key, calls: this.hour.global, tokens: this.hour.tokens };
  }
}
