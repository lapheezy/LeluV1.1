/**
 * ==========================================================
 * LÉLUVERSE
 * WORLD REGISTRY — Discoverable destination catalog
 *
 * A centralized registry of every location LÉLU can direct
 * her attention toward. Panels auto-register on mount and
 * unregister on unmount. Cosmos waypoints, workspaces, and
 * dynamic destinations are also tracked here.
 *
 * The GenesisPresenceEngine queries this registry instead of
 * maintaining hardcoded lists, so newly created UI surfaces
 * become discoverable without code changes.
 *
 * Offline-first: no external API dependency.
 * ==========================================================
 */

export type DestinationKind = "panel" | "cosmos" | "workspace" | "agent" | "simulation" | "visualization" | "tab" | "environment";

export interface WorldDestination {
  /** Unique key (e.g. "chat", "cosmos-earth", "workspace-memory") */
  key: string;
  /** Human-readable label */
  label: string;
  /** Category for attention selection */
  kind: DestinationKind;
  /** Priority weight (0-1, higher = more likely to be explored) */
  weight: number;
  /** Short-range = nearby UI, medium = inter-panel, long = cosmos */
  scale: "short" | "medium" | "long";
  /** Optional metadata */
  meta?: Record<string, unknown>;
}

interface CoverageEntry {
  count: number;
  lastVisited: number;
}

export default class WorldRegistry {
  private static instance: WorldRegistry | null = null;

  /** All known destinations. key → descriptor. */
  private destinations = new Map<string, WorldDestination>();

  /** Coverage tracker: how many times each destination was visited */
  private coverage = new Map<string, CoverageEntry>();

  /** Recently visited keys (ordered: oldest → newest) */
  private recent: string[] = [];

  /** Maximum recent buffer */
  private static readonly RECENT_MAX = 20;

  /** How many ticks after visiting before a destination can be revisited */
  private static readonly COOLDOWN_TICKS = 6;

  private ticks = 0;

  private constructor() {}

  public static getInstance(): WorldRegistry {
    if (!WorldRegistry.instance) {
      WorldRegistry.instance = new WorldRegistry();
    }
    return WorldRegistry.instance;
  }

  /* -------------------------------------------------------------
   * Registration
   * ------------------------------------------------------------- */

  /** Register a destination. Idempotent (updates if already exists). */
  public register(dest: WorldDestination): void {
    this.destinations.set(dest.key, dest);
    if (!this.coverage.has(dest.key)) {
      this.coverage.set(dest.key, { count: 0, lastVisited: 0 });
    }
  }

  /** Remove a destination from the registry. */
  public unregister(key: string): void {
    this.destinations.delete(key);
    // Keep coverage for tracking even after removal
  }

  /** Check if a key is registered. */
  public has(key: string): boolean {
    return this.destinations.has(key);
  }

  /* -------------------------------------------------------------
   * Exploration & Selection
   * ------------------------------------------------------------- */

  /** Mark a destination as visited (update coverage). */
  public markVisited(key: string): void {
    const entry = this.coverage.get(key);
    if (entry) {
      entry.count++;
      entry.lastVisited = this.ticks;
    } else {
      this.coverage.set(key, { count: 1, lastVisited: this.ticks });
    }
    // Add to recency list
    this.recent = [
      ...this.recent.filter((k) => k !== key),
      key,
    ].slice(-WorldRegistry.RECENT_MAX);
  }

  /** Increment the global tick. */
  public tick(): void {
    this.ticks++;
  }

  /**
   * Select the best destination for LÉLU's attention given a scale.
   *
   * Scoring:
   *  - Higher weight → higher score
   *  - Recently visited → big penalty
   *  - Never visited → bonus
   *  - Over-visited (count > avg) → penalty
   *
   * Returns the selected destination or null if none qualify.
   */
  public selectAttention(scale: "short" | "medium" | "long" | DestinationKind | "all" = "all"): WorldDestination | null {
    const candidates = Array.from(this.destinations.values());

    if (candidates.length === 0) return null;

    // Compute average visits for normalization
    const totalVisits = Array.from(this.coverage.values()).reduce((sum, e) => sum + e.count, 0);
    const avgVisits = totalVisits / Math.max(1, this.coverage.size);

    let bestScore = -Infinity;
    let best: WorldDestination | null = null;

    for (const dest of candidates) {
      const cov = this.coverage.get(dest.key) ?? { count: 0, lastVisited: 0 };

      // Base: weight (0-1)
      let score = dest.weight * 10;

      // Recency penalty: exponentially decays over cooldown period
      const ticksSince = this.ticks - cov.lastVisited;
      if (ticksSince < WorldRegistry.COOLDOWN_TICKS) {
        const recencyFactor = ticksSince / WorldRegistry.COOLDOWN_TICKS; // 0..1
        score *= recencyFactor * recencyFactor; // quadratic
      }

      // Coverage penalty: if visited more than average
      if (cov.count > avgVisits && avgVisits > 0) {
        score *= avgVisits / cov.count;
      }

      // Never-visited bonus
      if (cov.count === 0) {
        score *= 2.0;
      }

      // Scale match bonus
      // Scale match: if the requested scale matches the destination's scale, boost
      if (scale === dest.scale) {
        score *= 1.5;
      }

      if (score > bestScore) {
        bestScore = score;
        best = dest;
      }
    }

    return best;
  }

  /** Get destinations of a given scale. */
  public byScale(scale: "short" | "medium" | "long"): WorldDestination[] {
    return Array.from(this.destinations.values()).filter((d) => d.scale === scale);
  }

  /** How many destinations are registered. */
  public get size(): number {
    return this.destinations.size;
  }

  /** Dump debug info. */
  public debug(): { destinations: WorldDestination[]; coverage: Record<string, CoverageEntry> } {
    return {
      destinations: Array.from(this.destinations.values()),
      coverage: Object.fromEntries(this.coverage),
    };
  }
}