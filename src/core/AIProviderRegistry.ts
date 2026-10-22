/**
 * ==========================================================
 * LÉLU
 * AI PROVIDER REGISTRY
 * ==========================================================
 */

import type AIProvider from "../providers/AIProvider";

const FAILURE_COOLDOWN_MS = 30_000;

/**
 * How long a provider sits out after a credential the server has
 * REFUSED, as opposed to a request that merely failed.
 *
 * A 401 is not a transient condition: the key is wrong, and it will be
 * just as wrong in thirty seconds. Measured on every boot of this
 * repository: "[CerebrasProvider] API request failed {status: 401,
 * message: Wrong API Key}" — attempted, refused, cooled for 30s,
 * attempted again, for the life of the session.
 *
 * It is a long cooldown rather than a permanent disable because a key
 * can be fixed while the app is running, and a provider that can never
 * come back without a reload is its own bug. Fifteen minutes is long
 * enough that a broken credential stops costing anything and short
 * enough that a corrected one is picked up.
 */
const AUTH_FAILURE_COOLDOWN_MS = 15 * 60_000;

/**
 * WHY a provider failed, in the terms someone would act on.
 *
 * "failed" is not a diagnosis. A refused key is fixed in a dashboard, a
 * timeout is fixed by a longer budget, an unreachable host is fixed by
 * the network, and a model that stopped short is fixed by nothing on
 * this list. Purely a reading of the reason text every provider already
 * reports — no new error channel, no keys, no secrets.
 *
 * New in the second pass: billing (out of credit — top up the account),
 * model-not-found (wrong model id for this account's plan), and
 * bad-request (malformed request body or parameter). All three collapsed
 * to "unknown" before because the 402/404/400/422 codes were never
 * in the classifier.
 */
export type ProviderFailureKind =
  | "credential-refused"
  | "timeout"
  | "network"
  | "server"
  | "billing"
  | "model-not-found"
  | "bad-request"
  | "unknown";

interface ProviderFailure {
  count: number;
  lastFailure: number;
  reason: string;
  /**
   * The server refused the credential itself. A different thing from a
   * timeout, a 500 or an unreachable host, and it deserves a different
   * cooldown.
   */
  authRejected?: boolean;
  /** The same distinction as a category, for diagnostics. */
  kind?: ProviderFailureKind;
}

/**
 * Did the server refuse the credential, or did the request just fail?
 *
 * Read from the reason text, because that is what every provider
 * already reports and what the registry already stores — adding a
 * structured error channel through nine providers to learn one bit
 * would be a larger change than the problem.
 *
 * Deliberately narrow: 401, 403 and the unambiguous phrases. A network
 * error, a timeout or a 500 must NOT land here, or a provider would be
 * put to sleep for a quarter of an hour over a dropped connection.
 */
export function isAuthRejection(reason: string): boolean {
  const text = reason.toLowerCase();
  if (/\b(401|403)\b/.test(text)) return true;
  return (
    /wrong api key|invalid api key|invalid_api_key|incorrect api key/.test(text) ||
    /unauthorized|authentication failed|invalid authentication|invalid credentials/.test(text) ||
    /api key not valid|no api key provided|missing api key/.test(text)
  );
}

/**
 * What kind of provider failure this was.
 *
 * Auth is checked first, so a 401 that happens to arrive from an
 * aborted request is still a credential problem. The rest are the
 * categories a reader can act on: a timeout means the budget is too
 * short, network means nothing left the machine, server means the
 * provider is unwell, and unknown is honestly unknown.
 */
export function classifyProviderFailure(reason: string): ProviderFailureKind {
  if (isAuthRejection(reason)) return "credential-refused";
  const text = reason.toLowerCase();
  // 402 / credit-exhausted phrases — fix in the provider dashboard, not
  // in code. Must come before the generic server check.
  if (/\b402\b|out of credit|payment required|insufficient.{0,20}(credit|fund)/.test(text)) {
    return "billing";
  }
  // 404 in an AI provider context almost always means the model id is
  // wrong or not available on this account's plan.
  if (/\b404\b|model.*not.*(?:available|found)|that model/.test(text)) {
    return "model-not-found";
  }
  // 400 / 422 — the request body or parameters were rejected. Fix the
  // request format, not the provider configuration.
  if (/\b(400|422)\b|malformed|rejected as malformed|bad request|unprocessable/.test(text)) {
    return "bad-request";
  }
  if (/timed? ?out|etimedout|deadline exceeded|aborted|abort error/.test(text)) return "timeout";
  if (/econnreset|econnrefused|enotfound|eai_again|network|fetch failed|socket hang up|dns/.test(text)) {
    return "network";
  }
  if (/\b(429|500|502|503|504|529)\b|overloaded|rate limit|service unavailable/.test(text)) {
    return "server";
  }
  return "unknown";
}

