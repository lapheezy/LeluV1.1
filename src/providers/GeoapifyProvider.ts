/**
 * ==========================================================
 * LÉLU
 * GEOAPIFY PROVIDER (geocoding + places)
 *
 * A keyed geocoder alongside the key-less Nominatim one.
 * Nominatim's public instance asks callers to keep to roughly
 * one request a second; Geoapify is the option for when that
 * ceiling is the constraint. It stays out of the chain unless
 * GEOAPIFY_API_KEY is set, so Nominatim remains the default.
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";
import { endpoint } from "../core/Endpoints";
import { knowledgeAvailable, knowledgeFetch } from "./aiRelay";

export default class GeoapifyProvider implements Provider {
  readonly name = "geoapify";
  readonly category = "geo";
  readonly priority = 84;
  readonly enabled = true;
  readonly requiresApiKey = true;
  readonly timeout = 15000;
  readonly cooldown = 500;
  readonly maxConcurrent = 2;
  readonly capabilities = ["geocoding", "places", "location", "geo"] as const;

  canSearch(query: string): boolean {
    // The key is on the server (knowledge relay); until it says whether it
    // holds one, Geoapify is tried and an unconfigured relay answers 503.
    return query.trim().length > 0 && knowledgeAvailable("geoapify") !== false;
  }

  async search(query: string): Promise<KnowledgeResult[]> {
    // No key in the browser: the runtime key bridge used to publish it into
    // the served page. The server appends it (plugins/aiProxyApi.ts).
    const url = `${endpoint("geoapify")}/v1/geocode/search?text=${encodeURIComponent(query)}&limit=8&format=json`;

    const response = await knowledgeFetch("geoapify", url, { signal: AbortSignal.timeout(this.timeout) });
    if (response.status === 503) return [];
    if (!response.ok) {
      throw new Error(`geoapify ${response.status}: ${(await response.text()).slice(0, 200)}`);
    }

    const data = await response.json();
    return (data.results ?? []).map((place: any, index: number): KnowledgeResult => ({
      id: `geoapify-${place.place_id ?? index}`,
      title: place.formatted ?? place.address_line1 ?? query,
      content:
        `${place.formatted ?? ""}` +
        (place.lat !== undefined && place.lon !== undefined
          ? ` — ${Number(place.lat).toFixed(5)}, ${Number(place.lon).toFixed(5)}`
          : "") +
        (place.category ? ` (${place.category})` : ""),
      url: `${endpoint("openstreetmap")}/?mlat=${place.lat}&mlon=${place.lon}`,
      source: "Geoapify",
      confidence: typeof place.rank?.confidence === "number" ? place.rank.confidence : 0.9,
      metadata: {
        lat: place.lat ?? null,
        lon: place.lon ?? null,
        country: place.country ?? null,
        countryCode: place.country_code ?? null,
        state: place.state ?? null,
        city: place.city ?? null,
        resultType: place.result_type ?? null,
      },
    }));
  }
}
