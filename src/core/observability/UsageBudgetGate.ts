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

import UsageLedger, { ALL_SOURCES, type PendingUsage, type UsageEvent, type UsageKind } from "./UsageLedger";

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

  constructor(private readonly ledger: UsageLedger = UsageLedger.getInstance()) {}

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

  async reserve(kind: UsageKind, source: string, options: { reserveTokens?: number } = {}): Promise<Reservation> {
    const tokens = Math.max(0, Math.floor(options.reserveTokens ?? 0));
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
      warnings: [own.warning, all.warning].filter((w): w is string => Boolean(w)),
    };
    this.inFlight.set(reservation.id, reservation);

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
    const event = this.ledger.record({ ...outcome, id: reservation.id, kind: reservation.kind, source: reservation.source, userId: reservation.userId });
    this.inFlight.delete(reservation.id);
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
): Promise<R> {
  const gate = UsageBudgetGate.getInstance();
  const declared = Number((request as { maxTokens?: unknown })?.maxTokens);
  // Reserve the output ceiling the request itself declares, when it declares
  // one; otherwise nothing is guessed — the token cap applies to reported use.
  const reservation = await gate.reserve("ai", provider.name, { reserveTokens: Number.isFinite(declared) && declared > 0 ? declared : 0 });
  // Stopped before sending: nothing reaches the provider, so the
  // reservation is given back rather than counted.
  const signal = (request as { signal?: AbortSignal })?.signal;
  if (signal?.aborted) {
    await gate.release(reservation);
    throw signal.reason instanceof Error ? signal.reason : Object.assign(new Error("Stopped before sending."), { name: "AbortError" });
  }
  const started = Date.now();
  let response: R;
  try {
    response = await provider.generate(request);
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
