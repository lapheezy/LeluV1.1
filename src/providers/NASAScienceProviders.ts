/**
 * ==========================================================
 * LÉLU
 * NASA SCIENCE PROVIDERS
 *
 * The NASA open-API family beyond the image library that
 * NASAProvider already covers: APOD, near-Earth objects,
 * space weather (DONKI), natural events (EONET), full-disc
 * Earth imagery (EPIC), the exoplanet archive, the Open
 * Science Data Repository, and InSight's Mars weather.
 *
 * They live in one module because they are the same provider
 * shape differing only in path, query and how a record maps
 * onto a KnowledgeResult — eight near-identical files would
 * hide that rather than express it.
 *
 * KEYS: these accept NASA's shared `DEMO_KEY` without
 * registration, so they work unconfigured but rate-limited.
 * Set NASA_API_KEY to lift the limit. EONET and the exoplanet
 * archive take no key at all.
 * ==========================================================
 */

import type Provider from "./Provider";
import type { KnowledgeResult } from "./Provider";
import { endpoint } from "../core/Endpoints";
import { nasaApiKey } from "../core/resolveEnv";

/** Shared behaviour: timeouts, JSON fetch, error shape. */
abstract class NASABaseProvider implements Provider {
  abstract readonly name: string;
  abstract readonly capabilities: readonly string[];
  readonly category = "science";
  readonly priority = 85;
  readonly enabled = true;
  readonly requiresApiKey = false;
  readonly timeout = 15000;
  readonly cooldown = 1000;
  readonly maxConcurrent = 2;

  canSearch(query: string): boolean {
    return query.trim().length > 0;
  }

  protected async json(url: string): Promise<any> {
    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeout) });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`${this.name} ${response.status}: ${body.slice(0, 200)}`);
    }
    return response.json();
  }

  /** ISO date N days before today, which most NASA feeds window on. */
  protected daysAgo(days: number): string {
    return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
  }

  protected today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  abstract search(query: string): Promise<KnowledgeResult[]>;
}

/* ---------------- Astronomy Picture of the Day ---------------- */

export class NASAApodProvider extends NASABaseProvider {
  readonly name = "nasa-apod";
  readonly capabilities = ["astronomy", "space", "media", "daily"] as const;

  async search(_query: string): Promise<KnowledgeResult[]> {
    // APOD has no search parameter — it serves a dated entry. A recent
    // window is returned so the caller has material to reason over
    // rather than a single day that may not relate to the question.
    const url =
      `${endpoint("nasaApod")}?api_key=${encodeURIComponent(nasaApiKey())}` +
      `&start_date=${this.daysAgo(6)}&end_date=${this.today()}`;
    const data = await this.json(url);
    const entries = Array.isArray(data) ? data : [data];

    return entries
      .filter((entry: any) => entry && entry.title)
      .map((entry: any): KnowledgeResult => ({
        id: `apod-${entry.date}`,
        title: entry.title,
        content: entry.explanation ?? "",
        url: entry.hdurl ?? entry.url ?? "",
        source: "NASA APOD",
        confidence: 0.99,
        timestamp: entry.date,
        metadata: {
          mediaType: entry.media_type,
          copyright: entry.copyright ?? null,
          thumbnail: entry.thumbnail_url ?? entry.url ?? null,
        },
      }))
      .reverse();
  }
}

/* ---------------- Near-Earth objects ---------------- */

export class NASANeoProvider extends NASABaseProvider {
  readonly name = "nasa-neo";
  readonly capabilities = ["astronomy", "space", "asteroids", "hazards"] as const;

