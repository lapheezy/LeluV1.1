/**
 * ==========================================================
 * LÉLU — EARTH CORE · SPATIAL PROVIDER REGISTRY
 *
 * One pluggable registry of real spatial data sources. Every
 * provider declares its attribution, license, polling interval,
 * auth requirement and a fetch() that returns canonical
 * SpatialEntity objects. Providers that need a key the user has
 * not supplied are registered but report NOT_CONFIGURED — the
 * runtime never fabricates data to fill a gap.
 *
 * Sources used (all public, key-less unless noted):
 *   • adsb.lol          → live aircraft positions (CC-BY-NC? see note)
 *   • CelesTrak GP      → satellite TLEs (public, propagated ≈ positions)
 *   • USGS              → live earthquake feed (public domain)
 *   • Open-Meteo        → geocoding, reverse geocoding, current weather
 *   • Curated places    → offline fallback for geocoding
 *   • NASA FIRMS        → fires (VITE_FIRMS_API_KEY) — real VIIRS NRT
 *                         hotspots via the area CSV API, bbox-bounded
 *   • AISStream         → vessels — WebSocket bridged SERVER-SIDE by
 *                         plugins/aisBridgePlugin.ts; the key is never
 *                         in the browser bundle or any client code
 *   • OpenStreetMap     → ALPR / surveillance camera infrastructure
 *                         (FoggedLens/DeFlock tagging: camera:type=alpr,
 *                         surveillance:type=ALPR/ANPR, camera:direction…)
 *                         via the public Overpass API — key-less
 * ==========================================================
 */

import {
  earthDistanceKm,
  type DataSource,
  type GeoLocation,
  type SpatialEntity,
  type SpatialSearchResult,
} from "./EarthTypes";
import { corsFetch } from "../../providers/corsFetch";
import { publicEnvVar } from "../env/publicEnv";

/* ------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------ */

async function fetchJson(url: string, timeoutMs = 10000): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/**
 * Browser-safe variables only.
 *
 * This used to hand back the whole `import.meta.env` object, which made
 * Vite inline every VITE_* value — including the chat-provider API keys,
 * which this module has no business seeing — into the EarthProviders
 * chunk. `publicEnvVar` reads an explicit allowlist of names instead
 * (see core/env/publicEnv.ts), so only the two variables Earth actually
 * uses can reach the bundle through here. The original note about
 * needing a contiguous `import.meta.env` expression still holds, and
 * publicEnv.ts satisfies it: each name is read as its own literal
 * `import.meta.env.VITE_X` reference.
 */
function key(name: string): string | undefined {
  return publicEnvVar(name) || undefined;
}

/**
 * A provider failure with a known, honest cause — EarthCore maps the
 * hint to a DataSource status (NOT CONFIGURED / AUTH FAILED / …).
 * One provider failing this way never breaks Earth or LÉLU.
 */
export type ProviderHint =
  | "not_configured"
  | "auth_error"
  | "rate_limited"
  | "disconnected"
  | "unavailable";

export class ProviderHintError extends Error {
  hint: ProviderHint;

  constructor(hint: ProviderHint, message: string) {
    super(message);
    this.name = "ProviderHintError";
    this.hint = hint;
  }
}

