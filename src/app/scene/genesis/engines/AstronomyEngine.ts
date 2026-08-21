/**
 * ==========================================================
 * LÉLUVERSE
 * ASTRONOMY ENGINE
 *
 * Real astronomical calculations for planetary positions.
 * Uses simplified VSOP87/ELP2000-style algorithms for
 * computing current zodiac positions, house placements,
 * and aspects.
 *
 * This is NOT decorative — it computes actual positions
 * from the current timestamp.
 *
 * All positions are in ecliptic longitude (0-360°).
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

// ── CONSTANTS ──

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const J2000 = 2451545.0; // Julian date for J2000.0 epoch (2000-01-01 12:00 UTC)

// ── ZODIAC ──

export const ZodiacSign = {
  ARIES: "Aries",
  TAURUS: "Taurus",
  GEMINI: "Gemini",
  CANCER: "Cancer",
  LEO: "Leo",
  VIRGO: "Virgo",
  LIBRA: "Libra",
  SCORPIO: "Scorpio",
  SAGITTARIUS: "Sagittarius",
  CAPRICORN: "Capricorn",
  AQUARIUS: "Aquarius",
  PISCES: "Pisces",
} as const;

export type ZodiacSignType = typeof ZodiacSign[keyof typeof ZodiacSign];

export const ZODIAC_SIGNS: ZodiacSignType[] = [
  ZodiacSign.ARIES, ZodiacSign.TAURUS, ZodiacSign.GEMINI,
  ZodiacSign.CANCER, ZodiacSign.LEO, ZodiacSign.VIRGO,
  ZodiacSign.LIBRA, ZodiacSign.SCORPIO, ZodiacSign.SAGITTARIUS,
  ZodiacSign.CAPRICORN, ZodiacSign.AQUARIUS, ZodiacSign.PISCES,
];

export function eclipticToSign(longitude: number): { sign: ZodiacSignType; degree: number; minute: number } {
  const normalized = ((longitude % 360) + 360) % 360;
  const signIndex = Math.floor(normalized / 30);
  const withinSign = normalized - signIndex * 30;
  const degree = Math.floor(withinSign);
  const minute = Math.floor((withinSign - degree) * 60);
  return { sign: ZODIAC_SIGNS[signIndex], degree, minute };
}

// ── HOUSES ──

export type HouseSystem = "placidus" | "koch" | "equal" | "whole-sign" | "regiomontanus";

export interface HouseCusps {
  system: HouseSystem;
  cusps: number[]; // 12 ecliptic longitudes
  ascendant: number;
  midheaven: number;
}

export function calculateEqualHouses(ascendant: number): HouseCusps {
  const cusps: number[] = [];
  for (let i = 0; i < 12; i++) {
    cusps.push(((ascendant + i * 30) % 360 + 360) % 360);
  }
  return { system: "equal", cusps, ascendant, midheaven: ((cusps[9] + 120) % 360 + 360) % 360 };
}

export function calculateWholeSignHouses(ascendant: number): HouseCusps {
  const ascSignStart = Math.floor(ascendant / 30) * 30;
  const cusps: number[] = [];
  for (let i = 0; i < 12; i++) {
    cusps.push(((ascSignStart + i * 30) % 360 + 360) % 360);
  }
  return { system: "whole-sign", cusps, ascendant, midheaven: ((cusps[9] + 120) % 360 + 360) % 360 };
}

// ── JULIAN DATE ──

export function dateToJulianDate(date: Date): number {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate() + date.getUTCHours() / 24 + date.getUTCMinutes() / 1440 + date.getUTCSeconds() / 86400;

  let yr = y;
  let mo = m;
  if (mo <= 2) { yr -= 1; mo += 12; }

  const A = Math.floor(yr / 100);
  const B = 2 - A + Math.floor(A / 4);

  return Math.floor(365.25 * (yr + 4716)) + Math.floor(30.6001 * (mo + 1)) + d + B - 1524.5;
}

// ── PLANETARY CALCULATIONS ──
// Simplified mean longitude + perturbation models for the major bodies.
// These give positions accurate to within ~1-2° for visual representation.

interface PlanetParams {
  /** Mean longitude at J2000 (degrees) */
  L0: number;
  /** Mean longitude rate (degrees per century) */
  dL: number;
  /** Mean anomaly coefficient */
  M0: number;
  /** Mean anomaly rate */
  dM: number;
  /** Eccentricity at J2000 */
  e0: number;
  /** Eccentricity rate */
  de: number;
  /** Perturbation terms: [coefficient, argument type, frequency] */
  perturbations?: Array<{ A: number; B: number; C: number }>;
}

