/**
 * ==========================================================
 * LÉLUVERSE — INFINITE COSMOS ENGINE
 *
 * Makes the cosmos genuinely infinite through:
 * - Spatial partitioning (chunks)
 * - Procedural generation around camera
 * - Lazy loading/unloading
 * - Persistent coordinates (deterministic from seed)
 * - Level-of-detail rendering
 *
 * The cosmos has no outer boundary. The user can pan
 * outward indefinitely and new space streams in.
 * ==========================================================
 */

// ── CONSTANTS ──

/** Chunk size in world units */
const CHUNK_SIZE = 40;

/** How many chunks to keep loaded in each direction */
const CHUNK_RADIUS = 3;

/** Star density per chunk (base) */
const BASE_STAR_DENSITY = 12;

/** Galaxy spawn chance per chunk (0-1) */
const GALAXY_CHANCE = 0.08;

/** Nebula spawn chance per chunk */
const NEBULA_CHANCE = 0.05;

/** Black hole spawn chance per chunk */
const BLACK_HOLE_CHANCE = 0.005;

/** Chunks farther than this (in chunks, any axis) from the camera are unloaded */
const UNLOAD_RADIUS = CHUNK_RADIUS + 2;

/**
 * Hard ceiling on loaded chunks. The camera's unload ring alone holds at
 * most (2·UNLOAD_RADIUS+1)³ = 1331 and streaming never exceeds that;
 * preloads around a destination are the only way past it, so the cap is
 * one ring plus one preload (7³ = 343). Farthest-from-camera chunks go
 * first. Before this, every preload away from the camera added 343
 * chunks that nothing removed until the camera next crossed a boundary.
 */
const MAX_LOADED_CHUNKS = 1331 + 343;

type RenderableData = {
  stars: StarData[];
  galaxies: GalaxyData[];
  nebulae: NebulaData[];
  blackHoles: BlackHoleData[];
};

// ── TYPES ──

export interface ChunkCoord {
  cx: number;
  cy: number;
  cz: number;
}

export interface StarData {
  id: string;
  x: number;
  y: number;
  z: number;
  size: number;
  hue: number;
  brightness: number;
  twinkleSpeed: number;
  twinklePhase: number;
}

export interface GalaxyData {
  id: string;
  x: number;
  y: number;
  z: number;
  size: number;
  hue: number;
  rotation: number;
  spiralArms: number;
  type: 'spiral' | 'elliptical' | 'irregular';
}

export interface NebulaData {
  id: string;
  x: number;
  y: number;
  z: number;
  size: number;
  hue: number;
  opacity: number;
}

export interface BlackHoleData {
  id: string;
  x: number;
  y: number;
  z: number;
  size: number;
  accretionHue: number;
}

export interface CosmicChunk {
  coord: ChunkCoord;
  stars: StarData[];
  galaxies: GalaxyData[];
  nebulae: NebulaData[];
  blackHoles: BlackHoleData[];
  generated: boolean;
  lastAccessed: number;
}

export interface InfiniteCosmosState {
  /** Active chunks keyed by "cx,cy,cz" */
  chunks: Map<string, CosmicChunk>;
  /** Camera chunk position */
  cameraChunk: ChunkCoord;
  /** Total generated chunks */
  totalChunksGenerated: number;
  /** Total stars rendered */
  totalStars: number;
}

// ── SEEDED RANDOM ──

function hashCoords(cx: number, cy: number, cz: number): number {
  let h = cx * 374761393 + cy * 668265263 + cz * 1274126177;
  h = (h ^ (h >> 13)) * 1103515245;
  h = h ^ (h >> 16);
  return (h & 0x7fffffff) / 0x7fffffff;
}

