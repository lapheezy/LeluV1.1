/**
 * ==========================================================
 * LÉLU — PROVIDER HEALTH
 *
 * A deterministic, honest view of the AI provider fallback
 * chain, and the one place production can perform a REAL
 * live verification when credentials and network exist.
 *
 * This is NOT a second provider registry. It owns no
 * providers and holds no chain of its own — it reads the ONE
 * `AIProviderRegistry` that AIRuntime already constructs, and
 * reports what is actually true about it.
 *
 * It also does not duplicate StartupDiagnostic, which asks a
 * coarse boot-time question ("are the 15 subsystems
 * constructible?") and covers providers with two of its
 * fifteen checks. This answers the narrower, per-provider
 * question the fallback chain actually depends on: for EACH
 * provider, in priority order — is it configured, does it
 * have credentials, is it in cooldown, and (only if asked,
 * and only if it can be) does a real request to it succeed?
 *
 * THE HONESTY RULE THIS TYPE EXISTS TO ENFORCE:
 *
 *   A missing API key must never look like a healthy provider,
 *   and a provider that was never contacted must never be
 *   reported as verified.
 *
 * Hence `verification` is an explicit four-state value rather
 * than a boolean. `"not_attempted"` and `"skipped_no_credentials"`
 * are first-class outcomes — the sandbox this was developed in
 * has no API keys, so `verifyLive()` there correctly reports
 * "skipped", never "healthy". Nothing here fabricates a
 * response, and there is no stubbed transport: `verifyLive()`
 * calls the provider's own real `generate()`.
 * ==========================================================
 */

import type AIProviderRegistry from "../AIProviderRegistry";
import { BudgetExhaustedError, gatedGenerate } from "../observability/UsageBudgetGate";
import KvStore from "../storage/KvStore.ts";

/** Why a provider is or is not usable right now. */
export type ProviderAvailability =
  /** Registered, credentialed, not in cooldown — usable. */
  | "ready"
  /** Registered but has no API key: cannot be used, never an error. */
  | "no_credentials"
  /** Quarantined by the registry after a recent real failure. */
  | "cooldown"
  /** Registered but disabled by configuration. */
  | "disabled"
  /** Its own isAvailable()/health() threw. */
  | "error";

/** What we actually know about whether this provider WORKS. */
export type ProviderVerification =
  /** No live request was made (the default — claims nothing). */
  | "not_attempted"
  /** A real request was made and succeeded. */
  | "verified_live"
  /** A real request was made and failed (reason recorded). */
  | "failed_live"
  /** Deliberately not attempted: no credentials to attempt with. */
  | "skipped_no_credentials"
  /** Deliberately not sent: a usage budget for this provider is spent. */
  | "skipped_budget";

export interface ProviderHealthEntry {
  name: string;
  /** Lower number = tried earlier in the fallback chain. */
  priority: number;
  /** Position in the real ordered chain (1 = primary). */
  position: number;
  requiresApiKey: boolean;
  availability: ProviderAvailability;
  verification: ProviderVerification;
  /** Explicit, surfaced reason — never swallowed. */
  detail: string;
  /** Real timestamp of the last successful generation, if any. */
  lastSuccess: number | null;
  inCooldown: boolean;
}

export interface ProviderHealthReport {
  checkedAt: number;
  /** Every provider, in the real fallback order. */
  chain: ProviderHealthEntry[];
  /** The providers that would actually be attempted, in order. */
  usableChain: string[];
  /** The first two usable providers — the PRIMARY fallback path. */
  primaryPath: string[];
  /** Everything after the primary path — secondary fallbacks. */
  secondaryPath: string[];
  /** True only if at least one provider is genuinely usable. */
  anyUsable: boolean;
  /** True only if a live verification was actually performed. */
  liveVerificationAttempted: boolean;
}

export default class ProviderHealth {
  constructor(private readonly registry: AIProviderRegistry) {}

