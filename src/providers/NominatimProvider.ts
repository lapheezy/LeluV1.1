/**
 * ==========================================================
 * LÉLU
 * NOMINATIM PROVIDER
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";

export default class NominatimProvider implements Provider {

  readonly name =
    "nominatim";

  readonly category = "geography";

  readonly priority = 80;

  readonly enabled = true;

  readonly requiresApiKey = false;

  readonly timeout = 10000;

  readonly cooldown = 500;

  readonly maxConcurrent = 3;

  readonly capabilities = ["geography", "location", "map", "places"] as const;

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

    url.searchParams.set(
      "addressdetails",
      "1",
    );

    const response =
      await fetch(
        url.toString(),
        {

          headers: {

            Accept:
              "application/json",

            "User-Agent":
              "LeluAI/1.0",

          },

        },
      );

    if (!response.ok) {

      throw new Error(

        `Nominatim ${response.status}`,

      );

    }

    const json =
      await response.json();

    return (json ?? []).map(
      (place: any): KnowledgeResult => ({
        id: String(place.place_id ?? crypto.randomUUID()),
        title: place.display_name,
        content: `${place.lat}, ${place.lon}`,
        url: `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}`,
        source: "Nominatim",
        confidence: 0.96,
        timestamp: new Date().toISOString(),
        metadata: {
          latitude: Number(place.lat),
          longitude: Number(place.lon),
          category: place.category,
          type: place.type,
          importance: place.importance,
          address: place.address,
          osmId: place.osm_id,
          osmType: place.osm_type,
        },
      }),
    );

  }

}