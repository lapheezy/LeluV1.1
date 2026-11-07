/**
 * ==========================================================
 * LÉLU — SPATIAL PORTAL REGISTRY
 *
 * Portals already exist in the world (SpatialPortals draws the
 * ring inside the one Genesis canvas). What did not exist is
 * PORTAL IDENTITY: a connection a person or an agent creates
 * survived only as a position in the ring, so a portal could
 * not be named, resolved, reopened or removed.
 *
 * This registry gives a portal a stable id and a destination
 * that must exist in the scene graph. It is deliberately not a
 * second navigation system: travelling through a portal keeps
 * the SAME scene and the SAME camera (no dual canvas, no
 * crossfade), so conversation and workspace context never
 * unmount.
 * ==========================================================
 */

import KvStore from "../../../core/storage/KvStore";
import { SPATIAL_DESTINATIONS, destinationFor, type SpatialDestination, type SpatialSceneId } from "./SpatialScenes";

export type PortalCreator = "user" | "agent";

export interface PortalRecord {
  id: string;
  /** The environment this portal connects to; must exist in the scene graph. */
  destination: SpatialSceneId;
  label: string;
  createdBy: PortalCreator;
  createdAt: number;
  workspace: string;
}

export interface PortalPort {
  get<T>(key: string): T | null;
  set(key: string, value: unknown): void;
}

export const PORTAL_STORAGE_KEY = "lelu.spatial.portals.v1";
const MAX_PORTALS = 64;

const kvPort: PortalPort = {
  get<T>(key: string): T | null {
    return KvStore.getInstance().get<T>(key) ?? null;
  },
  set(key: string, value: unknown): void {
    KvStore.getInstance().set(key, value);
  },
};

function memoryPort(): PortalPort {
  const data = new Map<string, unknown>();
  return {
    get<T>(key: string): T | null {
      return (data.get(key) as T) ?? null;
    },
    set(key: string, value: unknown): void {
      data.set(key, value);
    },
  };
}

export interface PortalTravelPlan {
  portal: PortalRecord;
  destination: SpatialDestination;
  /** The camera owner during the transition — the existing cinematic arousal. */
  cameraOwnership: "cinematic";
  /** The scene that performs the transition; the persistent one, never a copy. */
  scene: SpatialDestination["kind"];
  /** Navigation never resets the conversation or the open workspace. */
  preservesConversation: true;
  preservesWorkspace: true;
}

export interface PortalMigration {
  portals: PortalRecord[];
  /** Entries that named no real destination. Reported, never drawn. */
  skipped: number;
}

function isPortal(value: unknown): value is Partial<PortalRecord> {
  return typeof value === "object" && value !== null;
}

export function readPortals(raw: unknown): PortalMigration {
  const portals: PortalRecord[] = [];
  let skipped = 0;
  const list = Array.isArray(raw)
    ? raw
    : isPortal(raw) && Array.isArray((raw as { portals?: unknown[] }).portals)
      ? ((raw as { portals: unknown[] }).portals)
      : [];
  const known = new Set(SPATIAL_DESTINATIONS.map((destination) => destination.id));
  for (const candidate of list) {
    if (!isPortal(candidate)) {
      skipped += 1;
      continue;
    }
    const destination = candidate.destination;
    if (typeof destination !== "string" || !known.has(destination as SpatialSceneId)) {
      skipped += 1;
      continue;
    }
    const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : "";
    if (!id) {
      skipped += 1;
      continue;
    }
    portals.push({
      id,
      destination: destination as SpatialSceneId,
      label: typeof candidate.label === "string" && candidate.label ? candidate.label : destinationFor(destination as SpatialSceneId).label,
      createdBy: candidate.createdBy === "agent" ? "agent" : "user",
      createdAt: Number.isFinite(candidate.createdAt) ? Number(candidate.createdAt) : 0,
      workspace: typeof candidate.workspace === "string" ? candidate.workspace : "default",
    });
  }
  return { portals, skipped };
}

