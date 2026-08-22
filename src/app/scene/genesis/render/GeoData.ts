/**
 * ==========================================================
 * LÉLUVERSE — GEO DATA (free, key-less sources)
 *
 * Maps the LÉLU planet's lat/lon surface onto REAL Earth
 * geography using only free, key-less data sources:
 *
 *   • Browser Geolocation API  → the user's real GPS position
 *   • REST Countries v3.1      → country list + capitals + regions
 *   • Open-Meteo Geocoding     → reverse geocode / place search
 *   • Curated offline dataset  → reliable fallback (no network)
 *
 * The curated lists below are the source of truth for the
 * planet's named cities and countries; the network sources only
 * enrich (a fuller country table and reverse-geocoded names).
 * Every lookup degrades gracefully offline.
 * ==========================================================
 */

export interface GeoPlace {
  name: string;
  country: string;
  lat: number;
  lon: number;
  /** Deterministic hue used for the city's urban glow. */
  hue: number;
}

export interface GeoCountry {
  name: string;
  capital: string;
  lat: number;
  lon: number;
  region: string;
  subregion: string;
}

/* ------------------------------------------------------------------
 * Curated REAL world cities (offline, stable, accurate lat/lon).
 * These become the planet's urban hotspots so different cities render
 * and read as genuinely different places.
 * ------------------------------------------------------------------ */

export const REAL_CITIES: GeoPlace[] = [
  { name: "New York", country: "United States", lat: 40.71, lon: -74.01, hue: 215 },
  { name: "Los Angeles", country: "United States", lat: 34.05, lon: -118.24, hue: 30 },
  { name: "Miami", country: "United States", lat: 25.76, lon: -80.19, hue: 175 },
  { name: "Chicago", country: "United States", lat: 41.88, lon: -87.63, hue: 200 },
  { name: "Toronto", country: "Canada", lat: 43.65, lon: -79.38, hue: 210 },
  { name: "Vancouver", country: "Canada", lat: 49.28, lon: -123.12, hue: 180 },
  { name: "Mexico City", country: "Mexico", lat: 19.43, lon: -99.13, hue: 12 },
  { name: "São Paulo", country: "Brazil", lat: -23.55, lon: -46.63, hue: 40 },
  { name: "Rio de Janeiro", country: "Brazil", lat: -22.91, lon: -43.17, hue: 160 },
  { name: "Buenos Aires", country: "Argentina", lat: -34.60, lon: -58.38, hue: 45 },
  { name: "Lima", country: "Peru", lat: -12.05, lon: -77.04, hue: 20 },
  { name: "Bogotá", country: "Colombia", lat: 4.71, lon: -74.07, hue: 350 },
  { name: "London", country: "United Kingdom", lat: 51.51, lon: -0.13, hue: 220 },
  { name: "Paris", country: "France", lat: 48.86, lon: 2.35, hue: 265 },
  { name: "Madrid", country: "Spain", lat: 40.42, lon: -3.70, hue: 30 },
  { name: "Rome", country: "Italy", lat: 41.90, lon: 12.50, hue: 15 },
  { name: "Berlin", country: "Germany", lat: 52.52, lon: 13.40, hue: 205 },
  { name: "Amsterdam", country: "Netherlands", lat: 52.37, lon: 4.90, hue: 200 },
  { name: "Moscow", country: "Russia", lat: 55.76, lon: 37.62, hue: 340 },
  { name: "Istanbul", country: "Türkiye", lat: 41.01, lon: 28.98, hue: 20 },
  { name: "Athens", country: "Greece", lat: 37.98, lon: 23.73, hue: 190 },
  { name: "Cairo", country: "Egypt", lat: 30.04, lon: 31.24, hue: 45 },
  { name: "Lagos", country: "Nigeria", lat: 6.52, lon: 3.38, hue: 150 },
  { name: "Nairobi", country: "Kenya", lat: -1.29, lon: 36.82, hue: 120 },
  { name: "Johannesburg", country: "South Africa", lat: -26.20, lon: 28.05, hue: 40 },
  { name: "Casablanca", country: "Morocco", lat: 33.57, lon: -7.59, hue: 25 },
  { name: "Dubai", country: "United Arab Emirates", lat: 25.20, lon: 55.27, hue: 180 },
  { name: "Riyadh", country: "Saudi Arabia", lat: 24.71, lon: 46.68, hue: 35 },
  { name: "Mumbai", country: "India", lat: 19.08, lon: 72.88, hue: 330 },
  { name: "Delhi", country: "India", lat: 28.61, lon: 77.21, hue: 30 },
  { name: "Kolkata", country: "India", lat: 22.57, lon: 88.36, hue: 20 },
  { name: "Karachi", country: "Pakistan", lat: 24.86, lon: 67.01, hue: 25 },
  { name: "Bangkok", country: "Thailand", lat: 13.76, lon: 100.50, hue: 15 },
  { name: "Singapore", country: "Singapore", lat: 1.35, lon: 103.82, hue: 340 },
  { name: "Jakarta", country: "Indonesia", lat: -6.21, lon: 106.85, hue: 30 },
  { name: "Manila", country: "Philippines", lat: 14.60, lon: 120.98, hue: 15 },
  { name: "Hong Kong", country: "China", lat: 22.32, lon: 114.17, hue: 350 },
  { name: "Shanghai", country: "China", lat: 31.23, lon: 121.47, hue: 220 },
  { name: "Beijing", country: "China", lat: 39.90, lon: 116.41, hue: 340 },
  { name: "Seoul", country: "South Korea", lat: 37.57, lon: 126.98, hue: 210 },
  { name: "Tokyo", country: "Japan", lat: 35.68, lon: 139.69, hue: 205 },
  { name: "Osaka", country: "Japan", lat: 34.69, lon: 135.50, hue: 200 },
  { name: "Sydney", country: "Australia", lat: -33.87, lon: 151.21, hue: 195 },
  { name: "Melbourne", country: "Australia", lat: -37.81, lon: 144.96, hue: 210 },
  { name: "Auckland", country: "New Zealand", lat: -36.85, lon: 174.76, hue: 180 },
  { name: "Reykjavík", country: "Iceland", lat: 64.15, lon: -21.94, hue: 200 },
  { name: "Anchorage", country: "United States", lat: 61.22, lon: -149.90, hue: 210 },
  { name: "Honolulu", country: "United States", lat: 21.31, lon: -157.86, hue: 180 },
];

