/**
 * ==========================================================
 * LÉLU
 * PROVIDER
 * ==========================================================
 */

export interface KnowledgeResult {

  id: string;

  title: string;

  content: string;

  url?: string;

  source: string;

  confidence: number;

  timestamp?: string;

  metadata?:
    Record<
      string,
      unknown
    >;

}

export default interface Provider {

  readonly name: string;

  readonly category: string;

  readonly priority: number;

  readonly enabled: boolean;

  readonly requiresApiKey: boolean;

  readonly timeout: number;

  readonly cooldown: number;

  readonly maxConcurrent: number;

  readonly capabilities:
    readonly string[];

  canSearch(
    query: string,
  ): boolean;

  search(
    query: string,
  ): Promise<
    KnowledgeResult[]
  >;

}