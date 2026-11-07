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
  /** True only when the value is actually stored somewhere durable. */
  set(key: string, value: unknown): boolean;
}

export const PORTAL_STORAGE_KEY = "lelu.spatial.portals.v1";

/**
 * The built-in ring: every destination that is a place to go. The Core and the
 * Cosmos are the world itself, not portals in it. This is the registry's list,
 * not a scene's copy: the 3D field and the seeding both read it from here.
 */
export const RING_SCENES: readonly SpatialSceneId[] = SPATIAL_DESTINATIONS.filter(
  (destination) => destination.kind !== "core" && destination.kind !== "cosmos",
).map((destination) => destination.id);
const MAX_PORTALS = 64;

/**
 * The built-in ring's ids are namespaced: `scene:<destination>`. A portal a
 * person or an agent creates gets a `portal:<destination>:<stamp>` id, so the
 * two can never collide and a built-in portal can never be duplicated.
 */
export function builtinPortalId(scene: SpatialSceneId): string {
  return `scene:${scene}`;
}

export function isBuiltinPortal(portal: PortalRecord): boolean {
  return portal.id.startsWith("scene:");
}

const kvPort: PortalPort = {
  get<T>(key: string): T | null {
    return KvStore.getInstance().get<T>(key) ?? null;
  },
  set(key: string, value: unknown): boolean {
    return KvStore.getInstance().set(key, value);
  },
};

function memoryPort(): PortalPort {
  const data = new Map<string, unknown>();
  return {
    get<T>(key: string): T | null {
      return (data.get(key) as T) ?? null;
    },
    set(key: string, value: unknown): boolean {
      data.set(key, value);
      return true;
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
    if (!this.persist()) {
      // Never report success for a portal that was not saved: a UI or an agent
      // action must see the refusal, not a portal that vanishes on reload.
      if (existing) this.portals.set(existing.id, existing);
      else this.portals.delete(portal.id);
      return { ok: false, reason: "The portal could not be saved on this device." };
    }
    return { ok: true, portal };
  }

  /** Rename or re-point a portal. The id and the creation time never change. */
  update(
    id: string,
    patch: { label?: string; destination?: unknown },
  ): { ok: true; portal: PortalRecord } | { ok: false; reason: string } {
    const current = this.portals.get(id);
    if (!current) return { ok: false, reason: `No portal ${id}.` };
    let destination = current.destination;
    if (patch.destination !== undefined) {
      if (
        typeof patch.destination !== "string" ||
        !SPATIAL_DESTINATIONS.some((item) => item.id === patch.destination)
      ) {
        return { ok: false, reason: `"${String(patch.destination)}" is not a destination in the scene graph.` };
      }
      destination = patch.destination as SpatialSceneId;
    }
    const next: PortalRecord = { ...current, destination, label: patch.label?.trim() || current.label };
    this.portals.set(id, next);
    if (!this.persist()) {
      this.portals.set(id, current);
      return { ok: false, reason: "The portal could not be saved on this device." };
    }
    return { ok: true, portal: next };
  }

  /**
   * Give the ring its identities: one stable record per built-in destination.
   * Idempotent, so calling it on every mount adds nothing after the first time
   * and never duplicates a built-in portal.
   */
  seedRing(scenes: readonly SpatialSceneId[], workspace = "default"): number {
    const added: string[] = [];
    for (const scene of scenes) {
      const id = builtinPortalId(scene);
      if (this.portals.has(id)) continue;
      this.portals.set(id, {
        id,
        destination: scene,
        label: destinationFor(scene).label,
        createdBy: "user",
        createdAt: Date.now() + added.length,
        workspace,
      });
      added.push(id);
    }
    if (added.length === 0) return 0;
    if (this.persist()) return added.length;
    for (const id of added) this.portals.delete(id);
    return 0;
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
    const current = this.portals.get(id);
    if (!current) return false;
    this.portals.delete(id);
    if (this.persist()) return true;
    // The removal could not be saved: the portal is still there, so say so.
    this.portals.set(id, current);
    return false;
  }

  subscribe(listener: (portals: PortalRecord[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Returns whether the write actually happened — callers must not fake
   * success. The port reports it: a backend that swallows its errors cannot be
   * told apart from a saved one, which is how a portal used to be reported as
   * created and then vanish on reload.
   */
  private persist(): boolean {
    let saved = false;
    try {
      saved = this.port.set(PORTAL_STORAGE_KEY, [...this.portals.values()]) === true;
    } catch {
      saved = false;
    }
    if (!saved) return false;
    for (const listener of this.listeners) listener(this.list());
    return true;
  }
}
