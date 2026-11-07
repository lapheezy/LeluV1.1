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

/**
 * The slice of SupabaseClient used here. Typed loosely on purpose: it is the
 * PostgREST query builder (supabase-js) in the app, and a small fake in tests.
 */
export interface UsageBackend {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
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

interface BudgetRow {
  kind: string; source: string;
  daily_requests: number | null; monthly_requests: number | null;
  daily_tokens: number | null; monthly_tokens: number | null;
  daily_cost_usd: number | string | null; monthly_cost_usd: number | string | null;
}
interface DailyRow { day: string; kind: string; source: string; requests: number; input_tokens: number | null; output_tokens: number | null; reported_cost_usd: number | string | null; unknown_cost_requests: number }
interface ReservationRow { id: string; source: string; reserved_tokens: number; created_at: string }

/**
 * May this reservation proceed? Pure, so it is unit-tested directly.
 *
 * `ahead` are the live reservations ranked BEFORE this one by the database
 * clock. Each counts one request (and its declared tokens) against every
 * budget covering its source. Reported cost only; unknown cost never estimated.
 */
export function evaluateAccountBudgets(
  source: string,
  reserveTokens: number,
  budgets: BudgetRow[],
  daily: DailyRow[],
  ahead: ReservationRow[],
  today: string,
): RemoteReserveResult {
  const warnings: string[] = [];
  const ordered = [...budgets].sort((a, c) => (a.source === ALL_SOURCES ? 1 : 0) - (c.source === ALL_SOURCES ? 1 : 0));
  for (const b of ordered) {
    if (b.source !== source && b.source !== ALL_SOURCES) continue;
    const scope = b.source === ALL_SOURCES ? `all ${b.kind === "ai" ? "AI providers" : "sources"}` : source;
    const inScope = (s: string) => b.source === ALL_SOURCES || s === source;
    const rows = daily.filter((r) => inScope(r.source));
    const sumRows = (list: DailyRow[]) => list.reduce(
      (t, r) => ({
        req: t.req + Number(r.requests ?? 0),
        tok: t.tok + Number(r.input_tokens ?? 0) + Number(r.output_tokens ?? 0),
        cost: t.cost + Number(r.reported_cost_usd ?? 0),
        unknown: t.unknown + Number(r.unknown_cost_requests ?? 0),
      }),
      { req: 0, tok: 0, cost: 0, unknown: 0 },
    );
    const month = sumRows(rows);
    const day = sumRows(rows.filter((r) => r.day === today));
    const held = ahead.filter((r) => inScope(r.source));
    const heldReq = held.length;
    const heldTok = held.reduce((t, r) => t + Number(r.reserved_tokens ?? 0), 0);
    const refuse = (limit: string, detail: string): RemoteReserveResult => ({ allowed: false, reason: `${scope}: ${limit} budget reached (${detail}).` });
    if (b.daily_requests && day.req + heldReq + 1 > b.daily_requests) return refuse("daily request", `${day.req} used + ${heldReq} in flight of ${b.daily_requests}`);
    if (b.monthly_requests && month.req + heldReq + 1 > b.monthly_requests) return refuse("monthly request", `${month.req} used + ${heldReq} in flight of ${b.monthly_requests}`);
    if (b.daily_tokens && (day.tok + heldTok >= b.daily_tokens || day.tok + heldTok + reserveTokens > b.daily_tokens)) return refuse("daily token", `${day.tok} reported + ${heldTok + reserveTokens} reserved of ${b.daily_tokens}`);
    if (b.monthly_tokens && (month.tok + heldTok >= b.monthly_tokens || month.tok + heldTok + reserveTokens > b.monthly_tokens)) return refuse("monthly token", `${month.tok} reported + ${heldTok + reserveTokens} reserved of ${b.monthly_tokens}`);
    if (b.daily_cost_usd && day.cost >= Number(b.daily_cost_usd)) return refuse("daily spending", `$${day.cost.toFixed(4)} reported of $${b.daily_cost_usd}`);
    if (b.monthly_cost_usd && month.cost >= Number(b.monthly_cost_usd)) return refuse("monthly spending", `$${month.cost.toFixed(4)} reported of $${b.monthly_cost_usd}`);
    if ((b.daily_cost_usd || b.monthly_cost_usd) && month.unknown > 0) {
      warnings.push(`${scope}: ${month.unknown} call(s) this month reported no cost; the spending cap counts reported cost only.`);
    }
  }
  return { allowed: true, warnings };
}

/**
 * The account half of UsageBudgetGate, on plain tables under RLS:
 *
 *   reserve  INSERT the reservation (its created_at is the database clock),
 *            THEN read live reservations, THEN read usage. Rank this
 *            reservation among the live ones; admit only if used + earlier
 *            reservations + 1 fits. Reading reservations before records means
 *            a call settling in between is counted twice (safe), never zero
 *            times. Refused → the reservation is deleted.
 *   settle   INSERT the record (ON CONFLICT DO NOTHING) THEN delete the
 *            reservation, so the call is never in neither table.
 *   release  delete the reservation.
 */
export class SupabaseUsageRemote implements UsageRemote {
  constructor(private readonly channel: UsageChannel) {}

