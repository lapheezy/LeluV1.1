import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";

export abstract class BaseProvider implements Provider {
  abstract readonly name: string;

  category = "general";

  priority = 50;

  enabled = true;

  requiresApiKey = false;

  timeout = 10000;

  cooldown = 0;

  maxConcurrent = 1;

  capabilities: readonly string[] = ["search"];

  protected cache = new Map<string, KnowledgeResult[]>();

  abstract canHandle(query: string): boolean;

  canSearch(query: string): boolean {
    return this.canHandle(query);
  }

  protected abstract execute(
    query: string,
  ): Promise<KnowledgeResult[]>;

  async search(query: string): Promise<KnowledgeResult[]> {
    if (!this.enabled) {
      return [];
    }

    const cached = this.cache.get(query);

    if (cached) {
      return cached;
    }

    const result = await this.execute(query);

    this.cache.set(query, result);

    return result;
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  clearCache(): void {
    this.cache.clear();
  }
}