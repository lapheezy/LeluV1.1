/**
 * ==========================================================
 * LÉLU — CREATIVE OBJECTS
 *
 * A garment, a sleeve, a pattern piece, a pendant, its stone or
 * a chair leg is an OBJECT here: geometry, materials, component
 * hierarchy, transform, motion, provenance and revision history
 * in one record with a stable id.
 *
 * The rules this file enforces:
 *
 *   1. Geometry is never flattened. A part carries positions and
 *      indices; a component carries the ids of its parts; the
 *      object carries its components. Nothing becomes a picture.
 *   2. Placement is not ownership. `location` says where an
 *      object currently is (cosmos, workspace, library). Taking
 *      an object out of the cosmos changes that one field — the
 *      record, geometry, materials and history stay.
 *   3. Detaching a component does not corrupt the assembly. The
 *      parent keeps its parts, the component is marked detached,
 *      and a NEW object owns the extracted geometry. Reattaching
 *      puts the component back and keeps the extracted object's
 *      record, so its history is never destroyed.
 *   4. Every mutation is reversible. `undo`/`redo` restore the
 *      whole store snapshot — relationships and transforms
 *      included, not just what a renderer would draw.
 *   5. Only `deletePermanently` destroys a record, and it needs
 *      an explicit confirmation string.
 *
 * Units: millimetres, z-up, matching the pattern and the solver.
 * ==========================================================
 */

import type { Mesh } from "./geometry";

export type Vec3 = [number, number, number];

/* ---------------- geometry payload ---------------- */

export interface CreativePart {
  id: string;
  label: string;
  mesh: Mesh;
  /** Textile/material id from the material library. */
  materialId: string;
  /** Fallback colour when the material id is not in the library. */
  color: string;
  opacity: number;
  /** True for cloth and sheet surfaces, false for solids. */
  thin: boolean;
  componentId: string;
}

export type CreativeKind =
  | "garment"
  | "garment-component"
  | "pattern"
  | "pattern-piece"
  | "textile-sample"
  | "product"
  | "jewelry"
  | "jewelry-component"
  | "assembly";

export type ComponentKind =
  | "shell"
  | "sleeve"
  | "collar"
  | "panel"
  | "boning"
  | "overskirt"
  | "lining"
  | "pattern-piece"
  | "band"
  | "stone"
  | "setting"
  | "bail"
  | "chain"
  | "clasp"
  | "body"
  | "leg"
  | "seat"
  | "back"
  | "shelf"
  | "shade"
  | "base"
  | "fitting"
  | "other";

export type ComponentStatus = "attached" | "detached";

export interface ComponentSocket {
  id: string;
  accepts: ComponentKind[];
  /** In the parent's local space, mm and degrees. */
  positionMm: Vec3;
  rotationDeg: Vec3;
}

export interface CreativeComponent {
  id: string;
  name: string;
  kind: ComponentKind;
  /** Parts of this object that belong to the component. */
  partIds: string[];
  materialId: string;
  status: ComponentStatus;
  /** The object that owns the geometry while detached. */
  detachedObjectId?: string;
  /** Component kind accepted by this component's own socket, if any. */
  socket?: ComponentSocket;
  patternPieceId?: string;
  dimensions: Record<string, number>;
  note: string;
}

/* ---------------- object record ---------------- */

export interface Transform {
  position: Vec3;
  /** Euler degrees, applied X then Y then Z. */
  rotation: Vec3;
  scale: Vec3;
}

export const IDENTITY_TRANSFORM: Transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

export type MotionKind = "none" | "spin" | "orbit" | "bob";

export interface Motion {
  kind: MotionKind;
  /** Revolutions per minute for spin/orbit; cycles per minute for bob. */
  speed: number;
  /** Orbit path radius, mm. */
  radiusMm: number;
  /** Bob height, mm. */
  amplitudeMm: number;
  paused: boolean;
}

export const STILL: Motion = { kind: "none", speed: 2, radiusMm: 380, amplitudeMm: 40, paused: false };

/** Where the object currently is. Placement, not ownership. */
export type ObjectLocation = "cosmos" | "workspace" | "library";

export interface Attachment {
  parentObjectId: string;
  parentComponentId: string;
  socketId?: string;
  /** The child's transform relative to the parent at attach time. */
  relative: Transform;
}

export interface Provenance {
  createdBy: "lelu" | "owner";
  method: string;
  offline: boolean;
  /** Ids this object was derived from (a garment, a pattern, a revision). */
  derivedFrom: string[];
}

export interface RevisionEntry {
  revision: number;
  at: number;
  action: string;
  detail: string;
}

