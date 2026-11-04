/**
 * ==========================================================
 * LÉLU HOME — WEATHER (real, keyless: Open-Meteo)
 *
 * Where: the place LÉLU already knows (ProactiveCore's location,
 * geocoded), or the device's position when the person taps "use my
 * location" (never asked for on load). Remembered, so the card shows
 * the next time without asking again.
 *
 * What: current temperature and conditions, and a one-line look at the
 * next two hours ("Rain in 60m", "Clear for the next 2h").
 * ==========================================================
 */

import { endpoint } from "../../../../core/Endpoints";
import KvStore from "../../../../core/storage/KvStore";

export interface HomePlace {
  name: string;
  latitude: number;
  longitude: number;
}

export interface HomeWeather {
  place: string;
  temperatureC: number;
  code: number;
  isDay: boolean;
  /** "Rain in 60m" / "Clear for the next 2h" … */
  outlook: string;
  /** Precipitation probability (0–100) for each of the next hours, for the bar strip. */
  nextHours: number[];
  fetchedAt: number;
}

const PLACE_KEY = "lelu.home.place.v1";

/** WMO weather code → short words. */
export function describeWeather(code: number): string {
  if (code === 0) return "Clear";
  if (code <= 2) return "Partly cloudy";
  if (code === 3) return "Overcast";
  if (code === 45 || code === 48) return "Fog";
  if (code >= 51 && code <= 57) return "Drizzle";
  if (code >= 61 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 85 && code <= 86) return "Snow showers";
  if (code >= 95) return "Thunderstorm";
  return "—";
}

export function isWet(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

/** "Rain in 60m" from hourly precipitation probabilities, starting at the current hour. */
export function outlookFrom(probabilities: number[], codeNow: number): string {
  if (isWet(codeNow)) return "Raining now";
  const next = probabilities.findIndex((p, i) => i > 0 && p >= 50);
  if (next > 0 && next <= 3) return `Rain in ${next * 60}m`;
  return `Dry for the next ${Math.max(1, Math.min(3, probabilities.length - 1))}h`;
}

export function savedPlace(): HomePlace | null {
  const place = KvStore.getInstance().get<HomePlace>(PLACE_KEY);
  return place && typeof place.latitude === "number" ? place : null;
}

export function savePlace(place: HomePlace): void {
  KvStore.getInstance().set(PLACE_KEY, place);
}

export async function geocode(name: string): Promise<HomePlace | null> {
  const res = await fetch(`${endpoint("openMeteoGeocoding")}/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`);
  if (!res.ok) return null;
  const place = (await res.json()).results?.[0];
  return place ? { name: place.name, latitude: place.latitude, longitude: place.longitude } : null;
}

/** The device's position, named by reverse lookup when possible. Asks the browser — call only on a tap. */
export function devicePlace(): Promise<HomePlace> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Location is not available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ name: "Here", latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
      (err) => reject(new Error(err.message || "Location was not allowed.")),
      { timeout: 10_000, maximumAge: 30 * 60_000 },
    );
  });
}

export async function fetchWeather(place: HomePlace): Promise<HomeWeather> {
  const url =
    `${endpoint("openMeteo")}/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    "&current=temperature_2m,weather_code,is_day&hourly=precipitation_probability&forecast_hours=4&timezone=auto";
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
  const json = (await res.json()) as {
    current?: { temperature_2m?: number; weather_code?: number; is_day?: number };
    hourly?: { precipitation_probability?: number[] };
  };
  const code = json.current?.weather_code ?? 0;
  const hours = (json.hourly?.precipitation_probability ?? []).slice(0, 4);
  return {
    place: place.name,
    temperatureC: Math.round(json.current?.temperature_2m ?? 0),
    code,
    isDay: json.current?.is_day !== 0,
    outlook: outlookFrom(hours, code),
    nextHours: hours,
    fetchedAt: Date.now(),
  };
}
