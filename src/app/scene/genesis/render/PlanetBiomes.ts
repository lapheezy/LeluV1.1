/**
 * ==========================================================
 * LÉLUVERSE — PLANET BIOMES
 *
 * Deterministic, seedable geography for the LÉLU planet so that
 * every ground point maps to a stable biome. This feeds the
 * camera-facing surface LOD: as you descend, the right environment
 * (ocean, coast, forest, jungle, desert, grassland, savanna,
 * mountain, polar, urban) streams in based on where you are.
 *
 * Also owns the single persistent planet clock used by the day/night
 * sun, so time never resets as the camera changes scale.
 * ==========================================================
 */

import { Vector3 } from "three";
import { REAL_CITIES, type GeoPlace } from "./GeoData";
import {
  beginGeoStreaming,
  countryAtLatLon,
  elevationAtLatLon,
  isCountryDataReady,
  warmElevationAround,
} from "./GeoPipeline";

/* ------------------------------------------------------------------
 * Deterministic hashing + value noise (no Math.random — stable).
 * ------------------------------------------------------------------ */

function fract(x: number) {
  return x - Math.floor(x);
}

function hash2(x: number, y: number, seed: number) {
  const h = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return fract(h);
}

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstep(x - ix);
  const fy = smoothstep(y - iy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number, seed: number, octaves = 4) {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise(x * freq, y * freq, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** Seeded RNG (exported so surface layers can generate stable geometry). */
export function seededRng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------------------
 * Biome types
 * ------------------------------------------------------------------ */

export type PlanetBiomeId =
  | "OCEAN"
  | "COAST"
  | "FOREST"
  | "JUNGLE"
  | "DESERT"
  | "GRASSLAND"
  | "SAVANNA"
  | "MOUNTAIN"
  | "POLAR"
  | "URBAN";

export interface PlanetBiomeInfo {
  id: PlanetBiomeId;
  name: string;
  accent: string;
}

export const BIOMES: Record<PlanetBiomeId, PlanetBiomeInfo> = {
  OCEAN: { id: "OCEAN", name: "Ocean", accent: "#3f8cff" },
  COAST: { id: "COAST", name: "Coastline", accent: "#ffd08a" },
  FOREST: { id: "FOREST", name: "Forest", accent: "#4fae6a" },
  JUNGLE: { id: "JUNGLE", name: "Jungle", accent: "#2fae6a" },
  DESERT: { id: "DESERT", name: "Desert", accent: "#e8c37a" },
  GRASSLAND: { id: "GRASSLAND", name: "Grassland", accent: "#a4d16f" },
  SAVANNA: { id: "SAVANNA", name: "Savanna", accent: "#d4b46a" },
  MOUNTAIN: { id: "MOUNTAIN", name: "Mountain", accent: "#9aa7b6" },
  POLAR: { id: "POLAR", name: "Polar", accent: "#cfefff" },
  URBAN: { id: "URBAN", name: "City", accent: "#ffb25e" },
};

/* ------------------------------------------------------------------
 * Named REAL urban regions — real-world cities (GeoData.REAL_CITIES)
 * become the planet's urban hotspots. Each carries its own hue so
 * different cities read as genuinely different places.
 * ------------------------------------------------------------------ */

export function nearestRealCity(lat: number, lon: number) {
  let best: { city: GeoPlace; dist: number } | null = null;
  for (const city of REAL_CITIES) {
    const dLat = Math.abs(lat - city.lat);
    // Wrap longitude so cities near the ±180 seam compare correctly.
    let dLon = Math.abs(lon - city.lon);
    if (dLon > 180) dLon = 360 - dLon;
    const dist = Math.hypot(dLat, dLon);
    if (!best || dist < best.dist) best = { city, dist };
  }
  return best;
}

/* ------------------------------------------------------------------
 * Lat/lon ⇄ surface direction
 * ------------------------------------------------------------------ */

const DEG = Math.PI / 180;

export function groundDirToLatLon(dir: Vector3): { lat: number; lon: number } {
  const n = dir.clone().normalize();
  const lat = 90 - Math.acos(clamp(n.y, -1, 1)) / DEG;
  let lon = Math.atan2(n.z, -n.x) / DEG - 180;
  if (lon < -180) lon += 360;
  if (lon > 180) lon -= 360;
  return { lat, lon };
}

/* ------------------------------------------------------------------
 * Elevation, moisture, biome
 * ------------------------------------------------------------------ */

/** Deterministic procedural elevation used whenever real tiles are absent. */
function proceduralElevation(lat: number, lon: number): number {
  const continent = fbm(lon * 0.04 + 100, lat * 0.04 + 40, 7, 5); // 0..1
  const detail = fbm(lon * 0.1 + 210, lat * 0.1 + 130, 19, 5); // 0..1
  const ridge = fbm(lon * 0.055 + 300, lat * 0.055 + 420, 31, 5); // 0..1

  let e = (continent - 0.53) * 2.4;
  e += (detail - 0.5) * 1.1;
  e += Math.max(0, ridge - 0.62) * 2.6;

  // Shallow continental shelf keeps coastlines readable.
  return clamp(e, -1, 1);
}

/**
 * -1 (deep ocean) → +1 (high mountain). 0 ≈ sea level.
 *
 * Prefers real streamed elevation (Mapzen Terrarium tiles) when the
 * tile for this location has loaded; otherwise falls back to the
 * deterministic procedural field. Offline behavior is therefore
 * byte-for-byte identical to before this layer was added.
 */
export function elevationAt(lat: number, lon: number): number {
  const real = elevationAtLatLon(lat, lon);
  if (real === null) return proceduralElevation(lat, lon);

  // Normalize meters → -1..1 (roughly -8km ocean trench .. +8km peak),
  // then blend with the procedural shape so large-scale continuity is
  // retained while real peaks/valleys/coastlines show through.
  const normalized = clamp(real / 8000, -1, 1);
  return clamp(normalized * 0.65 + proceduralElevation(lat, lon) * 0.35, -1, 1);
}

/** Real country name when the boundary polygons have streamed in. */
export function countryAt(lat: number, lon: number): string | null {
  return countryAtLatLon(lat, lon);
}

/** Real streamed elevation in meters, or null before the tile loads. */
export function realElevationAt(lat: number, lon: number): number | null {
  return elevationAtLatLon(lat, lon);
}

/** True once real country polygons are available. */
export function geoDataReady(): boolean {
  return isCountryDataReady();
}

/** Stream boundaries + elevation tiles for the camera's location. */
export function warmGeoData(lat: number, lon: number): void {
  beginGeoStreaming();
  warmElevationAround(lat, lon);
}

/** 0 (dry) → 1 (wet). */
export function moistureAt(lat: number, lon: number): number {
  const m = fbm(lon * 0.06 + 320, lat * 0.06 + 210, 29, 5);
  // Bands: wet tropics, dry subtropics, moderate temperate.
  const absLat = Math.abs(lat);
  let band = 0.5;
  if (absLat < 18) band = 0.72;
  else if (absLat < 35) band = 0.3;
  else band = 0.55;
  return clamp(m * 0.55 + band * 0.45, 0, 1);
}

export function biomeAt(lat: number, lon: number): PlanetBiomeId {
  // Cities take precedence — they are the "urban" destinations.
  const city = nearestRealCity(lat, lon);
  if (city && city.dist < 3.2) return "URBAN";

  if (Math.abs(lat) > 66) return "POLAR";

  const e = elevationAt(lat, lon);
  if (e < -0.03) return "OCEAN";
  if (e < 0.04) return "COAST";

  const m = moistureAt(lat, lon);
  const absLat = Math.abs(lat);

  if (e > 0.52) return "MOUNTAIN";
  if (m > 0.72 && absLat < 28) return "JUNGLE";
  if (m > 0.55) return "FOREST";
  if (m < 0.3) return "DESERT";
  if (absLat < 24) return "SAVANNA";
  return "GRASSLAND";
}

/* ------------------------------------------------------------------
 * Persistent planet clock + sun
 * ------------------------------------------------------------------ */

/** Seconds for one full day/night cycle. */
export const PLANET_DAY_LENGTH = 300;

/** Sun position (used by the directional light) orbiting the planet. */
export function sunDirection(elapsed: number): Vector3 {
  const t = (elapsed % PLANET_DAY_LENGTH) / PLANET_DAY_LENGTH;
  const angle = t * Math.PI * 2;
  return new Vector3(
    Math.cos(angle),
    Math.sin(angle) * 0.35,
    Math.sin(angle),
  ).normalize().multiplyScalar(12);
}

/** 1 at high noon → 0 at midnight (drives city lights / night glow). */
export function dayFactor(elapsed: number): number {
  const t = (elapsed % PLANET_DAY_LENGTH) / PLANET_DAY_LENGTH;
  return clamp(0.5 + 0.5 * Math.sin(t * Math.PI * 2 - Math.PI / 2), 0, 1);
}
