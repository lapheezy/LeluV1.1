/**
 * ==========================================================
 * LÉLU
 * NOAA / US NATIONAL WEATHER SERVICE PROVIDER
 *
 * Key-less, and the authoritative source for US forecasts and
 * active weather alerts — which Open-Meteo does not carry.
 *
 * COVERAGE IS DELIBERATELY BOUNDED: api.weather.gov serves the
 * United States and its territories only. A query about
 * anywhere else is declined here rather than answered wrongly,
 * so the resolver falls through to Open-Meteo instead of this
 * provider returning an authoritative-looking empty result.
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";
import { endpoint } from "../core/Endpoints";

interface Point {
  lat: number;
  lon: number;
}

export default class NOAAProvider implements Provider {
  readonly name = "noaa";
  readonly category = "weather";
  readonly priority = 80;
  readonly enabled = true;
  readonly requiresApiKey = false;
  readonly timeout = 15000;
  readonly cooldown = 500;
  readonly maxConcurrent = 2;
  readonly capabilities = ["weather", "forecast", "alerts", "united-states"] as const;

  // api.weather.gov requires a User-Agent identifying the caller and
  // returns 403 without one.
  private readonly headers = {
    "User-Agent": "LELU/1.0 (https://github.com/lapheezy/LeluV1.1)",
    Accept: "application/geo+json",
  };

  canSearch(query: string): boolean {
    return query.trim().length > 0;
  }

  /**
   * Candidate place names to try, in order.
   *
   * The Open-Meteo geocoder matches place NAMES, not free text: "Denver"
   * resolves, "Denver Colorado" returns nothing, and "weather in Denver"
   * returns nothing. Callers hand this provider a question, so passing it
   * through unchanged silently produced zero results for a location that
   * resolves perfectly well — which read as "no forecast available"
   * rather than "the query was never understood".
   */
  private candidates(query: string): string[] {
    const cleaned = query
      .toLowerCase()
      .replace(
        /\b(what(?:'s| is)?|how|is|it|the|current|today'?s?|tomorrow'?s?|right now|now|weather|forecast|temperature|temp|conditions|climate|rain|snow|wind|hot|cold|warm|in|at|for|of|near|around|like|there)\b/g,
        " ",
      )
      .replace(/[?!.]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const base = cleaned || query.trim();
    const words = base.split(" ").filter(Boolean);

    const out = [
      base,
      // "denver colorado" → "denver, colorado": the comma form is what the
      // geocoder accepts for a place-plus-region pair.
      words.length >= 2 ? `${words.slice(0, -1).join(" ")}, ${words[words.length - 1]}` : "",
      words[0] ?? "",
      query.trim(),
    ];
    return [...new Set(out.filter((c) => c.length > 1))];
  }

  private async geocode(query: string): Promise<{ point: Point; label: string } | null> {
    // Reuse the geocoder the rest of the project already uses rather than
    // introducing a second one with different behaviour.
    for (const candidate of this.candidates(query)) {
      const url =
        `${endpoint("openMeteoGeocoding")}/v1/search?name=${encodeURIComponent(candidate)}` +
        `&count=1&language=en&format=json`;
      const response = await fetch(url, { signal: AbortSignal.timeout(this.timeout) });
      if (!response.ok) continue;
      const data = await response.json();
      const place = data.results?.[0];
      if (!place) continue;
      return {
        point: { lat: place.latitude, lon: place.longitude },
        label: [place.name, place.admin1, place.country].filter(Boolean).join(", "),
      };
    }
    return null;
  }

  async search(query: string): Promise<KnowledgeResult[]> {
    const located = await this.geocode(query);
    if (!located) return [];

    const { point, label } = located;
    const pointsUrl = `${endpoint("noaa")}/points/${point.lat.toFixed(4)},${point.lon.toFixed(4)}`;
    const pointsRes = await fetch(pointsUrl, {
      headers: this.headers,
      signal: AbortSignal.timeout(this.timeout),
    });

    // 404 from /points is NOAA's way of saying "outside our coverage".
    // That is a real answer, not a failure: return nothing and let the
    // global provider handle it.
    if (pointsRes.status === 404) return [];
    if (!pointsRes.ok) {
      throw new Error(`NOAA ${pointsRes.status}: ${(await pointsRes.text()).slice(0, 200)}`);
    }

    const points = await pointsRes.json();
    const forecastUrl = points.properties?.forecast;
    const results: KnowledgeResult[] = [];

    if (forecastUrl) {
      const forecastRes = await fetch(forecastUrl, {
        headers: this.headers,
        signal: AbortSignal.timeout(this.timeout),
      });
      if (forecastRes.ok) {
        const forecast = await forecastRes.json();
        for (const period of (forecast.properties?.periods ?? []).slice(0, 6)) {
          results.push({
            id: `noaa-forecast-${period.number}`,
            title: `${label} — ${period.name}`,
            content:
              `${period.detailedForecast ?? period.shortForecast}` +
              ` Temperature ${period.temperature}°${period.temperatureUnit},` +
              ` wind ${period.windSpeed ?? "unknown"} ${period.windDirection ?? ""}.`.trimEnd(),
            url: `${endpoint("openstreetmap")}/?mlat=${point.lat}&mlon=${point.lon}`,
            source: "NOAA / US National Weather Service",
            confidence: 0.99,
            timestamp: period.startTime,
            metadata: {
              temperature: period.temperature,
              unit: period.temperatureUnit,
              isDaytime: period.isDaytime,
              shortForecast: period.shortForecast,
            },
          });
        }
      }
    }

    // Active alerts are the part with real urgency, so they lead.
    const alertsRes = await fetch(
      `${endpoint("noaa")}/alerts/active?point=${point.lat.toFixed(4)},${point.lon.toFixed(4)}`,
      { headers: this.headers, signal: AbortSignal.timeout(this.timeout) },
    );
    if (alertsRes.ok) {
      const alerts = await alertsRes.json();
      const alertResults = (alerts.features ?? []).map((feature: any): KnowledgeResult => {
        const p = feature.properties ?? {};
        return {
          id: `noaa-alert-${feature.id}`,
          title: `⚠ ${p.event ?? "Weather alert"} — ${p.areaDesc ?? label}`,
          content: `${p.headline ?? ""} ${p.description ?? ""}`.trim().slice(0, 4000),
          url: p.uri ?? "",
          source: "NOAA / NWS Alerts",
          confidence: 1,
          timestamp: p.effective ?? p.sent,
          metadata: {
            severity: p.severity ?? null,
            urgency: p.urgency ?? null,
            certainty: p.certainty ?? null,
            expires: p.expires ?? null,
          },
        };
      });
      results.unshift(...alertResults);
    }

    return results;
  }
}
