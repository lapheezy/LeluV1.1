import { BaseProvider } from "./BaseProvider";

import type { KnowledgeResult } from "./Provider";

export class WikipediaProvider extends BaseProvider {
  readonly name = "wikipedia";

  readonly category = "knowledge";

  readonly priority = 77;

  readonly enabled = true;

  readonly requiresApiKey = false;

  readonly timeout = 10000;

  readonly cooldown = 500;

  readonly maxConcurrent = 3;

  readonly capabilities = ["knowledge", "encyclopedia", "fact", "reference"] as const;

  canHandle(query: string): boolean {
    return query.trim().length > 0;
  }

  protected async execute(
    query: string,
  ): Promise<KnowledgeResult[]> {
    const url =
      "https://en.wikipedia.org/api/rest_v1/page/summary/" +
      encodeURIComponent(query);

    const response = await fetch(url);

    if (!response.ok) {
      return [];
    }

    const page = await response.json();

    return [
      {
        id: String(page.pageid ?? crypto.randomUUID()),
        title: page.title,
        content: page.extract,
        source: "Wikipedia",
        confidence: 0.95,
        timestamp: new Date().toISOString(),
        url: page.content_urls?.desktop?.page ?? "",
        metadata: {
          extract: page.extract,
        },
      },
    ];
  }
}