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
    // The source's own budget sees its own in-flight calls; the "*" budget
    // sees every in-flight call of the kind. Check both with the right pending.
    const own = this.ledger.check(kind, source, this.pending(kind, source), "source");
    if (!own.allowed) throw new BudgetExhaustedError(kind, source, own.reason ?? "budget reached", "device");
    const all = this.ledger.check(kind, source, this.pending(kind, ALL_SOURCES), "all");
    if (!all.allowed) throw new BudgetExhaustedError(kind, source, all.reason ?? "budget reached", "device");

    // Taken synchronously, before any await, so a concurrent reserve on this
    // device already counts it.
    const reservation: Reservation = {
      id: newId(), kind, source, tokens, accountChecked: false,
      warnings: [own.warning, all.warning].filter((w): w is string => Boolean(w)),
    };
    this.inFlight.set(reservation.id, reservation);

    const remote = this.remoteFactory();
    if (remote) {
      let result: RemoteReserveResult | null = null;
      try {
        result = await remote.reserve({ id: reservation.id, kind, source, reserveTokens: tokens });
      } catch {
        // Unreachable account side (offline): the device budget still held.
        reservation.warnings.push("Account budget could not be checked (offline); this device's budget was applied.");
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
    const event = this.ledger.record({ ...outcome, id: reservation.id, kind: reservation.kind, source: reservation.source });
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
