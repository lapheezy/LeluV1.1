/**
 * ==========================================================
 * LÉLU
 * NASA PROVIDER
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";

export default class NASAProvider implements Provider {

  readonly name =
    "nasa";

  readonly category = "science";

  readonly priority = 85;

  readonly enabled = true;

  readonly requiresApiKey = false;

  readonly timeout = 10000;

  readonly cooldown = 500;

  readonly maxConcurrent = 3;

  readonly capabilities = ["science", "space", "astronomy", "media"] as const;

  private readonly endpoint =
    "https://images-api.nasa.gov/search";

  canSearch(query: string): boolean {
    return query.trim().length > 0;
  }

  async search(
    query: string,
  ): Promise<KnowledgeResult[]> {

    const response =
      await fetch(

        `${this.endpoint}?q=${encodeURIComponent(
          query,
        )}&media_type=image,video`,

      );

    if (!response.ok) {

      throw new Error(

        `NASA ${response.status}`,

      );

    }

    const json =
      await response.json();

    return (json.collection?.items ?? []).map(
      (item: any): KnowledgeResult => {

        const data =
          item.data?.[0] ?? {};

        const links =
          item.links?.[0];

        return {
          id: data.nasa_id ?? crypto.randomUUID(),
          title: data.title ?? "NASA",
          content: data.description ?? "",
          url: links?.href ?? "",
          source: "NASA",
          confidence: 0.99,
          timestamp: data.date_created,
          metadata: {
            nasaId: data.nasa_id,
            center: data.center,
            keywords: data.keywords ?? [],
            mediaType: data.media_type,
          },
        };

      },

    );

  }

}