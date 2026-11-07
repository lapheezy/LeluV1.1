/**
 * ==========================================================
 * LÉLU — USAGE LEDGER
 *
 * Cumulative accounting of what LÉLU consumes: AI model calls
 * (tokens) and external knowledge-source calls (requests, errors,
 * rate limits, latency), plus per-source budgets.
 *
 * Before this existed, AIProviderRegistry kept only the LAST usage
 * of each provider, and knowledge-source calls were logged but never
 * counted, so "how much did today cost" had no answer.
 *
 * HONESTY RULES
 *   • Token counts come only from the provider's own `usage` object.
 *     A provider that reports none is recorded as tokens UNAVAILABLE
 *     (null), never as 0 and never as an estimate.
 *   • Cost is "reported" only when the provider returned a cost
 *     figure (e.g. OpenRouter `usage.cost`). LÉLU holds no price
 *     table, so everything else is "unknown", never a guess.
 *   • A budget is a hard call cap checked BEFORE the call. Hitting
 *     it refuses that source; it never reroutes to a paid one.
 *
 * Persistence: daily aggregates and the latest events are kept in
 * localStorage when it exists (browser), so a reload keeps the
 * day's totals; in Node it is memory-only.
 * ==========================================================
 */

export type UsageKind = "ai" | "api";
export type CostKind = "reported" | "unknown";

export interface UsageEvent {
  /** Stable id: the dedupe key when the event is synced to Supabase. */
  id: string;
  /** The signed-in user the event was recorded for; null when signed out. */
  userId: string | null;
  at: number;
  kind: UsageKind;
  /** Provider / knowledge-source name. */
  source: string;
  model?: string;
  operation?: string;
  ok: boolean;
  latencyMs?: number;
  rateLimited?: boolean;
  /** null = the provider did not report it. */
  inputTokens: number | null;
  outputTokens: number | null;
  cachedInputTokens: number | null;
  reasoningTokens: number | null;
  costUsd: number | null;
  costKind: CostKind;
  results?: number;
  error?: string;
}

export interface UsageTotals {
  calls: number;
  ok: number;
  failed: number;
  rateLimited: number;
  /** Calls whose provider reported token counts. */
  tokenReportedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  reportedCostUsd: number;
  /** Calls with no reported cost: their cost is unknown, not zero. */
  unknownCostCalls: number;
  totalLatencyMs: number;
}

export interface UsageBudget {
  dailyCalls?: number;
  monthlyCalls?: number;
  dailyTokens?: number;
  monthlyTokens?: number;
  /** Spending caps count REPORTED cost only; unknown cost is never estimated. */
  dailyCostUsd?: number;
  monthlyCostUsd?: number;
}

/** Calls already reserved but not yet settled (they hold budget). */
export interface PendingUsage {
  requests: number;
  tokens: number;
}