  /**
   * Deterministic, offline-safe inspection. Makes NO network calls —
   * every value comes from the registry's real recorded state and each
   * provider's own health()/isAvailable(). Safe to call anywhere,
   * including at boot and in the sandbox.
   */
  public async inspect(): Promise<ProviderHealthReport> {
    const all = this.registry.all();
    const snapshot = this.registry.statusSnapshot();
    const byName = new Map(snapshot.map((entry) => [entry.name, entry]));

    // The REAL chain order the resolver walks: ascending priority.
    const ordered = [...all].sort((a, b) => a.priority - b.priority);

    const chain: ProviderHealthEntry[] = [];

    for (const [index, provider] of ordered.entries()) {
      const status = byName.get(provider.name);
      let availability: ProviderAvailability;
      let detail: string;

      if (!provider.enabled) {
        availability = "disabled";
        detail = "disabled by configuration";
      } else if (status?.inCooldown) {
        availability = "cooldown";
        detail = `quarantined after a real failure: ${status.failure?.reason ?? "unknown"}`;
      } else {
        try {
          const health = await provider.health();
          if (health.available) {
            availability = "ready";
            detail = "credentialed and ready";
          } else if (provider.requiresApiKey) {
            // The honesty rule: this is NOT an error and NOT healthy.
            availability = "no_credentials";
            detail = health.lastError ?? "no API key configured";
          } else {
            availability = "error";
            detail = health.lastError ?? "reported unavailable";
          }
        } catch (error) {
          availability = "error";
          detail = error instanceof Error ? error.message : String(error);
        }
      }

      chain.push({
        name: provider.name,
        priority: provider.priority,
        position: index + 1,
        requiresApiKey: provider.requiresApiKey,
        availability,
        verification: "not_attempted",
        detail,
        lastSuccess: status?.lastSuccess ?? null,
        inCooldown: Boolean(status?.inCooldown),
      });
    }

    const usableChain = chain.filter((c) => c.availability === "ready").map((c) => c.name);

    return {
      checkedAt: Date.now(),
      chain,
      usableChain,
      primaryPath: usableChain.slice(0, 2),
      secondaryPath: usableChain.slice(2),
      anyUsable: usableChain.length > 0,
      liveVerificationAttempted: false,
    };
  }

  /**
   * REAL live verification — the production path.
   *
   * Sends a genuine minimal request through each provider's own
   * `generate()`. There is no stub and no fabricated response: if this
   * reports `verified_live`, that provider actually answered.
   *
   * A provider without credentials is reported `skipped_no_credentials`,
   * never "healthy" and never "failed" — not having a key is not a
   * failure, and pretending otherwise is exactly what this module
   * exists to prevent. In an environment with no keys at all (such as
   * a CI sandbox), every entry is skipped and `anyUsable` stays false.
   *
   * Failures here are isolated per provider: a broken secondary can
   * never affect the primary path's reported health.
   */
  public async verifyLive(options?: { prompt?: string; only?: string[] }): Promise<ProviderHealthReport> {
    const report = await this.inspect();
    const prompt = options?.prompt ?? "Reply with the single word: ok";

    for (const entry of report.chain) {
      if (options?.only && !options.only.includes(entry.name)) {
        continue;
      }
      if (entry.availability === "no_credentials") {
        entry.verification = "skipped_no_credentials";
        continue;
      }
      if (entry.availability !== "ready") {
        // Disabled / cooldown / error: nothing to verify, and we do not
        // invent a result for it.
        continue;
      }

      const provider = this.registry.get(entry.name);
      if (!provider) continue;

      try {
        // A probe is a billed call like any other: it goes through the budget gate.
        const response = await gatedGenerate(provider, {
          messages: [{ role: "user", content: prompt }],
          prompt,
          timestamp: Date.now(),
        }, "health-probe");
        if (response && typeof response.text === "string" && response.text.trim().length > 0) {
          entry.verification = "verified_live";
          entry.detail = `live request succeeded (${response.model || "unknown model"})`;
        } else {
          entry.verification = "failed_live";
          entry.detail = "live request returned an empty response";
        }
      } catch (error) {
        if (error instanceof BudgetExhaustedError) {
          entry.verification = "skipped_budget";
          entry.detail = `not sent: ${error.message}`;
          continue;
        }
        // Contained per provider — a failing secondary must never break
        // the primary path's result.
        entry.verification = "failed_live";
        entry.detail = error instanceof Error ? error.message : String(error);
      }
    }

    report.liveVerificationAttempted = true;
    return report;
  }

  /** Human-readable summary for a diagnostics panel or a CLI check. */
  public static format(report: ProviderHealthReport): string {
    const lines = report.chain.map((entry) => {
      const verified =
        entry.verification === "not_attempted" ? "" : `  [${entry.verification}]`;
      return `  ${entry.position}. ${entry.name.padEnd(20)} p${entry.priority}  ${entry.availability.padEnd(16)} ${entry.detail}${verified}`;
    });
    return [
      `PROVIDER CHAIN (${report.usableChain.length}/${report.chain.length} usable)`,
      `  primary:   ${report.primaryPath.join(" → ") || "(none)"}`,
      `  secondary: ${report.secondaryPath.join(" → ") || "(none)"}`,
      `  live verification attempted: ${report.liveVerificationAttempted}`,
      ...lines,
    ].join("\n");
  }
}

