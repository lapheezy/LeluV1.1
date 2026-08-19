/**
 * ==========================================================
 * LÉLU
 * OPENSTREETMAP PROVIDER
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";

export default class OpenStreetMapProvider implements Provider {

  readonly name =
    "openstreetmap";

  readonly category = "geography";

  readonly priority = 79;

  readonly enabled = true;

  readonly requiresApiKey = false;

  readonly timeout = 10000;

  readonly cooldown = 500;

  readonly maxConcurrent = 3;

  readonly capabilities = ["geography", "map", "places", "location"] as const;

  private readonly endpoint =
    "https://nominatim.openstreetmap.org/search";

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
      "q",
      query,
    );

    url.searchParams.set(
      "format",
      "jsonv2",
    );

    url.searchParams.set(
      "limit",
      "10",
    );

    const response =
      await fetch(
        url.toString(),
        {

          headers: {

            Accept:
              "application/json",

          },

        },

      );

    if (!response.ok) {

      throw new Error(

        `OpenStreetMap ${response.status}`,

      );

    }

    const json =
      await response.json();

    return (json ?? []).map(
      (place: any): KnowledgeResult => ({
        id: String(place.osm_id ?? crypto.randomUUID()),
        title: place.display_name,
        content: `${place.lat}, ${place.lon}`,
        url: `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}`,
        source: "OpenStreetMap",
        confidence: 0.95,
        timestamp: new Date().toISOString(),
        metadata: {
          latitude: Number(place.lat),
          longitude: Number(place.lon),
          osmId: place.osm_id,
          osmType: place.osm_type,
          category: place.category,
          type: place.type,
        },
      }),
    );

  }

}