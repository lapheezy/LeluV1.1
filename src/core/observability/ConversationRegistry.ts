/**
 * ==========================================================
 * LÉLU — UNIVERSAL CONVERSATION REGISTRY (WP19.1)
 *
 * Every conversational process registers here: user chats (the id
 * MultiChatStore already uses), voice turns, agent tasks, agent-to-agent
 * and group dialogues, private self-dialogue, tool and browser work, and
 * background cognition. The registry is the LIFECYCLE INDEX across those
 * authorities, not a copy of them:
 *
 *   - it keys each record by the id its authority already uses, so a
 *     chat here IS the chat in MultiChatStore, a dialogue here IS the
 *     dialogue on the AgentStore tasks;
 *   - it never stores message text: identities, counts, timings, the
 *     providers and models used, tools, errors and relationships;
 *   - usage is attributed from the ONE usage path (UsageBudgetGate →
 *     UsageLedger). A call with no conversation is NOT dropped: it goes to
 *     a per-day "background:<purpose>" record when it is background work,
 *     otherwise to a per-day "unattributed" record shown as such.
 *
 * Persisted through KvStore (bounded: the newest 3000 records).
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import { isBackgroundPurpose, purposeOf, type UsageEvent } from "./UsageLedger";

export type ConversationType =
  | "user-chat"
  | "voice"
  | "agent-task"
  | "agent-direct"
  | "agent-group"
  | "self-dialogue"
  | "tool"
  | "browser"
  | "background"
  | "unattributed";

export type Initiator = "user" | "lelu" | "agent" | "system" | "scheduled";
export type ConversationStatus = "active" | "idle" | "paused" | "completed" | "failed" | "terminated";

export interface Stat {
  min: number | null;
  max: number | null;
  sum: number;
  n: number;
}

export interface ConversationRecord {
  id: string;
  parentId: string | null;
  type: ConversationType;
  purpose: string;
  title: string;
  initiator: Initiator;
  /** Agents and services taking part (agent:<id>, service:<name>). */
  participants: string[];
  startedAt: number;
  lastActivityAt: number;
  endedAt: number | null;
  status: ConversationStatus;
  messagesIn: number;
  messagesOut: number;
  modelCalls: number;
  failedCalls: number;
  rateLimited: number;
  /** Calls whose provider reported tokens; tokens are summed from those only. */
  tokenReportedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  latency: Stat;
  providers: Record<string, number>;
  models: Record<string, number>;
  toolCalls: number;
  toolFailures: number;
  tools: Record<string, number>;
  /** Linked work: AgentStore task ids, ImprovementQueue ids, objectives. */
  tasks: string[];
  errors: Array<{ at: number; message: string }>;
  retries: number;
  interruptions: number;
}

export interface RegistryFilter {
  type?: ConversationType[];
  status?: ConversationStatus[];
  participant?: string;
  provider?: string;
  model?: string;
  from?: number;
  to?: number;
  minCalls?: number;
  text?: string;
}

const KEY = "lelu.conversation.registry.v1";
const MAX = 3000;
const IDLE_MS = 10 * 60_000;
const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);

const emptyStat = (): Stat => ({ min: null, max: null, sum: 0, n: 0 });
function addStat(s: Stat, v: number): void {
  s.min = s.min === null ? v : Math.min(s.min, v);
  s.max = s.max === null ? v : Math.max(s.max, v);
  s.sum += v;
  s.n += 1;
}

type Listener = () => void;

export default class ConversationRegistry {
  private static instance: ConversationRegistry | null = null;
  static getInstance(): ConversationRegistry {
    return (ConversationRegistry.instance ??= new ConversationRegistry());
  }
  static resetForTests(): void {
    ConversationRegistry.instance = null;
  }

