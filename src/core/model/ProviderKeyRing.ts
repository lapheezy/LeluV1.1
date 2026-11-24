/**
 * ==========================================================
 * LÉLU — PROVIDER KEY RING
 *
 * Several credentials for ONE provider, each with its own health.
 *
 * The runtime has always supported one key per provider, so a free tier's
 * per-minute ceiling was the app's ceiling. The capacity is already paid for —
 * it is just configured in more than one place — and the only missing piece is
 * deciding WHICH credential a request spends.
 *
 * What this does NOT do:
 *   • it does not assume the keys have independent quotas. Rotation spreads
 *     requests; it is not a claim that four keys buy four times the limit. A
 *     provider-wide refusal still cools the whole provider, through the
 *     existing AIProviderRegistry.
 *   • it never exposes key material. Health reports slot numbers and labels
 *     (`GROQ_API_KEY_2`), never values.
 *   • it does not replace the broker. A brokered request carries no credential
 *     by design, so the ring is only consulted for a direct send.
 *
 * Order: round-robin, skipping any slot inside its cooldown. Cooldowns match
 * the registry's own reading of the failure — a refused credential and a spent
 * quota both sit out fifteen minutes because neither comes back in thirty
 * seconds; a transient failure sits out thirty.
 * ==========================================================
 */

import { CREDENTIAL_SPECS, resolveProviderCredentials, type CredentialProviderId } from "./ProviderCredentials";
import { resolveFirst } from "../resolveEnv";
import { classifyProviderFailure, retryAfterMsFrom, type ProviderFailureKind } from "../AIProviderRegistry";

/** How long a refused credential or a spent window keeps a key out. */
const AUTH_COOLDOWN_MS = 15 * 60_000;
const QUOTA_COOLDOWN_MS = 15 * 60_000;
/** A network blip or a 500 is worth another try soon, with another key. */
const TRANSIENT_COOLDOWN_MS = 30_000;

/**
 * The environment names a provider's credentials can come from are no longer
 * listed here: they are the canonical contract in ProviderCredentials.ts, which
 * the server broker also reads. Two lists drifted — this ring accepted
 * GROQ_API_KEYS while the broker (the path every browser request takes)
 * ignored it — so there is now one.
 */

export interface RingCredential {
  /** The position the operator configured, for reporting. Never a secret. */
  label: string;
  key: string;
}

export type KeyState = "ready" | "cooling" | "retired";

export interface KeyHealth {
  slot: number;
  label: string;
  state: KeyState;
  cooldownMsRemaining: number;
  failures: number;
  successes: number;
  lastFailureKind?: ProviderFailureKind;
  lastUsedAt?: number;
}

interface KeyRecord extends RingCredential {
  slot: number;
  failures: number;
  successes: number;
  cooldownUntil: number;
  lastFailureKind?: ProviderFailureKind;
  lastUsedAt?: number;
}

/** After this many refused credentials in a row, stop handing the slot out. */
const MAX_CONSECUTIVE_AUTH_FAILURES = 3;

function cooldownFor(kind: ProviderFailureKind): number {
  if (kind === "credential-refused" || kind === "billing") return AUTH_COOLDOWN_MS;
  if (kind === "quota-exhausted") return QUOTA_COOLDOWN_MS;
  return TRANSIENT_COOLDOWN_MS;
}

/**
 * The ONE rule shared by selection and health, so a key reported ready is
 * exactly a key that will be handed out.
 */
function stateOf(record: KeyRecord, at: number): KeyState {
  if (
    record.lastFailureKind === "credential-refused" &&
    record.failures >= MAX_CONSECUTIVE_AUTH_FAILURES
  ) {
    return "retired";
  }
  if (record.cooldownUntil > at) return "cooling";
  return "ready";
}

export default class ProviderKeyRing {
  private static rings = new Map<string, ProviderKeyRing>();