export default class PortalRegistry {
  private static instance: PortalRegistry | null = null;
  private portals = new Map<string, PortalRecord>();
  private skipped = 0;
  private listeners = new Set<(portals: PortalRecord[]) => void>();

  private constructor(private readonly port: PortalPort) {
    const migrated = readPortals(this.port.get<unknown>(PORTAL_STORAGE_KEY));
    for (const portal of migrated.portals) this.portals.set(portal.id, portal);
    this.skipped = migrated.skipped;
  }

  static getInstance(port?: PortalPort): PortalRegistry {
    if (!PortalRegistry.instance) {
      PortalRegistry.instance = new PortalRegistry(port ?? kvPort);
    }
    return PortalRegistry.instance;
  }

  /** Tests only: a fresh registry over an isolated port. */
  static resetForTests(port?: PortalPort): PortalRegistry {
    PortalRegistry.instance = new PortalRegistry(port ?? memoryPort());
    return PortalRegistry.instance;
  }

  getMigrationReport(): { skipped: number; portals: number } {
    return { skipped: this.skipped, portals: this.portals.size };
  }

  list(workspace?: string): PortalRecord[] {
    const all = [...this.portals.values()].sort((a, b) => a.createdAt - b.createdAt);
    return workspace ? all.filter((portal) => portal.workspace === workspace) : all;
  }

  get(id: string): PortalRecord | null {
    return this.portals.get(id) ?? null;
  }

  /**
   * A portal can only point at an environment the scene graph declares.
   * An unknown destination is refused with a reason instead of producing a
   * portal that opens nothing.
   */
  create(input: {
    destination: unknown;
    label?: string;
    createdBy?: PortalCreator;
    workspace?: string;
    id?: string;
  }): { ok: true; portal: PortalRecord } | { ok: false; reason: string } {
    const destination = typeof input.destination === "string" ? (input.destination as SpatialSceneId) : null;
    if (!destination || !SPATIAL_DESTINATIONS.some((item) => item.id === destination)) {
      return { ok: false, reason: `"${String(input.destination)}" is not a destination in the scene graph.` };
    }
    if (this.portals.size >= MAX_PORTALS) {
      return { ok: false, reason: `The world already holds ${MAX_PORTALS} portals; remove one first.` };
    }
    const existing = input.id ? this.portals.get(input.id) : undefined;
    const portal: PortalRecord = {
      id: existing?.id ?? input.id ?? `portal_${destination}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      destination,
      label: input.label?.trim() || destinationFor(destination).label,
      createdBy: input.createdBy === "agent" ? "agent" : "user",
      createdAt: existing?.createdAt ?? Date.now(),
      workspace: input.workspace ?? existing?.workspace ?? "default",
    };
    this.portals.set(portal.id, portal);
    this.persist();
    return { ok: true, portal };
  }

  /** The destination behind a portal, or null when it no longer exists. */
  resolve(id: string): SpatialDestination | null {
    const portal = this.portals.get(id);
    if (!portal) return null;
    return SPATIAL_DESTINATIONS.find((item) => item.id === portal.destination) ?? null;
  }

  /**
   * What travelling through this portal means. The SAME persistent scene
   * performs the transition with the existing cinematic camera ownership, so
   * no second canvas, no crossfade and nothing unmounts.
   */
  planTravel(id: string): PortalTravelPlan | null {
    const portal = this.portals.get(id);
    const destination = this.resolve(id);
    if (!portal || !destination) return null;
    return {
      portal,
      destination,
      cameraOwnership: "cinematic",
      scene: destination.kind,
      preservesConversation: true,
      preservesWorkspace: true,
    };
  }

  remove(id: string): boolean {
    const removed = this.portals.delete(id);
    if (removed) this.persist();
    return removed;
  }

  subscribe(listener: (portals: PortalRecord[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private persist(): void {
    try {
      this.port.set(PORTAL_STORAGE_KEY, [...this.portals.values()]);
      for (const listener of this.listeners) listener(this.list());
    } catch {
      // A world that cannot save a portal still works this session.
    }
  }
}
