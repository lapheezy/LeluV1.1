/**
 * ==========================================================
 * LÉLU — USAGE BUDGET GATE
 *
 * Every billed call (each model round of the tool loop, each
 * knowledge-source call that opts in) goes through three steps:
 *
 *   reserve  BEFORE dispatch. Refused when a cap would be exceeded,
 *            counting calls already in flight, so concurrent calls
 *            cannot both take the last unit. Local check first
 *            (this device); then, when signed in, the account-wide
 *            check in Postgres (reserve_usage, serialised per user by
 *            an advisory lock), which covers every device.
 *   settle   AFTER the call, with the usage the provider REPORTED.
 *            Recorded under the reservation's id, so the record and
 *            any later sync of the same event are one row.
 *   release  when the call never reached the provider: the
 *            reservation is given back and nothing is recorded.
 *
 * A failed provider call is settled (ok: false), not released: it was
 * a request, and request caps count it.
 *
 * Nothing here estimates tokens or cost. A token cap is enforced on
 * reported tokens plus any declared reservation; a spending cap on
 * reported cost only.
 *
 * Offline / remote unreachable: the local check still applies and the
 * reservation says `accountChecked: false`, so the caller can tell the
 * user the account-wide budget was not consulted.
 * ==========================================================
 */

import ResourcePolicy, { ResourceRefusal } from "./ResourcePolicy";
import ConversationRegistry from "./ConversationRegistry";
import UsageLedger, {
  ALL_SOURCES,
  BACKGROUND_BUDGET_SOURCE,
  BACKGROUND_PRIORITY,
  purposeOf,
  isBackgroundPurpose,
  nextUtcMidnight,
  type PendingUsage,
  type UsageEvent,
  type UsageKind,
} from "./UsageLedger";

/**
 * A provider refusal that means "spent for the day", not "slow down": a 429
 * naming a per-day / daily / TPD / RPD limit.
 */
export function isDailyLimitRefusal(message: string): boolean {
  return /\b429\b|rate.?limit|too many requests/i.test(message) &&
    /per[\s-]?day|daily|\bTPD\b|\bRPD\b|tokens per day|requests per day|-per-day/i.test(message);
}

/** Where background model use stands right now — the gate's own view, for the UI and tests. */
export interface BackgroundAllowance {
  cap: number;
  ownerSet: boolean;
  usedToday: number;
  inFlight: number;
  remaining: number;
  paused: { until: number; reason: string } | null;
  /** Earliest time the next background call may be sent (now when it may go now). */
  nextAllowedAt: number;
  /** Why it may not go now, when it may not. */
  blockedBy: "paused" | "cap" | "pacing" | null;
  /** When the current call became available (pacing passed). */
  slotOpenedAt: number;
  /** True while the allowance is scarce enough to be paced and rationed by priority. */
  rationed: boolean;
}

/**
 * A purpose that asked for a background call within this window still has a
 * claim: lower-priority work may not take an available call ahead of it.
 */
const DEMAND_WINDOW_MS = 30 * 60_000;
/**
 * Rationing (pacing and priority) is for a SCARCE allowance. When the owner
 * has granted enough that calls would be spaced less than this apart, only
 * the cap itself applies.
 */
const RATION_MIN_SPACING_MS = 60_000;

export interface RemoteReserveResult {
  allowed: boolean;
  reason?: string;
  warnings?: string[];
}

/** The account-side half (Supabase RPCs). Absent when signed out. */
export interface UsageRemote {
  reserve(args: { id: string; kind: UsageKind; source: string; reserveTokens: number }): Promise<RemoteReserveResult>;
  settle(id: string, event: UsageEvent): Promise<void>;
  release(id: string): Promise<void>;
}

export class BudgetExhaustedError extends Error {
  readonly kind: UsageKind;
  readonly source: string;
  /** "device" = this browser's budget; "account" = the signed-in user's budget across devices. */
  readonly scope: "device" | "account";
  constructor(kind: UsageKind, source: string, reason: string, scope: "device" | "account") {
    super(reason);
    this.name = "BudgetExhaustedError";
    this.kind = kind;
    this.source = source;
    this.scope = scope;
  }
}

export interface Reservation {
  id: string;
  kind: UsageKind;
  source: string;
  /** Signed-in user when the call was reserved (sent); the record belongs to them. */
  userId: string | null;
  tokens: number;
  accountChecked: boolean;
  warnings: string[];
  /** The purpose label; background reservations count against the background cap. */
  operation?: string;
  reservedAt?: number;
  /** WP19: who the call is for, so its usage is attributed and limits apply. */
  conversationId?: string;
  agentId?: string;
}