async function fetchText(url: string, timeoutMs = 15000): Promise<string> {
  const res = await corsFetch(url, undefined, timeoutMs);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

/* ------------------------------------------------------------------
 * Provider contract
 * ------------------------------------------------------------------ */

export interface ProviderFetchContext {
  focus: GeoLocation | null;
  radiusKm?: number;
}

export interface SpatialProviderDef {
  id: string;
  name: string;
  provider: string;
  attribution: string;
  license?: string;
  updateIntervalMs: number;
  authRequired: boolean;
  /** False when a required key is missing → provider is NOT CONFIGURED. */
  configured: () => boolean;
  fetch: (ctx: ProviderFetchContext) => Promise<SpatialEntity[]>;
}

const registry = new Map<string, SpatialProviderDef>();
let registered = false;

export function registerProvider(def: SpatialProviderDef): void {
  registry.set(def.id, def);
}

export function getProvider(id: string): SpatialProviderDef | undefined {
  return registry.get(id);
}

export function allProviders(): SpatialProviderDef[] {
  return Array.from(registry.values());
}

/** Map a provider to its honest DataSource state. */
export function providerToSource(def: SpatialProviderDef): DataSource {
  return {
    id: def.id,
    name: def.name,
    provider: def.provider,
    attribution: def.attribution,
    license: def.license,
    updateIntervalMs: def.updateIntervalMs,
    authRequired: def.authRequired,
    status: def.configured() ? "idle" : "not_configured",
    freshnessLabel: def.configured() ? undefined : "NOT CONFIGURED",
  };
}

/* ------------------------------------------------------------------
 * Curated fallback places (offline geocoding — real coordinates)
 * ------------------------------------------------------------------ */

const FALLBACK_PLACES: Array<{ name: string; country: string; lat: number; lon: number }> = [
  { name: "New York", country: "United States", lat: 40.71, lon: -74.01 },
  { name: "Los Angeles", country: "United States", lat: 34.05, lon: -118.24 },
  { name: "Miami", country: "United States", lat: 25.76, lon: -80.19 },
  { name: "Toronto", country: "Canada", lat: 43.65, lon: -79.38 },
  { name: "Mexico City", country: "Mexico", lat: 19.43, lon: -99.13 },
  { name: "São Paulo", country: "Brazil", lat: -23.55, lon: -46.63 },
  { name: "Buenos Aires", country: "Argentina", lat: -34.6, lon: -58.38 },
  { name: "London", country: "United Kingdom", lat: 51.51, lon: -0.13 },
  { name: "Paris", country: "France", lat: 48.86, lon: 2.35 },
  { name: "Madrid", country: "Spain", lat: 40.42, lon: -3.7 },
  { name: "Rome", country: "Italy", lat: 41.9, lon: 12.5 },
  { name: "Berlin", country: "Germany", lat: 52.52, lon: 13.4 },
  { name: "Moscow", country: "Russia", lat: 55.76, lon: 37.62 },
  { name: "Istanbul", country: "Türkiye", lat: 41.01, lon: 28.98 },
  { name: "Cairo", country: "Egypt", lat: 30.04, lon: 31.24 },
  { name: "Lagos", country: "Nigeria", lat: 6.52, lon: 3.38 },
  { name: "Nairobi", country: "Kenya", lat: -1.29, lon: 36.82 },
  { name: "Johannesburg", country: "South Africa", lat: -26.2, lon: 28.05 },
  { name: "Dubai", country: "United Arab Emirates", lat: 25.2, lon: 55.27 },
  { name: "Mumbai", country: "India", lat: 19.08, lon: 72.88 },
  { name: "Delhi", country: "India", lat: 28.61, lon: 77.21 },
  { name: "Bangkok", country: "Thailand", lat: 13.76, lon: 100.5 },
  { name: "Singapore", country: "Singapore", lat: 1.35, lon: 103.82 },
  { name: "Jakarta", country: "Indonesia", lat: -6.21, lon: 106.85 },
  { name: "Hong Kong", country: "China", lat: 22.32, lon: 114.17 },
  { name: "Shanghai", country: "China", lat: 31.23, lon: 121.47 },
  { name: "Beijing", country: "China", lat: 39.9, lon: 116.41 },
  { name: "Seoul", country: "South Korea", lat: 37.57, lon: 126.98 },
  { name: "Tokyo", country: "Japan", lat: 35.68, lon: 139.69 },
  { name: "Sydney", country: "Australia", lat: -33.87, lon: 151.21 },
  { name: "Auckland", country: "New Zealand", lat: -36.85, lon: 174.76 },
];

/* ------------------------------------------------------------------
 * Places — geocoding + reverse geocoding (Open-Meteo, key-less)
 * ------------------------------------------------------------------ */

interface OpenMeteoPlace {
  id?: number;
  name?: string;
  latitude?: number;
  longitude?: number;
  country?: string;
  admin1?: string;
  feature_code?: string;
  population?: number;
}

export async function searchPlaces(query: string): Promise<SpatialSearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  try {
    const data = (await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`,
    )) as { results?: OpenMeteoPlace[] };
    const results = (data.results ?? [])
      .filter((r) => typeof r.latitude === "number" && typeof r.longitude === "number" && r.name)
      .map((r, i) => ({
        id: `openmeteo-${r.id ?? i}`,
        name: r.name!,
        country: r.country,
        admin1: r.admin1,
        lat: r.latitude!,
        lon: r.longitude!,
        featureType: r.feature_code ?? "place",
        source: "Open-Meteo Geocoding",
        confidence: Math.max(0.4, 0.95 - i * 0.06),
      }));
    if (results.length > 0) return results;
  } catch {
    /* offline — fall through to curated */
  }
  // Offline fallback: curated real places (fuzzy contains match).
  const lower = q.toLowerCase();
  return FALLBACK_PLACES.filter(
    (p) => p.name.toLowerCase().includes(lower) || lower.includes(p.name.toLowerCase()),
  ).map((p, i) => ({
    id: `curated-${p.name}`,
    name: p.name,
    country: p.country,
    lat: p.lat,
    lon: p.lon,
    featureType: "city",
    source: "Curated offline dataset",
    confidence: 0.7 - i * 0.04,
  }));
}

export async function reverseGeocodePlace(
  lat: number,
  lon: number,
): Promise<{ name: string; country?: string; admin1?: string } | null> {
  try {
    const data = (await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&count=1&language=en&format=json`,
    )) as { results?: OpenMeteoPlace[] };
    const hit = data.results?.[0];
    if (hit?.name) {
      return { name: hit.name, country: hit.country, admin1: hit.admin1 };
    }
  } catch {
    /* offline */
  }
  // Offline fallback: nearest curated place.
  let best: (typeof FALLBACK_PLACES)[number] | null = null;
  let bestD = Infinity;
  for (const p of FALLBACK_PLACES) {
    const d = Math.hypot(lat - p.lat, lon - p.lon);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  if (best && bestD < 20) return { name: best.name, country: best.country };
  return null;
}

