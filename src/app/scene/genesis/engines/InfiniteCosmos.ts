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
    const { cx, cy, cz } = this.cameraChunk;

    // Generate missing chunks within radius
    for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
      for (let dy = -CHUNK_RADIUS; dy <= CHUNK_RADIUS; dy++) {
        for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
          const key = `${cx + dx},${cy + dy},${cz + dz}`;
          if (!this.chunks.has(key)) {
            this.chunks.set(key, generateChunk({ cx: cx + dx, cy: cy + dy, cz: cz + dz }));
            this.totalGenerated++;
          }
        }
      }
    }

    // Unload chunks outside extended radius
    const unloadRadius = CHUNK_RADIUS + 2;
    for (const [key, chunk] of this.chunks) {
      const dcx = chunk.coord.cx - cx;
      const dcy = chunk.coord.cy - cy;
      const dcz = chunk.coord.cz - cz;
      if (Math.abs(dcx) > unloadRadius || Math.abs(dcy) > unloadRadius || Math.abs(dcz) > unloadRadius) {
        this.chunks.delete(key);
      }
    }

    this.emit();
  }

  // ── PUBLIC API ──

  /** Get all currently loaded chunks */
  getChunks(): CosmicChunk[] {
    return Array.from(this.chunks.values());
  }

  /** Get chunks as a flat array of renderable objects */
  getRenderableData(): {
    stars: StarData[];
    galaxies: GalaxyData[];
    nebulae: NebulaData[];
    blackHoles: BlackHoleData[];
  } {
    const stars: StarData[] = [];
    const galaxies: GalaxyData[] = [];
    const nebulae: NebulaData[] = [];
    const blackHoles: BlackHoleData[] = [];

    for (const chunk of this.chunks.values()) {
      stars.push(...chunk.stars);
      galaxies.push(...chunk.galaxies);
      nebulae.push(...chunk.nebulae);
      blackHoles.push(...chunk.blackHoles);
    }

    return { stars, galaxies, nebulae, blackHoles };
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

  /** Force generate chunks around a specific position (for preloading) */
  preloadAround(x: number, y: number, z: number): void {
    const center: ChunkCoord = {
      cx: Math.floor(x / CHUNK_SIZE),
      cy: Math.floor(y / CHUNK_SIZE),
      cz: Math.floor(z / CHUNK_SIZE),
    };

    for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
      for (let dy = -CHUNK_RADIUS; dy <= CHUNK_RADIUS; dy++) {
        for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
          const key = `${center.cx + dx},${center.cy + dy},${center.cz + dz}`;
          if (!this.chunks.has(key)) {
            this.chunks.set(key, generateChunk({ cx: center.cx + dx, cy: center.cy + dy, cz: center.cz + dz }));
            this.totalGenerated++;
          }
        }
      }
    }
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

  /** Reset and regenerate all chunks */
  reset(): void {
    this.chunks.clear();
    this.totalGenerated = 0;
    this.streamChunks();
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
