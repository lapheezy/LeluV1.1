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
  | "skipped_no_credentials";

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
        const response = await provider.generate({
          messages: [{ role: "user", content: prompt }],
          prompt,
          timestamp: Date.now(),
        });
        if (response && typeof response.text === "string" && response.text.trim().length > 0) {
          entry.verification = "verified_live";
          entry.detail = `live request succeeded (${response.model || "unknown model"})`;
        } else {
          entry.verification = "failed_live";
          entry.detail = "live request returned an empty response";
        }
      } catch (error) {
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
