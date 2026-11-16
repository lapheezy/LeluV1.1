/**
 * ==========================================================
 * LÉLU — VOICE RESOURCE MANAGER
 *
 * What this is: the one place that knows what her voice has COST,
 * what it has LEFT, which account is cooling, and why the last
 * attempt failed. plugins/voiceApi.ts asks; this answers.
 *
 * What this is NOT:
 *   · not a credential store — it never receives, holds or returns a
 *     key. Callers ask for an ORDERED LIST OF OPAQUE IDS and resolve
 *     the key themselves, so a snapshot can be rendered, logged or
 *     served without any risk of leaking a secret;
 *   · not a second voice engine — nothing here synthesises, plays or
 *     chooses a voice;
 *   · not a way around a provider's limits. A spent account is
 *     treated as spent: it is skipped, and it is re-probed at most
 *     once per `exhaustedProbeMs` so recovery is noticed without
 *     hammering a provider that has already said no.
 *
 * THE HONESTY RULES THIS TYPE ENFORCES
 *
 *   1. An estimate is never presented as a measurement. Local
 *      accounting is labelled internal; provider-reported
 *      `character-cost` is authoritative and reconciled separately.
 *   2. A provider's own counter may LAG. A reconciliation never
 *      lowers the internal lower bound on what was spent — it can
 *      only raise it. Lagging is reported as lagging.
 *   3. "Unknown" is a value, not zero. A call whose provider
 *      reported nothing stays counted as a call with no report.
 *   4. TTS and STT are tracked apart: a TTS quota refusal must not
 *      silence her ears, and a transcription rate limit must not
 *      silence her mouth.
 *
 * Quota semantics: ElevenLabs bills synthesis per character against
 * a monthly per-account allowance. That is the only allowance this
 * module exhausts. Transcription is billed by the provider in its own
 * units, so no character estimate is invented for STT; its calls and
 * reported costs are counted, and a refusal still cools the account.
 *
 * This module imports nothing: it is read from the browser bundle and
 * from the server plugin project (tsconfig.node.json, `nodenext`).
 * ==========================================================
 */

export type VoiceKind = "tts" | "stt";

/** Why a credential may not be spent right now. */
export type CredentialHealth = "ready" | "cooling" | "exhausted";

/** Why a credential was left out of a plan. */
export type VoiceSkipReason = "cooling" | "exhausted" | "insufficient_allowance";