  async search(_query: string): Promise<KnowledgeResult[]> {
    const url =
      `${endpoint("nasaNeo")}/feed?start_date=${this.today()}` +
      `&end_date=${this.today()}&api_key=${encodeURIComponent(nasaApiKey())}`;
    const data = await this.json(url);
    const byDate: Record<string, any[]> = data.near_earth_objects ?? {};

    return Object.entries(byDate)
      .flatMap(([date, objects]) =>
        (objects ?? []).map((neo: any): KnowledgeResult => {
          const approach = neo.close_approach_data?.[0];
          const diameter = neo.estimated_diameter?.meters;
          const size =
            diameter
              ? `${Math.round(diameter.estimated_diameter_min)}–${Math.round(diameter.estimated_diameter_max)} m`
              : "size unknown";
          const missKm = approach?.miss_distance?.kilometers
            ? `${Math.round(Number(approach.miss_distance.kilometers)).toLocaleString()} km`
            : "distance unknown";
          return {
            id: `neo-${neo.id}`,
            title: `${neo.name} — ${size}${neo.is_potentially_hazardous_asteroid ? " (potentially hazardous)" : ""}`,
            content:
              `Close approach ${approach?.close_approach_date_full ?? date} at ${missKm}, ` +
              `relative velocity ${approach?.relative_velocity?.kilometers_per_hour
                ? `${Math.round(Number(approach.relative_velocity.kilometers_per_hour)).toLocaleString()} km/h`
                : "unknown"}. Estimated diameter ${size}.`,
            url: neo.nasa_jpl_url ?? "",
            source: "NASA NeoWs",
            confidence: 0.99,
            timestamp: date,
            metadata: {
              hazardous: Boolean(neo.is_potentially_hazardous_asteroid),
              magnitude: neo.absolute_magnitude_h,
              missDistanceKm: approach?.miss_distance?.kilometers ?? null,
            },
          };
        }),
      )
      .sort((a, b) => Number(a.metadata?.missDistanceKm ?? 0) - Number(b.metadata?.missDistanceKm ?? 0));
  }
}

/* ---------------- Space weather (DONKI) ---------------- */

export class NASADonkiProvider extends NASABaseProvider {
  readonly name = "nasa-donki";
  readonly capabilities = ["space-weather", "solar", "geomagnetic", "science"] as const;

  async search(query: string): Promise<KnowledgeResult[]> {
    // DONKI splits by event type; the question selects which feed to
    // read rather than fanning out across all of them.
    const text = query.toLowerCase();
    const type = text.includes("flare")
      ? "FLR"
      : text.includes("geomagnetic") || text.includes("storm")
        ? "GST"
        : text.includes("cme") || text.includes("coronal")
          ? "CME"
          : "notifications";

    const url =
      `${endpoint("nasaDonki")}/${type}?startDate=${this.daysAgo(30)}` +
      `&endDate=${this.today()}&api_key=${encodeURIComponent(nasaApiKey())}`;
    const data = await this.json(url);
    const events = Array.isArray(data) ? data : [];

    return events.slice(0, 25).map((event: any, index: number): KnowledgeResult => {
      const time =
        event.beginTime ?? event.startTime ?? event.messageIssueTime ?? event.eventTime ?? "";
      const body =
        event.messageBody ??
        [
          event.classType ? `Class ${event.classType}.` : "",
          event.sourceLocation ? `Source ${event.sourceLocation}.` : "",
          event.note ?? "",
        ]
          .filter(Boolean)
          .join(" ");
      return {
        id: `donki-${event.flrID ?? event.gstID ?? event.activityID ?? event.messageID ?? index}`,
        title: event.messageType ?? `${type} event${event.classType ? ` ${event.classType}` : ""}`,
        content: String(body || "NASA DONKI space-weather event.").slice(0, 4000),
        url: event.link ?? event.messageURL ?? "",
        source: "NASA DONKI",
        confidence: 0.97,
        timestamp: time,
        metadata: { eventType: type, classType: event.classType ?? null },
      };
    });
  }
}

/* ---------------- Natural events (EONET) ---------------- */

export class NASAEonetProvider extends NASABaseProvider {
  readonly name = "nasa-eonet";
  readonly capabilities = ["natural-events", "wildfire", "storms", "volcano", "earth"] as const;

