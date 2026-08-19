/**
 * ==========================================================
 * LÉLU
 * GDELT PROVIDER
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";

export default class GDELTProvider implements Provider {

  readonly name =
    "gdelt";

  readonly category = "news";

  readonly priority = 70;

  readonly enabled = true;

  readonly requiresApiKey = false;

  readonly timeout = 10000;

  readonly cooldown = 500;

  readonly maxConcurrent = 3;

  readonly capabilities = ["news", "current-events", "global", "media"] as const;

  private readonly endpoint =
    "https://api.gdeltproject.org/api/v2/doc/doc";

  canSearch(query: string): boolean {
    return query.trim().length > 0;
  }

  async search(
    query: string,
  ): Promise<KnowledgeResult[]> {

    const url =
      new URL(
        this.endpoint,
      );

    url.searchParams.set(
      "query",
      query,
    );

    url.searchParams.set(
      "mode",
      "artlist",
    );

    url.searchParams.set(
      "format",
      "json",
    );

    url.searchParams.set(
      "maxrecords",
      "10",
    );

    const response =
      await fetch(
        url.toString(),
      );

    if (!response.ok) {

      throw new Error(
        `GDELT ${response.status}`,
      );

    }

    const json =
      await response.json();

    return (json.articles ?? []).map(
      (article: any): KnowledgeResult => ({
        id: article.url ?? crypto.randomUUID(),
        title: article.title ?? "Untitled",
        content: article.seendate ?? "",
        url: article.url,
        source: "GDELT",
        confidence: 0.96,
        timestamp: article.seendate,
        metadata: {
          language: article.language,
          domain: article.domain,
          sourceCountry: article.sourcecountry,
          socialImage: article.socialimage,
          tone: article.tone,
        },
      }),
    );

  }

}