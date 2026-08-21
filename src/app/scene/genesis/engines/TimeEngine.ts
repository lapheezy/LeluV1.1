/**
 * ==========================================================
 * LÉLUVERSE
 * TIME ENGINE
 *
 * Unified time state for all world systems.
 * Supports:
 *   - Real-world time (for astrology/astronomy)
 *   - World simulation time (for the fictional planet)
 *   - Day/night cycle time
 *   - Historical playback
 *   - Future simulation
 *
 * The astrology engine uses real-world time explicitly.
 * The fictional planet can use its own simulated time.
 * ==========================================================
 */

export type TimeMode = "real" | "simulation" | "paused" | "historical" | "future";

export interface TimeState {
  /** Real-world timestamp */
  realTimestamp: number;
  /** Simulation world timestamp */
  worldTimestamp: number;
  /** Current time mode */
  mode: TimeMode;
  /** Simulation speed multiplier (1 = real-time, 60 = 1 minute per second, etc.) */
  simulationSpeed: number;
  /** Day/night progress 0-1 */
  dayNightProgress: number;
  /** Current "hour" in the fictional world */
  worldHour: number;
  /** Current "day" in the fictional world */
  worldDay: number;
  /** Whether currently paused */
  paused: boolean;
  /** Historical snapshot reference */
  historicalReference: number | null;
}

export default class TimeEngine {
  private static instance: TimeEngine | null = null;

  private state: TimeState;
  private listeners = new Set<(state: TimeState) => void>();
  private tickInterval: ReturnType<typeof setInterval> | null = null;

  private constructor() {
    this.state = {
      realTimestamp: Date.now(),
      worldTimestamp: Date.now(),
      mode: "real",
      simulationSpeed: 1,
      dayNightProgress: 0,
      worldHour: 0,
      worldDay: 0,
      paused: false,
      historicalReference: null,
    };
  }

  static getInstance(): TimeEngine {
    if (!TimeEngine.instance) {
      TimeEngine.instance = new TimeEngine();
    }
    return TimeEngine.instance;
  }

  // ── PUBLIC API ──

  start(): void {
    if (this.tickInterval) return;
    this.tickInterval = setInterval(() => this.tick(), 100);
  }

  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
  }

  getState(): TimeState {
    return { ...this.state };
  }

  /** Get real-world timestamp (used for astrology) */
  getRealTimestamp(): number {
    return this.state.realTimestamp;
  }

  /** Get world simulation timestamp */
  getWorldTimestamp(): number {
    return this.state.worldTimestamp;
  }

  /** Set time mode */
  setMode(mode: TimeMode): void {
    this.state.mode = mode;
    this.state.paused = mode === "paused";
    this.emit();
  }

  /** Set simulation speed */
  setSimulationSpeed(speed: number): void {
    this.state.simulationSpeed = Math.max(0.1, Math.min(3600, speed));
    this.emit();
  }

  /** Jump to a specific date */
  jumpToDate(timestamp: number): void {
    this.state.mode = "historical";
    this.state.historicalReference = timestamp;
    this.state.worldTimestamp = timestamp;
    this.state.paused = true;
    this.emit();
  }

  /** Return to current real time */
  returnToNow(): void {
    this.state.mode = "real";
    this.state.historicalReference = null;
    this.state.paused = false;
    this.state.worldTimestamp = Date.now();
    this.emit();
  }

  /** Pause time */
  pause(): void {
    this.state.paused = true;
    this.state.mode = "paused";
    this.emit();
  }

  /** Resume time */
  resume(): void {
    this.state.paused = false;
    this.state.mode = "real";
    this.emit();
  }

  subscribe(listener: (state: TimeState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  shutdown(): void {
    this.stop();
    this.listeners.clear();
    TimeEngine.instance = null;
  }

  // ── INTERNAL ──

  private tick(): void {
    const now = Date.now();
    this.state.realTimestamp = now;

    if (!this.state.paused) {
      if (this.state.mode === "simulation") {
        this.state.worldTimestamp += this.state.simulationSpeed * 100; // 100ms ticks
      } else {
        this.state.worldTimestamp = now;
      }
    }

    // Compute day/night progress (12-hour cycle in the fictional world)
    const worldDate = new Date(this.state.worldTimestamp);
    const hours = worldDate.getUTCHours() + worldDate.getUTCMinutes() / 60;
    this.state.dayNightProgress = (hours % 24) / 24;
    this.state.worldHour = hours % 24;
    this.state.worldDay = Math.floor(this.state.worldTimestamp / (24 * 3600 * 1000));

    this.emit();
  }

  private emit(): void {
    const snapshot = { ...this.state };
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch { /* ignore */ }
    }
  }
}