type Settlement = Omit<UsageEvent, "id" | "userId" | "at" | "kind" | "source" | "inputTokens" | "outputTokens" | "cachedInputTokens" | "reasoningTokens" | "costUsd" | "costKind"> & { usage?: unknown };

function newId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `res-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export default class UsageBudgetGate {
  private static instance: UsageBudgetGate | null = null;
  static getInstance(): UsageBudgetGate {
    UsageBudgetGate.instance ??= new UsageBudgetGate();
    return UsageBudgetGate.instance;
  }

  private readonly inFlight = new Map<string, Reservation>();
  private remoteFactory: () => UsageRemote | null = () => null;
  /** Settlements the account side has not acknowledged (UsageSync retries them by id). */
  private readonly unsettled = new Set<string>();

  constructor(private readonly ledger: UsageLedger = UsageLedger.getInstance()) {
    // After a restart the hourly limits continue from what the ledger recorded this hour.
    ResourcePolicy.getInstance().seedHour = (hour) => {
      const b = this.ledger.rollups("hour").find((r) => r.key === hour)?.bucket;
      return b ? { calls: b.calls, tokens: b.inputTokens + b.outputTokens, byConversation: b.conversations, byAgent: b.agents } : null;
    };
  }

  /** Wire the account side (SupabaseUsageRemote) — or null to stay device-only. */
  setRemote(factory: () => UsageRemote | null): void {
    this.remoteFactory = factory;
  }

  private accountReady: () => Promise<boolean> = async () => true;

  /**
   * Signed in, the account's budgets must be on this device before a call is
   * sent — otherwise a fresh device would check an empty budget list and let
   * a call through that the account forbids (found live: a call went out on a
   * newly signed-in device seconds before its budgets loaded).
   */
  setAccountReadiness(ready: () => Promise<boolean>): void {
    this.accountReady = ready;
  }

  pending(kind: UsageKind, source: string): PendingUsage {
    let requests = 0;
    let tokens = 0;
    for (const r of this.inFlight.values()) {
      if (r.kind !== kind || (source !== ALL_SOURCES && r.source !== source)) continue;
      requests += 1;
      tokens += r.tokens;
    }
    return { requests, tokens };
  }

  inFlightCount(): number {
    return this.inFlight.size;
  }

  private now: () => number = () => Date.now();
  /** When each background purpose last wanted a model call (sent or not). */
  private readonly demand = new Map<string, number>();

  /**
   * Record that a background purpose wanted a model call. Callers that check
   * the allowance and step back on their own call this, so their need still
   * counts when the next call becomes available.
   */
  noteDemand(operation: string): void {
    if (isBackgroundPurpose(operation)) this.demand.set(purposeOf(operation), this.now());
  }

  /** Tests only: a controllable clock for pacing and day boundaries. */
  setClock(now: () => number): void {
    this.now = now;
  }

  /**
   * Background model use: the owner's daily cap, a pause after any provider
   * reports its daily quota spent, and PACING — the remaining calls are spread
   * over what is left of the UTC day, so a small allowance is not spent in the
   * first minutes. Conversation is never subject to any of this.
   */
  backgroundAllowance(): BackgroundAllowance {
    const now = this.now();
    const cap = this.ledger.backgroundDailyCap();
    const usedToday = this.ledger.backgroundCallsToday();
    const background = [...this.inFlight.values()].filter((r) => r.kind === "ai" && isBackgroundPurpose(r.operation));
    const inFlight = background.length;
    const remaining = Math.max(0, cap - usedToday - inFlight);
    const paused = this.ledger.backgroundPaused();
    const midnight = nextUtcMidnight(now);

    if (paused) {
      return { cap, ownerSet: this.ledger.backgroundCapIsOwnerSet(), usedToday, inFlight, remaining, paused, nextAllowedAt: paused.until, blockedBy: "paused", slotOpenedAt: paused.until, rationed: true };
    }
    if (remaining <= 0) {
      return { cap, ownerSet: this.ledger.backgroundCapIsOwnerSet(), usedToday, inFlight, remaining, paused: null, nextAllowedAt: midnight, blockedBy: "cap", slotOpenedAt: midnight, rationed: true };
    }
    // Pace from the last background call made TODAY: the remaining calls,
    // plus the gap after the last of them, share what is left of the day,
    // so every one of them fits before midnight. A new day starts unpaced.
    const dayStart = midnight - 86_400_000;
    const last = Math.max(this.ledger.lastBackgroundCall() ?? 0, ...background.map((r) => r.reservedAt ?? 0));
    const spacing = last >= dayStart ? (midnight - last) / (remaining + 1) : 0;
    const rationed = (midnight - Math.max(last, dayStart)) / (remaining + 1) >= RATION_MIN_SPACING_MS;
    const nextAllowedAt = rationed && last >= dayStart ? last + spacing : now;
    const slotOpenedAt = last >= dayStart ? nextAllowedAt : dayStart;
    return {
      slotOpenedAt,
      rationed,
      cap,
      ownerSet: this.ledger.backgroundCapIsOwnerSet(),
      usedToday,
      inFlight,
      remaining,
      paused: null,
      nextAllowedAt: Math.max(now, nextAllowedAt),
      blockedBy: nextAllowedAt > now ? "pacing" : null,
    };
  }

  private checkBackground(operation: string | undefined, continuation: boolean): void {
    this.noteDemand(operation ?? "");
    const allowance = this.backgroundAllowance();
    const at = new Date(allowance.nextAllowedAt).toISOString();
    if (allowance.blockedBy === "paused") {
      throw new BudgetExhaustedError("ai", BACKGROUND_BUDGET_SOURCE, `Background model use is paused until ${at}: ${allowance.paused?.reason}. Conversation is not affected.`, "device");
    }
    if (allowance.blockedBy === "cap") {
      throw new BudgetExhaustedError(
        "ai",
        BACKGROUND_BUDGET_SOURCE,
        `Background budget used: ${allowance.usedToday + allowance.inFlight}/${allowance.cap} calls today. It resets at ${at}; only the owner can raise it (Settings → Usage & budgets).`,
        "device",
      );
    }
    // A later round of a tool loop that already started is not re-paced:
    // stopping it half-way would discard work its first round did.
    if (allowance.blockedBy === "pacing" && !continuation) {
      throw new BudgetExhaustedError(
        "ai",
        BACKGROUND_BUDGET_SOURCE,
        `Pacing the background budget (${allowance.remaining} of ${allowance.cap} left today): the next background call may go at ${at}.`,
        "device",
      );
    }
    // PRIORITY. An available call goes to the most important work that still
    // wants one (asked within DEMAND_WINDOW_MS). Lower-priority work gets a
    // call only when nothing more important is waiting for it.
    if (!continuation && allowance.rationed) {
      const now = this.now();
      const mine = BACKGROUND_PRIORITY[purposeOf(operation)] ?? 0;
      const waiting = [...this.demand.entries()]
        .filter(([purpose, at]) => (BACKGROUND_PRIORITY[purpose] ?? 0) > mine && now - at <= DEMAND_WINDOW_MS)
        .sort((a, b) => (BACKGROUND_PRIORITY[b[0]] ?? 0) - (BACKGROUND_PRIORITY[a[0]] ?? 0));
      if (waiting.length > 0) {
        const releasedAt = waiting[0][1] + DEMAND_WINDOW_MS;
        throw new BudgetExhaustedError(
          "ai",
          BACKGROUND_BUDGET_SOURCE,
          `This background call is held for ${waiting[0][0]}, which has higher priority and still wants one; ${purposeOf(operation)} may use it if ${waiting[0][0]} has not asked again by ${new Date(releasedAt).toISOString()}.`,
          "device",
        );
      }
    }
  }

  async reserve(kind: UsageKind, source: string, options: { reserveTokens?: number; operation?: string; continuation?: boolean; conversationId?: string; agentId?: string } = {}): Promise<Reservation> {
    const tokens = Math.max(0, Math.floor(options.reserveTokens ?? 0));
    // The owner's resource policy first (WP19.5): emergency stop, paused,
    // terminated or throttled workloads, concurrency and hourly caps.
    if (kind === "ai") {
      try {
        ResourcePolicy.getInstance().checkCall({ conversationId: options.conversationId, agentId: options.agentId, inFlight: [...this.inFlight.values()].filter((r) => r.kind === "ai") });
      } catch (error) {
        // Surfaced like any budget refusal: the call is not sent, the person is told why.
        if (error instanceof ResourceRefusal) throw new BudgetExhaustedError(kind, source, `resource limit (${error.rule}): ${error.message}`, "device");
        throw error;
      }
    }
    // Background work is checked against its own allowance FIRST, before any
    // provider or account budget: it must never take what conversation needs.
    if (kind === "ai" && isBackgroundPurpose(options.operation)) this.checkBackground(options.operation, Boolean(options.continuation));
    if (this.remoteFactory() && !(await this.accountReady())) {
      throw new BudgetExhaustedError(
        kind,
        source,
        "your account's budgets could not be loaded yet, so I could not confirm this call is within them. Try again in a moment.",
        "account",
      );
    }
    // The source's own budget sees its own in-flight calls; the "*" budget
    // sees every in-flight call of the kind. Check both with the right pending.
    const own = this.ledger.check(kind, source, this.pending(kind, source), "source");
    if (!own.allowed) throw new BudgetExhaustedError(kind, source, own.reason ?? "budget reached", "device");
    const all = this.ledger.check(kind, source, this.pending(kind, ALL_SOURCES), "all");
    if (!all.allowed) throw new BudgetExhaustedError(kind, source, all.reason ?? "budget reached", "device");

    // Taken synchronously, before any await, so a concurrent reserve on this
    // device already counts it.
    const reservation: Reservation = {
      id: newId(), kind, source, tokens, accountChecked: false, userId: this.ledger.getUser(),
      ...(options.operation ? { operation: options.operation } : {}), reservedAt: this.now(),
      ...(options.conversationId ? { conversationId: options.conversationId } : {}),
      ...(options.agentId ? { agentId: options.agentId } : {}),
      warnings: [own.warning, all.warning].filter((w): w is string => Boolean(w)),
    };
    this.inFlight.set(reservation.id, reservation);
    if (kind === "ai") ResourcePolicy.getInstance().noteCall({ conversationId: options.conversationId, agentId: options.agentId });

    const remote = this.remoteFactory();
    if (remote) {
      let result: RemoteReserveResult | null = null;
      try {
        result = await remote.reserve({ id: reservation.id, kind, source, reserveTokens: tokens });
      } catch {
        // The account could not be checked. With no budget covering this
        // call there is nothing to enforce: send it, record it, sync later.
        // With one, this device's own count says nothing about the other
        // devices' spend, so sending would be a guess — refuse instead
        // (found live: a new device sent a call past a cap while its account
        // requests were timing out).
        const covered = this.ledger.budgetsSnapshot()[`${kind}:${source}`] || this.ledger.budgetsSnapshot()[`${kind}:${ALL_SOURCES}`];
        if (covered) {
          this.inFlight.delete(reservation.id);
          throw new BudgetExhaustedError(
            kind,
            source,
            "your account could not be reached to confirm this call is within your budget, so it was not sent. Try again when you're back online.",
            "account",
          );
        }
        reservation.warnings.push("Account could not be checked (offline) and no budget covers this call; it was sent and will sync later.");
      }
      if (result) {
        if (!result.allowed) {
          this.inFlight.delete(reservation.id);
          throw new BudgetExhaustedError(kind, source, result.reason ?? "account budget reached", "account");
        }
        reservation.accountChecked = true;
        reservation.warnings.push(...(result.warnings ?? []));
      }
    }
    return reservation;
  }

  /** The call happened: record what the provider reported and free the reservation. */
  async settle(reservation: Reservation, outcome: Settlement): Promise<UsageEvent> {
    const event = this.ledger.record({
      ...outcome,
      id: reservation.id,
      kind: reservation.kind,
      source: reservation.source,
      userId: reservation.userId,
      ...(reservation.conversationId ? { conversationId: reservation.conversationId } : {}),
      ...(reservation.agentId ? { agentId: reservation.agentId } : {}),
    });
    this.inFlight.delete(reservation.id);
    // Every settled call reaches the conversation registry: none is invisible.
    if (event.kind === "ai") {
      ConversationRegistry.getInstance().recordUsage(event);
      ResourcePolicy.getInstance().noteTokens((event.inputTokens ?? 0) + (event.outputTokens ?? 0));
    }
    // A provider saying its quota is spent FOR THE DAY — on any call, chat
    // included — stops background model use until the next UTC day, so what
    // remains on the other providers is kept for conversation.
    if (reservation.kind === "ai" && !event.ok && event.error && isDailyLimitRefusal(event.error)) {
      this.ledger.pauseBackground(nextUtcMidnight(this.now()), `${reservation.source} reported its daily limit`);
    }
    const remote = reservation.accountChecked ? this.remoteFactory() : null;
    if (remote) {
      try {
        await remote.settle(reservation.id, event);
      } catch {
        this.unsettled.add(reservation.id); // UsageSync upserts it later by the same id
      }
    }
    return event;
  }

  /** The call never reached the provider: give the reservation back, record nothing. */
  async release(reservation: Reservation): Promise<void> {
    this.inFlight.delete(reservation.id);
    const remote = reservation.accountChecked ? this.remoteFactory() : null;
    if (remote) await remote.release(reservation.id).catch(() => undefined); // server TTL frees it anyway
  }

  unsettledIds(): string[] {
    return [...this.unsettled];
  }

  markSettled(ids: Iterable<string>): void {
    for (const id of ids) this.unsettled.delete(id);
  }
}

/** The words a chat answer uses when a budget stops a call. */
export function budgetNotice(error: BudgetExhaustedError): string {
  const where = error.scope === "account" ? "your account budget (all devices)" : "this device's budget";
  return (
    `I didn't send this to ${error.source}: ${error.message} ` +
    `This limit comes from ${where}, so I stopped here instead of switching to another provider. ` +
    "You can raise or clear it in Settings → Usage & budgets."
  );
}