/* ------------------------------------------------------------------
 * Aircraft — adsb.lol live positions (key-less)
 * ------------------------------------------------------------------ */

interface AdsbAircraft {
  hex?: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  gs?: number;
  track?: number;
  squawk?: string;
  category?: string;
  t?: number;
}

async function fetchFlights(ctx: ProviderFetchContext): Promise<SpatialEntity[]> {
  const focus = ctx.focus;
  if (!focus) return [];
  const radiusNm = Math.min(300, Math.max(10, Math.round((ctx.radiusKm ?? 200) / 1.852)));
  const data = (await fetchJson(
    `https://api.adsb.lol/v2/point/${focus.lat.toFixed(3)}/${focus.lon.toFixed(3)}/${radiusNm}`,
  )) as { ac?: AdsbAircraft[] };
  const now = Date.now();
  return (data.ac ?? [])
    .filter((a) => typeof a.lat === "number" && typeof a.lon === "number")
    .slice(0, 220)
    .map((a) => {
      const callsign = (a.flight ?? "").trim();
      const altitude =
        typeof a.alt_baro === "number" ? a.alt_baro : a.alt_baro === "ground" ? 0 : undefined;
      return {
        id: `adsb-${a.hex ?? Math.random().toString(36).slice(2)}`,
        type: "aircraft" as const,
        name: callsign || (a.hex ? `FLIGHT ${a.hex.toUpperCase()}` : "Unknown aircraft"),
        location: { lat: a.lat!, lon: a.lon! },
        timestamp: now,
        source: "aircraft", // layer id — mergeLayerEntities keys on this
        freshness: "live" as const,
        metadata: {
          hex: a.hex,
          altitudeFt: altitude,
          groundSpeedKt: a.gs,
          trackDeg: a.track,
          squawk: a.squawk,
          category: a.category,
        },
      };
    });
}

/* ------------------------------------------------------------------
 * Satellites — CelesTrak GP TLEs, propagated (circular approx)
 * Positions are ESTIMATED and always labeled as such.
 * ------------------------------------------------------------------ */

interface CelestrakSatellite {
  OBJECT_NAME?: string;
  OBJECT_ID?: string;
  EPOCH?: string;
  MEAN_MOTION?: number;
  INCLINATION?: number;
  RA_OF_ASC_NODE?: number;
  ARG_OF_PERICENTER?: number;
  MEAN_ANOMALY?: number;
}

