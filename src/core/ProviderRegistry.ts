/**
 * ==========================================================
 * LÉLU
 * PROVIDER REGISTRY
 * ==========================================================
 */

import type Provider from "../providers/Provider";

export default class ProviderRegistry {

  private readonly providers =
    new Map<string, Provider>();

  private locked =
    false;

  register(
    provider: Provider,
  ): void {

    if (this.locked) {

      throw new Error(
        "ProviderRegistry is locked.",
      );

    }

    if (
      this.providers.has(
        provider.name,
      )
    ) {

      console.warn(

        `[ProviderRegistry] "${provider.name}" already registered. Replacing.`,

      );

    }

    this.providers.set(
      provider.name,
      provider,
    );

  }

  registerMany(
    providers: Provider[],
  ): void {

    for (
      const provider of providers
    ) {

      this.register(
        provider,
      );

    }

  }

  unregister(
    name: string,
  ): boolean {

    if (this.locked) {

      throw new Error(
        "ProviderRegistry is locked.",
      );

    }

    return this.providers.delete(
      name,
    );

  }

  get(
    name: string,
  ): Provider | undefined {

    return this.providers.get(
      name,
    );

  }

  require(
    name: string,
  ): Provider {

    const provider =
      this.get(
        name,
      );

    if (!provider) {

      throw new Error(

        `Provider "${name}" is not registered.`,

      );

    }

    return provider;

  }

  all(): Provider[] {

    return Array.from(
      this.providers.values(),
    );

  }

  names(): string[] {

    return Array.from(
      this.providers.keys(),
    );

  }

  has(
    name: string,
  ): boolean {

    return this.providers.has(
      name,
    );

  }

  clear(): void {

    if (this.locked) {

      throw new Error(
        "ProviderRegistry is locked.",
      );

    }

    this.providers.clear();

  }

  freeze(): void {

    this.locked =
      true;

  }

  get size(): number {

    return this.providers.size;

  }

}