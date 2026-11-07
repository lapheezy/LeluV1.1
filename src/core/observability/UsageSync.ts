/**
 * ==========================================================
 * LÉLU — USAGE SYNC (Supabase)
 *
 * Moves UsageLedger events into public.usage_records for the
 * signed-in user, mirrors budgets both ways, and reads the
 * account-wide daily/monthly views so every device shows the same
 * totals. Also provides the account half of UsageBudgetGate
 * (reserve_usage / settle_usage / release_usage RPCs).
 *
 * DUPLICATES: every event carries a stable id (the reservation id for
 * a gated call, a deterministic legacy-… id for events recorded
 * before ids existed). Rows are inserted with ON CONFLICT (user_id,
 * id) DO NOTHING, so a retry, a second tab or a settle that already
 * wrote the row never produces a second record.
 *
 * WHOSE EVENTS: only events recorded while THIS user was signed in
 * are synced to this user. Events recorded signed out stay on the
 * device: on a shared browser they could belong to anyone.
 *
 * OFFLINE: a failed upsert leaves the ids unsynced; the next flush
 * (ledger change, sign-in, or the browser's `online` event) retries.
 * ==========================================================
 */

import UsageLedger, { ALL_SOURCES, type UsageBudget, type UsageEvent, type UsageKind, type UsageTotals } from "./UsageLedger";
import UsageBudgetGate, { type RemoteReserveResult, type UsageRemote } from "./UsageBudgetGate";

type Result<T = unknown> = PromiseLike<{ data: T | null; error: { message: string } | null }>;

/** The slice of SupabaseClient used here (a fake implements it in tests). */
export interface UsageBackend {
  rpc(fn: string, args: Record<string, unknown>): Result;
  from(table: string): {
    upsert(rows: unknown, options: Record<string, unknown>): Result;
    select(columns: string): {
      gte(column: string, value: string): Result<unknown[]>;
    } & Result<unknown[]>;
    delete(): { eq(c: string, v: string): { eq(c: string, v: string): Result } };
  };
}

export interface UsageChannel {
  client: UsageBackend;
  userId: string;
}

export interface SyncStatus {
  signedIn: boolean;
  lastSyncAt: number | null;
  lastError: string | null;
  pending: number;
  syncedTotal: number;
}

export function toRow(event: UsageEvent, userId: string): Record<string, unknown> {
  return {
    user_id: userId,
    id: event.id,
    kind: event.kind,
    source: event.source.slice(0, 120),
    model: event.model?.slice(0, 200) ?? null,
    operation: event.operation?.slice(0, 60) ?? null,
    ok: event.ok,
    rate_limited: Boolean(event.rateLimited),
    latency_ms: typeof event.latencyMs === "number" ? Math.max(0, Math.round(event.latencyMs)) : null,
    results: typeof event.results === "number" ? event.results : null,
    input_tokens: event.inputTokens,
    output_tokens: event.outputTokens,
    cached_input_tokens: event.cachedInputTokens,
    reasoning_tokens: event.reasoningTokens,
    cost_usd: event.costKind === "reported" ? event.costUsd : null,
    cost_kind: event.costKind,
    error: event.error?.slice(0, 200) ?? null,
    occurred_at: new Date(event.at).toISOString(),
  };
}

const BUDGET_COLUMNS: Array<[keyof UsageBudget, string]> = [
  ["dailyCalls", "daily_requests"], ["monthlyCalls", "monthly_requests"],
  ["dailyTokens", "daily_tokens"], ["monthlyTokens", "monthly_tokens"],
  ["dailyCostUsd", "daily_cost_usd"], ["monthlyCostUsd", "monthly_cost_usd"],
];

interface Storage { getItem(k: string): string | null; setItem(k: string, v: string): void }

export class SupabaseUsageRemote implements UsageRemote {
  constructor(private readonly channel: UsageChannel) {}

