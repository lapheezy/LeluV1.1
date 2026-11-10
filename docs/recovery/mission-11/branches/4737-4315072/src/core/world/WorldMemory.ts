/**
 * ==========================================================
 * LÉLU — WORLD MEMORY
 *
 * Wheregenerated rooms live between sessions.
 *
 * Uses the project's existing KvStore (localStorage → sessionStorage
 * → legacy migration), the same persistence the avatar profile and
 * creative stores use. There is deliberately no second database and
 * no network call: a room LÉLU builds is available offline, on the
 * next boot, exactly as it was left.
 *
 * Each room keeps a bounded revision history, so "undo the last
 * change" is a real operation rather than a re-generation.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import { cloneSpec, validateWorld, type WorldSpec } from "./WorldSpec";

const WORLDS_KEY = "worlds.v1";
const CURRENT_KEY = "worlds.current";
const MAX_REVISIONS = 12;

export type WorldRevision = {
  at: number;
  label: string;
  spec: WorldSpec;
};

export type StoredWorld = {
  spec: WorldSpec;
  createdAt: number;
  updatedAt: number;
  revisions: WorldRevision[];
};

export type WorldSummary = {
  id: string;
  name: string;
  theme: WorldSpec["theme"];
  createdAt: number;
  updatedAt: number;
  objects: number;
  revisions: number;
};

class WorldMemoryImpl {
  private static instance: WorldMemoryImpl | null = null;

  public static getInstance(): WorldMemoryImpl {
    if (!WorldMemoryImpl.instance) WorldMemoryImpl.instance = new WorldMemoryImpl();
    return WorldMemoryImpl.instance;
  }

  private readAll(): Record<string, StoredWorld> {
    const raw = KvStore.getInstance().get<Record<string, StoredWorld>>(WORLDS_KEY);
    if (!raw || typeof raw !== "object") return {};
    const clean: Record<string, StoredWorld> = {};
    for (const [id, world] of Object.entries(raw)) {
      if (!world || typeof world !== "object") continue;
      if (!world.spec || typeof world.spec !== "object") continue;
      clean[id] = {
        spec: world.spec,
        createdAt: Number(world.createdAt) || 0,
        updatedAt: Number(world.updatedAt) || 0,
        revisions: Array.isArray(world.revisions) ? world.revisions.slice(-MAX_REVISIONS) : [],
      };
    }
    return clean;
  }

  private writeAll(worlds: Record<string, StoredWorld>): void {
    KvStore.getInstance().set(WORLDS_KEY, worlds);
  }

  /** Save a room, keeping the previous version as a revision. */
  public save(spec: WorldSpec, options: { label?: string; now?: number } = {}): StoredWorld {
    const now = options.now ?? Date.now();
    const worlds = this.readAll();
    const previous = worlds[spec.id];
    const revisions = previous ? [...previous.revisions] : [];
    if (previous) {
      revisions.push({
        at: previous.updatedAt,
        label: options.label ?? "before change",
        spec: cloneSpec(previous.spec),
      });
    }
    const stored: StoredWorld = {
      spec: cloneSpec(spec),
      createdAt: previous?.createdAt ?? spec.createdAt ?? now,
      updatedAt: now,
      revisions: revisions.slice(-MAX_REVISIONS),
    };
    worlds[spec.id] = stored;
    this.writeAll(worlds);
    this.setCurrent(spec.id);
    return stored;
  }

  public load(id: string): WorldSpec | null {
    const worlds = this.readAll();
    const stored = worlds[id];
    return stored ? cloneSpec(stored.spec) : null;
  }

  public getStored(id: string): StoredWorld | null {
    const stored = this.readAll()[id];
    return stored ? { ...stored, spec: cloneSpec(stored.spec) } : null;
  }

  public list(): WorldSummary[] {
    return Object.values(this.readAll())
      .map((world) => ({
        id: world.spec.id,
        name: world.spec.name,
        theme: world.spec.theme,
        createdAt: world.createdAt,
        updatedAt: world.updatedAt,
        objects: Array.isArray(world.spec.nodes) ? world.spec.nodes.length : 0,
        revisions: world.revisions.length,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public remove(id: string): boolean {
    const worlds = this.readAll();
    if (!worlds[id]) return false;
    delete worlds[id];
    this.writeAll(worlds);
    if (this.currentId() === id) {
      const next = Object.keys(worlds)[0];
      if (next) this.setCurrent(next);
      else KvStore.getInstance().remove(CURRENT_KEY);
    }
    return true;
  }

  /** The last room LÉLU was in — what boots after a reload. */
  public currentId(): string | null {
    const id = KvStore.getInstance().get<string>(CURRENT_KEY);
    return typeof id === "string" && id ? id : null;
  }

  public setCurrent(id: string): void {
    KvStore.getInstance().set(CURRENT_KEY, id);
  }

  public current(): WorldSpec | null {
    const id = this.currentId();
    return id ? this.load(id) : null;
  }

  /** Roll a room back to its previous revision. */
  public undo(id: string): WorldSpec | null {
    const worlds = this.readAll();
    const stored = worlds[id];
    if (!stored || stored.revisions.length === 0) return null;
    const revisions = [...stored.revisions];
    const last = revisions.pop()!;
    worlds[id] = { ...stored, spec: cloneSpec(last.spec), revisions, updatedAt: Date.now() };
    this.writeAll(worlds);
    return cloneSpec(last.spec);
  }

  /**
   * Problems with a stored room, so a corrupt or outdated entry is reported
   * instead of being rendered as if it were valid.
   */
  public problemsWith(spec: WorldSpec): string[] {
    return validateWorld(spec);
  }
}

const WorldMemory = WorldMemoryImpl;
export default WorldMemory;
export type WorldMemoryApi = WorldMemoryImpl;