  async search(_query: string): Promise<KnowledgeResult[]> {
    const data = await this.json(`${endpoint("nasaEonet")}/events?status=open&limit=40`);
    return (data.events ?? []).map((event: any): KnowledgeResult => {
      const geometry = event.geometry?.[event.geometry.length - 1];
      const coords = Array.isArray(geometry?.coordinates) ? geometry.coordinates : null;
      return {
        id: `eonet-${event.id}`,
        title: event.title,
        content:
          `${event.description || event.title}. Category: ` +
          `${(event.categories ?? []).map((c: any) => c.title).join(", ") || "uncategorised"}.` +
          (coords ? ` Location ${Number(coords[1]).toFixed(2)}, ${Number(coords[0]).toFixed(2)}.` : ""),
        url: event.sources?.[0]?.url ?? "",
        source: "NASA EONET",
        confidence: 0.98,
        timestamp: geometry?.date ?? "",
        metadata: {
          categories: (event.categories ?? []).map((c: any) => c.title),
          lat: coords ? Number(coords[1]) : null,
          lon: coords ? Number(coords[0]) : null,
          closed: event.closed ?? null,
        },
      };
    });
  }
}

/* ---------------- EPIC full-disc Earth imagery ---------------- */

export class NASAEpicProvider extends NASABaseProvider {
  readonly name = "nasa-epic";
  readonly capabilities = ["earth", "imagery", "space", "media"] as const;

  async search(_query: string): Promise<KnowledgeResult[]> {
    const data = await this.json(
      `${endpoint("nasaEpic")}/api/natural?api_key=${encodeURIComponent(nasaApiKey())}`,
    );
    const images = Array.isArray(data) ? data : [];

    return images.slice(0, 12).map((image: any): KnowledgeResult => {
      // EPIC archive paths are date-partitioned: .../archive/natural/YYYY/MM/DD/png/NAME.png
      const day = String(image.date ?? "").slice(0, 10).replace(/-/g, "/");
      const href = day
        ? `${endpoint("nasaEpic")}/archive/natural/${day}/png/${image.image}.png` +
          `?api_key=${encodeURIComponent(nasaApiKey())}`
        : "";
      return {
        id: `epic-${image.identifier ?? image.image}`,
        title: `EPIC full-disc Earth — ${image.date ?? "unknown date"}`,
        content: image.caption ?? "DSCOVR/EPIC natural-colour image of the full Earth disc.",
        url: href,
        source: "NASA EPIC",
        confidence: 0.99,
        timestamp: image.date,
        metadata: {
          centroid: image.centroid_coordinates ?? null,
          lat: image.centroid_coordinates?.lat ?? null,
          lon: image.centroid_coordinates?.lon ?? null,
        },
      };
    });
  }
}

/* ---------------- Exoplanet archive ---------------- */

export class NASAExoplanetProvider extends NASABaseProvider {
  readonly name = "nasa-exoplanet";
  readonly capabilities = ["astronomy", "exoplanets", "science"] as const;

