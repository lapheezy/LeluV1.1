/**
 * ==========================================================
 * LÉLU — COSMOS NAVIGATION
 *
 * The spatial map as a place you can BE, not just look at.
 *
 * The 3D cosmos (CosmosStore) draws entities that already exist
 * in the runtime. This is the layer above it that owns the
 * things a navigable environment needs and a visualisation does
 * not: where you currently are, the trail that got you there,
 * the rooms that were opened, how often each place was visited,
 * and which workspace a destination opens on arrival.
 *
 * Levels are nestable:
 *
 *   core ── galaxy ── planet ── room
 *     └── project areas and sessions hang under the same tree
 *
 * Every node may carry a `ref` to a REAL record (an agent, a
 * project, a task, a conversation). The map never copies those
 * records — it points at them, so a node cannot disagree with
 * the thing it names.
 *
 * Seeded destinations are re-registered from the runtime on
 * every boot (so a deleted agent cannot linger as a ghost), and
 * the same ids are idempotent: visiting a place does not
 * duplicate it. Rooms created here persist, and a removed room
 * is archived rather than destroyed, so expansion is reversible.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type NavLevel = "core" | "galaxy" | "planet" | "room";

/** Who put this destination here. Expansion by LÉLU is marked as hers. */
export type NavOrigin = "system" | "lelu" | "user";

/** The real runtime record a node stands for. */
export interface NavRef {
  kind: "agent" | "project" | "task" | "conversation" | "cosmos";
  id: string;
}

/** What arriving at this destination should open. */
export interface NavOpen {
  module?: string;
  view?: string;
  projectId?: string;
  conversationId?: string;
}

export interface NavNode {
  id: string;
  level: NavLevel;
  label: string;
  parentId: string | null;
  ref: NavRef | null;
  opens: NavOpen | null;
  position: [number, number, number];
  origin: NavOrigin;
  createdAt: number;
  visits: number;
  lastVisited: number | null;
  /** Only rooms LÉLU or the user created can be removed. */
  removable: boolean;
  archived: boolean;
}

export interface NavDestination {
  id: string;
  level: NavLevel;
  label: string;
  parentId: string | null;
  ref?: NavRef | null;
  opens?: NavOpen | null;
  position?: [number, number, number];
  origin?: NavOrigin;
  /**
   * Only what the user or LÉLU added may be removed. Destinations that
   * mirror a live record (an agent's planet, an open view) follow their
   * source instead, so the map cannot be emptied out from under it.
   */
  removable?: boolean;
}

export interface NavigationState {
  /** Live destinations, in registration order. Archived rooms are excluded. */
  nodes: NavNode[];
  currentId: string;
  /** Visits in order, most recent last. A trail, not a stack of copies. */
  trail: string[];
  version: number;
}

const KEY = "lelu.cosmos.nav.v1";
/** The root of the map. Exported so callers hang destinations in one place. */
export const COSMOS_CORE_ID = "cosmos-core";
const CORE_ID = COSMOS_CORE_ID;
const MAX_TRAIL = 50;
const MAX_PERSISTED_ROOMS = 200;

interface PersistedNav {
  rooms: NavNode[];
  visits: Record<string, { visits: number; lastVisited: number | null }>;
  currentId: string;
  trail: string[];
}

function coreNode(): NavNode {
  return {
    id: CORE_ID,
    level: "core",
    label: "LÉLU CORE",
    parentId: null,
    ref: { kind: "cosmos", id: "lelu-core" },
    opens: { module: "chat" },
    position: [0, 0, 0],
    origin: "system",
    createdAt: 0,
    visits: 0,
    lastVisited: null,
    removable: false,
    archived: false,
  };
}

/** Deterministic ring position for the nth child of a parent. */
export function childPosition(parent: [number, number, number], index: number): [number, number, number] {
  const angle = (index / Math.max(index + 1, 6)) * Math.PI * 2 + index * 0.7;
  const radius = 3 + (index % 4) * 1.6;
  return [
    parent[0] + Math.cos(angle) * radius,
    parent[1] + (index % 3) * 1.1 - 1,
    parent[2] + Math.sin(angle) * radius,
  ];
}

export default class CosmosNavigation {
  private static instance: CosmosNavigation | null = null;

  private nodes = new Map<string, NavNode>();
  private trail: string[] = [];
  private currentId = CORE_ID;
  private version = 0;
  private listeners = new Set<(state: NavigationState) => void>();

  private constructor() {
    this.nodes.set(CORE_ID, coreNode());
    this.load();
  }

  static getInstance(): CosmosNavigation {
    if (!CosmosNavigation.instance) CosmosNavigation.instance = new CosmosNavigation();
    return CosmosNavigation.instance;
  }

  /** Drop the singleton and its persisted rooms (tests, full reset). */
  static reset(): void {
    CosmosNavigation.instance = null;
    try {
      KvStore.getInstance().remove(KEY);
    } catch {
      /* storage blocked */
    }
  }