function propagateSubPoint(sat: CelestrakSatellite, now: number): GeoLocation | null {
  if (
    !sat.EPOCH ||
    typeof sat.MEAN_MOTION !== "number" ||
    typeof sat.INCLINATION !== "number" ||
    typeof sat.RA_OF_ASC_NODE !== "number" ||
    typeof sat.ARG_OF_PERICENTER !== "number" ||
    typeof sat.MEAN_ANOMALY !== "number"
  ) {
    return null;
  }
  const epochMs = Date.parse(sat.EPOCH.replace(" ", "T") + "Z");
  if (Number.isNaN(epochMs)) return null;
  const mu = 398600.4418; // km³/s²
  const n = (sat.MEAN_MOTION * 2 * Math.PI) / 86400; // rad/s
  const a = Math.cbrt(mu / (n * n));
  const i = (sat.INCLINATION * Math.PI) / 180;
  const raan = (sat.RA_OF_ASC_NODE * Math.PI) / 180;
  const w = (sat.ARG_OF_PERICENTER * Math.PI) / 180;
  const M0 = (sat.MEAN_ANOMALY * Math.PI) / 180;
  const M = M0 + n * ((now - epochMs) / 1000);
  const u = M + w;
  const cosU = Math.cos(u);
  const sinU = Math.sin(u);
  const x = a * (Math.cos(raan) * cosU - Math.sin(raan) * sinU * Math.cos(i));
  const y = a * (Math.sin(raan) * cosU + Math.cos(raan) * sinU * Math.cos(i));
  const z = a * (sinU * Math.sin(i));
  const jd = now / 86400000 + 2440587.5;
  const gmstDeg = (280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360;
  const gmst = (gmstDeg * Math.PI) / 180;
  const lat = Math.asin(Math.min(1, Math.max(-1, z / a))) * (180 / Math.PI);
  let lon = (Math.atan2(y, x) - gmst) * (180 / Math.PI);
  lon = ((lon + 540) % 360) - 180;
  return { lat, lon };
}

async function fetchSatellites(_ctx: ProviderFetchContext): Promise<SpatialEntity[]> {
  const now = Date.now();
  const data = (await fetchJson(
    "https://celestrak.org/NORAD/elements/gp.php?GROUP=stations&FORMAT=json",
  )) as CelestrakSatellite[];
  const out: SpatialEntity[] = [];
  for (const sat of data ?? []) {
    const loc = propagateSubPoint(sat, now);
    if (!loc || !sat.OBJECT_NAME) continue;
    out.push({
      id: `celestrak-${sat.OBJECT_ID ?? sat.OBJECT_NAME}`,
      type: "satellite",
      name: sat.OBJECT_NAME,
      location: loc,
      timestamp: now,
      source: "satellites", // layer id
      freshness: "updated", // TLEs are not real-time positions
      estimated: true, // propagated sub-point, not observed
      metadata: {
        objectId: sat.OBJECT_ID,
        inclinationDeg: sat.INCLINATION,
        meanMotionRevPerDay: sat.MEAN_MOTION,
        note: "Approximate sub-satellite point propagated from TLE (circular orbit).",
      },
    });
  }
  return out.slice(0, 160);
}

/* ------------------------------------------------------------------
 * Earthquakes — USGS live feed (public domain)
 * ------------------------------------------------------------------ */

interface UsgsFeature {
  id?: string;
  properties?: {
    mag?: number;
    place?: string;
    time?: number;
    url?: string;
  };
  geometry?: { coordinates?: number[] };
}

async function fetchEarthquakes(_ctx: ProviderFetchContext): Promise<SpatialEntity[]> {
  const data = (await fetchJson(
    "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson",
  )) as { features?: UsgsFeature[] };
  return (data.features ?? [])
    .filter((f) => Array.isArray(f.geometry?.coordinates) && f.geometry!.coordinates!.length >= 2)
    .slice(0, 200)
    .map((f) => ({
      id: `usgs-${f.id ?? f.properties?.time ?? Math.random()}`,
      type: "earthquake" as const,
      name: f.properties?.place ?? "Earthquake",
      location: { lon: f.geometry!.coordinates![0], lat: f.geometry!.coordinates![1] },
      timestamp: f.properties?.time ?? Date.now(),
      source: "earthquakes", // layer id
      freshness: "live" as const,
      metadata: {
        magnitude: f.properties?.mag,
        depthKm: f.geometry!.coordinates![2],
        url: f.properties?.url,
      },
    }));
}

/* ------------------------------------------------------------------
 * Weather — Open-Meteo current conditions at the focus (key-less)
 * ------------------------------------------------------------------ */

const WMO_LABELS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  80: "Light showers",
  81: "Showers",
  82: "Violent showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Severe thunderstorm",
};

async function fetchWeather(ctx: ProviderFetchContext): Promise<SpatialEntity[]> {
  const focus = ctx.focus;
  if (!focus) return [];
  const data = (await fetchJson(
    `https://api.open-meteo.com/v1/forecast?latitude=${focus.lat.toFixed(4)}&longitude=${focus.lon.toFixed(4)}&current=temperature_2m,weather_code,wind_speed_10m&timezone=auto`,
  )) as {
    current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number; time?: string };
  };
  const c = data.current;
  if (!c || typeof c.temperature_2m !== "number") return [];
  const code = c.weather_code ?? -1;
  return [
    {
      id: `weather-${focus.lat.toFixed(2)}-${focus.lon.toFixed(2)}`,
      type: "weather",
      name: WMO_LABELS[code] ?? "Weather",
      location: focus,
      timestamp: c.time ? Date.parse(c.time) : Date.now(),
      source: "weather", // layer id
      freshness: "live",
      metadata: {
        temperatureC: c.temperature_2m,
        windKph: c.wind_speed_10m,
        weatherCode: code,
      },
    },
  ];
}

/* ------------------------------------------------------------------
 * Fires — NASA FIRMS (key required → NOT CONFIGURED without one)
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------
 * Fires — NASA FIRMS area CSV API (VITE_FIRMS_API_KEY, client-side
 * MAP_KEY as NASA documents; rate limit 5000 tx / 10 min)
 * ------------------------------------------------------------------ */

/** Minimal RFC-4180-ish CSV line splitter (handles quoted fields). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** acq_date (YYYY-MM-DD) + acq_time (HHMM, UTC) → epoch ms. */
function parseFirmsTimestamp(date: string, time: string): number | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  let hh = 0;
  let mm = 0;
  const tm = time.match(/^(\d{2})(\d{2})$/);
  if (tm) {
    hh = Number(tm[1]);
    mm = Number(tm[2]);
  }
  const ts = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hh, mm);
  return Number.isFinite(ts) ? ts : null;
}

