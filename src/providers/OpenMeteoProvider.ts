/**
 * ==========================================================
 * LÉLU
 * OPEN METEO PROVIDER
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";

export default class OpenMeteoProvider implements Provider {

  readonly name =
    "open-meteo";

  readonly category = "weather";

  readonly priority = 82;

  readonly enabled = true;

  readonly requiresApiKey = false;

  readonly timeout = 10000;

  readonly cooldown = 500;

  readonly maxConcurrent = 3;

  readonly capabilities = ["weather", "forecast", "location"] as const;

  canSearch(query: string): boolean {
    return query.trim().length > 0;
  }

  async search(
    query: string,
  ): Promise<KnowledgeResult[]> {

    const geo =
      await fetch(

        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
          query,
        )}&count=1&language=en&format=json`,

      );

    if (!geo.ok) {

      throw new Error(
        `OpenMeteo Geocoding ${geo.status}`,
      );

    }

    const geoJson =
      await geo.json();

    const place =
      geoJson.results?.[0];

    if (!place) {

      return [];

    }

    const weather =
      await fetch(

        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,rain,showers,snowfall,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m`,

      );

    if (!weather.ok) {

      throw new Error(
        `OpenMeteo ${weather.status}`,
      );

    }

    const json =
      await weather.json();

    return [

      {

        id:
          `${place.name}-${place.latitude}-${place.longitude}`,

        title:
          `${place.name} Weather`,

        content:
          JSON.stringify(
            json.current,
          ),

        url:
          "https://open-meteo.com/",

        source:
          "Open-Meteo",

        confidence:
          0.98,

        timestamp:
          new Date().toISOString(),

        metadata: {

          city:
            place.name,

          country:
            place.country,

          latitude:
            place.latitude,

          longitude:
            place.longitude,

          weather:
            json.current,

        },

      },

    ];

  }

}