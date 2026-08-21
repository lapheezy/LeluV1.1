/**
 * ==========================================================
 * LÉLUVERSE
 * FLOATING CITY ENGINE
 *
 * Floating cities are actual persistent world objects,
 * not decorative models.
 *
 * Each city has position, altitude, population, structures,
 * energy, weather interaction, and movement.
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";
import KvStore from "../../../../core/storage/KvStore";

// ── TYPES ──

export interface FloatingCity {
  id: string;
  name: string;
  /** World position */
  x: number;
  y: number; // altitude
  z: number;
  /** Velocity (for drifting) */
  vx: number;
  vy: number;
  vz: number;
  /** Base altitude */
  baseAltitude: number;
  /** Current drift target */
  driftTargetX: number;
  driftTargetZ: number;
  /** Population */
  population: number;
  /** Structures count */
  structures: number;
  /** Energy level 0-1 */
  energy: number;
  /** Weather influence */
  windInfluence: number;
  /** Districts */
  districts: string[];
  /** Landmarks */
  landmarks: string[];
  /** Scale */
  scale: number;
  /** Visual color hue */
  hue: number;
  /** Whether anchored (stable) or drifting */
  anchored: boolean;
}

// ── FLOATING CITY ENGINE ──

const CITIES_KEY = "lelu.world.floatingCities.v1";

export default class FloatingCityEngine {
  private static instance: FloatingCityEngine | null = null;

  private cities: FloatingCity[] = [];
  private time = 0;
  private listeners = new Set<() => void>();

  private constructor() {
    this.loadCities();
  }

  static getInstance(): FloatingCityEngine {
    if (!FloatingCityEngine.instance) {
      FloatingCityEngine.instance = new FloatingCityEngine();
    }
    return FloatingCityEngine.instance;
  }

  // ── PUBLIC API ──

  getCities(): FloatingCity[] {
    return [...this.cities];
  }

  getCityById(id: string): FloatingCity | undefined {
    return this.cities.find((c) => c.id === id);
  }

  getCitiesNear(x: number, z: number, radius: number): FloatingCity[] {
    return this.cities.filter((c) => {
      const dx = c.x - x;
      const dz = c.z - z;
      return Math.sqrt(dx * dx + dz * dz) < radius;
    });
  }

  /** Spawn a new floating city */
  spawnCity(params: {
    name: string;
    x: number;
    z: number;
    altitude?: number;
    population?: number;
    hue?: number;
  }): FloatingCity {
    const city: FloatingCity = {
      id: `city-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: params.name,
      x: params.x,
      y: params.altitude ?? 30 + Math.random() * 40,
      z: params.z,
      vx: 0,
      vy: 0,
      vz: 0,
      baseAltitude: params.altitude ?? 30 + Math.random() * 40,
      driftTargetX: params.x,
      driftTargetZ: params.z,
      population: params.population ?? 1000 + Math.floor(Math.random() * 50000),
      structures: 10 + Math.floor(Math.random() * 200),
      energy: 0.5 + Math.random() * 0.5,
      windInfluence: 0.1 + Math.random() * 0.3,
      districts: ["Central", "Residential", "Commercial", "Industrial"],
      landmarks: ["Central Spire", "Harbor District"],
      scale: 0.5 + Math.random() * 1.5,
      hue: params.hue ?? 180 + Math.random() * 60,
      anchored: Math.random() > 0.3,
    };
    this.cities.push(city);
    this.persist();
    this.emit();
    return city;
  }

  /** Remove a city */
  removeCity(id: string): boolean {
    const idx = this.cities.findIndex((c) => c.id === id);
    if (idx >= 0) {
      this.cities.splice(idx, 1);
      this.persist();
      this.emit();
      return true;
    }
    return false;
  }

  update(_state: GenesisState, delta: number): void {
    this.time += delta;

    for (const city of this.cities) {
      if (!city.anchored) {
        // Drift toward target
        const dx = city.driftTargetX - city.x;
        const dz = city.driftTargetZ - city.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        if (dist > 1) {
          city.vx += (dx / dist) * 0.01 * delta;
          city.vz += (dz / dist) * 0.01 * delta;
        }

        // Wind influence
        const windX = Math.sin(this.time * 0.05 + city.x * 0.01) * city.windInfluence;
        const windZ = Math.cos(this.time * 0.03 + city.z * 0.01) * city.windInfluence;
        city.vx += windX * delta * 0.01;
        city.vz += windZ * delta * 0.01;

        // Damping
        city.vx *= 0.99;
        city.vz *= 0.99;

        // Apply
        city.x += city.vx * delta;
        city.z += city.vz * delta;

        // Altitude fluctuation
        city.y = city.baseAltitude + Math.sin(this.time * 0.2 + city.x * 0.1) * 2;

        // Set new drift target occasionally
        if (Math.random() < 0.001) {
          city.driftTargetX = city.x + (Math.random() - 0.5) * 100;
          city.driftTargetZ = city.z + (Math.random() - 0.5) * 100;
        }
      } else {
        // Anchored: gentle hover
        city.y = city.baseAltitude + Math.sin(this.time * 0.3 + city.x * 0.05) * 0.5;
      }
    }

    this.emit();
  }

  shutdown(): void {
    this.cities = [];
    this.listeners.clear();
    FloatingCityEngine.instance = null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private loadCities(): void {
    try {
      const stored = KvStore.getInstance().get<FloatingCity[]>(CITIES_KEY);
      if (stored) this.cities = stored;
    } catch { /* ignore */ }
  }

  private persist(): void {
    try { KvStore.getInstance().set(CITIES_KEY, this.cities); } catch { /* ignore */ }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* ignore */ }
    }
  }
}