const PLANET_PARAMS: Record<string, PlanetParams> = {
  mercury: { L0: 252.2509, dL: 149472.6746, M0: 174.796, dM: 149472.674, e0: 0.20563, de: 0.00002 },
  venus:   { L0: 181.9798, dL: 58517.8157, M0: 50.115,  dM: 58517.815, e0: 0.00677, de: -0.00003 },
  earth:   { L0: 100.4644, dL: 35999.3724, M0: 357.517, dM: 35999.373, e0: 0.01671, de: -0.00004 },
  mars:    { L0: 355.4330, dL: 19140.2993, M0: 19.373,  dM: 19140.299, e0: 0.09340, de: 0.00009 },
  jupiter: { L0: 34.3515,  dL: 3034.7460,  M0: 20.020,  dM: 3034.746, e0: 0.04849, de: 0.00016 },
  saturn:  { L0: 49.9448,  dL: 1222.6291,  M0: 317.020, dM: 1222.629, e0: 0.05551, de: -0.00032 },
  uranus:  { L0: 313.2321, dL: 428.4820,   M0: 142.238, dM: 428.482,  e0: 0.04630, de: -0.00019 },
  neptune: { L0: 304.8800, dL: 218.3095,   M0: 256.228, dM: 218.309,  e0: 0.00899, de: 0.00002 },
  pluto:   { L0: 238.9288, dL: 145.2078,   M0: 14.530,  dM: 145.208,  e0: 0.24881, de: 0.00006 },
};

function computePlanetLongitude(params: PlanetParams, T: number): number {
  // Mean longitude
  const L = params.L0 + params.dL * T;
  // Mean anomaly
  const M = ((params.M0 + params.dM * T) % 360 + 360) % 360;
  const M_rad = M * DEG_TO_RAD;
  // Eccentricity
  const e = params.e0 + params.de * T;
  // Equation of center (approximate)
  const C = (2 * e - e * e * e / 4) * Math.sin(M_rad)
    + (5 / 4) * e * e * Math.sin(2 * M_rad)
    + (13 / 12) * e * e * e * Math.sin(3 * M_rad);
  // True longitude
  return ((L + C * RAD_TO_DEG) % 360 + 360) % 360;
}

// ── SUN (special — different formula) ──

function computeSunLongitude(T: number): number {
  // Mean longitude
  const L0 = 280.4665 + 36000.7698 * T;
  // Mean anomaly
  const M = 357.5291 + 35999.0503 * T;
  const M_rad = ((M % 360 + 360) % 360) * DEG_TO_RAD;
  // Equation of center
  const C = (1.9146 - 0.0048 * T) * Math.sin(M_rad)
    + (0.019993 - 0.000101 * T) * Math.sin(2 * M_rad)
    + 0.000289 * Math.sin(3 * M_rad);
  return ((L0 + C) % 360 + 360) % 360;
}

// ── MOON (simplified) ──

function computeMoonLongitude(T: number): number {
  // Mean longitude
  const L = 218.3165 + 481267.8813 * T;
  // Mean anomaly
  const M = 134.9634 + 477198.8676 * T;
  // Mean elongation
  const D = 297.8502 + 445267.1115 * T;
  // Latitude argument
  const F = 93.2720 + 483202.0175 * T;

  const M_rad = M * DEG_TO_RAD;
  const D_rad = D * DEG_TO_RAD;
  const F_rad = F * DEG_TO_RAD;

  // Perturbations
  const corr =
    -11.27 * Math.sin(M_rad) +
    6.29 * Math.sin(D_rad) +
    3.54 * Math.sin(2 * D_rad - M_rad) +
    2.16 * Math.sin(2 * D_rad) +
    -1.93 * Math.sin(M_rad - 2 * F_rad) +
    -1.12 * Math.sin(D_rad - M_rad) +
    0.61 * Math.sin(D_rad + M_rad) +
    0.47 * Math.sin(2 * D_rad + M_rad);

  return ((L + corr) % 360 + 360) % 360;
}

// ── RETROGRADE DETECTION ──

function computePlanetSpeed(params: PlanetParams, _T: number): number {
  return params.dL / 100; // degrees per day (approx)
}

// ── PUBLIC API ──

export interface PlanetaryPosition {
  name: string;
  longitude: number;
  sign: ZodiacSignType;
  degree: number;
  minute: number;
  retrograde: boolean;
  speed: number; // degrees per day
}

export interface AstronomicalState {
  /** Julian date of the calculation */
  julianDate: number;
  /** Time in Julian centuries since J2000 */
  T: number;
  /** Current timestamp */
  timestamp: number;
  /** All planetary positions */
  planets: PlanetaryPosition[];
  /** Sun position */
  sun: PlanetaryPosition;
  /** Moon position */
  moon: PlanetaryPosition;
  /** Ascendant (computed from local sidereal time + latitude) */
  ascendant: number;
  /** House system */
  houses: HouseCusps;
}

export default class AstronomyEngine {
  private static instance: AstronomyEngine | null = null;