/* ------------------------------------------------------------------ *
 * BROKER-OBSERVED HEALTH — Mission 14
 *
 * The class above reads the page's own registry. For BROKERED providers the
 * page holds no key and the server is the only authority: `/api/model/status`
 * is where a real 2xx, a 429, a rejected credential and their timestamps are
 * recorded. This section reuses that endpoint and keeps the observation.
 *
 * It does not replace the registry inspection above, and it does not claim
 * a configured key is a working provider. A row is `verified` only from an
 * observed completion; `unverified` means configured but never observed
 * succeeding. A failed probe keeps the previous real rows and records the
 * probe error separately, so "I could not check" never becomes "fine".
 * ------------------------------------------------------------------ */

export type BrokerAvailability =
  | "verified"
  | "unverified"
  | "failing"
  | "blocked"
  | "unknown";

export interface BrokerProviderObservation {
  id: string;
  /** The server's "the chain may try this provider" boolean. */
  available: boolean;
  /** Whether a credential is configured at all. */
  configured: boolean;
  /** The broker's evidence state, verbatim (COMPLETION_VERIFIED, …). */
  state: string;
  availability: BrokerAvailability;
  /** When a real 2xx completion was last observed, if ever. */
  lastSuccessAt: number | null;
  /** When a refusal/limit/outage was last observed, if ever. */
  lastFailureAt: number | null;
  lastFailureStatus: number | null;
  lastFailureNote: string | null;
  /** When LÉLU read this provider's row from the status endpoint. */
  observedAt: number;
}

export interface BrokerHealthSnapshot {
  at: number;
  endpoint: string;
  providers: BrokerProviderObservation[];
  /** Set when the status endpoint itself could not be read. */
  probeError: string | null;
  durability: "persisted" | "memory-only";
}

const BROKER_KEY = "provider-health.v1";
const BROKER_ENDPOINT = "/api/model/status";

const VERIFIED_STATES = new Set(["COMPLETION_VERIFIED", "TOOL_CALLING_VERIFIED"]);
const BLOCKED_STATES = new Set([
  "UNCONFIGURED",
  "POLICY_DISABLED",
  "SPEND_NOT_AUTHORIZED",
  "AUTHENTICATION_FAILED",
  "COOLDOWN",
]);
const FAILING_STATES = new Set([
  "CAPACITY_LIMITED",
  "UNREACHABLE",
  "CONTRACT_VIOLATION",
  "CREDENTIAL_ROTATED",
]);

interface BrokerState {
  state?: string;
  at?: number;
  httpStatus?: number;
  note?: string;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  lastFailureStatus?: number;
  lastFailureNote?: string;
}

const numberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const stringOrNull = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * Turn the broker's status body into observations. Pure, so the
 * classification can be tested without a server or a browser.
 */
export function deriveBrokerHealth(
  body: unknown,
  observedAt: number = Date.now(),
): BrokerProviderObservation[] {
  if (!body || typeof body !== "object") return [];
  const record = body as {
    providers?: Record<string, unknown>;
    states?: Record<string, unknown>;
  };
  const providers = record.providers && typeof record.providers === "object" ? record.providers : {};
  const states = record.states && typeof record.states === "object" ? record.states : {};
  const ids = [...new Set([...Object.keys(providers), ...Object.keys(states)])].sort();

  return ids.map((id) => {
    const rawState = states[id];
    const state: BrokerState =
      rawState && typeof rawState === "object" ? (rawState as BrokerState) : {};
    const available = providers[id] === true;
    // The server only sets `providers[id]` true when a credential exists and
    // no policy refusal applies. UNCONFIGURED is the authoritative "no key".
    const configured = state.state !== "UNCONFIGURED" && (available || state.state !== undefined);
    const name = state.state ?? "UNKNOWN";

    const explicitSuccess = numberOrNull(state.lastSuccessAt);
    const explicitFailure = numberOrNull(state.lastFailureAt);
    const lastSuccessAt =
      explicitSuccess ?? (VERIFIED_STATES.has(name) ? numberOrNull(state.at) : null);
    const lastFailureAt =
      explicitFailure ?? (BLOCKED_STATES.has(name) || FAILING_STATES.has(name) ? numberOrNull(state.at) : null);
    const lastFailureStatus =
      numberOrNull(state.lastFailureStatus) ??
      (lastFailureAt !== null ? numberOrNull(state.httpStatus) : null);
    const lastFailureNote =
      stringOrNull(state.lastFailureNote) ??
      (lastFailureAt !== null ? stringOrNull(state.note) ?? name : null);

    let availability: BrokerAvailability;
    if (!configured) availability = "blocked";
    else if (BLOCKED_STATES.has(name)) availability = "blocked";
    else if (FAILING_STATES.has(name)) availability = "failing";
    else if (VERIFIED_STATES.has(name)) {
      // A later failure means the provider worked once and is not working now.
      availability =
        lastFailureAt !== null && (lastSuccessAt === null || lastFailureAt > lastSuccessAt)
          ? "failing"
          : "verified";
    } else if (name === "CONFIGURED") availability = "unverified";
    else availability = "unknown";

    return {
      id,
      available,
      configured,
      state: name,
      availability,
      lastSuccessAt,
      lastFailureAt,
      lastFailureStatus,
      lastFailureNote,
      observedAt,
    };
  });
}