export interface ObjectCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface CreativeObject {
  id: string;
  kind: CreativeKind;
  name: string;
  revision: number;
  parts: CreativePart[];
  components: CreativeComponent[];
  sockets: ComponentSocket[];
  transform: Transform;
  motion: Motion;
  visible: boolean;
  locked: boolean;
  anchored: boolean;
  location: ObjectLocation;
  workspaceId: string;
  roomId?: string;
  /** Set when this object is a component extracted from another one. */
  attachment?: Attachment;
  /** Set when this object was put back into another object. */
  absorbedInto?: string;
  archived: boolean;
  source: { artifactId: string; artifactRevision: number; tool: string };
  /** Domain payload that makes the object re-editable (draft inputs, variables). */
  data: Record<string, unknown>;
  provenance: Provenance;
  checks: ObjectCheck[];
  createdAt: number;
  updatedAt: number;
  history: RevisionEntry[];
}

export interface CreateObjectInput {
  kind: CreativeKind;
  name: string;
  parts: CreativePart[];
  components?: CreativeComponent[];
  sockets?: ComponentSocket[];
  transform?: Partial<Transform>;
  location?: ObjectLocation;
  workspaceId?: string;
  motion?: Partial<Motion>;
  source?: Partial<CreativeObject["source"]>;
  provenance?: Partial<Provenance>;
  data?: Record<string, unknown>;
  checks?: ObjectCheck[];
  attachment?: Attachment;
}

/* ---------------- storage port ---------------- */

/**
 * Persistence is injected so the same store runs in the app (localStorage
 * through the existing KV layer), in tests (memory) and in a headless run
 * (a JSON file). The store never talks to a network.
 */
export interface CreativeStorage {
  read(): string | null;
  write(json: string): void;
}

export function memoryStorage(seed?: string): CreativeStorage {
  let value = seed ?? null;
  return {
    read: () => value,
    write: (json: string) => {
      value = json;
    },
  };
}

/**
 * Browser storage, guarded: a blocked or missing localStorage degrades to a
 * memory backend instead of throwing. `key` lets a test isolate itself.
 */
export function browserStorage(key = "lelu.creative.objects.v1"): CreativeStorage {
  let fallback: string | null = null;
  const usable = (): Storage | null => {
    try {
      const store = (globalThis as { localStorage?: Storage }).localStorage;
      if (!store) return null;
      const probe = `${key}.probe`;
      store.setItem(probe, "1");
      store.removeItem(probe);
      return store;
    } catch {
      return null;
    }
  };
  return {
    read: () => {
      const store = usable();
      if (!store) return fallback;
      try {
        return store.getItem(key);
      } catch {
        return fallback;
      }
    },
    write: (json: string) => {
      fallback = json;
      const store = usable();
      if (!store) return;
      try {
        store.setItem(key, json);
      } catch {
        /* quota or blocked: the memory copy still serves this session */
      }
    },
  };
}

/* ---------------- transform maths ---------------- */

const rad = (deg: number) => (deg * Math.PI) / 180;

export function applyTransform(positionMm: Vec3, t: Transform): Vec3 {
  const s: Vec3 = [positionMm[0] * t.scale[0], positionMm[1] * t.scale[1], positionMm[2] * t.scale[2]];
  const [rx, ry, rz] = [rad(t.rotation[0]), rad(t.rotation[1]), rad(t.rotation[2])];
  // X
  const y1 = s[1] * Math.cos(rx) - s[2] * Math.sin(rx);
  const z1 = s[1] * Math.sin(rx) + s[2] * Math.cos(rx);
  // Y
  const x2 = s[0] * Math.cos(ry) + z1 * Math.sin(ry);
  const z2 = -s[0] * Math.sin(ry) + z1 * Math.cos(ry);
  // Z
  const x3 = x2 * Math.cos(rz) - y1 * Math.sin(rz);
  const y3 = x2 * Math.sin(rz) + y1 * Math.cos(rz);
  return [x3 + t.position[0], y3 + t.position[1], z2 + t.position[2]];
}

export function composeTransforms(parent: Transform, child: Transform): Transform {
  return {
    position: applyTransform(child.position, parent),
    rotation: [parent.rotation[0] + child.rotation[0], parent.rotation[1] + child.rotation[1], parent.rotation[2] + child.rotation[2]],
    scale: [parent.scale[0] * child.scale[0], parent.scale[1] * child.scale[1], parent.scale[2] * child.scale[2]],
  };
}

/** Total transform at time t, including motion. Motion does not mutate the object. */
export function transformAt(object: CreativeObject, seconds: number): Transform {
  const t: Transform = {
    position: [...object.transform.position] as Vec3,
    rotation: [...object.transform.rotation] as Vec3,
    scale: [...object.transform.scale] as Vec3,
  };
  const m = object.motion;
  if (m.kind === "none" || m.paused) return t;
  const turns = (m.speed / 60) * seconds;
  const angle = turns * 360;
  if (m.kind === "spin") {
    t.rotation = [t.rotation[0], t.rotation[1], t.rotation[2] + angle];
  } else if (m.kind === "orbit") {
    const a = rad(angle);
    t.position = [t.position[0] + Math.cos(a) * m.radiusMm, t.position[1], t.position[2] + Math.sin(a) * m.radiusMm];
    t.rotation = [t.rotation[0], t.rotation[1] + angle, t.rotation[2]];
  } else if (m.kind === "bob") {
    t.position = [t.position[0], t.position[1], t.position[2] + Math.sin(rad(angle)) * m.amplitudeMm];
  }
  return t;
}

