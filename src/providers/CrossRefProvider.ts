/**
 * ==========================================================
 * LÉLU
 * CROSSREF PROVIDER
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";

export default class CrossrefProvider implements Provider {

  readonly name = "crossref";

  readonly category = "research";

  readonly priority = 75;

  readonly enabled = true;

  readonly requiresApiKey = false;

  readonly timeout = 10000;

  readonly cooldown = 500;

  readonly maxConcurrent = 3;

  readonly capabilities = ["research", "citation", "paper", "science"] as const;

  private readonly endpoint =
    "https://api.crossref.org/works";

  canSearch(query: string): boolean {
    return query.trim().length > 0;
  }

  async search(
    query: string,
  ): Promise<KnowledgeResult[]> {

    const response =
      await fetch(

        `${this.endpoint}?query=${encodeURIComponent(
          query,
        )}&rows=10`,

      );

    if (!response.ok) {

      throw new Error(

        `Crossref ${response.status}`,

      );

    }

    const json =
      await response.json();

    return (json.message?.items ?? []).map(
      (item: any): KnowledgeResult => ({
        id: item.DOI ?? crypto.randomUUID(),
        title: item.title?.[0] ?? "Untitled",
        content: (item.abstract ?? "").toString(),
        url: item.URL,
        source: "Crossref",
        confidence: 0.9,
        timestamp: item.created?.["date-parts"]?.[0]?.join("-"),
        metadata: {
          authors: (item.author ?? []).map((author: any) => `${author.given ?? ""} ${author.family ?? ""}`.trim()),
          year: item.created?.["date-parts"]?.[0]?.[0],
          doi: item.DOI,
          publisher: item.publisher,
        },
      }),
    );

  }

}