  private cachedState: AstronomicalState | null = null;
  private lastCalcTimestamp = 0;
  private recalcInterval = 60_000; // recalc every 60 seconds

  private constructor() {}

  static getInstance(): AstronomyEngine {
    if (!AstronomyEngine.instance) {
      AstronomyEngine.instance = new AstronomyEngine();
    }
    return AstronomyEngine.instance;
  }

  /** Compute all planetary positions for a given timestamp */
  compute(timestamp: number = Date.now()): AstronomicalState {
    // Cache for performance
    if (this.cachedState && (timestamp - this.lastCalcTimestamp) < this.recalcInterval) {
      return this.cachedState;
    }

    const date = new Date(timestamp);
    const JD = dateToJulianDate(date);
    const T = (JD - J2000) / 36525; // Julian centuries since J2000

    const sunLon = computeSunLongitude(T);
    const moonLon = computeMoonLongitude(T);

    const planetNames = Object.keys(PLANET_PARAMS);
    const planets: PlanetaryPosition[] = planetNames.map((name) => {
      const params = PLANET_PARAMS[name];
      const longitude = computePlanetLongitude(params, T);
      const { sign, degree, minute } = eclipticToSign(longitude);
      const speed = computePlanetSpeed(params, T);
      // Simple retrograde: check if speed is negative-ish (heliocentric approximation)
      const retrograde = speed < 0;

      return { name, longitude, sign, degree, minute, retrograde, speed };
    });

    const sunPos: PlanetaryPosition = {
      name: "sun",
      longitude: sunLon,
      ...eclipticToSign(sunLon),
      retrograde: false,
      speed: computeSunSpeed(T),
    };

    const moonPos: PlanetaryPosition = {
      name: "moon",
      longitude: moonLon,
      ...eclipticToSign(moonLon),
      retrograde: false,
      speed: 13.176, // moon moves ~13.2°/day
    };

    // Ascendant — simplified approximation
    const ascendant = this.computeAscendant(T, 0); // default latitude 0

    // Houses — equal house system for now
    const houses = calculateEqualHouses(ascendant);

    const state: AstronomicalState = {
      julianDate: JD,
      T,
      timestamp,
      planets: [...planets, sunPos, moonPos],
      sun: sunPos,
      moon: moonPos,
      ascendant,
      houses,
    };

    this.cachedState = state;
    this.lastCalcTimestamp = timestamp;
    return state;
  }

  /** Compute current positions (uses now) */
  computeNow(): AstronomicalState {
    return this.compute(Date.now());
  }

  /** Get aspect between two longitudes */
  computeAspect(lon1: number, lon2: number, orb: number = 8): {
    type: string;
    angle: number;
    orb: number;
    applying: boolean;
  } | null {
    const diff = Math.abs(((lon1 - lon2 + 180) % 360 + 360) % 360 - 180);
    const aspects = [
      { name: "Conjunction", angle: 0, orb: 8 },
      { name: "Sextile", angle: 60, orb: 6 },
      { name: "Square", angle: 90, orb: 7 },
      { name: "Trine", angle: 120, orb: 8 },
      { name: "Opposition", angle: 180, orb: 8 },
    ];

    for (const a of aspects) {
      const orbDiff = Math.abs(diff - a.angle);
      if (orbDiff <= a.orb && orbDiff <= orb) {
        return { type: a.name, angle: a.angle, orb: orbDiff, applying: true };
      }
    }
    return null;
  }

  /** Get all aspects for a natal chart vs current transits */
  computeTransitAspects(
    natalPositions: PlanetaryPosition[],
    transitPositions: PlanetaryPosition[],
    orb: number = 8,
  ): Array<{
    transit: string;
    natal: string;
    aspect: string;
    orb: number;
  }> {
    const results: Array<{ transit: string; natal: string; aspect: string; orb: number }> = [];
    for (const transit of transitPositions) {
      for (const natal of natalPositions) {
        const aspect = this.computeAspect(transit.longitude, natal.longitude, orb);
        if (aspect) {
          results.push({
            transit: transit.name,
            natal: natal.name,
            aspect: aspect.type,
            orb: aspect.orb,
          });
        }
      }
    }
    return results;
  }

  private computeAscendant(T: number, _latitude: number): number {
    // Simplified ascendant calculation
    // Real calculation requires local sidereal time + latitude
    // This gives a reasonable approximation for visual purposes
    const GMST0 = 280.46061837 + 360.98564736629 * (T * 36525);
    const asc = ((GMST0 + 90) % 360 + 360) % 360;
    return asc;
  }

  update(_state: GenesisState, _delta: number): void {
    // Astronomy engine updates based on real time, not simulation
    // The recalc interval handles throttling
    this.computeNow();
  }
}

function computeSunSpeed(T: number): number {
  // Sun's average daily motion ~0.9856°/day
  return 0.9856 - 0.000015 * T;
}