function seededRandom(seed: number): () => number {
  let s = seed * 2147483647 + 1;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── PROCEDURAL GENERATION ──

function generateChunk(coord: ChunkCoord): CosmicChunk {
  const seed = hashCoords(coord.cx, coord.cy, coord.cz);
  const rng = seededRandom(Math.floor(seed * 1000000) + 1);

  const baseX = coord.cx * CHUNK_SIZE;
  const baseY = coord.cy * CHUNK_SIZE;
  const baseZ = coord.cz * CHUNK_SIZE;

  // Vary density based on distance from origin (sparser at edges)
  const distFromOrigin = Math.sqrt(coord.cx ** 2 + coord.cy ** 2 + coord.cz ** 2);
  const densityFactor = Math.max(0.3, 1 - distFromOrigin * 0.02);

  const chunk: CosmicChunk = {
    coord,
    stars: [],
    galaxies: [],
    nebulae: [],
    blackHoles: [],
    generated: true,
    lastAccessed: Date.now(),
  };

  // Generate stars
  const starCount = Math.floor(BASE_STAR_DENSITY * densityFactor * (0.5 + rng()));
  for (let i = 0; i < starCount; i++) {
    chunk.stars.push({
      id: `star-${coord.cx},${coord.cy},${coord.cz}-${i}`,
      x: baseX + rng() * CHUNK_SIZE,
      y: baseY + rng() * CHUNK_SIZE,
      z: baseZ + rng() * CHUNK_SIZE,
      size: 0.02 + rng() * 0.08,
      hue: rng() * 360,
      brightness: 0.5 + rng() * 0.5,
      twinkleSpeed: 0.5 + rng() * 2,
      twinklePhase: rng() * Math.PI * 2,
    });
  }

  // Generate galaxies
  if (rng() < GALAXY_CHANCE * densityFactor) {
    const typeRoll = rng();
    chunk.galaxies.push({
      id: `galaxy-${coord.cx},${coord.cy},${coord.cz}`,
      x: baseX + rng() * CHUNK_SIZE,
      y: baseY + rng() * CHUNK_SIZE,
      z: baseZ + rng() * CHUNK_SIZE,
      size: 1.5 + rng() * 3,
      hue: rng() * 360,
      rotation: rng() * Math.PI * 2,
      spiralArms: typeRoll < 0.6 ? 2 + Math.floor(rng() * 3) : 0,
      type: typeRoll < 0.6 ? 'spiral' : typeRoll < 0.85 ? 'elliptical' : 'irregular',
    });
  }

  // Generate nebulae
  if (rng() < NEBULA_CHANCE * densityFactor) {
    chunk.nebulae.push({
      id: `nebula-${coord.cx},${coord.cy},${coord.cz}`,
      x: baseX + rng() * CHUNK_SIZE,
      y: baseY + rng() * CHUNK_SIZE,
      z: baseZ + rng() * CHUNK_SIZE,
      size: 2 + rng() * 5,
      hue: rng() * 360,
      opacity: 0.05 + rng() * 0.15,
    });
  }

  // Generate black holes (rare)
  if (rng() < BLACK_HOLE_CHANCE) {
    chunk.blackHoles.push({
      id: `bh-${coord.cx},${coord.cy},${coord.cz}`,
      x: baseX + rng() * CHUNK_SIZE,
      y: baseY + rng() * CHUNK_SIZE,
      z: baseZ + rng() * CHUNK_SIZE,
      size: 0.3 + rng() * 0.7,
      accretionHue: 20 + rng() * 30,
    });
  }

  return chunk;
}

// ── INFINITE COSMOS ENGINE ──

export default class InfiniteCosmos {
  private static instance: InfiniteCosmos | null = null;

  private chunks: Map<string, CosmicChunk> = new Map();
  private cameraChunk: ChunkCoord = { cx: 0, cy: 0, cz: 0 };
  private cameraWorldPos = { x: 0, y: 0, z: 0 };
  private totalGenerated = 0;
  private listeners = new Set<() => void>();
  /**
   * Flattened render data, built once per change. The scene has four
   * subscribers (stars, galaxies, nebulae, black holes); each used to
   * rebuild the whole flat array from every chunk on every emit.
   */
  private renderable: RenderableData | null = null;

  private constructor() {}

  static getInstance(): InfiniteCosmos {
    if (!InfiniteCosmos.instance) {
      InfiniteCosmos.instance = new InfiniteCosmos();
    }
    return InfiniteCosmos.instance;
  }

  // ── CAMERA TRACKING ──

  /** Update the camera world position — called every frame from CosmosLayer */
  updateCameraPosition(x: number, y: number, z: number): void {
    this.cameraWorldPos = { x, y, z };

    const newChunk: ChunkCoord = {
      cx: Math.floor(x / CHUNK_SIZE),
      cy: Math.floor(y / CHUNK_SIZE),
      cz: Math.floor(z / CHUNK_SIZE),
    };

    // Only update if we crossed a chunk boundary
    if (
      newChunk.cx !== this.cameraChunk.cx ||
      newChunk.cy !== this.cameraChunk.cy ||
      newChunk.cz !== this.cameraChunk.cz
    ) {
      this.cameraChunk = newChunk;
      this.streamChunks();
    }
  }

  // ── CHUNK STREAMING ──

  private streamChunks(): void {
    const added = this.ensureAround(this.cameraChunk);
    const removed = this.unloadFar();
    if (added || removed) this.changed();
  }

  /** Generate any missing chunk within CHUNK_RADIUS of a center. Returns how many were added. */
  private ensureAround(center: ChunkCoord): number {
    const now = Date.now();
    let added = 0;
    for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
      for (let dy = -CHUNK_RADIUS; dy <= CHUNK_RADIUS; dy++) {
        for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
          const coord = { cx: center.cx + dx, cy: center.cy + dy, cz: center.cz + dz };
          const key = `${coord.cx},${coord.cy},${coord.cz}`;
          const existing = this.chunks.get(key);
          if (existing) {
            existing.lastAccessed = now;
            continue;
          }
          this.chunks.set(key, generateChunk(coord));
          this.totalGenerated++;
          added++;
        }
      }
    }
    return added;
  }

  /** Drop chunks outside the camera's unload ring. Returns how many were removed. */
  private unloadFar(): number {
    const { cx, cy, cz } = this.cameraChunk;
    let removed = 0;
    for (const [key, chunk] of this.chunks) {
      const d = Math.max(
        Math.abs(chunk.coord.cx - cx),
        Math.abs(chunk.coord.cy - cy),
        Math.abs(chunk.coord.cz - cz),
      );
      if (d > UNLOAD_RADIUS) {
        this.chunks.delete(key);
        removed++;
      }
    }
    return removed + this.enforceCap();
  }

  /** Evict farthest-from-camera chunks (never the camera's own ring) until under the cap. */
  private enforceCap(): number {
    const excess = this.chunks.size - MAX_LOADED_CHUNKS;
    if (excess <= 0) return 0;
    const { cx, cy, cz } = this.cameraChunk;
    const candidates: Array<[string, number]> = [];
    for (const [key, chunk] of this.chunks) {
      const d = Math.max(
        Math.abs(chunk.coord.cx - cx),
        Math.abs(chunk.coord.cy - cy),
        Math.abs(chunk.coord.cz - cz),
      );
      if (d > CHUNK_RADIUS) candidates.push([key, d]);
    }
    candidates.sort((a, b) => b[1] - a[1]);
    let removed = 0;
    for (const [key] of candidates.slice(0, excess)) {
      this.chunks.delete(key);
      removed++;
    }
    return removed;
  }

  private changed(): void {
    this.renderable = null;
    this.emit();
  }

  // ── PUBLIC API ──

  /** Get all currently loaded chunks */
  getChunks(): CosmicChunk[] {
    return Array.from(this.chunks.values());
  }

  /**
   * Get chunks as a flat array of renderable objects. The same snapshot is
   * returned until the loaded set changes, so subscribers can compare by
   * reference and share one build.
   */
  getRenderableData(): RenderableData {
    if (this.renderable) return this.renderable;
    const stars: StarData[] = [];
    const galaxies: GalaxyData[] = [];
    const nebulae: NebulaData[] = [];
    const blackHoles: BlackHoleData[] = [];

    for (const chunk of this.chunks.values()) {
      for (const star of chunk.stars) stars.push(star);
      for (const galaxy of chunk.galaxies) galaxies.push(galaxy);
      for (const nebula of chunk.nebulae) nebulae.push(nebula);
      for (const hole of chunk.blackHoles) blackHoles.push(hole);
    }

    this.renderable = { stars, galaxies, nebulae, blackHoles };
    return this.renderable;
  }

  /** Get chunk at a world position */
  getChunkAt(x: number, y: number, z: number): CosmicChunk | undefined {
    const key = `${Math.floor(x / CHUNK_SIZE)},${Math.floor(y / CHUNK_SIZE)},${Math.floor(z / CHUNK_SIZE)}`;
    return this.chunks.get(key);
  }

  /** Get the current camera chunk position */
  getCameraChunk(): ChunkCoord {
    return { ...this.cameraChunk };
  }

  /** Get camera world position */
  getCameraPosition(): { x: number; y: number; z: number } {
    return { ...this.cameraWorldPos };
  }

  /** Get total chunks generated */
  getTotalGenerated(): number {
    return this.totalGenerated;
  }

  /** Get total loaded chunks */
  getLoadedCount(): number {
    return this.chunks.size;
  }

  /**
   * Force generate chunks around a specific position (for preloading a
   * destination before the camera gets there). Subscribers are notified
   * when anything new was generated — the first preload at mount is what
   * fills the sky, and it used to be silent, so the star field mounted
   * empty and stayed empty until the camera crossed a chunk boundary.
   */
  preloadAround(x: number, y: number, z: number): void {
    const added = this.ensureAround(InfiniteCosmos.worldToChunk(x, y, z));
    if (added === 0) return;
    this.enforceCap();
    this.changed();
  }

  /** Check if a world position is within loaded chunks */
  isPositionLoaded(x: number, y: number, z: number): boolean {
    return this.getChunkAt(x, y, z) !== undefined;
  }

  /** Convert world position to chunk key */
  static worldToChunk(x: number, y: number, z: number): ChunkCoord {
    return {
      cx: Math.floor(x / CHUNK_SIZE),
      cy: Math.floor(y / CHUNK_SIZE),
      cz: Math.floor(z / CHUNK_SIZE),
    };
  }

  /** Convert chunk to world origin */
  static chunkToWorld(coord: ChunkCoord): { x: number; y: number; z: number } {
    return {
      x: coord.cx * CHUNK_SIZE,
      y: coord.cy * CHUNK_SIZE,
      z: coord.cz * CHUNK_SIZE,
    };
  }

  /** Get chunk size */
  static getChunkSize(): number {
    return CHUNK_SIZE;
  }

  /** Hard ceiling on loaded chunks */
  static getMaxLoadedChunks(): number {
    return MAX_LOADED_CHUNKS;
  }

  // ── SUBSCRIPTIONS ──

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* swallow */ }
    }
  }

  /** Drop every loaded chunk without regenerating (coordinates stay deterministic). */
  clear(): void {
    this.chunks.clear();
    this.changed();
  }

  /** Reset and regenerate all chunks */
  reset(): void {
    this.chunks.clear();
    this.totalGenerated = 0;
    this.streamChunks();
    // streamChunks only emits on a difference; a reset always is one.
    this.changed();
  }

  /** Get stats for diagnostics */
  getStats() {
    return {
      loadedChunks: this.chunks.size,
      totalGenerated: this.totalGenerated,
      cameraChunk: { ...this.cameraChunk },
      totalStars: Array.from(this.chunks.values()).reduce((s, c) => s + c.stars.length, 0),
      totalGalaxies: Array.from(this.chunks.values()).reduce((s, c) => s + c.galaxies.length, 0),
      totalNebulae: Array.from(this.chunks.values()).reduce((s, c) => s + c.nebulae.length, 0),
      totalBlackHoles: Array.from(this.chunks.values()).reduce((s, c) => s + c.blackHoles.length, 0),
    };
  }
}