export interface BrokerHealthOptions {
  kv?: KvStore;
  now?: () => number;
  fetchImpl?: typeof fetch;
  endpoint?: string;
}

export class BrokerHealth {
  private readonly kv: KvStore;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch | undefined;
  private readonly endpoint: string;
  private snapshot: BrokerHealthSnapshot | null;

  constructor(options: BrokerHealthOptions = {}) {
    this.kv = options.kv ?? KvStore.getInstance();
    this.now = options.now ?? (() => Date.now());
    // Bind the global: an extracted `fetch` called as `this.fetchImpl(...)`
    // throws "Illegal invocation" in browsers, which made every health probe
    // fail before it left the page and stored an empty provider list.
    this.fetchImpl =
      options.fetchImpl ?? (typeof fetch === "function" ? fetch.bind(globalThis) : undefined);
    this.endpoint = options.endpoint ?? BROKER_ENDPOINT;
    this.snapshot = this.load();
  }

  private load(): BrokerHealthSnapshot | null {
    try {
      const stored = this.kv.get<BrokerHealthSnapshot>(BROKER_KEY);
      if (!stored || !Array.isArray(stored.providers)) return null;
      return stored;
    } catch {
      return null;
    }
  }

  private persist(snapshot: BrokerHealthSnapshot): BrokerHealthSnapshot {
    let wrote = false;
    try {
      wrote = this.kv.set(BROKER_KEY, snapshot);
    } catch {
      wrote = false;
    }
    return { ...snapshot, durability: wrote ? "persisted" : "memory-only" };
  }

  /** The last observation — possibly from a previous session. Never a probe. */
  public get(): BrokerHealthSnapshot | null {
    return this.snapshot;
  }

  /** Ask the broker now. A failure keeps the previous rows and records why. */
  public async refresh(): Promise<BrokerHealthSnapshot> {
    const at = this.now();
    if (!this.fetchImpl) {
      return this.recordFailure(at, "No fetch implementation is available in this runtime.");
    }
    try {
      const response = await this.fetchImpl(this.endpoint, {
        headers: { Accept: "application/json" },
        signal:
          typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
            ? AbortSignal.timeout(8_000)
            : undefined,
      });
      if (!response.ok) {
        return this.recordFailure(at, `GET ${this.endpoint} returned HTTP ${response.status}.`);
      }
      const body = (await response.json()) as unknown;
      const snapshot: BrokerHealthSnapshot = {
        at,
        endpoint: this.endpoint,
        providers: deriveBrokerHealth(body, at),
        probeError: null,
        durability: "memory-only",
      };
      this.snapshot = this.persist(snapshot);
      return this.snapshot;
    } catch (error) {
      return this.recordFailure(at, error instanceof Error ? error.message : String(error));
    }
  }

  private recordFailure(at: number, error: string): BrokerHealthSnapshot {
    const previous = this.snapshot;
    const snapshot: BrokerHealthSnapshot = {
      at,
      endpoint: this.endpoint,
      // Keep the last real answer; its own observedAt stays truthful.
      providers: previous?.providers ?? [],
      probeError: error,
      durability: "memory-only",
    };
    this.snapshot = this.persist(snapshot);
    return this.snapshot;
  }
}

export class BrokerHealthStore {
  private static instance: BrokerHealth | null = null;

  public static getInstance(): BrokerHealth {
    if (!BrokerHealthStore.instance) BrokerHealthStore.instance = new BrokerHealth();
    return BrokerHealthStore.instance;
  }

  public static setForTests(instance: BrokerHealth | null): void {
    BrokerHealthStore.instance = instance;
  }
}
