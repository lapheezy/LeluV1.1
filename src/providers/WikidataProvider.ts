/**
 * ==========================================================
 * LÉLU
 * WIKIDATA PROVIDER
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";

export default class WikidataProvider implements Provider {

  readonly name = "wikidata";

  readonly category = "knowledge";

  readonly priority = 76;

  readonly enabled = true;

  readonly requiresApiKey = false;

  readonly timeout = 10000;

  readonly cooldown = 500;

  readonly maxConcurrent = 3;

  readonly capabilities = ["knowledge", "entity", "fact", "wikidata"] as const;

  private readonly endpoint =
    "https://www.wikidata.org/w/api.php";

  canSearch(query: string): boolean {
    return query.trim().length > 0;
  }

  async search(
    query: string,
  ): Promise<KnowledgeResult[]> {

    const url = new URL(
      this.endpoint,
    );

    url.searchParams.set(
      "action",
      "wbsearchentities",
    );

    url.searchParams.set(
      "search",
      query,
    );

    url.searchParams.set(
      "language",
      "en",
    );

    url.searchParams.set(
      "limit",
      "10",
    );

    url.searchParams.set(
      "format",
      "json",
    );

    url.searchParams.set(
      "origin",
      "*",
    );

    const response =
      await fetch(
        url.toString(),
      );

    if (!response.ok) {

      throw new Error(
        `Wikidata ${response.status}`,
      );
    }

    const json =
      await response.json();

    return (json.search ?? []).map(
      (item: any): KnowledgeResult => ({
        id: item.id ?? crypto.randomUUID(),
        title: item.label,
        content: item.description ?? "",
        url: `https://www.wikidata.org/wiki/${item.id}`,
        source: "Wikidata",
        confidence: 0.95,
        timestamp: new Date().toISOString(),
        metadata: {
          id: item.id,
          conceptUri: item.concepturi,
          aliases: item.aliases ?? [],
        },
      }),
    );

  }

}