/** Budgets keyed "kind:*" apply to every source of that kind. */
export const ALL_SOURCES = "*";

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Deterministic id for an event recorded before ids existed, so re-syncing it never duplicates. */
export function legacyEventId(e: Pick<UsageEvent, "at" | "kind" | "source" | "ok"> & { latencyMs?: number; model?: string }): string {
  const text = `${e.at}|${e.kind}|${e.source}|${e.ok}|${e.latencyMs ?? ""}|${e.model ?? ""}`;
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let i = 0; i < text.length; i += 1) {
    h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619);
    h2 = Math.imul(h2 ^ text.charCodeAt(i), 2246822507);
  }
  return `legacy-${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

export interface BudgetDecision {
  allowed: boolean;
  /** Set when a cap is ≥ 80 % used (or exceeded). */
  warning?: string;
  reason?: string;
}

const STORAGE_KEY = "lelu.usage.v1";
const MAX_EVENTS = 500;
const PERSISTED_EVENTS = 100;
const KEEP_DAYS = 62;

const emptyTotals = (): UsageTotals => ({
  calls: 0, ok: 0, failed: 0, rateLimited: 0, tokenReportedCalls: 0,
  inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0,
  reportedCostUsd: 0, unknownCostCalls: 0, totalLatencyMs: 0,
});

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Normalise the usage object of any provider family LÉLU talks to:
 * Anthropic (input_tokens / output_tokens / cache_read_input_tokens),
 * OpenAI-compatible (prompt_tokens / completion_tokens / *_details),
 * Gemini (promptTokenCount / candidatesTokenCount).
 */
export function normalizeUsage(usage: unknown): Pick<UsageEvent, "inputTokens" | "outputTokens" | "cachedInputTokens" | "reasoningTokens" | "costUsd" | "costKind"> {
  const u = (usage && typeof usage === "object" ? usage : {}) as Record<string, any>;
  const input = num(u.input_tokens) ?? num(u.prompt_tokens) ?? num(u.promptTokenCount) ?? num(u.inputTokens);
  const output = num(u.output_tokens) ?? num(u.completion_tokens) ?? num(u.candidatesTokenCount) ?? num(u.outputTokens);
  const cached = num(u.cache_read_input_tokens) ?? num(u.prompt_tokens_details?.cached_tokens) ?? num(u.cachedContentTokenCount);
  const reasoning = num(u.completion_tokens_details?.reasoning_tokens) ?? num(u.thoughtsTokenCount);
  const cost = num(u.cost) ?? num(u.total_cost);
  return {
    inputTokens: input,
    outputTokens: output,
    cachedInputTokens: cached,
    reasoningTokens: reasoning,
    costUsd: cost,
    costKind: cost === null ? "unknown" : "reported",
  };
}

const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
const monthKey = (t: number) => new Date(t).toISOString().slice(0, 7);

function add(totals: UsageTotals, e: UsageEvent): void {
  totals.calls += 1;
  if (e.ok) totals.ok += 1; else totals.failed += 1;
  if (e.rateLimited) totals.rateLimited += 1;
  if (e.inputTokens !== null || e.outputTokens !== null) totals.tokenReportedCalls += 1;
  totals.inputTokens += e.inputTokens ?? 0;
  totals.outputTokens += e.outputTokens ?? 0;
  totals.cachedInputTokens += e.cachedInputTokens ?? 0;
  totals.reasoningTokens += e.reasoningTokens ?? 0;
  if (e.costKind === "reported" && e.costUsd !== null) totals.reportedCostUsd += e.costUsd; else totals.unknownCostCalls += 1;
  totals.totalLatencyMs += e.latencyMs ?? 0;
}

type Daily = Record<string, Record<string, UsageTotals>>; // day → "kind:source" → totals

interface Storage { getItem(k: string): string | null; setItem(k: string, v: string): void }

export default class UsageLedger {
  private static instance: UsageLedger | null = null;
  static getInstance(): UsageLedger {
    UsageLedger.instance ??= new UsageLedger();
    return UsageLedger.instance;
  }

  private events: UsageEvent[] = [];
  private daily: Daily = {};
  private budgets: Record<string, UsageBudget> = {};
  private readonly sessionStart: number;
  private listeners = new Set<() => void>();
  private currentUser: string | null = null;

  constructor(
    private readonly now: () => number = () => Date.now(),
    private readonly storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null,
  ) {
    this.sessionStart = now();
    this.load();
  }

  /* ---------- recording ---------- */

  /** Who new events belong to (SupabasePersistence auth). */
  setUser(userId: string | null): void {
    this.currentUser = userId;
  }

  getUser(): string | null {
    return this.currentUser;
  }

  record(event: Omit<UsageEvent, "id" | "userId" | "at" | "inputTokens" | "outputTokens" | "cachedInputTokens" | "reasoningTokens" | "costUsd" | "costKind"> & { usage?: unknown; id?: string }): UsageEvent {
    const { usage, id, ...rest } = event;
    const full: UsageEvent = { id: id ?? newId(), userId: this.currentUser, at: this.now(), ...rest, ...normalizeUsage(usage) };
    if (full.error) full.error = full.error.slice(0, 200);
    this.events.push(full);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    const day = (this.daily[dayKey(full.at)] ??= {});
    add((day[`${full.kind}:${full.source}`] ??= emptyTotals()), full);
    this.save();
    for (const listener of this.listeners) {
      try { listener(); } catch { /* a listener never breaks accounting */ }
    }
    return full;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /* ---------- reading ---------- */

  recent(limit = 25): UsageEvent[] {
    return this.events.slice(-limit).reverse();
  }

  /** Every retained event, oldest first (the sync queue reads this). */
  allEvents(): readonly UsageEvent[] {
    return this.events;
  }

  /** Per-source totals for a period. "session" counts only events since this ledger started. */
  summary(period: "session" | "day" | "week" | "month" = "day"): Array<{ kind: UsageKind; source: string; totals: UsageTotals }> {
    const merged = new Map<string, UsageTotals>();
    const merge = (key: string, t: UsageTotals) => {
      const into = merged.get(key) ?? emptyTotals();
      for (const field of Object.keys(t) as Array<keyof UsageTotals>) into[field] += t[field];
      merged.set(key, into);
    };
    if (period === "session") {
      for (const e of this.events) {
        if (e.at < this.sessionStart) continue;
        const t = emptyTotals(); add(t, e); merge(`${e.kind}:${e.source}`, t);
      }
    } else {
      const t = this.now();
      const days = new Set<string>();
      if (period === "day") days.add(dayKey(t));
      if (period === "week") for (let i = 0; i < 7; i += 1) days.add(dayKey(t - i * 86_400_000));
      for (const [day, perSource] of Object.entries(this.daily)) {
        if (period === "month" ? day.startsWith(monthKey(t)) : days.has(day)) {
          for (const [key, totals] of Object.entries(perSource)) merge(key, totals);
        }
      }
    }
    return [...merged.entries()]
      .map(([key, totals]) => {
        const [kind, ...source] = key.split(":");
        return { kind: kind as UsageKind, source: source.join(":"), totals };
      })
      .sort((a, b) => b.totals.calls - a.totals.calls);
  }

  totals(period: "session" | "day" | "week" | "month" = "day", kind?: UsageKind): UsageTotals {
    const out = emptyTotals();
    for (const row of this.summary(period)) {
      if (kind && row.kind !== kind) continue;
      for (const field of Object.keys(out) as Array<keyof UsageTotals>) out[field] += row.totals[field];
    }
    return out;
  }

  /* ---------- budgets ---------- */

  setBudget(kind: UsageKind, source: string, budget: UsageBudget | null): void {
    const key = `${kind}:${source}`;
    if (budget === null) delete this.budgets[key]; else this.budgets[key] = { ...budget };
    this.save();
  }

  budgetsSnapshot(): Record<string, UsageBudget> {
    return { ...this.budgets };
  }

  /**
   * May this source be called now? Checked BEFORE the call, against the
   * source's own budget and the kind's "*" budget, counting calls that are
   * reserved but not yet settled (`pending`) so concurrent calls cannot
   * both take the last unit.
   */
  check(kind: UsageKind, source: string, pending: PendingUsage = { requests: 0, tokens: 0 }, only?: "source" | "all"): BudgetDecision {
    let warning: string | undefined;
    const scopes = only === "source" ? [source] : only === "all" ? [ALL_SOURCES] : [source, ALL_SOURCES];
    for (const scope of scopes) {
      const budget = this.budgets[`${kind}:${scope}`];
      if (!budget) continue;
      const label = scope === ALL_SOURCES ? `all ${kind === "ai" ? "AI providers" : "sources"}` : source;
      const t = this.now();
      const today = emptyTotals();
      const month = emptyTotals();
      for (const [day, perSource] of Object.entries(this.daily)) {
        const inMonth = day.startsWith(monthKey(t));
        if (!inMonth) continue;
        for (const [key, totals] of Object.entries(perSource)) {
          const [k, ...rest] = key.split(":");
          if (k !== kind || (scope !== ALL_SOURCES && rest.join(":") !== source)) continue;
          for (const field of Object.keys(month) as Array<keyof UsageTotals>) {
            month[field] += totals[field];
            if (day === dayKey(t)) today[field] += totals[field];
          }
        }
      }
      const caps: Array<[string, number, number | undefined, boolean]> = [
        // [label, used incl. pending, cap, isCount (a new call adds 1)]
        ["daily calls", today.calls + pending.requests, budget.dailyCalls, true],
        ["monthly calls", month.calls + pending.requests, budget.monthlyCalls, true],
        ["daily tokens", today.inputTokens + today.outputTokens + pending.tokens, budget.dailyTokens, false],
        ["monthly tokens", month.inputTokens + month.outputTokens + pending.tokens, budget.monthlyTokens, false],
        ["daily reported spend ($)", today.reportedCostUsd, budget.dailyCostUsd, false],
        ["monthly reported spend ($)", month.reportedCostUsd, budget.monthlyCostUsd, false],
      ];
      for (const [name, used, cap, isCount] of caps) {
        if (cap === undefined) continue;
        const shown = name.includes("$") ? used.toFixed(4) : String(used);
        if (isCount ? used + 1 > cap : used >= cap) {
          return {
            allowed: false,
            reason: `${label}: ${name} budget reached (${shown}/${cap}${pending.requests ? `, ${pending.requests} in flight` : ""}). Raise or clear the budget to continue.`,
            warning: `${label}: ${name} ${shown}/${cap}`,
          };
        }
        if (used >= cap * 0.8) warning = `${label}: ${name} at ${shown}/${cap} (${Math.round((used / cap) * 100)}%)`;
      }
      if ((budget.dailyCostUsd !== undefined || budget.monthlyCostUsd !== undefined) && month.unknownCostCalls > 0) {
        warning ??= `${label}: ${month.unknownCostCalls} call(s) this month reported no cost — the spending cap counts reported cost only.`;
      }
    }
    return { allowed: true, warning };
  }

  /* ---------- persistence ---------- */

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { daily?: Daily; budgets?: Record<string, UsageBudget>; events?: UsageEvent[] };
      this.daily = parsed.daily && typeof parsed.daily === "object" ? parsed.daily : {};
      this.budgets = parsed.budgets && typeof parsed.budgets === "object" ? parsed.budgets : {};
      this.events = Array.isArray(parsed.events)
        ? parsed.events.slice(-PERSISTED_EVENTS).map((e) => ({ ...e, id: e.id ?? legacyEventId(e), userId: e.userId ?? null }))
        : [];
    } catch {
      /* a corrupt record starts a fresh ledger rather than breaking the app */
    }
  }

  private save(): void {
    if (!this.storage) return;
    const cutoff = dayKey(this.now() - KEEP_DAYS * 86_400_000);
    for (const day of Object.keys(this.daily)) if (day < cutoff) delete this.daily[day];
    try {
      this.storage.setItem(STORAGE_KEY, JSON.stringify({ daily: this.daily, budgets: this.budgets, events: this.events.slice(-PERSISTED_EVENTS) }));
    } catch {
      /* storage full or blocked: accounting continues in memory */
    }
  }
}