export interface VoiceResourceOptions {
  /** Characters one credential may spend per billing month. */
  monthlyCharacterLimit?: number;
  /** How long a credential sits out after a refusal, per kind. */
  cooldownMs?: number;
  /** How often a spend-out credential may be re-probed. */
  exhaustedProbeMs?: number;
  /** Flag a credential once it has less than this fraction left. */
  lowQuotaFraction?: number;
  /** How many usage entries are kept. */
  historyLimit?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

export interface VoiceEstimate {
  /** Estimated characters, or null when no honest estimate exists. */
  characters: number | null;
  /** What the number is based on — never a number without a basis. */
  basis: string;
}

export interface VoicePlanRequest {
  text?: string;
  audioBytes?: number;
}

export interface VoicePlanSkipped {
  label: string;
  reason: VoiceSkipReason;
  retryAfterMs: number | null;
}

export interface VoicePlan {
  kind: VoiceKind;
  estimate: number | null;
  estimateBasis: string;
  /** Credential ids to try, in order. Never keys. */
  candidates: string[];
  skipped: VoicePlanSkipped[];
  available: boolean;
  unavailableReason:
    | "all_credentials_exhausted"
    | "all_credentials_cooling"
    | "insufficient_allowance"
    | "no_credentials"
    | null;
  /** Shortest wait that could make a credential usable again. */
  retryAfterMs: number | null;
  /** Sum of the remaining estimated allowance across credentials. */
  remainingCharacters: number | null;
}

export interface VoiceUsageEntry {
  at: number;
  kind: VoiceKind;
  label: string;
  ok: boolean;
  estimatedCharacters: number | null;
  reportedCharacters: number | null;
  fiatCostUsd: number | null;
  status: number | null;
  reason: string | null;
  latencyMs: number;
}

export interface VoiceKindSnapshot {
  calls: number;
  ok: number;
  failed: number;
  cooldownRemainingMs: number;
  lastSuccessAt: number | null;
  lastFailure: { at: number; status: number; reason: string } | null;
  /** Every call's estimate. */
  estimatedCharacters: number;
  /** What the provider reported charging. */
  reportedCharacters: number;
  /** Estimates of the calls that also reported — the comparable pairs. */
  estimatedForReported: number;
  /** Estimates charged because the provider reported nothing. */
  unreportedEstimates: number;
}

export interface VoiceCredentialSnapshot {
  /** Opaque positional id (`account-1`). Never an env name or a key. */
  label: string;
  index: number;
  health: CredentialHealth;
  usedCharacters: number;
  characterLimit: number;
  remainingCharacters: number;
  /** 0..1 — internal estimate, reconciled where upstream reported. */
  utilization: number;
  exhausted: { since: number; reason: string } | null;
  upstream: { used: number; limit: number; observedAt: number; lagging: boolean } | null;
  tts: VoiceKindSnapshot;
  stt: VoiceKindSnapshot;
}

export interface VoiceResourceSnapshot {
  at: number;
  availability: { tts: boolean; stt: boolean };
  credentials: VoiceCredentialSnapshot[];
  activeCredential: { tts: string | null; stt: string | null };
  lastSuccess: VoiceUsageEntry | null;
  lastFailure: VoiceUsageEntry | null;
  totals: {
    credentials: number;
    ready: number;
    cooling: number;
    exhausted: number;
    usedCharacters: number;
    remainingCharacters: number;
    calls: number;
    ok: number;
    failed: number;
    reportedCharacters: number;
    estimatedCharacters: number;
    /** reported − estimated. Positive means the estimate was low. */
    estimateDriftCharacters: number;
  };
  lowQuota: Array<{ label: string; remainingCharacters: number; utilization: number }>;
  /** Most recent first. */
  history: VoiceUsageEntry[];
  limits: {
    monthlyCharacterLimit: number;
    cooldownMs: number;
    exhaustedProbeMs: number;
    lowQuotaFraction: number;
  };
}

export interface UpstreamReconciliation {
  internalUsed: number;
  upstreamUsed: number;
  limit: number;
  /** True when the provider's own counter is behind what we know we spent. */
  lagging: boolean;
}

export interface VoiceUsageReport {
  estimatedCharacters: number | null;
  reportedCharacters: number | null;
  fiatCostUsd?: number | null;
  latencyMs: number;
}

export interface VoiceFailureReport {
  status: number;
  reason: string;
  estimatedCharacters?: number | null;
  latencyMs: number;
}

interface KindState {
  calls: number;
  ok: number;
  failed: number;
  /** Every call's estimate, reported or not. */
  estimatedCharacters: number;
  /** What the provider said it charged. */
  reportedCharacters: number;
  /** Estimates charged because the provider reported nothing. */
  unreportedEstimates: number;
  /** Estimates of the calls that DID report — the only comparable pairs. */
  estimatedForReported: number;
  cooldownUntil: number;
  lastSuccessAt: number | null;
  lastFailure: { at: number; status: number; reason: string } | null;
}

interface CredentialState {
  label: string;
  index: number;
  seenAt: number;
  tts: KindState;
  stt: KindState;
  upstream: { used: number; limit: number; at: number } | null;
  exhaustedAt: number | null;
  exhaustedReason: string | null;
}

const DEFAULT_LIMIT = 10_000;
const DEFAULT_COOLDOWN_MS = 15 * 60_000;
const DEFAULT_EXHAUSTED_PROBE_MS = 30 * 60_000;
const DEFAULT_LOW_QUOTA_FRACTION = 0.15;
const DEFAULT_HISTORY_LIMIT = 200;

function emptyKind(): KindState {
  return {
    calls: 0,
    ok: 0,
    failed: 0,
    estimatedCharacters: 0,
    reportedCharacters: 0,
    unreportedEstimates: 0,
    estimatedForReported: 0,
    cooldownUntil: 0,
    lastSuccessAt: null,
    lastFailure: null,
  };
}

function emptyState(label: string, index: number, now: number): CredentialState {
  return {
    label,
    index,
    seenAt: now,
    tts: emptyKind(),
    stt: emptyKind(),
    upstream: null,
    exhaustedAt: null,
    exhaustedReason: null,
  };
}

/**
 * A refusal another ACCOUNT could fix. 400/413/422 are about the text or
 * the audio and will fail identically everywhere, so they never burn a
 * second credential; 5xx and transport errors are the provider being
 * unwell, which is also not the next account's fault.
 */
export function isAnotherAccountWorthTrying(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

/** A number that is genuinely a number, or null — never a coerced 0. */
function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

export default class VoiceResourceManager {
  private readonly states = new Map<string, CredentialState>();
  private readonly order: string[] = [];
  private readonly entries: VoiceUsageEntry[] = [];
  private readonly active: Record<VoiceKind, string | null> = { tts: null, stt: null };
  private readonly limitOverride: number;
  private readonly cooldownMs: number;
  private readonly exhaustedProbeMs: number;
  private readonly lowQuotaFraction: number;
  private readonly historyLimit: number;
  private readonly clock: () => number;

  constructor(options: VoiceResourceOptions = {}) {
    this.limitOverride = options.monthlyCharacterLimit ?? DEFAULT_LIMIT;
    this.cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
    this.exhaustedProbeMs = options.exhaustedProbeMs ?? DEFAULT_EXHAUSTED_PROBE_MS;
    this.lowQuotaFraction = options.lowQuotaFraction ?? DEFAULT_LOW_QUOTA_FRACTION;
    this.historyLimit = options.historyLimit ?? DEFAULT_HISTORY_LIMIT;
    this.clock = options.now ?? (() => Date.now());
  }

  /**
   * Register the credentials that exist RIGHT NOW.
   *
   * Ids are opaque and positional (`account-1`, `account-2`), so a change
   * to the configured set re-indexes the accounting: that is deliberate —
   * a different set is a different arrangement of accounts, and inheriting
   * another account's cooldown would be worse than starting clean.
   */
  public sync(labels: readonly string[]): void {
    const now = this.clock();
    const present = new Set(labels);
    for (let i = this.order.length - 1; i >= 0; i -= 1) {
      if (!present.has(this.order[i])) this.order.splice(i, 1);
    }
    labels.forEach((label, index) => {
      const existing = this.states.get(label);
      if (existing) {
        existing.index = index;
        return;
      }
      this.states.set(label, emptyState(label, index, now));
      if (!this.order.includes(label)) this.order.push(label);
    });
    // Keep `order` identical to the caller's spend order.
    this.order.sort((a, b) => (this.states.get(a)?.index ?? 0) - (this.states.get(b)?.index ?? 0));
    for (const kind of ["tts", "stt"] as const) {
      if (this.active[kind] && !present.has(this.active[kind] as string)) this.active[kind] = null;
    }
  }

  /** Every credential the manager knows about, in spend order. */
  public labels(): string[] {
    return [...this.order];
  }

  /**
   * What this request is expected to cost, and on what basis.
   * TTS: characters in the text (code points). STT: no honest character
   * estimate exists — transcription is billed in the provider's own units.
   */
  public estimate(kind: VoiceKind, request: VoicePlanRequest = {}): VoiceEstimate {
    if (kind === "stt") {
      return {
        characters: null,
        basis: "transcription is billed in the provider's own units; no character estimate is invented",
      };
    }
    const characters = [...(request.text ?? "")].length;
    return {
      characters,
      basis: "code points in the text (ElevenLabs bills synthesis per character; drift is reconciled from character-cost)",
    };
  }

  private limitFor(state: CredentialState): number {
    return state.upstream?.limit ?? this.limitOverride;
  }

  /**
   * Characters spent on SYNTHESIS. Transcription is billed by the provider in
   * its own units, so its counters are kept for display but never consume the
   * character allowance — a spent quota must not close her ears.
   */
  private internalUsed(state: CredentialState): number {
    // What was reported, plus the estimates charged for calls that reported nothing.
    return state.tts.reportedCharacters + state.tts.unreportedEstimates;
  }

  /** The larger of what we know we spent and what the provider last said. */
  private usedCharacters(state: CredentialState): number {
    return Math.max(this.internalUsed(state), state.upstream?.used ?? 0);
  }

  public remainingCharacters(label: string): number | null {
    const state = this.states.get(label);
    if (!state) return null;
    return Math.max(0, this.limitFor(state) - this.usedCharacters(state));
  }

  private exhaustedNow(state: CredentialState, now: number, kind: VoiceKind): { since: number; reason: string } | null {
    // A provider that refused outranks our arithmetic: the ledger is an
    // estimate, a 401 is not. A refusal is account-wide.
    if (state.exhaustedAt !== null) {
      if (now - state.exhaustedAt < this.exhaustedProbeMs) {
        return { since: state.exhaustedAt, reason: state.exhaustedReason ?? "character allowance spent" };
      }
      return null;
    }
    // The character allowance is a synthesis quantity; transcription has its
    // own billing, so an exhausted mouth does not close her ears.
    if (kind === "stt") return null;
    if (this.usedCharacters(state) < this.limitFor(state)) return null;
    const since = state.tts.lastSuccessAt ?? state.stt.lastSuccessAt ?? state.seenAt;
    // One probe per window: recovery is noticed without hammering a provider
    // that has already said the allowance is gone.
    if (now - since >= this.exhaustedProbeMs) return null;
    return { since, reason: state.exhaustedReason ?? "character allowance spent" };
  }

  private healthOf(state: CredentialState, now: number): CredentialHealth {
    if (this.exhaustedNow(state, now, "tts")) return "exhausted";
    if (state.tts.cooldownUntil > now || state.stt.cooldownUntil > now) return "cooling";
    return "ready";
  }

  /**
   * Which credentials this request may spend, in order, and exactly why the
   * others were left out. Nothing is sent upstream to answer this.
   */
  public plan(kind: VoiceKind, request: VoicePlanRequest = {}): VoicePlan {
    const now = this.clock();
    const { characters, basis } = this.estimate(kind, request);
    const candidates: string[] = [];
    const skipped: VoicePlanSkipped[] = [];

    for (const label of this.order) {
      const state = this.states.get(label);
      if (!state) continue;
      const spent = this.exhaustedNow(state, now, kind);
      if (spent) {
        skipped.push({
          label,
          reason: "exhausted",
          retryAfterMs: Math.max(0, spent.since + this.exhaustedProbeMs - now),
        });
        continue;
      }
      const cooldownUntil = state[kind].cooldownUntil;
      if (cooldownUntil > now) {
        skipped.push({ label, reason: "cooling", retryAfterMs: cooldownUntil - now });
        continue;
      }
      // Past the probe window an over-limit account is offered once: the
      // allowance is an ESTIMATE, and an estimate must not silence her for
      // good. If it really is spent, the provider refuses and cools it again.
      const overLimit = this.usedCharacters(state) >= this.limitFor(state);
      if (kind === "tts" && characters !== null && !overLimit) {
        const remaining = Math.max(0, this.limitFor(state) - this.usedCharacters(state));
        if (remaining < characters) {
          // Sending this would spend a partial allowance and come back refused.
          skipped.push({ label, reason: "insufficient_allowance", retryAfterMs: null });
          continue;
        }
      }
      candidates.push(label);
    }

    let unavailableReason: VoicePlan["unavailableReason"] = null;
    if (this.order.length === 0) unavailableReason = "no_credentials";
    else if (candidates.length === 0) {
      if (skipped.some((s) => s.reason === "exhausted")) unavailableReason = "all_credentials_exhausted";
      else if (skipped.some((s) => s.reason === "cooling")) unavailableReason = "all_credentials_cooling";
      else unavailableReason = "insufficient_allowance";
    }

    const waits = skipped
      .map((s) => s.retryAfterMs)
      .filter((ms): ms is number => typeof ms === "number" && Number.isFinite(ms));

    const remaining = this.order.length
      ? this.order.reduce((sum, label) => sum + (this.remainingCharacters(label) ?? 0), 0)
      : null;

    return {
      kind,
      estimate: characters,
      estimateBasis: basis,
      candidates,
      skipped,
      available: candidates.length > 0,
      unavailableReason,
      retryAfterMs: waits.length > 0 ? Math.min(...waits) : null,
      remainingCharacters: remaining,
    };
  }

  private pushEntry(entry: VoiceUsageEntry): void {
    this.entries.push(entry);
    if (this.entries.length > this.historyLimit) this.entries.splice(0, this.entries.length - this.historyLimit);
  }

  /**
   * A call the provider accepted. Reported characters are authoritative;
   * an absent report is recorded as an unreported cost (an estimate), never
   * quietly as zero.
   */
  public recordSuccess(kind: VoiceKind, label: string, report: VoiceUsageReport): void {
    const state = this.states.get(label);
    if (!state) return;
    const now = this.clock();
    const kindState = state[kind];
    kindState.calls += 1;
    kindState.ok += 1;
    kindState.cooldownUntil = 0;
    kindState.lastSuccessAt = now;
    const reported = finiteOrNull(report.reportedCharacters);
    const estimated = finiteOrNull(report.estimatedCharacters);
    kindState.estimatedCharacters += estimated ?? 0;
    if (reported === null) {
      // No report is not a free call: the estimate is what gets charged.
      kindState.unreportedEstimates += estimated ?? 0;
    } else {
      kindState.reportedCharacters += reported;
      kindState.estimatedForReported += estimated ?? 0;
    }

    // A credential that just spoke is not exhausted, whatever the estimate said.
    state.exhaustedAt = null;
    state.exhaustedReason = null;
    this.active[kind] = label;

    this.pushEntry({
      at: now,
      kind,
      label,
      ok: true,
      estimatedCharacters: estimated,
      reportedCharacters: reported,
      fiatCostUsd: finiteOrNull(report.fiatCostUsd ?? null),
      status: null,
      reason: null,
      latencyMs: Math.max(0, report.latencyMs),
    });
  }

  /**
   * A call the provider refused. A quota, refusal or rate limit cools THIS
   * kind on THIS credential — the next account, or the other modality, is
   * unaffected. A transport error (status 0) records the failure without
   * blaming the account.
   */
  public recordFailure(kind: VoiceKind, label: string, report: VoiceFailureReport): void {
    const state = this.states.get(label);
    if (!state) return;
    const now = this.clock();
    const kindState = state[kind];
    kindState.calls += 1;
    kindState.failed += 1;
    const failure = { at: now, status: report.status, reason: report.reason };
    kindState.lastFailure = failure;
    if (isAnotherAccountWorthTrying(report.status)) {
      kindState.cooldownUntil = now + this.cooldownMs;
      if (report.status === 401 || report.status === 403) {
        // ElevenLabs answers a spent month with 401/403, exactly like a
        // revoked key; both mean "do not keep asking this account".
        state.exhaustedAt = now;
        state.exhaustedReason = `upstream refused the credential (HTTP ${report.status})`;
      }
    }

    this.pushEntry({
      at: now,
      kind,
      label,
      ok: false,
      estimatedCharacters: finiteOrNull(report.estimatedCharacters ?? null),
      reportedCharacters: null,
      fiatCostUsd: null,
      status: report.status,
      reason: report.reason,
      latencyMs: Math.max(0, report.latencyMs),
    });
  }

  /**
   * Fold the provider's own counter in.
   *
   * Never lowers the internal lower bound: a lagging upstream number is
   * reported as lagging, not trusted down. A credential with allowance left
   * upstream stops being treated as exhausted.
   */
  public applyUpstreamUsage(
    label: string,
    upstream: { characterCount: number; characterLimit: number },
  ): UpstreamReconciliation | null {
    const state = this.states.get(label);
    if (!state) return null;
    const now = this.clock();
    const used = finiteOrNull(upstream.characterCount);
    const limit = finiteOrNull(upstream.characterLimit);
    if (used === null || limit === null || limit <= 0) return null;

    const internalUsed = this.internalUsed(state);
    state.upstream = { used, limit, at: now };
    if (this.usedCharacters(state) < limit) {
      // An authoritative "allowance left" contradicts a quota refusal, so the
      // account is usable again — a stale cooldown would keep her silent.
      state.exhaustedAt = null;
      state.exhaustedReason = null;
      state.tts.cooldownUntil = 0;
      state.stt.cooldownUntil = 0;
    }
    return {
      internalUsed,
      upstreamUsed: used,
      limit,
      lagging: used < internalUsed,
    };
  }

  /**
   * The operator states an account has allowance again (topped up, or a new
   * billing month). The counters restart, because keeping them at the limit
   * would keep the account exhausted forever. History keeps what was really
   * spent, so the reset is auditable.
   */
  public replenish(labels?: readonly string[]): string[] {
    const targets = labels && labels.length > 0 ? labels : this.order;
    const reset: string[] = [];
    for (const label of targets) {
      const state = this.states.get(label);
      if (!state) continue;
      const now = this.clock();
      state.tts = emptyKind();
      state.stt = emptyKind();
      state.upstream = null;
      state.exhaustedAt = null;
      state.exhaustedReason = null;
      state.seenAt = now;
      reset.push(label);
    }
    return reset;
  }

  /** Recent usage, most recent first. */
  public history(limit = 40): VoiceUsageEntry[] {
    return this.entries.slice(-Math.max(1, limit)).reverse();
  }

  /** Sanitized operational status. Contains ids and numbers — never a key. */
  public snapshot(): VoiceResourceSnapshot {
    const now = this.clock();
    const credentials: VoiceCredentialSnapshot[] = this.order.map((label) => {
      const state = this.states.get(label) as CredentialState;
      const limit = this.limitFor(state);
      const used = this.usedCharacters(state);
      const remaining = Math.max(0, limit - used);
      const exhausted = this.exhaustedNow(state, now, "tts");
      const kindSnapshot = (kind: VoiceKind): VoiceKindSnapshot => {
        const k = state[kind];
        return {
          calls: k.calls,
          ok: k.ok,
          failed: k.failed,
          cooldownRemainingMs: Math.max(0, k.cooldownUntil - now),
          lastSuccessAt: k.lastSuccessAt,
          lastFailure: k.lastFailure ? { ...k.lastFailure } : null,
          estimatedCharacters: k.estimatedCharacters,
          reportedCharacters: k.reportedCharacters,
          estimatedForReported: k.estimatedForReported,
          unreportedEstimates: k.unreportedEstimates,
        };
      };
      return {
        label,
        index: state.index,
        health: this.healthOf(state, now),
        usedCharacters: used,
        characterLimit: limit,
        remainingCharacters: remaining,
        utilization: limit > 0 ? Math.min(1, Math.round((used / limit) * 1000) / 1000) : 1,
        exhausted: exhausted ? { since: exhausted.since, reason: exhausted.reason } : null,
        upstream: state.upstream
          ? {
              used: state.upstream.used,
              limit: state.upstream.limit,
              observedAt: state.upstream.at,
              lagging: state.upstream.used < this.internalUsed(state),
            }
          : null,
        tts: kindSnapshot("tts"),
        stt: kindSnapshot("stt"),
      };
    });

    const usable = (kind: VoiceKind) =>
      this.order.some((label) => {
        const state = this.states.get(label) as CredentialState;
        if (kind === "tts") {
          return !this.exhaustedNow(state, now, "tts") && state.tts.cooldownUntil <= now;
        }
        // Transcription is blocked only by an explicit refusal or its own cooldown.
        const refused = state.exhaustedAt !== null && now - state.exhaustedAt < this.exhaustedProbeMs;
        return !refused && state.stt.cooldownUntil <= now;
      });

    const allEntries = [...this.entries].reverse();
    const history = this.history(20);
    const totals = credentials.reduce(
      (acc, c) => {
        acc.usedCharacters += c.usedCharacters;
        acc.remainingCharacters += c.remainingCharacters;
        acc.calls += c.tts.calls + c.stt.calls;
        acc.ok += c.tts.ok + c.stt.ok;
        acc.failed += c.tts.failed + c.stt.failed;
        // Character accounting is synthesis accounting; STT numbers stay per credential.
        acc.reportedCharacters += c.tts.reportedCharacters;
        acc.estimatedCharacters += c.tts.estimatedCharacters;
        acc.estimatedForReported += c.tts.estimatedForReported;
        return acc;
      },
      {
        credentials: credentials.length,
        ready: 0,
        cooling: 0,
        exhausted: 0,
        usedCharacters: 0,
        remainingCharacters: 0,
        calls: 0,
        ok: 0,
        failed: 0,
        reportedCharacters: 0,
        estimatedCharacters: 0,
        estimatedForReported: 0,
      },
    );
    for (const c of credentials) {
      if (c.health === "ready") totals.ready += 1;
      else if (c.health === "cooling") totals.cooling += 1;
      else totals.exhausted += 1;
    }

    const lowQuota = credentials
      .filter((c) => c.health === "exhausted" || c.utilization >= 1 - this.lowQuotaFraction)
      .map((c) => ({
        label: c.label,
        remainingCharacters: c.remainingCharacters,
        utilization: c.utilization,
      }));

    return {
      at: now,
      availability: { tts: usable("tts"), stt: usable("stt") },
      credentials,
      activeCredential: { tts: this.active.tts, stt: this.active.stt },
      lastSuccess: allEntries.find((e) => e.ok) ?? null,
      lastFailure: allEntries.find((e) => !e.ok) ?? null,
      totals: {
        credentials: totals.credentials,
        ready: totals.ready,
        cooling: totals.cooling,
        exhausted: totals.exhausted,
        usedCharacters: totals.usedCharacters,
        remainingCharacters: totals.remainingCharacters,
        calls: totals.calls,
        ok: totals.ok,
        failed: totals.failed,
        reportedCharacters: totals.reportedCharacters,
        estimatedCharacters: totals.estimatedCharacters,
        // Only comparable pairs: a call that reported nothing has no drift,
        // it has an estimate that was charged.
        estimateDriftCharacters: totals.reportedCharacters - totals.estimatedForReported,
      },
      lowQuota,
      history,
      limits: {
        monthlyCharacterLimit: this.limitOverride,
        cooldownMs: this.cooldownMs,
        exhaustedProbeMs: this.exhaustedProbeMs,
        lowQuotaFraction: this.lowQuotaFraction,
      },
    };
  }
}