export default class AIProviderRegistry {
  private readonly providers = new Map<string, AIProvider>();
  private readonly failures = new Map<string, ProviderFailure>();

  /**
   * The provider that last SUCCEEDED through the runtime — the
   * registry is the single source of truth for "which provider is
   * LÉLU actively using", and the API Status UI reads it from here.
   */
  private activeProvider: string | null = null;

  /** Timestamp of the last successful generation per provider. */
  private readonly lastSuccess = new Map<string, number>();

  /** Usage metadata (tokens/credits) reported by the last successful response. */
  private readonly lastUsage = new Map<string, unknown>();

  /**
   * In-flight initialization promise. `initialize()` had no guard at
   * all — two concurrent callers (plausible: multiple components each
   * calling AIService.initialize() on mount, or React StrictMode's
   * double-invoke) would each loop over every provider and call
   * `provider.initialize()` twice, concurrently, per provider. Memoizing
   * the actual work means concurrent callers await the SAME run instead
   * of racing separate ones.
   */
  private initializingPromise: Promise<void> | null = null;
  private initialized = false;

  public register(provider: AIProvider): void {
    if (this.providers.has(provider.name)) {
      console.warn(
        `[AIProviderRegistry] "${provider.name}" already registered. Replacing.`,
      );
    }

    this.providers.set(provider.name, provider);
    this.failures.delete(provider.name);
  }

  public registerMany(providers: AIProvider[]): void {
    for (const provider of providers) {
      this.register(provider);
    }
  }

  /**
   * Concurrent callers await the SAME run instead of each looping over
   * every provider independently. Once complete, later calls are a
   * true no-op (matching AICore/AIRuntime/AIService's own guard
   * convention) — there is currently no path that registers a provider
   * after startup, so re-running would only ever redundantly
   * re-initialize already-successful providers.
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    if (this.initializingPromise) return this.initializingPromise;

    this.initializingPromise = this.doInitialize();
    try {
      await this.initializingPromise;
    } finally {
      this.initializingPromise = null;
    }
  }

  private async doInitialize(): Promise<void> {
    for (const provider of this.providers.values()) {
      try {
        console.info(
          `[AIProviderRegistry] Initializing ${provider.name}...`,
        );
        await provider.initialize();
        console.info(
          `[AIProviderRegistry] ${provider.name} initialized.`,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.markFailure(provider.name, reason);
        console.error(
          `[AIProviderRegistry] Failed to initialize ${provider.name}`,
          error,
        );
      }
    }
    this.initialized = true;
  }

  public async shutdown(): Promise<void> {
    for (const provider of this.providers.values()) {
      try {
        await provider.shutdown?.();
      } catch (error) {
        console.error(
          `[AIProviderRegistry] Failed to shutdown ${provider.name}`,
          error,
        );
      }
    }
  }

  public get(name: string): AIProvider | undefined {
    return this.providers.get(name);
  }

  public require(name: string): AIProvider {
    const provider = this.get(name);

    if (!provider) {
      throw new Error(`AI Provider "${name}" is not registered.`);
    }

    return provider;
  }

  public all(): AIProvider[] {
    return Array.from(this.providers.values()).sort(
      (a, b) => a.priority - b.priority,
    );
  }

  public enabled(): AIProvider[] {
    return this.all().filter((provider) => provider.enabled);
  }

  public async available(): Promise<AIProvider[]> {
    const available: AIProvider[] = [];
    const now = Date.now();

    for (const provider of this.enabled()) {
      const failure = this.failures.get(provider.name);

      const cooldown = this.cooldownFor(provider.name);
      if (failure && now - failure.lastFailure < cooldown) {
        console.info(
          `[AIProviderRegistry] Skipping ${provider.name} during failure cooldown.`,
          {
            retryInMs: cooldown - (now - failure.lastFailure),
            reason: failure.reason,
            // Said plainly, because the two cases need different action
            // from whoever reads the log: fix the key, or wait.
            credentialRefused: failure.authRejected === true,
          },
        );
        continue;
      }

      if (failure) {
        this.failures.delete(provider.name);
      }

      try {
        if (await provider.isAvailable()) {
          available.push(provider);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.markFailure(provider.name, reason);
        console.error(
          `[AIProviderRegistry] ${provider.name} availability check failed.`,
          error,
        );
      }
    }

    return available;
  }

  public markFailure(name: string, reason: string): void {
    const previous = this.failures.get(name);
    // Sticky: once a credential has been refused, a later ordinary
    // failure must not quietly shorten the cooldown back to 30s.
    const authRejected = previous?.authRejected === true || isAuthRejection(reason);
    this.failures.set(name, {
      count: (previous?.count ?? 0) + 1,
      lastFailure: Date.now(),
      reason,
      authRejected,
      // Auth stays sticky for the same reason the cooldown does; every
      // other kind describes the failure that just happened, so a
      // recovered network does not keep reading as a timeout.
      kind: authRejected ? "credential-refused" : classifyProviderFailure(reason),
    });
  }

  /** How long this provider sits out, given why it failed. */
  public cooldownFor(name: string): number {
    return this.failures.get(name)?.authRejected === true
      ? AUTH_FAILURE_COOLDOWN_MS
      : FAILURE_COOLDOWN_MS;
  }

