/**
 * ==========================================================
 * LÉLUVERSE
 * WEATHER ENGINE
 *
 * Real environmental simulation layer.
 * Weather is actual world state, not particle effects.
 *
 * Systems: clouds, wind, rain, lightning, storms, fog,
 * heat waves, atmospheric disturbances.
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

// ── TYPES ──

export type WeatherCondition = "clear" | "cloudy" | "overcast" | "rain" | "heavy-rain" | "storm" | "fog" | "heat-wave" | "snow" | "dust" | "hurricane";

export interface WeatherCell {
  id: string;
  /** Grid position (x, z) */
  gridX: number;
  gridZ: number;
  /** World coordinates */
  worldX: number;
  worldZ: number;
  /** Current condition */
  condition: WeatherCondition;
  /** Intensity 0-1 */
  intensity: number;
  /** Wind speed (m/s) */
  windSpeed: number;
  /** Wind direction (radians) */
  windDirection: number;
  /** Temperature (arbitrary units 0-1) */
  temperature: number;
  /** Humidity 0-1 */
  humidity: number;
  /** Cloud cover 0-1 */
  cloudCover: number;
  /** Precipitation rate */
  precipitation: number;
  /** Pressure */
  pressure: number;
}

export interface StormSystem {
  id: string;
  /** Position */
  x: number;
  z: number;
  /** Velocity */
  vx: number;
  vz: number;
  /** Type */
  type: "thunderstorm" | "hurricane" | "tornado" | "blizzard" | "dust-storm";
  /** Intensity 0-1 */
  intensity: number;
  /** Radius of effect */
  radius: number;
  /** Lifecycle phase */
  phase: "forming" | "developing" | "intensifying" | "mature" | "weakening" | "dissipating";
  /** Age in seconds */
  age: number;
  /** Max lifetime */
  maxAge: number;
  /** Eye position for hurricanes */
  eyeX?: number;
  eyeZ?: number;
}

// ── WEATHER ENGINE ──

export default class WeatherEngine {
  private static instance: WeatherEngine | null = null;

  private cells: Map<string, WeatherCell> = new Map();
  private storms: StormSystem[] = [];
  private gridSize = 50; // world units per cell
  private time = 0;
  private listeners = new Set<() => void>();

  private constructor() {}

  static getInstance(): WeatherEngine {
    if (!WeatherEngine.instance) {
      WeatherEngine.instance = new WeatherEngine();
    }
    return WeatherEngine.instance;
  }

  // ── PUBLIC API ──

  getCellAt(worldX: number, worldZ: number): WeatherCell {
    const gx = Math.floor(worldX / this.gridSize);
    const gz = Math.floor(worldZ / this.gridSize);
    const key = `${gx},${gz}`;
    let cell = this.cells.get(key);
    if (!cell) {
      cell = this.createCell(gx, gz);
      this.cells.set(key, cell);
    }
    return cell;
  }

  getStorms(): StormSystem[] {
    return [...this.storms];
  }

  getStormAt(x: number, z: number, radius: number): StormSystem | undefined {
    return this.storms.find((s) => {
      const dx = s.x - x;
      const dz = s.z - z;
      return Math.sqrt(dx * dx + dz * dz) < radius + s.radius;
    });
  }