  private readonly provider: string;
  private readonly records: KeyRecord[];
  private cursor = 0;
  private readonly now: () => number;

  constructor(provider: string, credentials: RingCredential[], now: () => number = Date.now) {
    this.provider = provider.toLowerCase();
    this.now = now;
    this.records = credentials.map((credential, index) => ({
      ...credential,
      slot: index + 1,
      failures: 0,
      successes: 0,
      cooldownUntil: 0,
    }));
  }

  /** The process-wide ring for a provider, built from the environment once. */
  static for(provider: string): ProviderKeyRing {
    const name = provider.toLowerCase();
    const existing = ProviderKeyRing.rings.get(name);
    if (existing) return existing;
    const ring = new ProviderKeyRing(name, ProviderKeyRing.readEnvironment(name));
    ProviderKeyRing.rings.set(name, ring);
    return ring;
  }

  /** Forget the cached rings — for tests, and for a reload with a changed env. */
  static reset(): void {
    ProviderKeyRing.rings.clear();
  }

  static readEnvironment(provider: string): RingCredential[] {
    if (provider in CREDENTIAL_SPECS) {
      return resolveProviderCredentials(provider as CredentialProviderId).credentials.map(({ label, key }) => ({ label, key }));
    }
    // A provider outside the contract keeps the old single-name lookup.
    const key = (resolveFirst(`${provider.toUpperCase()}_API_KEY`) ?? "").trim();
    return key.length >= 8 && !/\s/.test(key) ? [{ label: `${provider.toUpperCase()}_API_KEY`, key }] : [];
  }

  /** How many credentials are configured, cooling or not. */
  size(): number {
    return this.records.length;
  }

  /** How many could be used right now. */
  readyCount(): number {
    const at = this.now();
    return this.records.filter((record) => stateOf(record, at) === "ready").length;
  }

  /**
   * The next usable credential, round-robin.
   *
   * Null means every slot is cooling: the caller then keeps its existing
   * single-key behaviour and the provider registry's own cooldown applies, so a
   * spent account is reported honestly instead of being hammered.
   */
  next(): RingCredential | null {
    if (this.records.length === 0) return null;
    const at = this.now();
    for (let step = 0; step < this.records.length; step += 1) {
      const index = (this.cursor + step) % this.records.length;
      const record = this.records[index];
      if (stateOf(record, at) !== "ready") continue;
      this.cursor = (index + 1) % this.records.length;
      record.lastUsedAt = at;
      return { label: record.label, key: record.key };
    }
    return null;
  }

  /** Record a refusal against the credential that received it. */
  markFailure(label: string, reason: string): void {
    const record = this.records.find((entry) => entry.label === label);
    if (!record) return;
    const kind = classifyProviderFailure(reason);
    record.failures += 1;
    record.lastFailureKind = kind;
    // A key told to wait 35 minutes must not be handed out again after the
    // generic transient window. Keep the longer of the policy cooldown and
    // the provider's own reset.
    record.cooldownUntil =
      this.now() + Math.max(cooldownFor(kind), retryAfterMsFrom(reason) ?? 0);
  }

  markSuccess(label: string): void {
    const record = this.records.find((entry) => entry.label === label);
    if (!record) return;
    record.successes += 1;
    record.failures = 0;
    record.cooldownUntil = 0;
  }

  /** Health, by slot — labels, states and counts. Never a key. */
  health(): KeyHealth[] {
    const at = this.now();
    return this.records.map((record) => ({
      slot: record.slot,
      label: record.label,
      state: stateOf(record, at),
      cooldownMsRemaining: Math.max(0, record.cooldownUntil - at),
      failures: record.failures,
      successes: record.successes,
      ...(record.lastFailureKind ? { lastFailureKind: record.lastFailureKind } : {}),
      ...(record.lastUsedAt ? { lastUsedAt: record.lastUsedAt } : {}),
    }));
  }

  get name(): string {
    return this.provider;
  }
}