/* ---------------- helpers ---------------- */

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function hashPositions(parts: CreativePart[]): number {
  // FNV-1a over the geometry, rounded to 0.001 mm so a re-material is
  // provably a no-op on the mesh.
  let h = 0x811c9dc5;
  for (const part of parts) {
    for (const n of part.mesh.positions) {
      const v = Math.round(n * 1000) | 0;
      h ^= v & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 8) & 0xff;
      h = Math.imul(h, 0x01000193);
      h ^= (v >>> 16) & 0xff;
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

export function geometryFingerprint(object: CreativeObject): number {
  return hashPositions(object.parts);
}

export const COMPONENT_COMPATIBILITY: Record<ComponentKind, ComponentKind[]> = {
  shell: ["sleeve", "collar", "panel", "boning", "overskirt", "lining"],
  sleeve: ["fitting"],
  collar: ["fitting"],
  panel: ["panel"],
  boning: [],
  overskirt: [],
  lining: [],
  "pattern-piece": [],
  band: ["stone", "setting"],
  stone: ["setting"],
  setting: ["stone"],
  bail: ["chain"],
  chain: ["clasp", "chain"],
  clasp: [],
  body: ["leg", "seat", "back", "shelf", "shade", "base", "fitting"],
  leg: ["fitting"],
  seat: ["fitting"],
  back: ["fitting"],
  shelf: ["fitting"],
  shade: ["fitting"],
  base: ["fitting"],
  fitting: [],
  other: ["other"],
};

export function canAccept(parentKind: ComponentKind, childKind: ComponentKind): boolean {
  return COMPONENT_COMPATIBILITY[parentKind]?.includes(childKind) ?? false;
}

/* ---------------- store ---------------- */

export interface ResolveResult {
  ok: boolean;
  object?: CreativeObject;
  message: string;
}

export interface ComposeResult {
  objectId: string;
  name: string;
  transform: Transform;
  parts: Array<{ id: string; label: string; positions: number[]; indices: number[]; materialId: string; color: string; opacity: number; thin: boolean; componentId: string }>;
  triangles: number;
}

export default class CreativeObjects {
  private static shared: CreativeObjects | null = null;

  private objects = new Map<string, CreativeObject>();
  private sequence = 0;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private readonly storage: CreativeStorage;
  private readonly now: () => number;

  constructor(storage: CreativeStorage = memoryStorage(), now: () => number = () => Date.now()) {
    this.storage = storage;
    this.now = now;
    this.reload();
  }

  /** The app-wide instance, persisted in browser storage. */
  static getInstance(): CreativeObjects {
    if (!CreativeObjects.shared) CreativeObjects.shared = new CreativeObjects(browserStorage());
    return CreativeObjects.shared;
  }

  static resetShared(): void {
    CreativeObjects.shared = null;
  }

  /** Re-read persisted state — this is what a page reload does. */
  reload(): void {
    const raw = this.storage.read();
    this.objects = new Map();
    this.sequence = 0;
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { sequence?: number; objects?: CreativeObject[] };
      for (const object of parsed.objects ?? []) {
        if (!object?.id || !Array.isArray(object.parts)) continue;
        this.objects.set(object.id, object);
      }
      this.sequence = parsed.sequence ?? this.objects.size;
    } catch {
      // Corrupt payload: keep an empty store rather than crash the app.
      this.objects = new Map();
    }
  }

  private persist(): void {
    const objects = [...this.objects.values()];
    this.storage.write(JSON.stringify({ version: 1, sequence: this.sequence, objects }));
  }

  private snapshot(): void {
    this.undoStack.push(JSON.stringify([...this.objects.values()]));
    if (this.undoStack.length > 40) this.undoStack.shift();
    this.redoStack = [];
  }

  private bump(object: CreativeObject, action: string, detail: string): void {
    object.revision += 1;
    object.updatedAt = this.now();
    object.history.push({ revision: object.revision, at: object.updatedAt, action, detail });
    if (object.history.length > 60) object.history.shift();
    this.objects.set(object.id, object);
    this.persist();
  }

  /* ---------- creation and reading ---------- */

  create(input: CreateObjectInput): CreativeObject {
    this.snapshot();
    const id = this.nextId(input.kind);
    const now = this.now();
    const transform: Transform = {
      position: clone(input.transform?.position ?? IDENTITY_TRANSFORM.position),
      rotation: clone(input.transform?.rotation ?? IDENTITY_TRANSFORM.rotation),
      scale: clone(input.transform?.scale ?? IDENTITY_TRANSFORM.scale),
    };
    const object: CreativeObject = {
      id,
      kind: input.kind,
      name: input.name.trim() || id,
      revision: 1,
      parts: clone(input.parts),
      components: clone(input.components ?? []),
      sockets: clone(input.sockets ?? []),
      transform,
      motion: { ...STILL, ...(input.motion ?? {}) },
      visible: true,
      locked: false,
      anchored: false,
      location: input.location ?? "workspace",
      workspaceId: input.workspaceId ?? "chat-universe",
      ...(input.attachment ? { attachment: clone(input.attachment) } : {}),
      archived: false,
      source: { artifactId: id, artifactRevision: 1, tool: "couture", ...(input.source ?? {}) },
      data: clone(input.data ?? {}),
      provenance: { createdBy: "lelu", method: "creative engine", offline: true, derivedFrom: [], ...(input.provenance ?? {}) },
      checks: input.checks ?? [],
      createdAt: now,
      updatedAt: now,
      history: [{ revision: 1, at: now, action: "create", detail: `${input.kind} with ${input.parts.length} part(s), ${this.triangleCount(input.parts)} triangles` }],
    };
    this.objects.set(id, object);
    this.sequence += 1;
    this.persist();
    return object;
  }

  private triangleCount(parts: CreativePart[]): number {
    return parts.reduce((n, p) => n + Math.floor(p.mesh.indices.length / 3), 0);
  }

  private nextId(kind: CreativeKind): string {
    let n = this.sequence + 1;
    let id = `obj-${kind}-${n}`;
    while (this.objects.has(id)) {
      n += 1;
      id = `obj-${kind}-${n}`;
    }
    return id;
  }

  get(id: string): CreativeObject | undefined {
    return this.objects.get(id);
  }

  all(): CreativeObject[] {
    return [...this.objects.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  list(filter: { location?: ObjectLocation; kind?: CreativeKind; roomId?: string; includeArchived?: boolean } = {}): CreativeObject[] {
    return this.all().filter((o) => {
      if (!filter.includeArchived && o.archived) return false;
      if (filter.location && o.location !== filter.location) return false;
      if (filter.kind && o.kind !== filter.kind) return false;
      if (filter.roomId && o.roomId !== filter.roomId) return false;
      return true;
    });
  }

  /**
   * Resolve a spoken or partial reference to exactly one object.
   * An ambiguous reference is refused WITH the candidates, never guessed —
   * "take the dress out" must never remove the wrong dress.
   */
  resolve(reference: string, scope?: { location?: ObjectLocation }): ResolveResult {
    const raw = reference.trim();
    if (!raw) return { ok: false, message: "no object reference given" };
    const pool = this.list({ ...(scope?.location ? { location: scope.location } : {}), includeArchived: true });
    const byId = pool.find((o) => o.id === raw);
    if (byId) return { ok: true, object: byId, message: `resolved by id: ${byId.name}` };
    const key = raw.toLowerCase().replace(/^(the|my|a|an|this|that)\s+/, "").replace(/\s+/g, " ");
    const exact = pool.filter((o) => o.name.toLowerCase() === key);
    if (exact.length === 1) return { ok: true, object: exact[0], message: `resolved by name: ${exact[0].name}` };
    const partial = pool.filter((o) => o.name.toLowerCase().includes(key) || o.kind === key);
    if (partial.length === 1) return { ok: true, object: partial[0], message: `resolved ${partial[0].name}` };
    if (partial.length > 1) {
      const newest = partial.filter((o) => o.name.toLowerCase().includes(key));
      if (newest.length === 1) return { ok: true, object: newest[0], message: `resolved ${newest[0].name}` };
      return {
        ok: false,
        message: `"${reference}" matches ${partial.length} objects: ${partial.map((o) => `"${o.name}" (${o.id})`).join(", ")}. Say which one.`,
      };
    }
    return { ok: false, message: `no object matches "${reference}". Objects: ${pool.map((o) => `"${o.name}"`).join(", ") || "none yet"}` };
  }

  /* ---------- placement and lifecycle ---------- */

  placeInCosmos(id: string, options: { roomId?: string; position?: Vec3; anchored?: boolean } = {}): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    this.snapshot();
    object.location = "cosmos";
    object.roomId = options.roomId ?? object.roomId ?? "cosmos-core";
    if (options.position) object.transform.position = clone(options.position);
    object.anchored = options.anchored ?? false;
    object.visible = true;
    object.archived = false;
    this.bump(object, "place-in-cosmos", `in ${object.roomId} at ${object.transform.position.map((n) => Math.round(n)).join(", ")} mm`);
    return object;
  }

  /** Taking it out of the cosmos keeps the object. This is not a delete. */
  removeFromCosmos(id: string): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    this.snapshot();
    object.location = "workspace";
    object.anchored = false;
    object.motion = { ...object.motion, paused: true };
    this.bump(object, "remove-from-cosmos", "returned to its workspace; record, geometry and history kept");
    return object;
  }

  moveToWorkspace(id: string, workspaceId: string): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    this.snapshot();
    object.workspaceId = workspaceId;
    object.location = "workspace";
    this.bump(object, "move-to-workspace", workspaceId);
    return object;
  }

  saveToLibrary(id: string, name?: string): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    this.snapshot();
    object.location = "library";
    if (name) object.name = name.trim();
    this.bump(object, "save-to-library", "reusable asset; geometry and component hierarchy kept");
    return object;
  }

  archive(id: string): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    this.snapshot();
    object.archived = true;
    object.visible = false;
    this.bump(object, "archive", "hidden from listings; still stored");
    return object;
  }

  unarchive(id: string): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    this.snapshot();
    object.archived = false;
    object.visible = true;
    this.bump(object, "unarchive", "visible again");
    return object;
  }

  /**
   * The only destructive operation. It refuses without the confirmation
   * string, and it refuses an object that is still inside another creation.
   */
  deletePermanently(id: string, confirm: string): { ok: boolean; message: string } {
    const object = this.get(id);
    if (!object) return { ok: false, message: `no object ${id}` };
    if (confirm !== object.name && confirm !== "DELETE") {
      return { ok: false, message: `to delete "${object.name}" permanently, pass its exact name or DELETE` };
    }
    const parent = object.attachment ? this.get(object.attachment.parentObjectId) : undefined;
    if (parent) return { ok: false, message: `"${object.name}" is part of "${parent.name}"; detach or reattach it first` };
    this.snapshot();
    this.objects.delete(id);
    this.persist();
    return { ok: true, message: `deleted "${object.name}" (${id}); undo can bring it back` };
  }

  /* ---------- transforms, motion, visibility ---------- */

  setTransform(id: string, patch: Partial<Transform>): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    if (object.locked) return object;
    this.snapshot();
    if (patch.position) object.transform.position = clone(patch.position);
    if (patch.rotation) object.transform.rotation = clone(patch.rotation);
    if (patch.scale) object.transform.scale = clone(patch.scale);
    this.bump(object, "transform", `pos ${object.transform.position.map((n) => Math.round(n)).join(",")} rot ${object.transform.rotation.map((n) => Math.round(n)).join(",")}`);
    return object;
  }

  moveBy(id: string, delta: Vec3): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    return this.setTransform(id, { position: [object.transform.position[0] + delta[0], object.transform.position[1] + delta[1], object.transform.position[2] + delta[2]] });
  }

  rotateBy(id: string, delta: Vec3): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    return this.setTransform(id, { rotation: [object.transform.rotation[0] + delta[0], object.transform.rotation[1] + delta[1], object.transform.rotation[2] + delta[2]] });
  }

  scaleTo(id: string, factor: number): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    const f = Math.min(20, Math.max(0.05, factor));
    return this.setTransform(id, { scale: [f, f, f] });
  }

  anchor(id: string, anchored = true): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    this.snapshot();
    object.anchored = anchored;
    this.bump(object, anchored ? "anchor" : "unanchor", anchored ? "held in place" : "free to move");
    return object;
  }

  setMotion(id: string, motion: Partial<Motion>): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    this.snapshot();
    object.motion = { ...object.motion, ...motion };
    this.bump(object, "motion", `${object.motion.kind}${object.motion.paused ? " (paused)" : ""} at ${object.motion.speed}/min`);
    return object;
  }

  setVisible(id: string, visible: boolean): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    this.snapshot();
    object.visible = visible;
    this.bump(object, "visibility", visible ? "shown" : "hidden");
    return object;
  }

  setLocked(id: string, locked: boolean): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    this.snapshot();
    object.locked = locked;
    this.bump(object, "lock", locked ? "locked" : "unlocked");
    return object;
  }

  /** Update the parametric data (variables, draft inputs) without rebuilding geometry. */
  setData(id: string, patch: Record<string, unknown>): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    this.snapshot();
    object.data = { ...object.data, ...clone(patch) };
    this.bump(object, "data", `edited ${Object.keys(patch).join(", ")}`);
    return object;
  }

  /* ---------- materials ---------- */

  /**
   * Change a material without touching geometry: only `materialId` fields
   * move, and the test asserts the geometry fingerprint is unchanged.
   */
  setMaterial(id: string, materialId: string, componentId?: string): CreativeObject | null {
    const object = this.get(id);
    if (!object) return null;
    this.snapshot();
    let changed = 0;
    for (const part of object.parts) {
      if (componentId && part.componentId !== componentId) continue;
      part.materialId = materialId;
      changed += 1;
    }
    for (const component of object.components) {
      if (componentId && component.id !== componentId) continue;
      component.materialId = materialId;
    }
    this.bump(object, "material", `${materialId} on ${changed} part(s); geometry untouched`);
    return object;
  }

  /* ---------- components ---------- */

  findComponent(objectId: string, reference: string): CreativeComponent | undefined {
    const object = this.get(objectId);
    if (!object) return undefined;
    const key = reference.trim().toLowerCase();
    return (
      object.components.find((c) => c.id === reference) ??
      object.components.find((c) => c.name.toLowerCase() === key) ??
      object.components.find((c) => c.kind === key) ??
      object.components.find((c) => c.name.toLowerCase().includes(key))
    );
  }

  /**
   * Extract a component into its own editable object.
   * The parent keeps the geometry and marks the component detached; the new
   * object owns a copy so it can be transformed, re-materialed and versioned
   * on its own.
   */
  detachComponent(objectId: string, componentRef: string, options: { name?: string; position?: Vec3 } = {}): { ok: boolean; message: string; object?: CreativeObject } {
    const parent = this.get(objectId);
    if (!parent) return { ok: false, message: `no object ${objectId}` };
    const component = this.findComponent(objectId, componentRef);
    if (!component) return { ok: false, message: `"${componentRef}" is not a component of "${parent.name}" (${parent.components.map((c) => c.name).join(", ")})` };
    if (component.status === "detached") {
      const existing = component.detachedObjectId ? this.get(component.detachedObjectId) : undefined;
      return { ok: false, message: `"${component.name}" is already detached${existing ? ` as "${existing.name}" (${existing.id})` : ""}` };
    }
    const partIds = new Set(component.partIds);
    const copyComponentId = `${component.id}-copy`;
    const parts = parent.parts.filter((p) => partIds.has(p.id)).map((p) => ({ ...clone(p), componentId: copyComponentId }));
    if (parts.length === 0) return { ok: false, message: `"${component.name}" has no geometry to extract` };

    this.snapshot();
    const offset: Vec3 = options.position ?? [
      parent.transform.position[0] + 420,
      parent.transform.position[1],
      parent.transform.position[2],
    ];
    const child = this.create({
      kind: parent.kind === "jewelry" ? "jewelry-component" : "garment-component",
      name: options.name ?? `${parent.name} — ${component.name}`,
      parts,
      components: [
        {
          id: copyComponentId,
          name: component.name,
          kind: component.kind,
          partIds: parts.map((p) => p.id),
          materialId: component.materialId,
          status: "attached",
          dimensions: clone(component.dimensions),
          note: `extracted from ${parent.id} at revision ${parent.revision}`,
        },
      ],
      transform: { position: offset, rotation: [...parent.transform.rotation], scale: [...parent.transform.scale] },
      location: "cosmos",
      workspaceId: parent.workspaceId,
      motion: { kind: "spin", speed: 3, radiusMm: 0 },
      provenance: { createdBy: "lelu", method: "component extraction", offline: true, derivedFrom: [parent.id] },
      attachment: {
        parentObjectId: parent.id,
        parentComponentId: component.id,
        ...(component.socket ? { socketId: component.socket.id } : {}),
        relative: { position: clone(offset), rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    });
    component.status = "detached";
    component.detachedObjectId = child.id;
    this.bump(parent, "detach-component", `${component.name} → ${child.id}`);
    return { ok: true, message: `detached "${component.name}" as "${child.name}" (${child.id})`, object: child };
  }

  /**
   * Put a detached component back. Compatibility is checked against the
   * parent's socket; the extracted object is kept (absorbed), never deleted.
   */
  attachComponent(childId: string, parentId: string, socketId?: string): { ok: boolean; message: string; object?: CreativeObject } {
    const child = this.get(childId);
    if (!child) return { ok: false, message: `no object ${childId}` };
    const parent = this.get(parentId);
    if (!parent) return { ok: false, message: `no object ${parentId}` };
    if (!child.attachment || child.attachment.parentObjectId !== parentId) {
      return { ok: false, message: `"${child.name}" was not extracted from "${parent.name}"; use attach-component with a compatible socket` };
    }
    const component = parent.components.find((c) => c.id === child.attachment?.parentComponentId);
    if (!component) return { ok: false, message: `"${parent.name}" no longer has that component` };
    const socket = socketId
      ? parent.sockets.find((s) => s.id === socketId)
      : component.socket
        ? parent.sockets.find((s) => s.id === component.socket?.id) ?? component.socket
        : undefined;
    if (socket && !socket.accepts.includes(component.kind)) {
      return { ok: false, message: `socket ${socket.id} accepts ${socket.accepts.join(", ")}, not ${component.kind}` };
    }
    this.snapshot();
    component.status = "attached";
    delete component.detachedObjectId;
    child.absorbedInto = parent.id;
    child.location = "workspace";
    child.motion = { ...child.motion, paused: true };
    this.bump(child, "absorbed", `reunited with ${parent.name} (${parent.id})`);
    this.bump(parent, "attach-component", `${component.name} ← ${child.id}${socket ? ` at ${socket.id}` : ""}`);
    return { ok: true, message: `reattached "${component.name}" to "${parent.name}"`, object: parent };
  }

  /**
   * Reuse a component in a DIFFERENT creation: its geometry is cloned into the
   * target as a new component (compatibility checked), and the extracted
   * object is kept in its workspace so its own history survives.
   */
  reuseComponent(childId: string, targetObjectId: string, options: { name?: string } = {}): { ok: boolean; message: string; object?: CreativeObject } {
    const child = this.get(childId);
    if (!child) return { ok: false, message: `no object ${childId}` };
    const target = this.get(targetObjectId);
    if (!target) return { ok: false, message: `no object ${targetObjectId}` };
    const sourceComponent = child.components[0];
    if (!sourceComponent) return { ok: false, message: `"${child.name}" has no component to reuse` };
    const socket = target.sockets.find((s) => s.accepts.includes(sourceComponent.kind));
    if (!socket) {
      return {
        ok: false,
        message: `"${target.name}" has no socket that accepts a ${sourceComponent.kind}. Sockets: ${target.sockets.map((s) => `${s.id} (${s.accepts.join(",")})`).join("; ") || "none"}`,
      };
    }
    this.snapshot();
    const componentId = `c-reused-${this.sequence + 1}`;
    // Re-identify the geometry: the target may already own a part with the
    // same local id (two sleeves on one garment), and ids must stay unique.
    const parts = child.parts.map((p, index) => ({ ...clone(p), id: `${componentId}-p${index + 1}`, componentId }));
    target.parts.push(...parts);
    target.components.push({
      id: componentId,
      name: options.name ?? `${child.name} (reused)`,
      kind: sourceComponent.kind,
      partIds: parts.map((p) => p.id),
      materialId: sourceComponent.materialId,
      status: "attached",
      dimensions: clone(sourceComponent.dimensions),
      note: `reused from ${child.id} into ${target.id} at socket ${socket.id}`,
    });
    child.absorbedInto = target.id;
    child.location = "workspace";
    this.bump(child, "reused", `geometry reused in ${target.name} (${target.id})`);
    this.bump(target, "reuse-component", `${child.name} seated at ${socket.id}`);
    return { ok: true, message: `reused "${child.name}" in "${target.name}" at ${socket.id}`, object: target };
  }

  /** Duplicate an object; the copy has its own identity and history. */
  duplicate(id: string, options: { name?: string; toCosmos?: boolean } = {}): CreativeObject | null {
    const source = this.get(id);
    if (!source) return null;
    const copy = this.create({
      kind: source.kind,
      name: options.name ?? `${source.name} (copy)`,
      parts: clone(source.parts),
      components: clone(source.components).map((c) => ({ ...c, status: "attached" as ComponentStatus, ...(c.detachedObjectId ? {} : {}) })),
      sockets: clone(source.sockets),
      transform: clone(source.transform),
      location: options.toCosmos ? "cosmos" : source.location,
      workspaceId: source.workspaceId,
      motion: clone(source.motion),
      source: { ...source.source, artifactId: source.id, artifactRevision: source.revision },
      data: clone(source.data),
      provenance: { ...source.provenance, method: `duplicate of ${source.id}`, derivedFrom: [...source.provenance.derivedFrom, source.id] },
      checks: clone(source.checks),
    });
    for (const component of copy.components) delete component.detachedObjectId;
    this.bump(copy, "duplicate", `from ${source.id} revision ${source.revision}`);
    return copy;
  }

  /* ---------- composition ---------- */

  /**
   * World-space parts at a moment in time. Detached components are left out
   * of the parent (their geometry lives in the extracted object), which is
   * exactly what "the sleeve is no longer on the dress" means.
   */
  compose(id: string, seconds = 0): ComposeResult | null {
    const object = this.get(id);
    if (!object) return null;
    const detached = new Set(object.components.filter((c) => c.status === "detached").map((c) => c.id));
    const transform = transformAt(object, seconds);
    const parts: ComposeResult["parts"] = [];
    let triangles = 0;
    for (const part of object.parts) {
      if (detached.has(part.componentId)) continue;
      const positions: number[] = new Array(part.mesh.positions.length);
      for (let i = 0; i < part.mesh.positions.length; i += 3) {
        const p = applyTransform([part.mesh.positions[i], part.mesh.positions[i + 1], part.mesh.positions[i + 2]], transform);
        positions[i] = p[0];
        positions[i + 1] = p[1];
        positions[i + 2] = p[2];
      }
      triangles += Math.floor(part.mesh.indices.length / 3);
      parts.push({
        id: part.id,
        label: part.label,
        positions,
        indices: part.mesh.indices,
        materialId: part.materialId,
        color: part.color,
        opacity: part.opacity,
        thin: part.thin,
        componentId: part.componentId,
      });
    }
    return { objectId: object.id, name: object.name, transform, parts, triangles };
  }

  /** Every visible Cosmos object, composed for a scene render. */
  composeCosmos(seconds = 0): ComposeResult[] {
    return this.list({ location: "cosmos" })
      .filter((o) => o.visible && !o.archived)
      .map((o) => this.compose(o.id, seconds))
      .filter((x): x is ComposeResult => Boolean(x));
  }

  /* ---------- integrity ---------- */

  /** Invariants that must hold after every lifecycle operation. */
  integrity(): ObjectCheck[] {
    const checks: ObjectCheck[] = [];
    const ids = new Set([...this.objects.keys()]);
    const partIds = new Set<string>();
    const componentIds = new Set<string>();
    let duplicateIds = 0;
    const duplicateKeys: string[] = [];
    let orphanParts = 0;
    let missingDetached = 0;
    let danglingAttachment = 0;
    let cycles = 0;

    for (const object of this.objects.values()) {
      if (!ids.has(object.id)) duplicateIds += 1;
      const ownParts = new Set(object.parts.map((p) => p.id));
      const ownComponents = new Set(object.components.map((c) => c.id));
      for (const part of object.parts) {
        if (!ownComponents.has(part.componentId)) orphanParts += 1;
        if (partIds.has(`${object.id}:${part.id}`)) {
          duplicateIds += 1;
          duplicateKeys.push(`${object.id}:${part.id}`);
        }
        partIds.add(`${object.id}:${part.id}`);
      }
      for (const component of object.components) {
        if (componentIds.has(`${object.id}:${component.id}`)) {
          duplicateIds += 1;
          duplicateKeys.push(`${object.id}:${component.id}`);
        }
        componentIds.add(`${object.id}:${component.id}`);
        if (component.partIds.some((pid) => !ownParts.has(pid))) orphanParts += 1;
        if (component.status === "detached") {
          const child = component.detachedObjectId ? this.get(component.detachedObjectId) : undefined;
          if (!child) missingDetached += 1;
        }
      }
      if (object.attachment) {
        const parent = this.get(object.attachment.parentObjectId);
        if (!parent || !parent.components.some((c) => c.id === object.attachment?.parentComponentId)) danglingAttachment += 1;
      }
    }

    // Cycle check through absorption links.
    for (const object of this.objects.values()) {
      let cursor: CreativeObject | undefined = object;
      const seen = new Set<string>();
      while (cursor) {
        if (seen.has(cursor.id)) {
          cycles += 1;
          break;
        }
        seen.add(cursor.id);
        cursor = cursor.absorbedInto ? this.get(cursor.absorbedInto) : undefined;
      }
    }

    checks.push({ name: "unique ids", ok: duplicateIds === 0, detail: `${this.objects.size} objects, ${partIds.size} parts, ${componentIds.size} components${duplicateKeys.length ? ` — duplicates: ${duplicateKeys.slice(0, 5).join(", ")}` : ""}` });
    checks.push({ name: "every part belongs to a component", ok: orphanParts === 0, detail: `${orphanParts} orphaned references` });
    checks.push({ name: "every detached component has its extracted object", ok: missingDetached === 0, detail: `${missingDetached} missing` });
    checks.push({ name: "attachments point at real components", ok: danglingAttachment === 0, detail: `${danglingAttachment} dangling` });
    checks.push({ name: "no cycles", ok: cycles === 0, detail: `${cycles} cycles` });
    return checks;
  }

  /* ---------- undo / redo ---------- */

  undo(): { ok: boolean; message: string } {
    const previous = this.undoStack.pop();
    if (!previous) return { ok: false, message: "nothing to undo" };
    this.redoStack.push(JSON.stringify([...this.objects.values()]));
    this.restoreSnapshot(previous);
    return { ok: true, message: `undone (${this.objects.size} objects restored with their relationships and transforms)` };
  }

  redo(): { ok: boolean; message: string } {
    const next = this.redoStack.pop();
    if (!next) return { ok: false, message: "nothing to redo" };
    this.undoStack.push(JSON.stringify([...this.objects.values()]));
    this.restoreSnapshot(next);
    return { ok: true, message: "redone" };
  }

  private restoreSnapshot(json: string): void {
    const objects = JSON.parse(json) as CreativeObject[];
    this.objects = new Map(objects.map((o) => [o.id, o]));
    this.persist();
  }

  /** Serialise the whole project — the JSON export path. */
  toJSON(): { version: number; sequence: number; objects: CreativeObject[] } {
    return { version: 1, sequence: this.sequence, objects: this.all() };
  }

  /** For tests and the demo: the same store, a fresh read of the same bytes. */
  factory(): CreativeObjects {
    return new CreativeObjects(this.storage, this.now);
  }
}