  getState(): NavigationState {
    return {
      nodes: [...this.nodes.values()].filter((node) => !node.archived),
      currentId: this.currentId,
      trail: [...this.trail],
      version: this.version,
    };
  }

  subscribe(listener: (state: NavigationState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Register (or refresh) a destination. Idempotent by id: the label,
   * parent, ref and what it opens can be corrected by the runtime, while
   * visits, position and the room's own persistence are kept.
   */
  register(destination: NavDestination): NavNode {
    const existing = this.nodes.get(destination.id);
    if (existing) {
      existing.label = destination.label;
      existing.parentId = destination.parentId;
      existing.level = destination.level;
      if (destination.ref !== undefined) existing.ref = destination.ref;
      if (destination.opens !== undefined) existing.opens = destination.opens;
      if (destination.origin) existing.origin = destination.origin;
      if (destination.position) existing.position = destination.position;
      if (destination.removable !== undefined) existing.removable = destination.removable;
      this.version += 1;
      // A persisted room whose label the runtime corrected must keep the
      // correction across a reload, or a rename would revert on boot.
      if (existing.origin !== "system") this.persist();
      this.notify();
      return existing;
    }

    const parent = destination.parentId ? this.nodes.get(destination.parentId) : undefined;
    const siblings = this.childrenOf(destination.parentId ?? null).length;
    const node: NavNode = {
      id: destination.id,
      level: destination.level,
      label: destination.label,
      parentId: destination.parentId,
      ref: destination.ref ?? null,
      opens: destination.opens ?? null,
      position: destination.position ?? childPosition(parent?.position ?? [0, 0, 0], siblings),
      origin: destination.origin ?? "system",
      createdAt: Date.now(),
      visits: 0,
      lastVisited: null,
      removable: destination.removable ?? destination.level === "room",
      archived: false,
    };
    this.nodes.set(node.id, node);
    this.version += 1;
    this.persist();
    this.notify();
    return node;
  }

  registerAll(destinations: NavDestination[]): void {
    for (const destination of destinations) this.register(destination);
  }

  get(id: string): NavNode | undefined {
    return this.nodes.get(id);
  }

  current(): NavNode {
    return this.nodes.get(this.currentId) ?? coreNode();
  }

  children(parentId: string | null): NavNode[] {
    return this.childrenOf(parentId);
  }

  /** Root → node, for a breadcrumb. Empty when the id is unknown. */
  pathTo(id: string): NavNode[] {
    const path: NavNode[] = [];
    const seen = new Set<string>();
    let cursor = this.nodes.get(id);
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      path.unshift(cursor);
      cursor = cursor.parentId ? this.nodes.get(cursor.parentId) : undefined;
    }
    return path;
  }

  /** Travel to a destination. Unknown or archived ids do not move you. */
  navigateTo(id: string): NavNode | null {
    const node = this.nodes.get(id);
    if (!node || node.archived) return null;
    // The first move starts the trail from where you already were, so a
    // trail always reads as a path rather than a list that begins mid-way.
    if (this.trail.length === 0 && this.currentId !== id) this.trail = [this.currentId];
    this.currentId = id;
    node.visits += 1;
    node.lastVisited = Date.now();
    this.trail = [...this.trail.filter((entry) => entry !== id), id].slice(-MAX_TRAIL);
    this.version += 1;
    this.persist();
    this.notify();
    return node;
  }

  /** The place before the current one, if the trail has one. */
  back(): NavNode | null {
    if (this.trail.length < 2) return null;
    const previous = this.trail[this.trail.length - 2];
    return this.navigateTo(previous);
  }

  /**
   * Open a new room. This is how the environment grows: LÉLU (with
   * approval — see CosmosAutonomy) or the user names a place, it hangs
   * under an existing destination, and it opens a real workspace on
   * arrival. A room with the same label under the same parent is reused
   * rather than duplicated.
   */
  createRoom(input: {
    label: string;
    parentId?: string | null;
    opens?: NavOpen | null;
    origin?: NavOrigin;
    ref?: NavRef | null;
  }): { ok: true; node: NavNode; created: boolean } | { ok: false; error: string } {
    const label = input.label.trim();
    if (!label) return { ok: false, error: "a room needs a name" };
    const parentId = input.parentId ?? CORE_ID;
    const parent = this.nodes.get(parentId);
    if (!parent || parent.archived) return { ok: false, error: `no destination "${parentId}" to hang a room under` };

    const duplicate = this.childrenOf(parentId).find(
      (node) => node.level === "room" && node.label.toLowerCase() === label.toLowerCase(),
    );
    if (duplicate) return { ok: true, node: duplicate, created: false };

    const index = this.childrenOf(parentId).length;
    const node: NavNode = {
      id: `room-${crypto.randomUUID().slice(0, 8)}`,
      level: "room",
      label,
      parentId,
      ref: input.ref ?? null,
      opens: input.opens ?? null,
      position: childPosition(parent.position, index),
      origin: input.origin ?? "user",
      createdAt: Date.now(),
      visits: 0,
      lastVisited: null,
      removable: true,
      archived: false,
    };
    this.nodes.set(node.id, node);
    this.version += 1;
    this.persist();
    this.notify();
    return { ok: true, node, created: true };
  }

  /** Archive a room. Reversible: the node and its visits are kept. */
  removeRoom(id: string): { ok: true; node: NavNode } | { ok: false; error: string } {
    const node = this.nodes.get(id);
    if (!node) return { ok: false, error: `no destination "${id}"` };
    if (!node.removable || node.level !== "room") {
      return { ok: false, error: `"${node.label}" is part of the environment and cannot be removed` };
    }
    if (node.archived) return { ok: true, node };
    node.archived = true;
    if (this.currentId === id) {
      this.currentId = node.parentId && this.nodes.get(node.parentId) ? node.parentId : CORE_ID;
    }
    this.trail = this.trail.filter((entry) => entry !== id);
    this.version += 1;
    this.persist();
    this.notify();
    return { ok: true, node };
  }

  /**
   * Remove a destination that mirrors a live record, because that record
   * is gone. Only system-owned destinations can be retired this way; a
   * room the user or LÉLU made goes through removeRoom instead.
   */
  retire(id: string): boolean {
    if (id === CORE_ID) return false;
    const node = this.nodes.get(id);
    if (!node || node.archived) return false;
    if (node.origin !== "system" || node.removable) return false;
    node.archived = true;
    if (this.currentId === id) {
      this.currentId = node.parentId && this.nodes.get(node.parentId) ? node.parentId : CORE_ID;
    }
    this.trail = this.trail.filter((entry) => entry !== id);
    this.version += 1;
    this.persist();
    this.notify();
    return true;
  }

  /** Archived rooms, so a removal can be undone from the interface. */
  archivedRooms(): NavNode[] {
    return [...this.nodes.values()].filter((node) => node.level === "room" && node.archived);
  }

  /** Bring an archived room back exactly as it was. */
  restoreRoom(id: string): { ok: true; node: NavNode } | { ok: false; error: string } {
    const node = this.nodes.get(id);
    if (!node) return { ok: false, error: `no destination "${id}"` };
    if (!node.archived) return { ok: true, node };
    node.archived = false;
    this.version += 1;
    this.persist();
    this.notify();
    return { ok: true, node };
  }

  /** Every room, for a workspace listing. */
  rooms(): NavNode[] {
    return [...this.nodes.values()].filter((node) => node.level === "room" && !node.archived);
  }

  /** Re-read persisted visits and rooms (a fresh start sees the same map). */
  reload(): void {
    this.load();
    this.version += 1;
    this.notify();
  }

  destroy(): void {
    this.listeners.clear();
    CosmosNavigation.instance = null;
  }

  /* ---------------- internals ---------------- */

  private childrenOf(parentId: string | null): NavNode[] {
    return [...this.nodes.values()].filter((node) => node.parentId === parentId && !node.archived);
  }

  private notify(): void {
    const state = this.getState();
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch (error) {
        console.error("[CosmosNavigation] listener failed:", error);
      }
    }
  }