  async reserve(args: { id: string; kind: UsageKind; source: string; reserveTokens: number }): Promise<RemoteReserveResult> {
    const { data, error } = await this.channel.client.rpc("reserve_usage", {
      p_id: args.id, p_kind: args.kind, p_source: args.source, p_reserve_tokens: args.reserveTokens, p_ttl_seconds: 600,
    });
    if (error) throw new Error(error.message);
    const d = (data ?? {}) as { allowed?: boolean; reason?: string; warnings?: string[] };
    return { allowed: d.allowed === true, reason: d.reason, warnings: d.warnings ?? [] };
  }

  async settle(id: string, event: UsageEvent): Promise<void> {
    const { error } = await this.channel.client.rpc("settle_usage", { p_reservation_id: id, p_record: toRow(event, this.channel.userId) });
    if (error) throw new Error(error.message);
  }

  async release(id: string): Promise<void> {
    const { error } = await this.channel.client.rpc("release_usage", { p_reservation_id: id });
    if (error) throw new Error(error.message);
  }
}

export default class UsageSync {
  private static instance: UsageSync | null = null;
  static getInstance(): UsageSync {
    UsageSync.instance ??= new UsageSync();
    return UsageSync.instance;
  }

  private channelFactory: () => UsageChannel | null = () => null;
  private status: SyncStatus = { signedIn: false, lastSyncAt: null, lastError: null, pending: 0, syncedTotal: 0 };
  private flushing: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();
  private started = false;

  constructor(
    private readonly ledger: UsageLedger = UsageLedger.getInstance(),
    private readonly gate: UsageBudgetGate = UsageBudgetGate.getInstance(),
    private readonly storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null,
  ) {}

  /** Connect to a channel source (SupabasePersistence.usageChannel) and wire the gate. Idempotent. */
  start(channel: () => UsageChannel | null, onAuthChange?: (listener: () => void) => void): void {
    this.channelFactory = channel;
    this.gate.setRemote(() => {
      const c = this.channelFactory();
      return c ? new SupabaseUsageRemote(c) : null;
    });
    if (this.started) return;
    this.started = true;
    this.ledger.subscribe(() => this.schedule());
    onAuthChange?.(() => void this.onAuth());
    if (typeof window !== "undefined") window.addEventListener?.("online", () => void this.flush());
    void this.onAuth();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  private emit(): void {
    for (const l of this.listeners) {
      try { l(); } catch { /* never break sync for a listener */ }
    }
  }

  /** Re-read who is signed in (after persistence connects, signs in or out). */
  refresh(): Promise<void> {
    return this.onAuth();
  }

  private async onAuth(): Promise<void> {
    const channel = this.channelFactory();
    this.ledger.setUser(channel?.userId ?? null);
    this.status.signedIn = Boolean(channel);
    this.emit();
    if (channel) {
      await this.pullBudgets().catch((e) => this.fail(e));
      await this.flush();
    }
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 1500);
    (this.timer as { unref?: () => void }).unref?.();
  }

  private syncedKey(userId: string) {
    return `lelu.usage.synced.${userId}`;
  }

  private syncedIds(userId: string): Set<string> {
    try {
      return new Set(JSON.parse(this.storage?.getItem(this.syncedKey(userId)) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  }

  /** Events this user still owes the account: theirs, not synced, not in flight. */
  unsynced(userId: string): UsageEvent[] {
    const synced = this.syncedIds(userId);
    return this.ledger.allEvents().filter((e) => e.userId === userId && !synced.has(e.id));
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      const channel = this.channelFactory();
      if (!channel) return;
      const events = this.unsynced(channel.userId);
      this.status.pending = events.length;
      if (events.length === 0) return;
      const synced = this.syncedIds(channel.userId);
      for (let i = 0; i < events.length; i += 100) {
        const chunk = events.slice(i, i + 100);
        const { error } = await channel.client
          .from("usage_records")
          .upsert(chunk.map((e) => toRow(e, channel.userId)), { onConflict: "user_id,id", ignoreDuplicates: true });
        if (error) {
          this.fail(error);
          return;
        }
        for (const e of chunk) synced.add(e.id);
        this.gate.markSettled(chunk.map((e) => e.id));
        this.status.syncedTotal += chunk.length;
      }
      this.storage?.setItem(this.syncedKey(channel.userId), JSON.stringify([...synced].slice(-2000)));
      this.status.pending = 0;
      this.status.lastSyncAt = Date.now();
      this.status.lastError = null;
    })().finally(() => {
      this.flushing = null;
      this.emit();
    });
    return this.flushing;
  }

  private fail(error: unknown): void {
    this.status.lastError = error instanceof Error ? error.message : (error as { message?: string })?.message ?? String(error);
    this.emit();
  }

  /* ---------- budgets ---------- */

  async pullBudgets(): Promise<void> {
    const channel = this.channelFactory();
    if (!channel) return;
    const { data, error } = await channel.client.from("usage_budgets").select("*");
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const budget: UsageBudget = {};
      for (const [field, column] of BUDGET_COLUMNS) {
        if (row[column] !== null && row[column] !== undefined) budget[field] = Number(row[column]);
      }
      this.ledger.setBudget(row.kind as UsageKind, String(row.source), budget);
    }
  }

