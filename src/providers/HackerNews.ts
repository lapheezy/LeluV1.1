/**
 * ==========================================================
 * LÉLU
 * HACKER NEWS PROVIDER
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";

export default class HackerNewsProvider implements Provider {

  readonly name = "hackernews";

  readonly category = "news";

  readonly priority = 70;

  readonly enabled = true;

  readonly requiresApiKey = false;

  readonly timeout = 10000;

  readonly cooldown = 500;

  readonly maxConcurrent = 3;

  readonly capabilities = ["news", "technology", "developer", "startups"] as const;

  private readonly endpoint =
    "https://hn.algolia.com/api/v1/search";

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
        )}&tags=story`,

      );

    if (!response.ok) {

      throw new Error(

        `Hacker News ${response.status}`,

      );

    }

    const json =
      await response.json();

    return (json.hits ?? []).map(
      (story: any): KnowledgeResult => ({
        id: String(story.objectID ?? crypto.randomUUID()),
        title: story.title ?? "Untitled",
        content: story.comment_text ?? story.story_text ?? "",
        url: story.url,
        source: "HackerNews",
        confidence: 0.88,
        timestamp: story.created_at,
        metadata: {
          author: story.author,
          score: story.points ?? 0,
        },
      }),
    );

  }

}