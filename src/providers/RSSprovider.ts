// src/providers/RSSProvider.ts

import { BaseProvider } from "./BaseProvider";
import type { KnowledgeResult } from "./Provider";

export class RSSProvider extends BaseProvider {
  readonly name = "rss";

  readonly category = "news";

  readonly priority = 73;

  readonly enabled = true;

  readonly requiresApiKey = false;

  readonly timeout = 10000;

  readonly cooldown = 500;

  readonly maxConcurrent = 3;

  readonly capabilities = ["news", "rss", "feed", "current-events"] as const;

  private readonly feeds = [
    "https://feeds.arstechnica.com/arstechnica/index",
    "https://techcrunch.com/feed/",
    "https://hnrss.org/frontpage",
    "https://www.nasa.gov/rss/dyn/breaking_news.rss",
  ];

  canHandle(query: string): boolean {
    const q = query.toLowerCase();

    return (
      q.includes("news") ||
      q.includes("latest") ||
      q.includes("today") ||
      q.includes("update") ||
      q.includes("headline")
    );
  }

  protected async execute(
    query: string,
  ): Promise<KnowledgeResult[]> {
    const results: KnowledgeResult[] = [];

    for (const feed of this.feeds) {
      try {
        const response = await fetch(feed);

        if (!response.ok) {
          continue;
        }

        const xml = await response.text();

        results.push({
          id: feed,
          title: feed,
          content: `RSS feed loaded for "${query}"`,
          source: feed,
          confidence: 0.8,
          timestamp: new Date().toISOString(),
          url: feed,
          metadata: { content: xml },
        });
      } catch {
        continue;
      }
    }

    return results;
  }
}