  private records = new Map<string, ConversationRecord>();
  /** Event-bus task id → conversation id (bound when a model call is made for it). */
  private taskToConversation = new Map<string, string>();
  private listeners = new Set<Listener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly kv: { get<T>(k: string): T | null; set<T>(k: string, v: T): boolean } = KvStore.getInstance(),
    private readonly now: () => number = () => Date.now(),
  ) {
    const saved = this.kv.get<ConversationRecord[]>(KEY);
    if (Array.isArray(saved)) {
      for (const r of saved) {
        if (!r || typeof r.id !== "string") continue;
        // Anything that was running when the app stopped is not running now.
        if (r.status === "active") {
          r.status = "failed";
          r.interruptions += 1;
          r.errors = [...(r.errors ?? []), { at: this.now(), message: "interrupted: the app stopped while this was active" }].slice(-10);
          r.endedAt = r.lastActivityAt;
        }
        this.records.set(r.id, r);
      }
    }
  }

  /* ---------------------------------------------------------- lifecycle */

  /** Register (or re-open) a conversation. Idempotent by id. */
  open(input: { id: string; type: ConversationType; initiator: Initiator; purpose?: string; title?: string; parentId?: string | null; participants?: string[] }): ConversationRecord {
    const at = this.now();
    let r = this.records.get(input.id);
    if (!r) {
      r = {
        id: input.id,
        parentId: input.parentId ?? null,
        type: input.type,
        purpose: input.purpose ?? input.type,
        title: String(input.title ?? input.id).slice(0, 120),
        initiator: input.initiator,
        participants: [...new Set(input.participants ?? [])],
        startedAt: at,
        lastActivityAt: at,
        endedAt: null,
        status: "active",
        messagesIn: 0,
        messagesOut: 0,
        modelCalls: 0,
        failedCalls: 0,
        rateLimited: 0,
        tokenReportedCalls: 0,
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningTokens: 0,
        latency: emptyStat(),
        providers: {},
        models: {},
        toolCalls: 0,
        toolFailures: 0,
        tools: {},
        tasks: [],
        errors: [],
        retries: 0,
        interruptions: 0,
      };
      this.records.set(r.id, r);
    } else {
      if (r.status !== "paused" && r.status !== "terminated") r.status = "active";
      r.endedAt = null;
      r.lastActivityAt = at;
      if (input.parentId && !r.parentId) r.parentId = input.parentId;
      for (const p of input.participants ?? []) if (!r.participants.includes(p)) r.participants.push(p);
    }
    this.changed();
    return r;
  }

  message(id: string, direction: "in" | "out"): void {
    const r = this.records.get(id);
    if (!r) return;
    if (direction === "in") r.messagesIn += 1;
    else r.messagesOut += 1;
    r.lastActivityAt = this.now();
    this.changed();
  }

  /** A turn or run finished: the conversation goes idle (it can resume) or ends. */
  settle(id: string, outcome: { ok: boolean; error?: string; end?: boolean }): void {
    const r = this.records.get(id);
    if (!r) return;
    r.lastActivityAt = this.now();
    if (!outcome.ok && outcome.error) r.errors = [...r.errors, { at: r.lastActivityAt, message: outcome.error.slice(0, 200) }].slice(-10);
    if (r.status === "terminated" || r.status === "paused") return this.changed();
    if (outcome.end) {
      r.status = outcome.ok ? "completed" : "failed";
      r.endedAt = r.lastActivityAt;
    } else r.status = outcome.ok ? "idle" : "failed";
    this.changed();
  }

  setStatus(id: string, status: ConversationStatus): ConversationRecord | undefined {
    const r = this.records.get(id);
    if (!r) return undefined;
    r.status = status;
    if (status === "terminated" || status === "completed") r.endedAt = this.now();
    this.changed();
    return r;
  }

  linkTask(id: string, taskId: string): void {
    const r = this.records.get(id);
    if (!r || r.tasks.includes(taskId)) return;
    r.tasks = [...r.tasks, taskId].slice(-50);
    this.changed();
  }

  noteRetry(id: string): void {
    const r = this.records.get(id);
    if (r) {
      r.retries += 1;
      this.changed();
    }
  }

  /** Tool events arrive with the bus task id; the gate bound it to a conversation. */
  bindTask(taskId: string, conversationId: string): void {
    this.taskToConversation.set(taskId, conversationId);
    if (this.taskToConversation.size > 2000) this.taskToConversation.delete(this.taskToConversation.keys().next().value as string);
  }

  conversationOfTask(taskId: string): string | undefined {
    return this.taskToConversation.get(taskId);
  }

  /* ---------------------------------------------------------- attribution */

  /** Where a usage event belongs. Never undefined: no call is invisible. */
  attributionOf(e: Pick<UsageEvent, "conversationId" | "operation" | "at">): { id: string; type: ConversationType; purpose: string } {
    if (e.conversationId) return { id: e.conversationId, type: "user-chat", purpose: purposeOf(e.operation) };
    if (isBackgroundPurpose(e.operation)) {
      const purpose = purposeOf(e.operation);
      return { id: `background:${purpose}:${dayKey(e.at)}`, type: "background", purpose };
    }
    return { id: `unattributed:${dayKey(e.at)}`, type: "unattributed", purpose: purposeOf(e.operation) };
  }

  /** Called by UsageBudgetGate.settle for every model / API call. */
  recordUsage(e: UsageEvent): void {
    const a = this.attributionOf(e);
    let r = this.records.get(a.id);
    if (!r) {
      r = this.open({
        id: a.id,
        type: a.type,
        initiator: a.type === "background" ? "scheduled" : a.type === "unattributed" ? "system" : "user",
        purpose: a.purpose,
        title: a.type === "background" ? `Background ${a.purpose} (${dayKey(e.at)})` : a.type === "unattributed" ? `Calls with no conversation (${dayKey(e.at)})` : a.id,
      });
      if (a.type === "background" || a.type === "unattributed") r.status = "idle";
    }
    r.modelCalls += 1;
    if (!e.ok) {
      r.failedCalls += 1;
      if (e.error) r.errors = [...r.errors, { at: e.at, message: e.error.slice(0, 200) }].slice(-10);
    }
    if (e.rateLimited) r.rateLimited += 1;
    if (e.inputTokens !== null || e.outputTokens !== null) r.tokenReportedCalls += 1;
    r.inputTokens += e.inputTokens ?? 0;
    r.outputTokens += e.outputTokens ?? 0;
    r.cachedInputTokens += e.cachedInputTokens ?? 0;
    r.reasoningTokens += e.reasoningTokens ?? 0;
    if (typeof e.latencyMs === "number") addStat(r.latency, e.latencyMs);
    r.providers[e.source] = (r.providers[e.source] ?? 0) + 1;
    if (e.model) r.models[e.model] = (r.models[e.model] ?? 0) + 1;
    if (e.agentId && !r.participants.includes(`agent:${e.agentId}`)) r.participants.push(`agent:${e.agentId}`);
    r.lastActivityAt = Math.max(r.lastActivityAt, e.at);
    this.changed();
  }

  /** Called from the event bus for tool and browser work. */
  recordBusEvent(e: { type: string; taskId?: string; tool?: string }): void {
    if (!e.type.startsWith("tool_") && !e.type.startsWith("browser_")) return;
    const conv = (e.taskId && this.taskToConversation.get(e.taskId)) || null;
    const at = this.now();
    // Work whose turn is unknown is still registered, under the day's unattributed record.
    const id = conv ?? `unattributed:${dayKey(at)}`;
    const r = this.records.get(id) ?? this.open({ id, type: "unattributed", initiator: "system", title: `Calls with no conversation (${dayKey(at)})` });
    if (e.type === "tool_started" || e.type === "browser_opened") {
      r.toolCalls += 1;
      const name = e.tool ?? (e.type.startsWith("browser_") ? "browser" : "tool");
      r.tools[name] = (r.tools[name] ?? 0) + 1;
      if (e.type.startsWith("browser_") && !r.participants.includes("service:browser")) r.participants.push("service:browser");
    }
    if (e.type === "tool_failed") r.toolFailures += 1;
    r.lastActivityAt = at;
    this.changed();
  }

  /* ---------------------------------------------------------- reading */

  get(id: string): ConversationRecord | undefined {
    const r = this.records.get(id);
    return r ? this.withIdle(r) : undefined;
  }

  list(f: RegistryFilter = {}): ConversationRecord[] {
    const t = f.text?.toLowerCase();
    return [...this.records.values()]
      .map((r) => this.withIdle(r))
      .filter(
        (r) =>
          (!f.type || f.type.includes(r.type)) &&
          (!f.status || f.status.includes(r.status)) &&
          (!f.participant || r.participants.includes(f.participant)) &&
          (!f.provider || r.providers[f.provider]) &&
          (!f.model || r.models[f.model]) &&
          (f.from === undefined || r.lastActivityAt >= f.from) &&
          (f.to === undefined || r.startedAt <= f.to) &&
          (f.minCalls === undefined || r.modelCalls >= f.minCalls) &&
          (!t || r.title.toLowerCase().includes(t) || r.id.toLowerCase().includes(t)),
      )
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  }

  /** The whole chain a conversation belongs to: its root and every descendant. */
  chain(id: string): ConversationRecord[] {
    let root = this.records.get(id);
    const seen = new Set<string>();
    while (root?.parentId && this.records.has(root.parentId) && !seen.has(root.id)) {
      seen.add(root.id);
      root = this.records.get(root.parentId);
    }
    if (!root) return [];
    const out: ConversationRecord[] = [];
    const walk = (r: ConversationRecord) => {
      out.push(this.withIdle(r));
      for (const c of this.records.values()) if (c.parentId === r.id && !out.some((o) => o.id === c.id)) walk(c);
    };
    walk(root);
    return out;
  }

  activeCount(): number {
    return [...this.records.values()].filter((r) => this.withIdle(r).status === "active").length;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  /** Every record, for export. */
  exportAll(): ConversationRecord[] {
    return this.list();
  }

  /** Active with no activity for IDLE_MS reads as idle (computed, not stored). */
  private withIdle(r: ConversationRecord): ConversationRecord {
    return r.status === "active" && this.now() - r.lastActivityAt > IDLE_MS ? { ...r, status: "idle" } : r;
  }

  private changed(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch {
        /* a listener never breaks the registry */
      }
    }
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, 400);
  }

  /** Write now (tests, shutdown). */
  save(): void {
    const all = [...this.records.values()].sort((a, b) => b.lastActivityAt - a.lastActivityAt).slice(0, MAX);
    if (all.length < this.records.size) this.records = new Map(all.map((r) => [r.id, r]));
    this.kv.set(KEY, all);
  }
}
