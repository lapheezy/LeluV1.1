/**
 * ==========================================================
 * LÉLU
 * ARXIV PROVIDER
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";

export default class ArxivProvider implements Provider {

  readonly name = "arxiv";

  readonly category = "research";

  readonly priority = 80;

  readonly enabled = true;

  readonly requiresApiKey = false;

  readonly timeout = 10000;

  readonly cooldown = 500;

  readonly maxConcurrent = 3;

  readonly capabilities = ["research", "paper", "science", "academia"] as const;

  private readonly endpoint =
    "https://export.arxiv.org/api/query";

  canSearch(query: string): boolean {
    return query.trim().length > 0;
  }

  async search(
    query: string,
  ): Promise<KnowledgeResult[]> {

    const response =
      await fetch(

        `${this.endpoint}?search_query=all:${encodeURIComponent(
          query,
        )}&start=0&max_results=10`,

      );

    if (!response.ok) {

      throw new Error(
        `arXiv ${response.status}`,
      );

    }

    const xml =
      await response.text();

    return [

      {

        id: crypto.randomUUID(),

        title: "arXiv parsing coming soon",

        content: xml,

        url:
          "https://arxiv.org",

        source: "arXiv",

        confidence: 0.8,

        timestamp: new Date().toISOString(),

        metadata: {
          summary: xml,
        },

      },

    ];

  }

}