/* ------------------------------------------------------------------
 * Curated offline country table (network source enriches this).
 * ------------------------------------------------------------------ */

export const OFFLINE_COUNTRIES: GeoCountry[] = [
  { name: "United States", capital: "Washington, D.C.", lat: 38.90, lon: -77.04, region: "Americas", subregion: "North America" },
  { name: "Canada", capital: "Ottawa", lat: 45.42, lon: -75.70, region: "Americas", subregion: "North America" },
  { name: "Mexico", capital: "Mexico City", lat: 19.43, lon: -99.13, region: "Americas", subregion: "North America" },
  { name: "Brazil", capital: "Brasília", lat: -15.79, lon: -47.88, region: "Americas", subregion: "South America" },
  { name: "Argentina", capital: "Buenos Aires", lat: -34.60, lon: -58.38, region: "Americas", subregion: "South America" },
  { name: "Peru", capital: "Lima", lat: -12.05, lon: -77.04, region: "Americas", subregion: "South America" },
  { name: "Colombia", capital: "Bogotá", lat: 4.71, lon: -74.07, region: "Americas", subregion: "South America" },
  { name: "United Kingdom", capital: "London", lat: 51.51, lon: -0.13, region: "Europe", subregion: "Northern Europe" },
  { name: "France", capital: "Paris", lat: 48.86, lon: 2.35, region: "Europe", subregion: "Western Europe" },
  { name: "Spain", capital: "Madrid", lat: 40.42, lon: -3.70, region: "Europe", subregion: "Southern Europe" },
  { name: "Italy", capital: "Rome", lat: 41.90, lon: 12.50, region: "Europe", subregion: "Southern Europe" },
  { name: "Germany", capital: "Berlin", lat: 52.52, lon: 13.40, region: "Europe", subregion: "Western Europe" },
  { name: "Netherlands", capital: "Amsterdam", lat: 52.37, lon: 4.90, region: "Europe", subregion: "Western Europe" },
  { name: "Russia", capital: "Moscow", lat: 55.76, lon: 37.62, region: "Europe", subregion: "Eastern Europe" },
  { name: "Türkiye", capital: "Ankara", lat: 39.93, lon: 32.86, region: "Asia", subregion: "Western Asia" },
  { name: "Greece", capital: "Athens", lat: 37.98, lon: 23.73, region: "Europe", subregion: "Southern Europe" },
  { name: "Egypt", capital: "Cairo", lat: 30.04, lon: 31.24, region: "Africa", subregion: "Northern Africa" },
  { name: "Nigeria", capital: "Abuja", lat: 9.06, lon: 7.49, region: "Africa", subregion: "Western Africa" },
  { name: "Kenya", capital: "Nairobi", lat: -1.29, lon: 36.82, region: "Africa", subregion: "Eastern Africa" },
  { name: "South Africa", capital: "Pretoria", lat: -25.74, lon: 28.19, region: "Africa", subregion: "Southern Africa" },
  { name: "Morocco", capital: "Rabat", lat: 34.02, lon: -6.84, region: "Africa", subregion: "Northern Africa" },
  { name: "United Arab Emirates", capital: "Abu Dhabi", lat: 24.45, lon: 54.38, region: "Asia", subregion: "Western Asia" },
  { name: "Saudi Arabia", capital: "Riyadh", lat: 24.71, lon: 46.68, region: "Asia", subregion: "Western Asia" },
  { name: "India", capital: "New Delhi", lat: 28.61, lon: 77.21, region: "Asia", subregion: "Southern Asia" },
  { name: "Pakistan", capital: "Islamabad", lat: 33.68, lon: 73.05, region: "Asia", subregion: "Southern Asia" },
  { name: "Thailand", capital: "Bangkok", lat: 13.76, lon: 100.50, region: "Asia", subregion: "South-Eastern Asia" },
  { name: "Singapore", capital: "Singapore", lat: 1.35, lon: 103.82, region: "Asia", subregion: "South-Eastern Asia" },
  { name: "Indonesia", capital: "Jakarta", lat: -6.21, lon: 106.85, region: "Asia", subregion: "South-Eastern Asia" },
  { name: "Philippines", capital: "Manila", lat: 14.60, lon: 120.98, region: "Asia", subregion: "South-Eastern Asia" },
  { name: "China", capital: "Beijing", lat: 39.90, lon: 116.41, region: "Asia", subregion: "Eastern Asia" },
  { name: "South Korea", capital: "Seoul", lat: 37.57, lon: 126.98, region: "Asia", subregion: "Eastern Asia" },
  { name: "Japan", capital: "Tokyo", lat: 35.68, lon: 139.69, region: "Asia", subregion: "Eastern Asia" },
  { name: "Australia", capital: "Canberra", lat: -35.28, lon: 149.13, region: "Oceania", subregion: "Australia and New Zealand" },
  { name: "New Zealand", capital: "Wellington", lat: -41.29, lon: 174.78, region: "Oceania", subregion: "Australia and New Zealand" },
  { name: "Iceland", capital: "Reykjavík", lat: 64.15, lon: -21.94, region: "Europe", subregion: "Northern Europe" },
];