  private async must<T>(query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T | null> {
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return data as T | null;
  }

  async reserve(args: { id: string; kind: UsageKind; source: string; reserveTokens: number }): Promise<RemoteReserveResult> {
    const db = this.channel.client;
    const mine = await this.must<ReservationRow>(
      db.from("usage_reservations")
        .insert({ user_id: this.channel.userId, id: args.id, kind: args.kind, source: args.source, reserved_tokens: args.reserveTokens })
        .select("id, source, reserved_tokens, created_at")
        .single(),
    );
    try {
      const budgets = (await this.must<BudgetRow[]>(db.from("usage_budgets").select("*").eq("kind", args.kind).in("source", [args.source, ALL_SOURCES]))) ?? [];
      if (budgets.length === 0) return { allowed: true, warnings: [] };
      const nowIso = new Date().toISOString();
      const live = (await this.must<ReservationRow[]>(
        db.from("usage_reservations").select("id, source, reserved_tokens, created_at").eq("kind", args.kind).gt("expires_at", nowIso),
      )) ?? [];
      const at = Date.parse(mine?.created_at ?? nowIso);
      const ahead = live.filter((r) => {
        if (r.id === args.id) return false;
        const t = Date.parse(r.created_at);
        return t < at || (t === at && r.id < args.id);
      });
      const monthStart = `${nowIso.slice(0, 7)}-01`;
      const daily = (await this.must<DailyRow[]>(db.from("usage_daily").select("*").eq("kind", args.kind).gte("day", monthStart))) ?? [];
      const verdict = evaluateAccountBudgets(args.source, args.reserveTokens, budgets, daily, ahead, nowIso.slice(0, 10));
      if (!verdict.allowed) await this.release(args.id);
      return verdict;
    } catch (error) {
      await this.release(args.id).catch(() => undefined);
      throw error;
    }
  }

  async settle(id: string, event: UsageEvent): Promise<void> {
    const db = this.channel.client;
    await this.must(db.from("usage_records").upsert({ ...toRow(event, this.channel.userId), reservation_id: id }, { onConflict: "user_id,id", ignoreDuplicates: true }));
    await this.release(id);
  }

  async release(id: string): Promise<void> {
    await this.must(this.channel.client.from("usage_reservations").delete().eq("id", id));
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
  private budgetsLoadedFor: string | null = null;
  private budgetsLoading: Promise<void> | null = null;

  constructor(
    private readonly ledger: UsageLedger = UsageLedger.getInstance(),
    private readonly gate: UsageBudgetGate = UsageBudgetGate.getInstance(),
    private readonly storage: Storage | null = typeof localStorage !== "undefined" ? localStorage : null,
  ) {}

  /** Connect to a channel source (SupabasePersistence.usageChannel) and wire the gate. Idempotent. */
  start(
    channel: () => UsageChannel | null,
    onAuthChange?: (listener: () => void) => void,
    makeRemote: (channel: UsageChannel) => UsageRemote = (c) => new SupabaseUsageRemote(c),
  ): void {
    this.channelFactory = channel;
    this.gate.setRemote(() => {
      const c = this.channelFactory();
      return c ? makeRemote(c) : null;
    });
    this.gate.setAccountReadiness(() => this.accountReady());
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
      await this.loadBudgets(channel.userId);
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

  private loadBudgets(userId: string): Promise<void> {
    if (this.budgetsLoadedFor === userId) return Promise.resolve();
    this.budgetsLoading ??= this.pullBudgets()
      .then(() => {
        this.budgetsLoadedFor = userId;
        this.storage?.setItem(`lelu.usage.budgetsSeen.${userId}`, String(Date.now()));
      })
      .catch((e) => this.fail(e))
      .finally(() => { this.budgetsLoading = null; });
    return this.budgetsLoading;
  }

  /**
   * Are the signed-in user's budgets on this device? Waits up to `timeoutMs`
   * for a load in progress, retrying once if none is. Signed out → true.
   */
  async accountReady(timeoutMs = 10_000): Promise<boolean> {
    const channel = this.channelFactory();
    if (!channel) return true;
    if (this.budgetsLoadedFor === channel.userId) return true;
    const load = this.loadBudgets(channel.userId);
    await Promise.race([load, new Promise((r) => setTimeout(r, timeoutMs))]);
    if (this.budgetsLoadedFor === channel.userId) return true;
    // Could not load now. A device that loaded this user's budgets before
    // keeps that copy (UsageLedger persists it) and enforces it; a device
    // that never has must not send blind.
    return Boolean(this.storage?.getItem(`lelu.usage.budgetsSeen.${channel.userId}`));
  }

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
