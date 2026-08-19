/**
 * ==========================================================
 * LÉLU
 * NEWS PROVIDER
 * ==========================================================
 */

import config from "../core/ProviderConfig";

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";

export default class NewsProvider
  implements Provider {

  readonly name =
    "news";

  readonly category =
    "news";

  readonly priority =
    85;

  readonly enabled =
    true;

  readonly requiresApiKey =
    true;

  readonly timeout =
    15000;

  readonly cooldown =
    1000;

  readonly maxConcurrent =
    2;

  readonly capabilities = [

    "news",
    "current-events",
    "technology",
    "science",
    "world",
    "business",

  ] as const;

  private readonly endpoint =
    "https://newsapi.org/v2/everything";

  canSearch(
    query: string,
  ): boolean {

    return query.trim().length > 0;

  }

  async search(
    query: string,
  ): Promise<KnowledgeResult[]> {

    const apiKey =
      config.newsApiKey;

    if (!apiKey) {

      throw new Error(
        "News API key missing.",
      );

    }

    const response =
      await fetch(

        `${this.endpoint}?q=${encodeURIComponent(
          query,
        )}&language=en&sortBy=publishedAt&pageSize=10&apiKey=${apiKey}`,

      );

    if (!response.ok) {

      throw new Error(
        `News ${response.status}`,
      );

    }

    const json =
      await response.json();

    return (json.articles ?? []).map(
      (article: any): KnowledgeResult => ({

        id:
          crypto.randomUUID(),

        title:
          article.title,

        content:
          article.description ??
          "",

        url:
          article.url,

        source:
          article.source?.name ??
          "News",

        confidence:
          0.95,

        timestamp:
          article.publishedAt,

        metadata: {

          image:
            article.urlToImage,

          author:
            article.author,

        },

      }),

    );

  }

}