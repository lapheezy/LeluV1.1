/**
 * ==========================================================
 * LÉLU — COSMOS ENTITY REGISTRY
 *
 * Every meaningful UI event (tab opened, search executed,
 * agent activated, panel used) creates a spatial entity in
 * the cosmos. LELU can travel to these entities.
 *
 * UI TAB ↔ WORLD ENTITY
 * ==========================================================
 */

export type EntityKind =
  | "tab"
  | "panel"
  | "search"
  | "agent"
  | "memory"
  | "system"
  | "workspace";

export interface CosmosEntity {
  id: string;
  kind: EntityKind;
  label: string;
  icon: string;
  /** Spatial position in cosmos [x, y, z] */
  position: [number, number, number];
  /** When this entity was created/activated */
  createdAt: number;
  /** When LELU last visited this entity */
  lastVisited: number | null;
  /** Whether this entity is currently active / in focus */
  active: boolean;
  /** Source panel/tab ID this entity maps to */
  sourceId: string;
  /** Optional color for visual distinction */
  color?: string;
  /** Scale relative to other entities */
  scale?: number;
}

export type CosmosListener = (entities: CosmosEntity[]) => void;

/** Maps entity kinds to orbit positions around the core */
const ORBIT_POSITIONS: Record<EntityKind, (index: number) => [number, number, number]> = {
  tab: (i) => [
    -4 + (i % 3) * 2.5 + Math.sin(i * 0.7) * 1.2,
    (i % 2) * 1.5 - 0.5,
    -3 + Math.floor(i / 3) * 2,
  ],
  panel: (i) => [
    3 - (i % 3) * 2.5 + Math.cos(i * 0.7) * 1.2,
    (i % 2) * 1.5 - 0.2,
    -3 + Math.floor(i / 3) * 2,
  ],
  search: (i) => [
    Math.sin(i * 1.1) * 5,
    -1.5 + (i % 2) * 0.8,
    Math.cos(i * 1.1) * 5,
  ],
  agent: (i) => [
    -5 + (i % 3) * 2.2,
    -1.8 + (i % 2) * 0.6,
    2 + Math.floor(i / 3) * 1.5,
  ],
  memory: (i) => [
    4 - (i % 2) * 1.8,
    -2 + (i % 3) * 0.7,
    1.5 + Math.floor(i / 2) * 1.2,
  ],
  system: (i) => [
    Math.cos(i * 0.9) * 4.5,
    1 + (i % 2) * 0.5,
    Math.sin(i * 0.9) * 4.5,
  ],
  workspace: (i) => [
    -3 + (i % 2) * 6,
    0.3 + Math.floor(i / 2) * 1.2,
    -4,
  ],
};

const KIND_COLORS: Record<EntityKind, string> = {
  tab: "#67e8f9",
  panel: "#a78bfa",
  search: "#fbbf24",
  agent: "#34d399",
  memory: "#f472b6",
  system: "#f87171",
  workspace: "#38bdf8",
};

const KIND_SCALES: Record<EntityKind, number> = {
  tab: 0.35,
  panel: 0.4,
  search: 0.28,
  agent: 0.38,
  memory: 0.3,
  system: 0.45,
  workspace: 0.5,
};

export default class CosmosEntityRegistry {
  private static instance: CosmosEntityRegistry | null = null;
  private entities = new Map<string, CosmosEntity>();
  private listeners = new Set<CosmosListener>();
  private idCounter = 0;

  private constructor() {}

  static getInstance(): CosmosEntityRegistry {
    if (!CosmosEntityRegistry.instance) {
      CosmosEntityRegistry.instance = new CosmosEntityRegistry();
    }
    return CosmosEntityRegistry.instance;
  }

  /**
   * Register or activate a cosmos entity for a UI event.
   * If an entity with the same sourceId+kind already exists, activate it
   * instead of creating a duplicate.
   */
  register(
    kind: EntityKind,
    sourceId: string,
    label: string,
    icon: string,
  ): CosmosEntity {
    // Check for existing
    for (const [, entity] of this.entities) {
      if (entity.sourceId === sourceId && entity.kind === kind) {
        entity.active = true;
        entity.createdAt = Date.now();
        this.notify();
        return entity;
      }
    }

    const existingCount = this.getByKind(kind).length;
    const pos = ORBIT_POSITIONS[kind](existingCount);
    const entity: CosmosEntity = {
      id: `cosmos-${++this.idCounter}-${kind}`,
      kind,
      label,
      icon,
      position: pos,
      createdAt: Date.now(),
      lastVisited: null,
      active: true,
      sourceId,
      color: KIND_COLORS[kind],
      scale: KIND_SCALES[kind],
    };

    this.entities.set(entity.id, entity);
    this.notify();
    return entity;
  }

  /** Mark an entity as visited by LELU */
  visit(entityId: string): void {
    const entity = this.entities.get(entityId);
    if (entity) {
      entity.lastVisited = Date.now();
      this.notify();
    }
  }

  /** Deactivate (but don't remove) an entity */
  deactivate(sourceId: string, kind: EntityKind): void {
    for (const [, entity] of this.entities) {
      if (entity.sourceId === sourceId && entity.kind === kind) {
        entity.active = false;
        this.notify();
        return;
      }
    }
  }

  /** Remove stale entities older than maxAgeMs */
  cleanStale(maxAgeMs = 600_000): void {
    const now = Date.now();
    for (const [id, entity] of this.entities) {
      if (!entity.active && now - entity.createdAt > maxAgeMs) {
        this.entities.delete(id);
      }
    }
    if (this.entities.size > 0) this.notify();
  }

  /** Get entity nearest to a given 3D position */
  getNearestTo(pos: [number, number, number]): CosmosEntity | null {
    let best: CosmosEntity | null = null;
    let bestDist = Infinity;
    for (const [, entity] of this.entities) {
      if (!entity.active) continue;
      const dx = entity.position[0] - pos[0];
      const dy = entity.position[1] - pos[1];
      const dz = entity.position[2] - pos[2];
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < bestDist) {
        bestDist = dist;
        best = entity;
      }
    }
    return best;
  }

  // ---- Queries ----

  get(id: string): CosmosEntity | undefined {
    return this.entities.get(id);
  }

  getAll(): CosmosEntity[] {
    return Array.from(this.entities.values());
  }

  getActive(): CosmosEntity[] {
    return this.getAll().filter((e) => e.active);
  }

  getByKind(kind: EntityKind): CosmosEntity[] {
    return this.getAll().filter((e) => e.kind === kind);
  }

  // ---- Subscriptions ----

  subscribe(fn: CosmosListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    const all = this.getAll();
    for (const fn of this.listeners) fn(all);
  }
}