function numOrUndefined(value: string | undefined): number | undefined {
  if (value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

// VIIRS near-real-time sources — two satellites merged for coverage.
const FIRMS_SOURCES = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT"];

async function fetchFires(ctx: ProviderFetchContext): Promise<SpatialEntity[]> {
  const apiKey = key("VITE_FIRMS_API_KEY");
  if (!apiKey) return [];
  const focus = ctx.focus;
  if (!focus) return [];
  // Viewport-bounded query: bbox around the current focus, scaled by the
  // requested radius so "fires near California" gets a wide net.
  const halfDeg = Math.max(4, Math.min(30, (ctx.radiusKm ?? 400) / 25));
  const west = Math.max(-180, focus.lon - halfDeg);
  const east = Math.min(180, focus.lon + halfDeg);
  const south = Math.max(-90, focus.lat - halfDeg);
  const north = Math.min(90, focus.lat + halfDeg);
  const bbox = `${west},${south},${east},${north}`;
  const now = Date.now();
  const seen = new Set<string>();
  const out: SpatialEntity[] = [];
  for (const source of FIRMS_SOURCES) {
    try {
      // /api/area/csv/{MAP_KEY}/{SOURCE}/{west,south,east,north}/{DAY_RANGE}
      // DAY_RANGE=2 → most recent data (today + yesterday); NRT detections
      // carry their own acq_date/acq_time so freshness stays truthful.
      const text = await fetchText(
        `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${apiKey}/${source}/${bbox}/2`,
      );
      const lines = text.split(/\r?\n/);
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCsvLine(lines[i]);
        const lat = Number(cols[0]);
        const lon = Number(cols[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const acqDate = cols[5] ?? "";
        const acqTime = cols[6] ?? "";
        const dedupe = `${acqDate}-${acqTime}-${lat.toFixed(3)}-${lon.toFixed(3)}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        const ts = parseFirmsTimestamp(acqDate, acqTime) ?? now;
        const confidenceRaw = cols[9] ?? "";
        const confidenceNum = Number(confidenceRaw);
        out.push({
          id: `firms-${source}-${acqDate}-${acqTime}-${lat.toFixed(3)}-${lon.toFixed(3)}`,
          type: "fire",
          name: `Fire ${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
          location: { lat, lon },
          timestamp: ts,
          source: "fires", // layer id
          freshness: ts >= now - 48 * 3600 * 1000 ? "live" : "updated",
          metadata: {
            brightnessK: numOrUndefined(cols[2]),
            scanKm: numOrUndefined(cols[3]),
            trackKm: numOrUndefined(cols[4]),
            acqDate,
            acqTime,
            satellite: cols[7],
            instrument: cols[8],
            confidence: Number.isFinite(confidenceNum) ? confidenceNum : confidenceRaw,
            version: cols[10],
            brightTi5K: numOrUndefined(cols[11]),
            frpMw: numOrUndefined(cols[12]),
            daynight: cols[13],
          },
        });
      }
    } catch {
      /* one satellite source failing must not kill the fires layer */
    }
  }
  out.sort((a, b) => (Number(b.metadata?.frpMw) || 0) - (Number(a.metadata?.frpMw) || 0));
  return out.slice(0, 150);
}

/* ------------------------------------------------------------------
 * Deflock / FoggedLens — ALPR camera infrastructure (OpenStreetMap)
 *
 * FoggedLens/DeFlock is a privacy-protection project that documents
 * ALPR (automatic license plate reader) camera locations using public
 * OpenStreetMap tags (camera:type=alpr, surveillance:type=ALPR/ANPR,
 * camera:direction, camera:mount, operator, surveillance:zone …).
 *
 * This layer integrates DeFlock's REAL capability set — camera
 * discovery, locations, metadata, density/geofence analysis and
 * camera-aware route analysis — directly into the Earth Core. The
 * data is public OSM data queried through the public Overpass API,
 * exactly as FoggedLens/deflock does. No key required.
 *
 * NOTE: DeFlock does not collect license-plate reads, events or
 * trajectories — it maps camera infrastructure. This provider is
 * honest about that and never fabricates plate-level data.
 * ------------------------------------------------------------------ */

/** Compass/cardinal or numeric direction tag → degrees (0-360) or null. */
function parseDirection(raw: string | undefined): number | null {
  if (!raw) return null;
  const value = raw.trim();
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric >= 0 && numeric <= 360) return numeric;
  const cardinals: Record<string, number> = {
    N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135,
    SSE: 157.5, S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270,
    WNW: 292.5, NW: 315, NNW: 337.5,
  };
  const key = value.toUpperCase();
  if (cardinals[key] !== undefined) return cardinals[key];
  return null;
}

/** The Overpass query FoggedLens/DeFlock tagging resolves to. */
function alprOverpassQuery(bbox: { west: number; south: number; east: number; north: number }): string {
  return `
[out:json][timeout:25];
(
  node["camera:type"="alpr"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["camera:type"="ALPR"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
  node["surveillance:type"~"^(ALPR|ANPR|LPR)$"](${bbox.south},${bbox.west},${bbox.north},${bbox.east});
);
out body 200;
`.trim();
}

interface OverpassElement {
  type?: string;
  id?: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
}

// Public Overpass mirrors, tried in order — one mirror being down or
// rate-limited must not disable the Deflock layer.
const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

async function overpassQuery(query: string, timeoutMs = 25000): Promise<OverpassElement[]> {
  let lastError: unknown = null;
  for (const endpoint of OVERPASS_MIRRORS) {
    try {
      // The explicit User-Agent matters: overpass-api.de's anti-abuse layer
      // rejects requests without a recognizable UA (406). Browsers ignore
      // the header, so this only helps non-browser contexts — harmless there.
      const response = await corsFetch(
        endpoint,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "*/*",
            "User-Agent": "LeluEarthCore/1.0 (+https://lelu.app) spatial research",
          },
          body: `data=${encodeURIComponent(query)}`,
        },
        timeoutMs,
      );
      if (!response.ok) throw new Error(`Overpass HTTP ${response.status}`);
      const payload = (await response.json().catch(() => ({}))) as { elements?: OverpassElement[] };
      return payload.elements ?? [];
    } catch (error) {
      lastError = error;
      // Try the next mirror.
    }
  }
  throw lastError instanceof Error ? lastError : new Error("All Overpass mirrors failed");
}

