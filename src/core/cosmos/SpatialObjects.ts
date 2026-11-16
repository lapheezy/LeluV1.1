/**
 * ==========================================================
 * LÉLU — SPATIAL OBJECTS
 *
 * A message, a document, an image, a video, a research brief,
 * a project, or a task can sit in a room as a thing you move
 * around — while remaining the record it came from.
 *
 * The rule this file exists to enforce: a spatial object is a
 * POSITION AND A POINTER, never a copy. Every object carries a
 * link to a real record; there is no way to create one without
 * a record id. Anything that displays the object is expected to
 * load the record by that link, so a stale card can never
 * invent content that the record does not contain.
 *
 * Placement is idempotent by record: dropping the same record
 * into the cosmos twice updates the object that is already
 * there instead of stacking duplicates (the same rule views and
 * conversations follow elsewhere in the codebase).
 * ==========================================================
 */

import KvStore from "../storage/KvStore";

export type SpatialKind =
  | "message"
  | "document"
  | "image"
  | "video"
  | "research"
  | "project"
  | "task"
  | "file"
  | "conversation"
  | "note";

/** The record this object stands for. Never optional, never generated. */
export interface RecordLink {
  kind: string;
  id: string;
}

export interface SpatialObject {
  id: string;
  kind: SpatialKind;
  title: string;
  link: RecordLink;
  /** The room it sits in (a CosmosNavigation room id, or "cosmos-core"). */
  roomId: string;
  position: [number, number, number];
  pinned: boolean;
  note?: string;
  createdAt: number;
  updatedAt: number;
}

export interface PlaceInput {
  kind: SpatialKind;
  title: string;
  link: RecordLink;
  roomId?: string;
  position?: [number, number, number];
  note?: string;
  pinned?: boolean;
}

export type PlaceResult =
  | { ok: true; object: SpatialObject; duplicate: boolean }
  | { ok: false; error: string };

const KEY = "lelu.cosmos.objects.v1";
const MAX_OBJECTS = 500;

function sameLink(a: RecordLink, b: RecordLink): boolean {
  return a.kind === b.kind && a.id === b.id;
}

/** Deterministic free spot in a room, so two drops do not land on top of each other. */
function nextPosition(count: number): [number, number, number] {
  const angle = count * 2.399963; // golden angle — spreads without overlap
  const radius = 1.4 + Math.sqrt(count) * 0.9;
  return [Math.cos(angle) * radius, 0.2 + (count % 3) * 0.4, Math.sin(angle) * radius];
}

export default class SpatialObjects {
  private static instance: SpatialObjects | null = null;

  private objects: SpatialObject[] = [];
  private listeners = new Set<(objects: SpatialObject[]) => void>();

  private constructor() {
    this.load();
  }

  static getInstance(): SpatialObjects {
    if (!SpatialObjects.instance) SpatialObjects.instance = new SpatialObjects();
    return SpatialObjects.instance;
  }

  static reset(): void {
    SpatialObjects.instance = null;
    try {
      KvStore.getInstance().remove(KEY);
    } catch {
      /* storage blocked */
    }
  }

  list(roomId?: string): SpatialObject[] {
    return roomId ? this.objects.filter((object) => object.roomId === roomId) : [...this.objects];
  }

  get(id: string): SpatialObject | undefined {
    return this.objects.find((object) => object.id === id);
  }

  /** The object for a record, if it has been placed. */
  find(link: RecordLink): SpatialObject | undefined {
    return this.objects.find((object) => sameLink(object.link, link));
  }

  /** Every object in a room, ordered so a renderer can be deterministic. */
  inRoom(roomId: string): SpatialObject[] {
    return this.objects
      .filter((object) => object.roomId === roomId)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.createdAt - b.createdAt);
  }

  place(input: PlaceInput): PlaceResult {
    if (!input.link || !input.link.kind || !input.link.id) {
      return { ok: false, error: "a spatial object must point at a real record (kind and id)" };
    }
    const title = input.title.trim();
    if (!title) return { ok: false, error: "a spatial object needs a title" };

    const existing = this.find(input.link);
    if (existing) {
      existing.title = title;
      if (input.note !== undefined) existing.note = input.note;
      if (input.pinned !== undefined) existing.pinned = input.pinned;
      existing.updatedAt = Date.now();
      this.persist();
      this.notify();
      return { ok: true, object: existing, duplicate: true };
    }

    const roomId = input.roomId ?? "cosmos-core";
    const object: SpatialObject = {
      id: `obj-${crypto.randomUUID().slice(0, 8)}`,
      kind: input.kind,
      title,
      link: { ...input.link },
      roomId,
      position: input.position ?? nextPosition(this.inRoom(roomId).length),
      pinned: input.pinned ?? false,
      ...(input.note !== undefined ? { note: input.note } : {}),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.objects = [...this.objects, object].slice(-MAX_OBJECTS);
    this.persist();
    this.notify();
    return { ok: true, object, duplicate: false };
  }

  /** Move an object to a new spot in its room (or into another room). */
  move(id: string, position: [number, number, number], roomId?: string): SpatialObject | null {
    const object = this.get(id);
    if (!object) return null;
    object.position = [...position] as [number, number, number];
    if (roomId) object.roomId = roomId;
    object.updatedAt = Date.now();
    this.persist();
    this.notify();
    return object;
  }

  pin(id: string, pinned = true): SpatialObject | null {
    const object = this.get(id);
    if (!object) return null;
    object.pinned = pinned;
    object.updatedAt = Date.now();
    this.persist();
    this.notify();
    return object;
  }

  remove(id: string): boolean {
    const before = this.objects.length;
    this.objects = this.objects.filter((object) => object.id !== id);
    if (this.objects.length === before) return false;
    this.persist();
    this.notify();
    return true;
  }

  subscribe(listener: (objects: SpatialObject[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  reload(): void {
    this.load();
    this.notify();
  }

  /** Snapshot for a reversible extension checkpoint. */
  snapshot(): SpatialObject[] {
    return this.objects.map((object) => ({ ...object, link: { ...object.link }, position: [...object.position] as [number, number, number] }));
  }

  /** Put the objects back exactly as a snapshot recorded them. */
  restore(snapshot: SpatialObject[]): void {
    this.objects = snapshot.map((object) => ({
      ...object,
      link: { ...object.link },
      position: [...object.position] as [number, number, number],
    }));
    this.persist();
    this.notify();
  }

  private notify(): void {
    const objects = [...this.objects];
    for (const listener of this.listeners) {
      try {
        listener(objects);
      } catch (error) {
        console.error("[SpatialObjects] listener failed:", error);
      }
    }
  }

  private persist(): void {
    try {
      KvStore.getInstance().set(KEY, this.objects);
    } catch {
      /* best-effort */
    }
  }

  private load(): void {
    try {
      const stored = KvStore.getInstance().get<SpatialObject[]>(KEY);
      this.objects = Array.isArray(stored) ? stored.filter((object) => object?.link?.id) : [];
    } catch {
      this.objects = [];
    }
  }
}
