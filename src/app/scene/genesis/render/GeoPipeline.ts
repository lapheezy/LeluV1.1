/**
 * ==========================================================
 * LÉLUVERSE — GEO PIPELINE (real geographic data streaming)
 *
 * This is the legitimate data layer between the planet renderer
 * and real-world open datasets. It deliberately contains NO giant
 * hard-coded dataset — instead it streams and caches tiles/boundaries
 * from public, CORS-friendly, key-less sources and degrades gracefully
 * to the offline curated data in `GeoData.ts` when offline.
 *
 * Sources (configurable via `configureGeoPipeline`):
 *   1. Country boundaries — a GeoJSON FeatureCollection of world
 *      country polygons (name + Polygon/MultiPolygon geometry).
 *      Used for real point-in-polygon country lookup and for drawing
 *      actual border lines on the planet surface.
 *   2. Elevation — Mapzen "Terrarium" PNG tiles, where elevation is
 *      packed into RGB. Each tile is decoded once into a Float32Array
 *      and cached so terrain sampling is synchronous per-frame.
 *
 * Everything here is lazy: nothing touches the network until the
 * planet actually requests a region, and every failure keeps the
 * existing procedural world working.
 * ==========================================================
 */

/* ------------------------------------------------------------------
 * Configurable sources (public domain / openly licensed data).
 * Override with `configureGeoPipeline` if you prefer Natural Earth,
 * a self-hosted proxy, or another tile provider.
 * ------------------------------------------------------------------ */

export interface GeoPipelineConfig {
  /** GeoJSON FeatureCollection of world countries (properties.name). */
  countriesUrl: string;
  /** Terrarium elevation tile template with {z}, {x}, {y} placeholders. */
  elevationUrlTemplate: string;
}

const DEFAULT_CONFIG: GeoPipelineConfig = {
  countriesUrl:
    "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json",
  elevationUrlTemplate:
    "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png",
};

let config: GeoPipelineConfig = { ...DEFAULT_CONFIG };

export function configureGeoPipeline(next: Partial<GeoPipelineConfig>): void {
  config = { ...config, ...next };
}

/* ------------------------------------------------------------------
 * Small LRU cache so streamed tiles/boundaries don't grow unbounded.
 * ------------------------------------------------------------------ */

class LruCache<K, V> {
  private readonly map = new Map<K, V>();

  constructor(private readonly maxSize: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value !== undefined) {
      // Refresh recency.
      this.map.delete(key);
      this.map.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  has(key: K): boolean {
    return this.map.has(key);
  }
}

/* ------------------------------------------------------------------
 * Country boundaries (streamed GeoJSON → point-in-polygon lookup)
 * ------------------------------------------------------------------ */

export interface CountryRing {
  /** Closed ring of [lat, lon] points (not raw GeoJSON order). */
  lat: number;
  lon: number;
}

export interface CountryBoundary {
  name: string;
  /** One polygon = one outer ring (holes are skipped for lookup). */
  rings: CountryRing[][];
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

let boundaries: CountryBoundary[] | null = null;
let boundariesPromise: Promise<CountryBoundary[] | null> | null = null;
let boundariesFailed = false;

function normalizeRings(geometry: unknown): CountryRing[][] {
  const rings: CountryRing[][] = [];
  const type = (geometry as { type?: string } | null)?.type;
  const coords = (geometry as { coordinates?: unknown } | null)?.coordinates;

  const addPolygon = (polygon: unknown) => {
    if (!Array.isArray(polygon)) return;
    // GeoJSON Polygon: [ [ [lon, lat], ... ] ] — first ring is the outer.
    const outer = polygon[0];
    if (!Array.isArray(outer)) return;
    const ring: CountryRing[] = [];
    for (const point of outer) {
      if (Array.isArray(point) && point.length >= 2) {
        const lon = Number(point[0]);
        const lat = Number(point[1]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) ring.push({ lat, lon });
      }
    }
    if (ring.length >= 4) rings.push(ring);
  };

  if (type === "Polygon") {
    addPolygon(coords);
  } else if (type === "MultiPolygon") {
    if (Array.isArray(coords)) for (const polygon of coords) addPolygon(polygon);
  }
  return rings;
}

export async function loadCountryBoundaries(force = false): Promise<CountryBoundary[] | null> {
  if (boundaries) return boundaries;
  if (boundariesFailed && !force) return null;
  if (boundariesPromise) return boundariesPromise;

  boundariesPromise = (async () => {
    try {
      const res = await fetch(config.countriesUrl, {
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        features?: Array<{
          properties?: { name?: unknown };
          geometry?: unknown;
        }>;
      };
      const parsed: CountryBoundary[] = [];
      for (const feature of data.features ?? []) {
        const name = feature.properties?.name;
        if (typeof name !== "string" || !name) continue;
        const rings = normalizeRings(feature.geometry);
        if (rings.length === 0) continue;

        let minLat = Infinity;
        let maxLat = -Infinity;
        let minLon = Infinity;
        let maxLon = -Infinity;
        for (const ring of rings) {
          for (const p of ring) {
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
            if (p.lon < minLon) minLon = p.lon;
            if (p.lon > maxLon) maxLon = p.lon;
          }
        }
        parsed.push({ name, rings, minLat, maxLat, minLon, maxLon });
      }
      if (parsed.length === 0) throw new Error("No country boundaries parsed");
      boundaries = parsed;
      return boundaries;
    } catch {
      boundariesFailed = true;
      return null;
    } finally {
      boundariesPromise = null;
    }
  })();

  return boundariesPromise;
}

function lonDelta(a: number, b: number): number {
  let d = Math.abs(a - b);
  if (d > 180) d = 360 - d;
  return d;
}

function pointInRing(lat: number, lon: number, ring: CountryRing[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].lon;
    const yi = ring[i].lat;
    const xj = ring[j].lon;
    const yj = ring[j].lat;
    const intersects =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Synchronous real country lookup. Returns the country name only when
 * boundaries have finished streaming AND the point is inside a real
 * polygon; otherwise `null` (callers fall back to nearest-place data).
 */
export function countryAtLatLon(lat: number, lon: number): string | null {
  if (!boundaries) return null;
  for (const b of boundaries) {
    // Latitude bounding-box prefilter.
    if (lat < b.minLat - 0.6 || lat > b.maxLat + 0.6) continue;

    // Longitude bbox prefilter. Polygons that span the antimeridian
    // (minLon near -180, maxLon near 180) are treated as covering all
    // longitudes; the ray-cast below still decides the final answer.
    const spansAntimeridian = b.maxLon - b.minLon > 180;
    const insideLon = spansAntimeridian
      ? true
      : lonDelta(lon, (b.minLon + b.maxLon) / 2) <= (b.maxLon - b.minLon) / 2 + 0.6;
    if (!insideLon) continue;

    for (const ring of b.rings) {
      if (pointInRing(lat, lon, ring)) return b.name;
    }
  }
  return null;
}

/** Real boundary rings for a named country (for border-line rendering). */
export function boundaryForCountry(name: string): CountryRing[][] | null {
  if (!boundaries) return null;
  const hit = boundaries.find((b) => b.name === name);
  return hit ? hit.rings : null;
}

/** True once real country polygons have been streamed and parsed. */
export function isCountryDataReady(): boolean {
  return boundaries !== null;
}

/* ------------------------------------------------------------------
 * Elevation (Terrarium RGB tiles → meters, decoded + cached)
 * ------------------------------------------------------------------ */

const TILE_SIZE = 256;
const elevationCache = new LruCache<string, Float32Array>(96);
const inFlight = new Set<string>();
let lastWarmAt = 0;
let lastWarmLat = Infinity;
let lastWarmLon = Infinity;

function tileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}

function tileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

/** Decode a Terrarium PNG into a 256×256 Float32Array of meters. */
async function decodeElevationTile(blob: Blob): Promise<Float32Array | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      bitmap.close?.();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, TILE_SIZE, TILE_SIZE);
    const rgba = ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data;
    const out = new Float32Array(TILE_SIZE * TILE_SIZE);
    for (let i = 0, p = 0; i < out.length; i++, p += 4) {
      // Terrarium: elevation = (R*256 + G + B/256) - 32768
      out[i] = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768;
    }
    bitmap.close?.();
    return out;
  } catch {
    return null;
  }
}