  private persist(): void {
    try {
      const rooms = [...this.nodes.values()]
        .filter((node) => node.level === "room" && node.origin !== "system")
        .slice(-MAX_PERSISTED_ROOMS);
      const visits: PersistedNav["visits"] = {};
      for (const node of this.nodes.values()) {
        if (node.visits > 0) visits[node.id] = { visits: node.visits, lastVisited: node.lastVisited };
      }
      const payload: PersistedNav = {
        rooms,
        visits,
        currentId: this.currentId,
        trail: this.trail,
      };
      KvStore.getInstance().set(KEY, payload);
    } catch {
      /* persistence must never break navigation */
    }
  }

  private load(): void {
    let stored: PersistedNav | null = null;
    try {
      stored = KvStore.getInstance().get<PersistedNav>(KEY);
    } catch {
      stored = null;
    }
    if (!stored) return;

    for (const room of stored.rooms ?? []) {
      if (!room || !room.id) continue;
      // A persisted room must hang under something that still exists.
      const parentId = room.parentId && this.nodes.has(room.parentId) ? room.parentId : CORE_ID;
      this.nodes.set(room.id, { ...room, level: "room", removable: true, parentId });
    }
    for (const [id, visit] of Object.entries(stored.visits ?? {})) {
      const node = this.nodes.get(id);
      if (!node) continue;
      node.visits = visit.visits;
      node.lastVisited = visit.lastVisited;
    }
    if (stored.currentId && this.nodes.get(stored.currentId) && !this.nodes.get(stored.currentId)!.archived) {
      this.currentId = stored.currentId;
    }
    this.trail = (stored.trail ?? []).filter((id) => {
      const node = this.nodes.get(id);
      return Boolean(node && !node.archived);
    });
  }
}