/** Bounding box around a focus for a radius (km). */
function bboxAround(lat: number, lon: number, radiusKm: number): { west: number; south: number; east: number; north: number } {
  const halfDeg = Math.max(0.15, Math.min(8, radiusKm / 111));
  return {
    west: Math.max(-180, lon - halfDeg),
    east: Math.min(180, lon + halfDeg),
    south: Math.max(-90, lat - halfDeg),
    north: Math.min(90, lat + halfDeg),
  };
}

/** Turn Overpass camera nodes into canonical SpatialEntity objects. */
function alprElementsToEntities(elements: OverpassElement[], now: number): SpatialEntity[] {
  const out: SpatialEntity[] = [];
  for (const el of elements) {
    if (typeof el.lat !== "number" || typeof el.lon !== "number") continue;
    const tags = el.tags ?? {};
    const directionRaw =
      tags["camera:direction"] ??
      tags["surveillance:direction"] ??
      tags["direction"] ??
      "";
    const directionDeg = parseDirection(directionRaw);
    const name =
      tags["name"] ??
      ([tags["operator"], tags["camera:number"] ? `cam ${tags["camera:number"]}` : ""].filter(Boolean).join(" ").trim() ||
        `ALPR ${el.lat!.toFixed(3)}°, ${el.lon!.toFixed(3)}°`);
    out.push({
      id: `osm-alpr-${el.id ?? `${el.lat.toFixed(4)}-${el.lon.toFixed(4)}`}`,
      type: "alpr" as const,
      name,
      location: { lat: el.lat, lon: el.lon },
      timestamp: now,
      source: "alpr", // layer id — mergeLayerEntities keys on this
      freshness: "updated" as const, // OSM data, not a live feed
      metadata: {
        operator: tags["operator"],
        cameraType: tags["camera:type"] ?? tags["surveillance:type"],
        direction: directionRaw || undefined,
        directionDeg,
        mount: tags["camera:mount"],
        zone: tags["surveillance:zone"],
        cameraNumber: tags["camera:number"],
        heightM: tags["height"],
        startDate: tags["start_date"],
        source: tags["source"] ?? "OpenStreetMap",
        osmType: el.type,
        osmId: el.id,
      },
    });
  }
  return out;
}

async function fetchAlprCameras(ctx: ProviderFetchContext): Promise<SpatialEntity[]> {
  const focus = ctx.focus;
  if (!focus) return [];
  const radiusKm = ctx.radiusKm ?? 200;
  const bbox = bboxAround(focus.lat, focus.lon, radiusKm);
  const elements = await overpassQuery(alprOverpassQuery(bbox));
  const now = Date.now();
  const cameras = alprElementsToEntities(elements, now)
    .filter((c) => earthDistanceKm(focus, c.location) <= radiusKm);
  cameras.sort((a, b) => earthDistanceKm(focus, a.location) - earthDistanceKm(focus, b.location));
  return cameras.slice(0, 240);
}

/**
 * Public helper for Deflock tools: real cameras around a location.
 * Returns the cameras plus density/cluster statistics (real math over
 * real positions — the DeFlock spatial analysis capability set).
 */
export async function queryAlprCameras(
  lat: number,
  lon: number,
  radiusKm = 100,
): Promise<{ cameras: SpatialEntity[]; density: { count: number; per1000km2: number; clusters: number } }> {
  const bbox = bboxAround(lat, lon, radiusKm);
  const elements = await overpassQuery(alprOverpassQuery(bbox));
  const now = Date.now();
  const cameras = alprElementsToEntities(elements, now)
    .filter((c) => earthDistanceKm({ lat, lon }, c.location) <= radiusKm);

  // Simple greedy clustering: each camera within 5 km of an existing
  // cluster representative joins it, otherwise it seeds a new cluster.
  // Real geometry over real positions — no fabrication.
  const representatives: number[] = [];
  for (let i = 0; i < cameras.length; i++) {
    const cam = cameras[i];
    const near = representatives.some(
      (rep) => earthDistanceKm(cam.location, cameras[rep].location) <= 5,
    );
    if (!near) representatives.push(i);
  }
  const clusterCount = representatives.length;
  const areaKm2 = Math.PI * radiusKm * radiusKm;
  return {
    cameras,
    density: {
      count: cameras.length,
      per1000km2: cameras.length === 0 ? 0 : Math.round((cameras.length / areaKm2) * 1000),
      clusters: clusterCount,
    },
  };
}