  /**
   * A credential has been fixed, or the provider is being re-enabled.
   * Clears the refusal so it is tried again immediately.
   */
  public clearFailure(name: string): void {
    this.failures.delete(name);
  }

  public markSuccess(name: string, usage?: unknown): void {
    this.failures.delete(name);
    this.activeProvider = name;
    this.lastSuccess.set(name, Date.now());
    if (usage !== undefined) {
      this.lastUsage.set(name, usage);
    }
  }

  /** Name of the provider that last succeeded — the active one. */
  public getActiveProvider(): string | null {
    return this.activeProvider;
  }

  /** Timestamp of the provider's last successful generation. */
  public lastSuccessOf(name: string): number | undefined {
    return this.lastSuccess.get(name);
  }

  /** Usage metadata from the provider's last successful generation. */
  public lastUsageOf(name: string): unknown {
    return this.lastUsage.get(name);
  }

  /** Whether the provider is currently inside its failure cooldown. */
  public isInCooldown(name: string): boolean {
    const failure = this.failures.get(name);
    if (!failure) {
      return false;
    }
    // The same rule the selection path uses, so a caller asking this
    // question gets the same answer the chain acted on.
    return Date.now() - failure.lastFailure < this.cooldownFor(name);
  }

  /** Read-only snapshot of every registered provider's runtime state. */
  public statusSnapshot(): {
    name: string;
    priority: number;
    enabled: boolean;
    requiresApiKey: boolean;
    timeout: number;
    lastSuccess: number | undefined;
    lastUsage: unknown;
    failure: ProviderFailure | null;
    inCooldown: boolean;
  }[] {
    return this.all().map((provider) => {
      const failure = this.failures.get(provider.name) ?? null;
      return {
        name: provider.name,
        priority: provider.priority,
        enabled: provider.enabled,
        requiresApiKey: provider.requiresApiKey,
        timeout: provider.timeout,
        lastSuccess: this.lastSuccess.get(provider.name),
        lastUsage: this.lastUsage.get(provider.name),
        failure,
        // The status panel must report the cooldown that is actually in
        // force, not the default one.
        inCooldown: this.isInCooldown(provider.name),
      };
    });
  }

  public failure(name: string): ProviderFailure | undefined {
    return this.failures.get(name);
  }

  public names(): string[] {
    return this.all().map((provider) => provider.name);
  }

  public has(name: string): boolean {
    return this.providers.has(name);
  }

  public clear(): void {
    this.providers.clear();
    this.failures.clear();
  }

  public get size(): number {
    return this.providers.size;
  }
}