/**
 * One model call: reserved, sent, settled. EVERY path that calls a model
 * provider goes through this — chat turns (ProviderResolver), provider health
 * probes (ProviderHealth) and source reading (ingestSource) — so no billed
 * call can skip a budget.
 *
 * Every round of the tool loop is a separate billed request, so each is
 * gated on its own. The reservation is taken BEFORE the request leaves
 * (UsageBudgetGate: this device, then the account across devices), so a
 * spent budget stops the call instead of being discovered afterwards.
 * The settlement records exactly what the provider reported; a failed
 * request is settled as a failure (it was a request), and only a call
 * that never left — stopped before sending — gives its reservation back.
 */
export async function gatedGenerate<R extends { model?: string; metadata?: { usage?: unknown } }>(
  provider: { name: string; generate: (request: any) => Promise<R> },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  request: any,
  operation = "generate",
  options: { continuation?: boolean } = {},
): Promise<R> {
  const gate = UsageBudgetGate.getInstance();
  const declared = Number((request as { maxTokens?: unknown })?.maxTokens);
  // Reserve the output ceiling the request itself declares, when it declares
  // one; otherwise nothing is guessed — the token cap applies to reported use.
  const conversationId =
    typeof request?.usageConversationId === "string" ? (request.usageConversationId as string) : typeof request?.conversationId === "string" ? (request.conversationId as string) : undefined;
  const agentId = typeof request?.agentId === "string" ? (request.agentId as string) : undefined;
  const reservation = await gate.reserve("ai", provider.name, {
    reserveTokens: Number.isFinite(declared) && declared > 0 ? declared : 0,
    operation,
    continuation: options.continuation,
    ...(conversationId ? { conversationId } : {}),
    ...(agentId ? { agentId } : {}),
  });
  // Tool and browser events of this request carry its timestamp as their task
  // id: bind it, so that work is attributed to the same conversation.
  if (conversationId && request?.timestamp !== undefined) ConversationRegistry.getInstance().bindTask(String(request.timestamp), conversationId);
  // Stopped before sending: nothing reaches the provider, so the
  // reservation is given back rather than counted.
  const signal = (request as { signal?: AbortSignal })?.signal;
  if (signal?.aborted) {
    await gate.release(reservation);
    throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error("Stopped before sending."), { name: "AbortError" });
  }
  const started = Date.now();
  let response: R;
  // The owner's longest-call limit (WP19.5): the call is abandoned and settled as failed.
  const maxMs = ResourcePolicy.getInstance().get().maxCallMs;
  try {
    response = maxMs
      ? await Promise.race([
          provider.generate(request),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`exceeded the ${Math.round(maxMs / 1000)} s limit on one model call (resource policy)`)), maxMs)),
        ])
      : await provider.generate(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    {
      // It was sent (or may have been): a request, counted as a failed one.
      await gate.settle(reservation, {
        operation,
        ok: false,
        latencyMs: Date.now() - started,
        rateLimited: /\b429\b|rate.?limit|too many requests|overloaded/i.test(message),
        error: message,
      });
    }
    throw error;
  }
  await gate.settle(reservation, {
    model: response.model,
    operation,
    ok: true,
    latencyMs: Date.now() - started,
    usage: response.metadata?.usage,
  });
  return response;
}