  /** Set (or clear, with null) a budget on this device and, when signed in, on the account. */
  async saveBudget(kind: UsageKind, source: string, budget: UsageBudget | null): Promise<void> {
    this.ledger.setBudget(kind, source, budget);
    const channel = this.channelFactory();
    if (!channel) return;
    if (budget === null) {
      const { error } = await channel.client.from("usage_budgets").delete().eq("kind", kind).eq("source", source);
      if (error) throw new Error(error.message);
      return;
    }
    const row: Record<string, unknown> = { user_id: channel.userId, kind, source, updated_at: new Date().toISOString() };
    for (const [field, column] of BUDGET_COLUMNS) row[column] = budget[field] ?? null;
    const { error } = await channel.client.from("usage_budgets").upsert(row, { onConflict: "user_id,kind,source" });
    if (error) throw new Error(error.message);
  }

  /* ---------- account-wide history ---------- */

  async accountSummary(period: "day" | "week" | "month"): Promise<Array<{ kind: UsageKind; source: string; totals: UsageTotals }> | null> {
    const channel = this.channelFactory();
    if (!channel) return null;
    const now = new Date();
    const from = period === "month"
      ? `${now.toISOString().slice(0, 7)}-01`
      : new Date(now.getTime() - (period === "week" ? 6 : 0) * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await channel.client.from("usage_daily").select("*").gte("day", from);
    if (error) throw new Error(error.message);
    const merged = new Map<string, UsageTotals>();
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const key = `${r.kind}:${r.source}`;
      const t = merged.get(key) ?? { calls: 0, ok: 0, failed: 0, rateLimited: 0, tokenReportedCalls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningTokens: 0, reportedCostUsd: 0, unknownCostCalls: 0, totalLatencyMs: 0 };
      t.calls += Number(r.requests ?? 0);
      t.ok += Number(r.ok_requests ?? 0);
      t.failed += Number(r.failed_requests ?? 0);
      t.rateLimited += Number(r.rate_limited_requests ?? 0);
      t.tokenReportedCalls += Number(r.token_reported_requests ?? 0);
      t.inputTokens += Number(r.input_tokens ?? 0);
      t.outputTokens += Number(r.output_tokens ?? 0);
      t.cachedInputTokens += Number(r.cached_input_tokens ?? 0);
      t.reasoningTokens += Number(r.reasoning_tokens ?? 0);
      t.reportedCostUsd += Number(r.reported_cost_usd ?? 0);
      t.unknownCostCalls += Number(r.unknown_cost_requests ?? 0);
      t.totalLatencyMs += Number(r.total_latency_ms ?? 0);
      merged.set(key, t);
    }
    return [...merged.entries()]
      .map(([key, totals]) => {
        const [kind, ...rest] = key.split(":");
        return { kind: kind as UsageKind, source: rest.join(":"), totals };
      })
      .sort((a, b) => b.totals.calls - a.totals.calls);
  }
}

export { ALL_SOURCES };
