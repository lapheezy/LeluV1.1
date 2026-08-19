/**
 * ==========================================================
 * LÉLU
 * WIKIMEDIA PROVIDER
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";

export default class WikimediaProvider implements Provider {

  readonly name = "wikimedia";

  readonly category = "media";

  readonly priority = 74;

  readonly enabled = true;

  readonly requiresApiKey = false;

  readonly timeout = 10000;

  readonly cooldown = 500;

  readonly maxConcurrent = 3;

  readonly capabilities = ["media", "image", "commons", "knowledge"] as const;

  private readonly endpoint =
    "https://commons.wikimedia.org/w/api.php";

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
      "query",
    );

    url.searchParams.set(
      "generator",
      "search",
    );

    url.searchParams.set(
      "gsrsearch",
      query,
    );

    url.searchParams.set(
      "gsrlimit",
      "10",
    );

    url.searchParams.set(
      "prop",
      "imageinfo|info",
    );

    url.searchParams.set(
      "iiprop",
      "url",
    );

    url.searchParams.set(
      "inprop",
      "url",
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
        `Wikimedia ${response.status}`,
      );

    }

    const json =
      await response.json();

    const pages =
      Object.values(
        json.query?.pages ?? {},
      ) as any[];

    return pages.map((page): KnowledgeResult => ({
      id: String(page.pageid ?? page.title),
      title: page.title,
      content: page.title,
      url: page.fullurl ?? page.imageinfo?.[0]?.descriptionurl ?? "",
      source: "Wikimedia Commons",
      confidence: 0.92,
      timestamp: new Date().toISOString(),
      metadata: {
        pageId: page.pageid,
        image: page.imageinfo?.[0]?.url,
      },
    }));

  }

}