  async search(query: string): Promise<KnowledgeResult[]> {
    // The archive speaks ADQL over TAP. Quotes are stripped from the
    // search term because they would terminate the literal and turn a
    // question into a syntax error.
    const term = query.replace(/['"\\]/g, "").trim().slice(0, 80);
    const where = term ? ` where upper(pl_name) like upper('%${term}%')` : "";
    const adql =
      `select top 25 pl_name,hostname,discoverymethod,disc_year,pl_orbper,pl_rade,sy_dist` +
      ` from ps${where} order by disc_year desc`;
    const url =
      `${endpoint("nasaExoplanet")}/TAP/sync?query=${encodeURIComponent(adql)}&format=json`;

    const rows = await this.json(url);
    return (Array.isArray(rows) ? rows : []).map((row: any): KnowledgeResult => ({
      id: `exoplanet-${row.pl_name}`,
      title: row.pl_name,
      content:
        `${row.pl_name} orbits ${row.hostname}. Discovered ${row.disc_year ?? "year unknown"} ` +
        `via ${row.discoverymethod ?? "unknown method"}.` +
        (row.pl_orbper ? ` Orbital period ${Number(row.pl_orbper).toFixed(2)} days.` : "") +
        (row.pl_rade ? ` Radius ${Number(row.pl_rade).toFixed(2)} Earth radii.` : "") +
        (row.sy_dist ? ` System distance ${Number(row.sy_dist).toFixed(1)} parsecs.` : ""),
      url: `${endpoint("nasaExoplanet")}/overview/${encodeURIComponent(row.pl_name ?? "")}`,
      source: "NASA Exoplanet Archive",
      confidence: 0.98,
      timestamp: row.disc_year ? `${row.disc_year}-01-01` : undefined,
      metadata: {
        host: row.hostname,
        method: row.discoverymethod,
        distanceParsecs: row.sy_dist ?? null,
      },
    }));
  }
}

/* ---------------- Open Science Data Repository ---------------- */

export class NASAOsdrProvider extends NASABaseProvider {
  readonly name = "nasa-osdr";
  readonly capabilities = ["biology", "science", "spaceflight", "research"] as const;

  async search(query: string): Promise<KnowledgeResult[]> {
    const data = await this.json(
      `${endpoint("nasaOsdr")}/files/search?term=${encodeURIComponent(query)}&size=20`,
    );
    const hits = data?.hits?.hits ?? data?.results ?? [];
    return (Array.isArray(hits) ? hits : []).map((hit: any, index: number): KnowledgeResult => {
      const source = hit._source ?? hit;
      const accession = source["Study Identifier"] ?? source.accession ?? `osd-${index}`;
      return {
        id: `osdr-${accession}`,
        title: source["Study Title"] ?? source.title ?? String(accession),
        content: source["Study Description"] ?? source.description ?? "NASA OSDR study record.",
        url: `https://osdr.nasa.gov/bio/repo/data/studies/${encodeURIComponent(String(accession))}`,
        source: "NASA OSDR",
        confidence: 0.95,
        metadata: {
          organism: source.organism ?? source["Study Organism"] ?? null,
          assay: source["Study Assay Technology Type"] ?? null,
        },
      };
    });
  }
}

/* ---------------- InSight Mars weather ---------------- */

export class NASAInsightProvider extends NASABaseProvider {
  readonly name = "nasa-insight";
  readonly capabilities = ["mars", "weather", "space", "science"] as const;

  async search(_query: string): Promise<KnowledgeResult[]> {
    const data = await this.json(
      `${endpoint("nasaInsight")}/?api_key=${encodeURIComponent(nasaApiKey())}&feedtype=json&ver=1.0`,
    );
    const sols: string[] = data.sol_keys ?? [];

    // The InSight lander is retired, so this feed is a fixed historical
    // record rather than current conditions. Saying so in the content is
    // the difference between a true answer and a confidently wrong one.
    return sols.map((sol): KnowledgeResult => {
      const entry = data[sol] ?? {};
      const temp = entry.AT;
      const wind = entry.HWS;
      const pressure = entry.PRE;
      return {
        id: `insight-sol-${sol}`,
        title: `Mars weather — sol ${sol}`,
        content:
          `Elysium Planitia, sol ${sol} (${entry.First_UTC?.slice(0, 10) ?? "date unknown"}). ` +
          (temp ? `Air temperature ${temp.av?.toFixed(1)}°C (min ${temp.mn?.toFixed(1)}, max ${temp.mx?.toFixed(1)}). ` : "") +
          (wind ? `Wind ${wind.av?.toFixed(1)} m/s. ` : "") +
          (pressure ? `Pressure ${pressure.av?.toFixed(1)} Pa. ` : "") +
          "Recorded by the InSight lander, whose mission ended in December 2022 — " +
          "this is an archival measurement, not current Mars weather.",
        url: "https://mars.nasa.gov/insight/weather/",
        source: "NASA InSight",
        confidence: 0.96,
        timestamp: entry.First_UTC,
        metadata: {
          sol,
          season: entry.Season ?? null,
          archival: true,
          temperatureC: temp?.av ?? null,
        },
      };
    });
  }
}
