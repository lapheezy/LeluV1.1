/**
 * ==========================================================
 * LÉLU
 * OPENALEX PROVIDER
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";

export default class OpenAlexProvider implements Provider {

  readonly name = "openalex";

  readonly category = "research";

  readonly priority = 78;

  readonly enabled = true;

  readonly requiresApiKey = false;

  readonly timeout = 10000;

  readonly cooldown = 500;

  readonly maxConcurrent = 3;

  readonly capabilities = ["research", "citation", "paper", "academia"] as const;

  private readonly endpoint =
    "https://api.openalex.org/works";

  canSearch(query: string): boolean {
    return query.trim().length > 0;
  }

  async search(
    query: string,
  ): Promise<KnowledgeResult[]> {

    const response =
      await fetch(

        `${this.endpoint}?search=${encodeURIComponent(
          query,
        )}&per_page=10`,

      );

    if (!response.ok) {

      throw new Error(

        `OpenAlex ${response.status}`,

      );

    }

    const json =
      await response.json();

    return (json.results ?? []).map(
      (work: any): KnowledgeResult => ({
        id: work.id ?? crypto.randomUUID(),
        title: work.display_name ?? "Untitled",
        content: work.abstract ?? "",
        url: work.primary_location?.landing_page_url,
        source: "OpenAlex",
        confidence: 0.92,
        timestamp: work.publication_date,
        metadata: {
          abstract: work.abstract ?? "",
          year: work.publication_year,
          doi: work.doi,
        },
      }),
    );

  }

}