/* ------------------------------------------------------------------
 * Runtime state + network enrichment
 * ------------------------------------------------------------------ */

let countries: GeoCountry[] = OFFLINE_COUNTRIES;
let countriesLoaded = false;

/**
 * Fetch the full country table from the free REST Countries API.
 * Never throws — on any failure we keep the offline table.
 */
export async function loadCountries(): Promise<GeoCountry[]> {
  if (countriesLoaded) return countries;
  try {
    const res = await fetch("https://restcountries.com/v3.1/all?fields=name,capital,latlng,region,subregion", {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`REST Countries HTTP ${res.status}`);
    const data = (await res.json()) as Array<{
      name?: { common?: string };
      capital?: string[];
      latlng?: number[];
      region?: string;
      subregion?: string;
    }>;
    const mapped: GeoCountry[] = data
      .filter((c) => Array.isArray(c.latlng) && c.latlng.length === 2 && c.name?.common)
      .map((c) => ({
        name: c.name!.common!,
        capital: c.capital?.[0] ?? "",
        lat: c.latlng![0],
        lon: c.latlng![1],
        region: c.region ?? "",
        subregion: c.subregion ?? "",
      }));
    if (mapped.length > 0) {
      countries = mapped;
      countriesLoaded = true;
    }
  } catch {
    /* offline — keep curated table */
  }
  return countries;
}

/** Synchronous access to whatever country table is currently loaded. */
export function getCountries(): GeoCountry[] {
  return countries;
}

/* ------------------------------------------------------------------
 * Nearest-place resolution (no network required — uses curated data)
 * ------------------------------------------------------------------ */

function lonDelta(a: number, b: number) {
  let d = Math.abs(a - b);
  if (d > 180) d = 360 - d;
  return d;
}

export interface NearestPlace {
  city: GeoPlace | null;
  country: GeoCountry | null;
  /** Great-circle distance in km. */
  distKm: number;
}

export function nearestPlace(lat: number, lon: number): NearestPlace {
  let bestCity: GeoPlace | null = null;
  let bestCityDist = Infinity;

  for (const city of REAL_CITIES) {
    const d = Math.hypot(lat - city.lat, lonDelta(lon, city.lon));
    if (d < bestCityDist) {
      bestCityDist = d;
      bestCity = city;
    }
  }

  let bestCountry: GeoCountry | null = null;
  let bestCountryDist = Infinity;
  for (const country of countries) {
    const d = Math.hypot(lat - country.lat, lonDelta(lon, country.lon));
    if (d < bestCountryDist) {
      bestCountryDist = d;
      bestCountry = country;
    }
  }

  // 1 degree ≈ 111 km.
  return {
    city: bestCityDist < 12 ? bestCity : null,
    country: bestCountry,
    distKm: Math.min(bestCityDist, bestCountryDist) * 111,
  };
}

/* ------------------------------------------------------------------
 * Browser Geolocation (GPS)
 * ------------------------------------------------------------------ */

export interface GpsPosition {
  lat: number;
  lon: number;
  accuracy: number;
}

export function getGpsPosition(): Promise<GpsPosition> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      reject(new Error("Geolocation is not supported in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
      },
      (error) => reject(new Error(`Geolocation denied (${error.code})`)),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  });
}

/* ------------------------------------------------------------------
 * Open-Meteo reverse geocoding (free, key-less)
 * ------------------------------------------------------------------ */

export async function reverseGeocode(lat: number, lon: number): Promise<{ name: string; country: string } | null> {
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?latitude=${lat.toFixed(5)}&longitude=${lon.toFixed(5)}&count=1&language=en&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<{ name?: string; country?: string }> };
    const hit = data.results?.[0];
    if (!hit) return null;
    return { name: hit.name ?? "", country: hit.country ?? "" };
  } catch {
    return null;
  }
}