/**
 * Deflock route analysis: real route geometry (OSRM, public) intersected
 * with real ALPR camera positions — reports every camera on/near the
 * route corridor so LÉLU can propose ALPR-light alternatives (the DeFlock
 * "route free of ALPRs" capability, executed with real data).
 */
export async function alprRouteAnalysis(
  from: GeoLocation,
  to: GeoLocation,
  corridorKm = 1.5,
): Promise<{
  route: Array<{ lat: number; lon: number }> | null;
  distanceKm: number;
  durationMin: number;
  camerasOnRoute: SpatialEntity[];
}> {
  let route: Array<{ lat: number; lon: number }> | null = null;
  let distanceKm = 0;
  let durationMin = 0;
  try {
    const data = (await fetchJson(
      `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=false`,
    )) as {
      routes?: Array<{
        geometry?: { coordinates?: Array<[number, number]> };
        distance?: number;
        duration?: number;
      }>;
    };
    const r = data.routes?.[0];
    if (r?.geometry?.coordinates) {
      route = r.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
      distanceKm = (r.distance ?? 0) / 1000;
      durationMin = (r.duration ?? 0) / 60;
    }
  } catch {
    /* routing offline — analysis still reports what it can */
  }

  if (!route || route.length === 0) {
    return { route: null, distanceKm: 0, durationMin: 0, camerasOnRoute: [] };
  }

  // One Overpass box around the whole route; filter to corridor distance.
  const lats = route.map((p) => p.lat);
  const lons = route.map((p) => p.lon);
  const south = Math.max(-90, Math.min(...lats) - 0.5);
  const north = Math.min(90, Math.max(...lats) + 0.5);
  const west = Math.max(-180, Math.min(...lons) - 0.5);
  const east = Math.min(180, Math.max(...lons) + 0.5);
  const elements = await overpassQuery(alprOverpassQuery({ south, west, north, east }));
  const now = Date.now();
  const cameras = alprElementsToEntities(elements, now);

  const camerasOnRoute: SpatialEntity[] = [];
  for (const cam of cameras) {
    let minD = Infinity;
    for (const point of route) {
      const d = earthDistanceKm(cam.location, point);
      if (d < minD) minD = d;
    }
    if (minD <= corridorKm) {
      camerasOnRoute.push({ ...cam, metadata: { ...cam.metadata, distanceToRouteKm: Number(minD.toFixed(2)) } });
    }
  }
  camerasOnRoute.sort((a, b) =>
    Number(a.metadata?.distanceToRouteKm) - Number(b.metadata?.distanceToRouteKm),
  );
  return { route, distanceKm, durationMin, camerasOnRoute: camerasOnRoute.slice(0, 120) };
}

/* ------------------------------------------------------------------
 * Vessels — AISStream via the server-side bridge
 *
 * The API key NEVER appears here or in any client code. The browser
 * only talks to the same-origin bridge (plugins/aisBridgePlugin.ts):
 *   GET /api/ais/vessels?bbox=west,south,east,north
 * An optional VITE_EARTH_VESSELS_ENDPOINT override is supported for
 * self-hosted deployments (also expected to keep the key server-side).
 * ------------------------------------------------------------------ */

interface BridgeVessel {
  mmsi?: number | string;
  name?: string;
  lat?: number;
  lon?: number;
  sog?: number;
  cog?: number;
  heading?: number;
  navStatus?: number;
  shipType?: number;
  destination?: string;
  callsign?: string;
  lastUpdate?: number;
}

