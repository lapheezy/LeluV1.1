/**
 * ==========================================================
 * LÉLU
 * AI PROVIDER REGISTRY
 * ==========================================================
 */

import type AIProvider from "../providers/AIProvider";

const FAILURE_COOLDOWN_MS = 30_000;

interface ProviderFailure {
  count: number;
  lastFailure: number;
  reason: string;
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

  public async initialize(): Promise<void> {
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

      if (failure && now - failure.lastFailure < FAILURE_COOLDOWN_MS) {
        console.info(
          `[AIProviderRegistry] Skipping ${provider.name} during failure cooldown.`,
          {
            retryInMs: FAILURE_COOLDOWN_MS - (now - failure.lastFailure),
            reason: failure.reason,
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
    this.failures.set(name, {
      count: (previous?.count ?? 0) + 1,
      lastFailure: Date.now(),
      reason,
    });
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
    return Date.now() - failure.lastFailure < FAILURE_COOLDOWN_MS;
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
        inCooldown: failure
          ? Date.now() - failure.lastFailure < FAILURE_COOLDOWN_MS
          : false,
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