  /** Spawn a storm at a world position */
  spawnStorm(
    x: number,
    z: number,
    type: StormSystem["type"] = "thunderstorm",
    intensity: number = 0.7,
  ): StormSystem {
    const storm: StormSystem = {
      id: `storm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      x, z,
      vx: (Math.random() - 0.5) * 2,
      vz: (Math.random() - 0.5) * 2,
      type,
      intensity,
      radius: type === "hurricane" ? 200 : 80,
      phase: "forming",
      age: 0,
      maxAge: type === "hurricane" ? 1200 : 300,
      ...(type === "hurricane" ? { eyeX: x, eyeZ: z } : {}),
    };
    this.storms.push(storm);
    this.emit();
    return storm;
  }

  /** Generate weather for a region */
  generateRegion(centerX: number, centerZ: number, radius: number): WeatherCell[] {
    const cells: WeatherCell[] = [];
    const minX = Math.floor((centerX - radius) / this.gridSize);
    const maxX = Math.ceil((centerX + radius) / this.gridSize);
    const minZ = Math.floor((centerZ - radius) / this.gridSize);
    const maxZ = Math.ceil((centerZ + radius) / this.gridSize);

    for (let gx = minX; gx <= maxX; gx++) {
      for (let gz = minZ; gz <= maxZ; gz++) {
        const key = `${gx},${gz}`;
        let cell = this.cells.get(key);
        if (!cell) {
          cell = this.createCell(gx, gz);
          this.cells.set(key, cell);
        }
        cells.push(cell);
      }
    }
    return cells;
  }

  update(_state: GenesisState, delta: number): void {
    this.time += delta;

    // Update cells
    for (const cell of this.cells.values()) {
      this.updateCell(cell, delta);
    }

    // Update storms
    for (let i = this.storms.length - 1; i >= 0; i--) {
      const storm = this.storms[i];
      this.updateStorm(storm, delta);
      if (storm.phase === "dissipating" && storm.intensity <= 0.01) {
        this.storms.splice(i, 1);
      }
    }

    this.emit();
  }

  shutdown(): void {
    this.cells.clear();
    this.storms = [];
    this.listeners.clear();
    WeatherEngine.instance = null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // ── INTERNAL ──

  private createCell(gx: number, gz: number): WeatherCell {
    // Procedural weather from coordinates
    const seed = gx * 31 + gz * 37;
    const hash = Math.sin(seed) * 10000;
    const r = hash - Math.floor(hash);

    return {
      id: `cell-${gx}-${gz}`,
      gridX: gx,
      gridZ: gz,
      worldX: gx * this.gridSize,
      worldZ: gz * this.gridSize,
      condition: (["clear", "cloudy", "clear", "clear", "overcast"] as WeatherCondition[])[Math.floor(r * 5)],
      intensity: 0.1 + r * 0.3,
      windSpeed: 1 + r * 5,
      windDirection: r * Math.PI * 2,
      temperature: 0.3 + r * 0.4,
      humidity: 0.2 + r * 0.6,
      cloudCover: r * 0.5,
      precipitation: 0,
      pressure: 1013 + (r - 0.5) * 30,
    };
  }

  private updateCell(cell: WeatherCell, delta: number): void {
    // Slowly evolve weather conditions
    const windEffect = Math.sin(this.time * 0.1 + cell.gridX * 0.5 + cell.gridZ * 0.3);
    cell.windDirection += windEffect * delta * 0.1;
    cell.windSpeed = Math.max(0, cell.windSpeed + windEffect * delta * 0.05);

    // Storm influence
    for (const storm of this.storms) {
      const dx = cell.worldX - storm.x;
      const dz = cell.worldZ - storm.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < storm.radius) {
        const influence = 1 - dist / storm.radius;
        cell.intensity = Math.min(1, cell.intensity + influence * storm.intensity * delta * 0.5);
        cell.precipitation = Math.min(1, cell.precipitation + influence * storm.intensity * delta * 0.3);
        if (storm.type === "hurricane") {
          cell.condition = storm.intensity > 0.7 ? "hurricane" : "storm";
        } else {
          cell.condition = "storm";
        }
      }
    }

    // Natural decay
    cell.precipitation = Math.max(0, cell.precipitation - delta * 0.01);
    cell.intensity = Math.max(0.05, cell.intensity - delta * 0.005);
  }

  private updateStorm(storm: StormSystem, delta: number): void {
    storm.age += delta;

    // Move
    storm.x += storm.vx * delta;
    storm.z += storm.vz * delta;
    if (storm.type === "hurricane" && storm.eyeX !== undefined && storm.eyeZ !== undefined) {
      storm.eyeX = storm.x;
      storm.eyeZ = storm.z;
    }

    // Lifecycle
    const lifeFraction = storm.age / storm.maxAge;
    if (lifeFraction < 0.15) {
      storm.phase = "forming";
      storm.intensity = Math.min(storm.intensity, lifeFraction / 0.15 * storm.intensity);
    } else if (lifeFraction < 0.35) {
      storm.phase = "developing";
    } else if (lifeFraction < 0.5) {
      storm.phase = "intensifying";
      storm.intensity = Math.min(1, storm.intensity + delta * 0.01);
    } else if (lifeFraction < 0.7) {
      storm.phase = "mature";
    } else if (lifeFraction < 0.9) {
      storm.phase = "weakening";
      storm.intensity = Math.max(0, storm.intensity - delta * 0.02);
    } else {
      storm.phase = "dissipating";
      storm.intensity = Math.max(0, storm.intensity - delta * 0.05);
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* ignore */ }
    }
  }
}