async function fetchVessels(ctx: ProviderFetchContext): Promise<SpatialEntity[]> {
  const focus = ctx.focus;
  if (!focus) return [];
  const radiusKm = ctx.radiusKm ?? 300;
  // Viewport-bounded request — the bridge subscribes to this box.
  const halfDeg = Math.max(5, Math.min(45, radiusKm / 10));
  const west = Math.max(-180, focus.lon - halfDeg);
  const east = Math.min(180, focus.lon + halfDeg);
  const south = Math.max(-90, focus.lat - halfDeg);
  const north = Math.min(90, focus.lat + halfDeg);

  let status: string | undefined;
  let vessels: BridgeVessel[] = [];
  const endpoint = key("VITE_EARTH_VESSELS_ENDPOINT");
  if (endpoint) {
    const data = (await fetchJson(
      `${endpoint}?lat=${focus.lat.toFixed(3)}&lon=${focus.lon.toFixed(3)}&radius=${Math.round(radiusKm)}`,
    )) as { status?: string; vessels?: BridgeVessel[] };
    status = data.status;
    vessels = data.vessels ?? [];
  } else {
    const res = await fetch(`/api/ais/vessels?bbox=${west},${south},${east},${north}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) {
      throw new ProviderHintError(
        "unavailable",
        "AISStream server bridge is not running in this deployment",
      );
    }
    if (!res.ok) throw new Error(`AIS bridge HTTP ${res.status}`);
    const data = (await res.json()) as { status?: string; vessels?: BridgeVessel[] };
    status = data.status;
    vessels = data.vessels ?? [];
  }

  // Honest provider states — never pretend data exists when it doesn't.
  // (The env-var name is deliberately NOT echoed here: the key is
  // server-side only and must never appear in the client bundle.)
  if (status === "not_configured") {
    throw new ProviderHintError("not_configured", "AISStream server key is not configured");
  }
  if (status === "auth_error") {
    throw new ProviderHintError("auth_error", "AISStream rejected the server-side API key");
  }
  if (status === "rate_limited") {
    throw new ProviderHintError("rate_limited", "AISStream rate limit hit");
  }
  if (
    (status === "disconnected" || status === "error" || status === "idle") &&
    vessels.length === 0
  ) {
    throw new ProviderHintError("disconnected", `AISStream ${status ?? "unavailable"}`);
  }
  // connecting / reconnecting with no data yet is a loading state, not an error

  const now = Date.now();
  return vessels
    .filter((v) => typeof v.lat === "number" && typeof v.lon === "number")
    .map((v) => {
      const lastUpdate = v.lastUpdate ?? now;
      const ageMs = now - lastUpdate;
      return {
        id: `ais-${v.mmsi}`,
        type: "vessel" as const,
        name: v.name?.trim() || (v.mmsi ? `Vessel ${v.mmsi}` : "Unknown vessel"),
        location: { lat: v.lat!, lon: v.lon! },
        timestamp: lastUpdate,
        source: "vessels", // layer id
        freshness: ageMs < 20 * 60 * 1000 ? ("live" as const) : ("updated" as const),
        metadata: {
          mmsi: v.mmsi,
          sogKt: v.sog,
          cogDeg: v.cog,
          headingDeg: v.heading,
          navStatus: v.navStatus,
          shipType: v.shipType,
          destination: v.destination,
          callsign: v.callsign,
          lastUpdate,
        },
      };
    })
    .filter((e) => earthDistanceKm(focus, e.location) <= radiusKm)
    .slice(0, 260);
}

/* ------------------------------------------------------------------
 * Registration — idempotent, safe to call from anywhere
 * ------------------------------------------------------------------ */

export function registerEarthProviders(): void {
  if (registered) return;
  registered = true;

  registerProvider({
    id: "aircraft",
    name: "Aircraft",
    provider: "adsb.lol",
    attribution: "adsb.lol — aggregated public ADS-B data",
    license: "See adsb.lol terms",
    updateIntervalMs: 30000,
    authRequired: false,
    configured: () => true,
    fetch: fetchFlights,
  });

  registerProvider({
    id: "satellites",
    name: "Satellites",
    provider: "CelesTrak",
    attribution: "CelesTrak — public TLE data (Dr. T.S. Kelso)",
    license: "Public domain TLEs",
    updateIntervalMs: 120000,
    authRequired: false,
    configured: () => true,
    fetch: fetchSatellites,
  });

  registerProvider({
    id: "earthquakes",
    name: "Earthquakes",
    provider: "USGS",
    attribution: "U.S. Geological Survey Earthquake Hazards Program",
    license: "Public domain",
    updateIntervalMs: 60000,
    authRequired: false,
    configured: () => true,
    fetch: fetchEarthquakes,
  });

  registerProvider({
    id: "weather",
    name: "Weather",
    provider: "Open-Meteo",
    attribution: "Open-Meteo — open weather data",
    license: "CC-BY 4.0",
    updateIntervalMs: 600000,
    authRequired: false,
    configured: () => true,
    fetch: fetchWeather,
  });

  registerProvider({
    id: "fires",
    name: "Fires",
    provider: "NASA FIRMS",
    attribution: "NASA Fire Information for Resource Management System",
    license: "NASA data — see FIRMS terms",
    updateIntervalMs: 600000,
    authRequired: true,
    configured: () => Boolean(key("VITE_FIRMS_API_KEY")),
    fetch: fetchFires,
  });

  registerProvider({
    id: "vessels",
    name: "Vessels",
    provider: "AISStream",
    attribution: "AISStream — vessel positions (bridged server-side)",
    license: "See AISStream terms",
    updateIntervalMs: 30000,
    authRequired: true,
    // Config state lives on the server bridge (the key is server-only),
    // so the provider always polls and reports the bridge's real status.
    configured: () => true,
    fetch: fetchVessels,
  });

  registerProvider({
    id: "alpr",
    name: "ALPR Cameras",
    provider: "OpenStreetMap — FoggedLens/DeFlock tags",
    attribution: "OpenStreetMap contributors — crowdsourced ALPR/surveillance camera locations per FoggedLens/DeFlock tagging",
    license: "ODbL — OpenStreetMap data",
    updateIntervalMs: 300000,
    authRequired: false,
    configured: () => true,
    fetch: fetchAlprCameras,
  });
}