async function fetchElevationTile(z: number, x: number, y: number): Promise<void> {
  const key = `${z}/${x}/${y}`;
  if (elevationCache.has(key) || inFlight.has(key)) return;
  inFlight.add(key);
  try {
    const url = config.elevationUrlTemplate
      .replace("{z}", String(z))
      .replace("{x}", String(x))
      .replace("{y}", String(y));
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const decoded = await decodeElevationTile(await res.blob());
    if (decoded) elevationCache.set(key, decoded);
  } catch {
    /* offline / no tile — procedural fallback remains active */
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Synchronous elevation sample (meters). Returns null when the tile for
 * this location has not streamed in yet — the caller then uses its
 * deterministic procedural terrain.
 */
export function elevationAtLatLon(lat: number, lon: number, z = 8): number | null {
  const xf = tileX(lon, z);
  const yf = tileY(lat, z);
  const x = Math.floor(xf);
  const y = Math.floor(yf);
  const data = elevationCache.get(`${z}/${x}/${y}`);
  if (!data) return null;

  const px = (xf - x) * TILE_SIZE;
  const py = (yf - y) * TILE_SIZE;
  const x0 = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor(px)));
  const y0 = Math.min(TILE_SIZE - 1, Math.max(0, Math.floor(py)));
  const fx = px - x0;
  const fy = py - y0;
  const x1 = Math.min(TILE_SIZE - 1, x0 + 1);
  const y1 = Math.min(TILE_SIZE - 1, y0 + 1);

  const a = data[y0 * TILE_SIZE + x0];
  const b = data[y0 * TILE_SIZE + x1];
  const c = data[y1 * TILE_SIZE + x0];
  const d = data[y1 * TILE_SIZE + x1];
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/**
 * Stream the elevation tiles around a camera position (the containing
 * tile plus its immediate neighborhood). Internally throttled so the
 * per-frame loop can call this freely.
 */
export function warmElevationAround(lat: number, lon: number, z = 8, radius = 1): void {
  const now = Date.now();
  const moved = Math.hypot(lat - lastWarmLat, lonDelta(lon, lastWarmLon));
  if (now - lastWarmAt < 1200 && moved < 0.6) return;
  lastWarmAt = now;
  lastWarmLat = lat;
  lastWarmLon = lon;

  const cx = Math.floor(tileX(lon, z));
  const cy = Math.floor(tileY(lat, z));
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      void fetchElevationTile(z, cx + dx, cy + dy);
    }
  }
}

/**
 * Kick off boundary streaming once (cheap, never throws). Call from the
 * planet HUD/layer when the planet first comes into view.
 */
export function beginGeoStreaming(): void {
  void loadCountryBoundaries();
}

/* ------------------------------------------------------------------
 * Re-exports used by the planet layer so it has ONE entry point.
 * ------------------------------------------------------------------ */

export { lonDelta };
