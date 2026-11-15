/**
 * ==========================================================
 * LÉLU — COSMOS OBJECT STORE
 *
 * The object library and the scene, in one place, because they are the
 * same thing: an object is either in the Cosmos or in the trash, and
 * "extracting" it from an assembly only detaches its parent.
 *
 * Every operation is deterministic and local. Ids are stable for life;
 * the only random-looking parts are the ids themselves, and tests can
 * inject a counter. State is persisted through the existing KvStore, so
 * a reload restores identity, geometry, relationships, positions and
 * motion — the same objects, not a picture of them.
 * ==========================================================
 */

import KvStore from "../../storage/KvStore";
import type { Scene3DProgram } from "../../creative/kit/Scene3D";
import {
  DEFAULT_MOTION,
  clampScale,
  frameOf,
  isVec3,
  ringSlot,
  type CosmosGroups,
  type CosmosObject,
  type CosmosObjectState,
  type MotionKind,
  type ObjectFrame,
  type ObjectMotion,
  type Vec3,
} from "./CosmosObjectTypes";

const STORE_KEY = "lelu.cosmos.objects.v1";
const MAX_OBJECTS = 120;
/** How far back undo goes in one session. */
const HISTORY_MAX = 30;
/** How much of that survives a reload — enough to take back the last few things. */
const HISTORY_PERSISTED = 4;

export interface SpawnInput {
  name: string;
  scene: Scene3DProgram;
  domain?: string;
  builder?: string;
  description?: string;
  params?: Record<string, number | string>;
  source?: { artifactId: string; rev: number } | null;
  partCount?: number;
  frame?: Partial<ObjectFrame>;
  motion?: Partial<ObjectMotion>;
  group?: string | null;
  place?: CosmosObject["place"];
}

export type StoreResult<T> = { ok: true; value: T } | { ok: false; reason: string };

type Listener = (state: CosmosObjectState) => void;

/** A whole-Cosmos snapshot: what undo restores, without duplicating objects. */
interface CosmosSnapshot {
  objects: CosmosObject[];
  groups: CosmosGroups;
  trash: CosmosObject[];
  selected: string | null;
  selection: string[];
  ids: number;
}

function cloneObject(object: CosmosObject): CosmosObject {
  return {
    ...object,
    params: { ...object.params },
    scene: { ...object.scene, objects: object.scene.objects.map((part) => ({ ...part, size: { ...part.size }, position: [...part.position] as Vec3, rotation: [...part.rotation] as Vec3, scale: [...part.scale] as Vec3 })) },
    frame: { ...object.frame, position: [...object.frame.position] as Vec3, rotation: [...object.frame.rotation] as Vec3 },
    motion: { ...object.motion },
    parent: object.parent,
    children: [...object.children],
    provenance: object.provenance.map((p) => ({ ...p })),
  };
}

function now(): number {
  return Date.now();
}

function cloneSnapshot(snapshot: CosmosSnapshot): CosmosSnapshot {
  return {
    objects: snapshot.objects.map(cloneObject),
    groups: JSON.parse(JSON.stringify(snapshot.groups)) as CosmosGroups,
    trash: snapshot.trash.map(cloneObject),
    selected: snapshot.selected,
    selection: [...snapshot.selection],
    ids: snapshot.ids,
  };
}

export default class CosmosObjectStore {
  private static instance: CosmosObjectStore | null = null;

  private objects = new Map<string, CosmosObject>();
  private groups: CosmosGroups = {};
  private trash: CosmosObject[] = [];
  private selected: string | null = null;
  /** multi-selection: the objects the next group/move acts on */
  private selection: string[] = [];
  private listeners = new Set<Listener>();
  private ids = 0;
  private revision = 0;
  private snapshot: CosmosObjectState;
  /** whole-Cosmos states, newest last: the "before" of each operation */
  private undoStack: CosmosSnapshot[] = [];
  private redoStack: CosmosSnapshot[] = [];
  /** the state as of the last commit — what the next operation started from */
  private last: CosmosSnapshot;

  static getInstance(): CosmosObjectStore {
    if (!CosmosObjectStore.instance) CosmosObjectStore.instance = new CosmosObjectStore();
    return CosmosObjectStore.instance;
  }

  /** A store that neither reads nor writes storage. Tests use this. */
  static createIsolated(): CosmosObjectStore {
    return new CosmosObjectStore(false);
  }

  private constructor(private persist = true) {
    if (this.persist) this.load();
    this.snapshot = this.build();
    this.last = this.serialize();
  }

  /* ------------------------------------------------------------------ */
  /* reading                                                             */
  /* ------------------------------------------------------------------ */

  public getState(): CosmosObjectState {
    return this.snapshot;
  }

  public subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public list(filter?: { place?: CosmosObject["place"]; domain?: string; group?: string; query?: string; selectedOnly?: boolean }): CosmosObject[] {
    let all = [...this.objects.values()];
    if (filter?.place) all = all.filter((o) => o.place === filter.place);
    if (filter?.domain) all = all.filter((o) => o.domain.toLowerCase() === filter.domain!.toLowerCase());
    if (filter?.group) all = all.filter((o) => o.group === filter.group);
    if (filter?.selectedOnly) all = all.filter((o) => o.id === this.selected);
    if (filter?.query) {
      const q = filter.query.toLowerCase();
      all = all.filter((o) => `${o.name} ${o.id} ${o.domain} ${o.description}`.toLowerCase().includes(q));
    }
    return all.sort((a, b) => a.createdAt - b.createdAt);
  }

  public get(id: string): CosmosObject | undefined {
    return this.objects.get(id);
  }

  /** "engine", the id, or a unique part of the name. */
  public resolve(reference?: string): CosmosObject | undefined {
    const ref = (reference ?? "").trim();
    if (!ref) return this.selected ? this.objects.get(this.selected) : this.list()[this.list().length - 1];
    const exact = this.objects.get(ref) ?? this.trash.find((o) => o.id === ref);
    if (exact) return exact;
    const q = ref.toLowerCase();
    const byName = this.list().filter((o) => o.name.toLowerCase().includes(q));
    if (byName.length) return byName[byName.length - 1];
    const trashed = this.trash.filter((o) => o.name.toLowerCase().includes(q));
    return trashed[trashed.length - 1];
  }

  public get groups_(): CosmosGroups {
    return this.groups;
  }

  public selectedId(): string | null {
    return this.selected;
  }

  /* ------------------------------------------------------------------ */
  /* writing                                                             */
  /* ------------------------------------------------------------------ */

  public spawn(input: SpawnInput): StoreResult<CosmosObject> {
    if (!input?.name || !input.scene || !Array.isArray(input.scene.objects) || input.scene.objects.length === 0) {
      return { ok: false, reason: "an object needs a name and some geometry: nothing was spawned" };
    }
    if (this.objects.size >= MAX_OBJECTS) {
      return { ok: false, reason: `the Cosmos is holding ${MAX_OBJECTS} objects — remove or export some before adding more` };
    }
    const at = now();
    const id = this.newId("obj");
    const siblings = this.list().filter((o) => !o.group || o.group !== input.group);
    // The Cosmos is drawn at scene scale, where a half-metre gearbox would be a
    // dot: an object arrives at a readable size, and its scale is a real
    // property the user can change ("make it smaller").
    const wanted = { ...(input.frame ?? {}) };
    if (wanted.scale === undefined) wanted.scale = 4;
    if (!wanted.position) wanted.position = ringSlot(siblings.length);
    const frame = frameOf(wanted);
    const object: CosmosObject = {
      id,
      name: input.name.trim().slice(0, 80),
      description: input.description?.trim().slice(0, 400) ?? "",
      domain: input.domain ?? "mechanical",
      builder: input.builder ?? "unknown",
      source: input.source ?? null,
      params: { ...(input.params ?? {}) },
      scene: input.scene,
      partCount: input.partCount ?? input.scene.objects.length,
      frame,
      motion: { ...DEFAULT_MOTION, ...(input.motion ?? {}) },
      parent: null,
      children: [],
      group: input.group ?? null,
      visible: true,
      locked: false,
      place: input.place ?? "cosmos",
      createdAt: at,
      updatedAt: at,
      provenance: [{ at, action: "spawned", detail: input.source ? `from ${input.source.artifactId} revision ${input.source.rev}` : "constructed" }],
    };
    this.objects.set(id, object);
    if (object.group) this.addToGroup(object.group, id);
    this.commit(`spawned ${object.name}`);
    return { ok: true, value: object };
  }

  public transform(
    id: string,
    change: { position?: Vec3; rotation?: Vec3; scale?: number; absolute?: boolean },
    opts?: { history?: boolean },
  ): StoreResult<CosmosObject> {
    const object = this.objects.get(id);
    if (!object) return { ok: false, reason: `no object ${id}` };
    if (object.locked) return { ok: false, reason: `“${object.name}” is locked — unlock it before moving it` };
    const position = change.position ? (isVec3(change.position) ? change.position : null) : null;
    if (change.position && !position) return { ok: false, reason: "a position is three numbers" };
    if (position) {
      const base = change.absolute === false ? object.frame.position : ([0, 0, 0] as Vec3);
      object.frame.position = [base[0] + position[0], base[1] + position[1], base[2] + position[2]];
    }
    if (change.rotation) {
      const r = isVec3(change.rotation) ? change.rotation : null;
      if (!r) return { ok: false, reason: "a rotation is three angles in degrees" };
      object.frame.rotation = change.absolute === false ? ([object.frame.rotation[0] + r[0], object.frame.rotation[1] + r[1], object.frame.rotation[2] + r[2]] as Vec3) : r;
    }
    if (typeof change.scale === "number") object.frame.scale = clampScale(change.scale);
    object.updatedAt = now();
    object.provenance.push({ at: object.updatedAt, action: "transformed", detail: `${change.position ? "moved" : ""}${change.rotation ? " rotated" : ""}${typeof change.scale === "number" ? " rescaled" : ""}`.trim() });
    this.commit(`moved ${object.name}`, opts?.history !== false);
    return { ok: true, value: object };
  }

  public animate(id: string, motion: Partial<ObjectMotion>): StoreResult<CosmosObject> {
    const object = this.objects.get(id);
    if (!object) return { ok: false, reason: `no object ${id}` };
    const kinds: MotionKind[] = ["still", "spin", "orbit", "bob", "drift"];
    if (motion.kind && !kinds.includes(motion.kind)) return { ok: false, reason: `unknown motion “${motion.kind}” — use ${kinds.join(", ")}` };
    object.motion = {
      ...object.motion,
      ...motion,
      speed: typeof motion.speed === "number" ? Math.min(2, Math.max(0, motion.speed)) : object.motion.speed,
      axis: motion.axis === "x" || motion.axis === "z" || motion.axis === "y" ? motion.axis : object.motion.axis,
    };
    object.updatedAt = now();
    object.provenance.push({ at: object.updatedAt, action: "animation", detail: `${object.motion.kind} ${object.motion.speed}/s${object.motion.paused ? ", paused" : ""}` });
    this.commit(`animated ${object.name}`);
    return { ok: true, value: object };
  }

  /** Pause or resume every floating object at once. */
  public pauseAll(paused: boolean): number {
    let count = 0;
    for (const object of this.objects.values()) {
      if (object.motion.kind === "still") continue;
      object.motion = { ...object.motion, paused };
      count += 1;
    }
    if (count) this.commit(paused ? "paused all motion" : "resumed all motion");
    return count;
  }

  public select(id: string | null, opts?: { add?: boolean }): StoreResult<CosmosObject | null> {
    if (id === null) {
      this.selected = null;
      this.selection = [];
      this.commit("cleared the selection", false);
      return { ok: true, value: null };
    }
    const object = this.objects.get(id) ?? this.resolve(id);
    if (!object) return { ok: false, reason: `no object matching “${id}”` };
    this.selected = object.id;
    if (opts?.add) {
      this.selection = this.selection.includes(object.id) ? this.selection.filter((s) => s !== object.id) : [...this.selection, object.id];
      if (!this.selection.includes(object.id)) this.selected = this.selection[this.selection.length - 1] ?? null;
    } else {
      this.selection = [object.id];
    }
    // Selection is a view state, not a change to the Cosmos: it is not undoable.
    this.commit(`selected ${object.name}`, false);
    return { ok: true, value: object };
  }

  /** The objects a group/move command should act on. */
  public selectionIds(): string[] {
    return [...this.selection];
  }

  /* ------------------------------------------------------------------ */
  /* history                                                             */
  /* ------------------------------------------------------------------ */

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public historyDepth(): { undo: number; redo: number } {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }

  /** Take back the last operation. Ids and geometry are restored, not re-created. */
  public undo(): StoreResult<string> {
    const previous = this.undoStack.pop();
    if (!previous) return { ok: false, reason: "there is nothing to take back yet" };
    this.redoStack.push(cloneSnapshot(this.serialize()));
    if (this.redoStack.length > HISTORY_MAX) this.redoStack.shift();
    this.applySnapshot(previous);
    this.commit("undone", false);
    return { ok: true, value: "undid the last change" };
  }

  public redo(): StoreResult<string> {
    const next = this.redoStack.pop();
    if (!next) return { ok: false, reason: "there is nothing to redo" };
    this.undoStack.push(cloneSnapshot(this.serialize()));
    if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
    this.applySnapshot(next);
    this.commit("redone", false);
    return { ok: true, value: "redid the change" };
  }

  /**
   * Split one part out of an object as its own object: the crankshaft out of an
   * engine, a panel out of a garment, a chair out of a furniture assembly. The
   * part keeps its size, material and world position; the parent keeps its id
   * and loses only that part.
   */
  public splitPart(id: string, partRef: string): StoreResult<{ source: CosmosObject; part: CosmosObject }> {
    const source = this.objects.get(id) ?? this.resolve(id);
    if (!source) return { ok: false, reason: `no object matching “${id}”` };
    if (this.objects.size >= MAX_OBJECTS) return { ok: false, reason: `the Cosmos is holding ${MAX_OBJECTS} objects — remove one first` };
    const key = (partRef ?? "").trim().toLowerCase();
    const index = source.scene.objects.findIndex((p) => p.id.toLowerCase() === key) >= 0
      ? source.scene.objects.findIndex((p) => p.id.toLowerCase() === key)
      : source.scene.objects.findIndex((p) => p.id.toLowerCase().includes(key));
    if (index < 0) {
      const available = [...new Set(source.scene.objects.map((p) => p.id))].slice(0, 14).join(", ");
      return { ok: false, reason: `“${source.name}” has no part called “${partRef}” — its parts are: ${available}${source.scene.objects.length > 14 ? " …" : ""}` };
    }
    const part = source.scene.objects[index];
    const s = source.frame.scale;
    const theta = (source.frame.rotation[1] * Math.PI) / 180;
    const localX = part.position[0] * s;
    const localZ = part.position[2] * s;
    // Keep the part where it was on screen: rotate its offset into the parent's
    // orientation, then re-centre the geometry on its own origin so it can be
    // turned and scaled like any other object.
    const worldPosition: Vec3 = [
      source.frame.position[0] + localX * Math.cos(theta) + localZ * Math.sin(theta),
      source.frame.position[1] + part.position[1] * s,
      source.frame.position[2] - localX * Math.sin(theta) + localZ * Math.cos(theta),
    ];
    const at = now();
    const newId = this.newId("obj");
    const piece: CosmosObject = {
      id: newId,
      name: `${source.name} · ${part.id}`.slice(0, 80),
      description: `the ${part.id} taken out of “${source.name}”`,
      domain: source.domain,
      builder: source.builder,
      source: source.source,
      params: { ...source.params },
      scene: {
        ...source.scene,
        objects: [{ ...part, id: `${part.id}-part`, position: [0, 0, 0], rotation: [...part.rotation] as Vec3, scale: [...part.scale] as Vec3, size: { ...part.size } }],
      },
      partCount: 1,
      frame: { position: worldPosition, rotation: [...source.frame.rotation] as Vec3, scale: s },
      motion: { ...DEFAULT_MOTION },
      parent: null,
      children: [],
      group: source.group,
      visible: true,
      locked: false,
      place: source.place,
      createdAt: at,
      updatedAt: at,
      provenance: [{ at, action: "split out", detail: `part ${part.id} of ${source.id} “${source.name}”` }],
    };
    // Take the part out of the parent, and record both sides of the change.
    source.scene = { ...source.scene, objects: source.scene.objects.filter((_, i) => i !== index) };
    source.partCount = Math.max(1, source.scene.objects.length);
    source.updatedAt = at;
    source.provenance.push({ at, action: "part removed", detail: `${part.id} → ${newId}` });
    this.objects.set(newId, piece);
    if (piece.group) this.addToGroup(piece.group, newId);
    this.commit(`split ${part.id} out of ${source.name}`);
    return { ok: true, value: { source, part: piece } };
  }

  /**
   * Move several objects at once, recording ONE undo step: dragging a
   * multi-selection must be one thing to take back, not five.
   */
  public nudge(ids: string[], delta: Vec3, opts?: { history?: boolean; silent?: boolean }): StoreResult<CosmosObject[]> {
    const moved: CosmosObject[] = [];
    const blocked: string[] = [];
    for (const id of [...new Set(ids)]) {
      const object = this.objects.get(id);
      if (!object) continue;
      if (object.locked) {
        blocked.push(object.name);
        continue;
      }
      object.frame.position = [object.frame.position[0] + delta[0], object.frame.position[1] + delta[1], object.frame.position[2] + delta[2]];
      object.updatedAt = now();
      moved.push(object);
    }
    if (blocked.length && !moved.length) return { ok: false, reason: `“${blocked.join("”, “")}” is locked — unlock it before moving it` };
    if (!moved.length) return { ok: false, reason: "nothing to move" };
    if (opts?.silent) {
      // A drag in progress: the scene must follow the finger, but the whole
      // gesture is ONE undo step, recorded when the finger lifts.
      this.touch();
      return { ok: true, value: moved };
    }
    this.commit(`moved ${moved.length === 1 ? moved[0].name : `${moved.length} objects`}`, opts?.history !== false);
    return { ok: true, value: moved };
  }

  /** Move an object between the Cosmos, the workspace and the gallery. */
  public setPlace(id: string, place: CosmosObject["place"]): StoreResult<CosmosObject> {
    const object = this.objects.get(id) ?? this.resolve(id);
    if (!object) return { ok: false, reason: `no object matching “${id}”` };
    const places: Array<CosmosObject["place"]> = ["cosmos", "workspace", "gallery"];
    if (!places.includes(place)) return { ok: false, reason: `“${place}” is not a place — it can live in ${places.join(", ")}` };
    const before = object.place;
    object.place = place;
    object.updatedAt = now();
    object.provenance.push({ at: object.updatedAt, action: "moved place", detail: `${before} → ${place}` });
    this.commit(`moved ${object.name} to the ${place}`);
    return { ok: true, value: object };
  }

  public integrate(childId: string, parentId: string): StoreResult<{ child: CosmosObject; parent: CosmosObject }> {
    if (childId === parentId) return { ok: false, reason: "an object cannot be inside itself" };
    const child = this.objects.get(childId);
    const parent = this.objects.get(parentId);
    if (!child || !parent) return { ok: false, reason: "both objects must exist before one can go inside the other" };
    if (this.ancestorsOf(parent.id).includes(child.id)) return { ok: false, reason: `“${parent.name}” is already inside “${child.name}” — that would be a loop` };
    if (child.parent) this.detach(child);
    child.parent = parent.id;
    child.place = parent.place;
    if (!parent.children.includes(child.id)) parent.children.push(child.id);
    child.updatedAt = now();
    parent.updatedAt = child.updatedAt;
    child.provenance.push({ at: child.updatedAt, action: "integrated", detail: `into ${parent.id} “${parent.name}”` });
    this.commit(`integrated ${child.name} into ${parent.name}`);
    return { ok: true, value: { child, parent } };
  }

  /** Take an object out of whatever it is inside, keeping it alive and identical. */
  public extract(id: string): StoreResult<CosmosObject> {
    const object = this.objects.get(id) ?? this.resolve(id) ?? undefined;
    if (!object) return { ok: false, reason: `no object matching “${id}”` };
    if (!object.parent && object.children.length === 0) return { ok: true, value: object };
    const parent = object.parent ? this.objects.get(object.parent) : undefined;
    this.detach(object);
    // The extracted object keeps its world position: it does not jump when it
    // leaves its parent, so what the user saw is what they now hold.
    object.updatedAt = now();
    object.provenance.push({ at: object.updatedAt, action: "extracted", detail: parent ? `out of ${parent.id} “${parent.name}”` : "detached from its children" });
    this.commit(`extracted ${object.name}`);
    return { ok: true, value: object };
  }

  public isolate(id: string, on = true): StoreResult<number> {
    const target = this.objects.get(id) ?? this.resolve(id);
    if (!target) return { ok: false, reason: `no object matching “${id}”` };
    let changed = 0;
    for (const object of this.objects.values()) {
      const visible = !on || object.id === target.id;
      if (object.visible !== visible) {
        object.visible = visible;
        object.updatedAt = now();
        changed += 1;
      }
    }
    this.selected = target.id;
    this.commit(on ? `isolated ${target.name}` : "showed everything again");
    return { ok: true, value: changed };
  }

  public showAll(): number {
    let changed = 0;
    for (const object of this.objects.values()) {
      if (!object.visible) {
        object.visible = true;
        object.updatedAt = now();
        changed += 1;
      }
    }
    this.commit("showed every object");
    return changed;
  }

  public lock(id: string, locked: boolean): StoreResult<CosmosObject> {
    const object = this.objects.get(id);
    if (!object) return { ok: false, reason: `no object ${id}` };
    object.locked = locked;
    object.updatedAt = now();
    object.provenance.push({ at: object.updatedAt, action: locked ? "locked" : "unlocked", detail: "" });
    this.commit(`${locked ? "locked" : "unlocked"} ${object.name}`);
    return { ok: true, value: object };
  }

  public rename(id: string, name: string): StoreResult<CosmosObject> {
    const object = this.objects.get(id);
    if (!object) return { ok: false, reason: `no object ${id}` };
    const clean = name.trim().slice(0, 80);
    if (!clean) return { ok: false, reason: "a name cannot be empty" };
    const before = object.name;
    object.name = clean;
    object.updatedAt = now();
    object.provenance.push({ at: object.updatedAt, action: "renamed", detail: `${before} → ${clean}` });
    this.commit(`renamed to ${clean}`);
    return { ok: true, value: object };
  }

  public duplicate(id: string, change?: { name?: string; scale?: number; offset?: Vec3 }): StoreResult<CosmosObject> {
    const source = this.objects.get(id);
    if (!source) return { ok: false, reason: `no object ${id}` };
    if (this.objects.size >= MAX_OBJECTS) return { ok: false, reason: `the Cosmos is holding ${MAX_OBJECTS} objects — remove one first` };
    const at = now();
    const copy: CosmosObject = {
      ...source,
      id: this.newId("obj"),
      name: (change?.name ?? `${source.name} copy`).slice(0, 80),
      frame: {
        position: [
          source.frame.position[0] + (change?.offset?.[0] ?? 1.4),
          source.frame.position[1] + (change?.offset?.[1] ?? 0),
          source.frame.position[2] + (change?.offset?.[2] ?? 0),
        ],
        rotation: [...source.frame.rotation] as Vec3,
        scale: clampScale(change?.scale ?? source.frame.scale),
      },
      children: [],
      parent: null,
      group: null,
      selected: undefined,
      createdAt: at,
      updatedAt: at,
      provenance: [{ at, action: "duplicated", detail: `from ${source.id} “${source.name}”` }],
    } as CosmosObject;
    this.objects.set(copy.id, copy);
    this.commit(`duplicated ${source.name}`);
    return { ok: true, value: copy };
  }

  /** Remove to the trash — reversible until `destroy`. */
  public remove(id: string, confirm = false): StoreResult<CosmosObject> {
    const object = this.objects.get(id);
    if (!object) return { ok: false, reason: `no object ${id}` };
    if (object.children.length && !confirm) {
      return { ok: false, reason: `“${object.name}” holds ${object.children.length} object(s) — extract them first, or confirm to remove them with it` };
    }
    this.detach(object);
    for (const childId of [...object.children]) this.remove(childId, true);
    this.objects.delete(object.id);
    this.trash = [...this.trash.slice(-29), object];
    if (this.selected === object.id) this.selected = null;
    if (object.group) this.removeFromGroup(object.group, object.id);
    this.commit(`removed ${object.name}`);
    return { ok: true, value: object };
  }

  /** Put a removed object back, exactly as it was. */
  public restore(id: string): StoreResult<CosmosObject> {
    const index = this.trash.findIndex((o) => o.id === id || o.name.toLowerCase().includes(id.toLowerCase()));
    if (index < 0) return { ok: false, reason: `nothing in the trash matches “${id}”` };
    const [object] = this.trash.splice(index, 1);
    object.parent = null;
    object.children = [];
    this.objects.set(object.id, object);
    if (object.group) this.addToGroup(object.group, object.id);
    this.commit(`restored ${object.name}`);
    return { ok: true, value: object };
  }

  public trashList(): CosmosObject[] {
    return [...this.trash];
  }

  public group(ids: string[], name?: string): StoreResult<{ id: string; name: string; members: string[] }> {
    const members = [...new Set(ids.map((id) => this.objects.get(id) ?? this.resolve(id)).filter((o): o is CosmosObject => Boolean(o)).map((o) => o.id))];
    if (members.length < 2) return { ok: false, reason: "a group needs at least two existing objects" };
    const id = this.newId("grp");
    const label = (name ?? `Collection ${Object.keys(this.groups).length + 1}`).slice(0, 60);
    this.groups[id] = { id, name: label, members, createdAt: now() };
    for (const member of members) {
      const object = this.objects.get(member)!;
      object.group = id;
      object.updatedAt = now();
      object.provenance.push({ at: object.updatedAt, action: "grouped", detail: label });
    }
    this.commit(`grouped ${members.length} objects`);
    return { ok: true, value: { id, name: label, members } };
  }

  public ungroup(groupOrObject: string): StoreResult<string[]> {
    const group = this.groups[groupOrObject] ?? Object.values(this.groups).find((g) => g.name.toLowerCase() === groupOrObject.toLowerCase()) ?? Object.values(this.groups).find((g) => g.members.includes(groupOrObject));
    if (!group) return { ok: false, reason: `no group matching “${groupOrObject}”` };
    for (const member of group.members) {
      const object = this.objects.get(member);
      if (object) {
        object.group = null;
        object.updatedAt = now();
        object.provenance.push({ at: object.updatedAt, action: "ungrouped", detail: group.name });
      }
    }
    delete this.groups[group.id];
    this.commit(`ungrouped ${group.name}`);
    return { ok: true, value: group.members };
  }

  /** Bring everything back to where it was first placed. */
  public resetPositions(): number {
    let changed = 0;
    const ordered = this.list();
    ordered.forEach((object, index) => {
      const slot = ringSlot(index);
      if (object.frame.position.join() !== slot.join()) {
        object.frame.position = slot;
        object.frame.rotation = [0, 0, 0];
        object.frame.scale = 1;
        object.updatedAt = now();
        changed += 1;
      }
    });
    this.commit("reset every object");
    return changed;
  }

  /** The current revision number of the object set, for change detection. */
  public getRevision(): number {
    return this.revision;
  }

  /** Forget everything (used by tests and by an explicit "clear" action). */
  public clear(): void {
    this.objects.clear();
    this.groups = {};
    this.trash = [];
    this.selected = null;
    this.commit("cleared the Cosmos");
  }

  /* ------------------------------------------------------------------ */
  /* internals                                                           */
  /* ------------------------------------------------------------------ */

  private ancestorsOf(id: string): string[] {
    const out: string[] = [];
    let current = this.objects.get(id)?.parent ?? null;
    let guard = 0;
    while (current && guard < 32) {
      out.push(current);
      current = this.objects.get(current)?.parent ?? null;
      guard += 1;
    }
    return out;
  }

  private detach(object: CosmosObject): void {
    if (object.parent) {
      const parent = this.objects.get(object.parent);
      if (parent) parent.children = parent.children.filter((c) => c !== object.id);
      object.parent = null;
    }
    for (const childId of [...object.children]) {
      const child = this.objects.get(childId);
      if (!child) continue;
      child.parent = null;
      object.children = object.children.filter((c) => c !== childId);
    }
  }

  private addToGroup(groupId: string, objectId: string): void {
    const group = this.groups[groupId];
    if (!group) return;
    if (!group.members.includes(objectId)) group.members.push(objectId);
  }

  private removeFromGroup(groupId: string, objectId: string): void {
    const group = this.groups[groupId];
    if (!group) return;
    group.members = group.members.filter((m) => m !== objectId);
    if (group.members.length < 2) {
      for (const member of group.members) {
        const object = this.objects.get(member);
        if (object) object.group = null;
      }
      delete this.groups[groupId];
    }
  }

  private newId(prefix: string): string {
    this.ids += 1;
    const base = `${prefix}_${this.ids.toString(36)}`;
    let candidate = base;
    let suffix = 0;
    while (this.objects.has(candidate) || this.trash.some((o) => o.id === candidate)) {
      suffix += 1;
      candidate = `${base}${suffix}`;
    }
    return candidate;
  }

  /** Update the scene without recording history and without moving the baseline. */
  private touch(): void {
    this.revision += 1;
    this.snapshot = this.build();
    if (this.persist) this.save();
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch {
        /* a broken panel must not break the Cosmos */
      }
    }
  }

  private commit(_why: string, keepHistory = true): void {
    if (keepHistory) {
      this.undoStack.push(this.last);
      if (this.undoStack.length > HISTORY_MAX) this.undoStack.shift();
      this.redoStack = [];
    }
    this.revision += 1;
    this.snapshot = this.build();
    this.last = this.serialize();
    if (this.persist) this.save();
    for (const listener of this.listeners) {
      try {
        listener(this.snapshot);
      } catch {
        /* a broken panel must not break the Cosmos */
      }
    }
  }

  private build(): CosmosObjectState {
    return {
      objects: [...this.objects.values()].sort((a, b) => a.createdAt - b.createdAt),
      groups: this.groups,
      trash: this.trash,
      selected: this.selected,
      selection: [...this.selection],
      revision: this.revision,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
    };
  }

  private serialize(): CosmosSnapshot {
    return {
      objects: [...this.objects.values()].map(cloneObject),
      groups: JSON.parse(JSON.stringify(this.groups)) as CosmosGroups,
      trash: this.trash.map(cloneObject),
      selected: this.selected,
      selection: [...this.selection],
      ids: this.ids,
    };
  }

  private applySnapshot(snapshot: CosmosSnapshot): void {
    const copy = cloneSnapshot(snapshot);
    this.objects = new Map(copy.objects.map((o) => [o.id, o]));
    this.groups = copy.groups;
    this.trash = copy.trash;
    this.selected = copy.selected;
    this.selection = copy.selection;
    this.ids = copy.ids;
  }

  private save(): void {
    try {
      KvStore.getInstance().set(STORE_KEY, {
        objects: this.list(),
        groups: this.groups,
        trash: this.trash,
        ids: this.ids,
        // Only the last few operations are kept on disk: a full history of
        // geometry snapshots would fill the browser's storage with copies of
        // copies, and the recent ones are what recovery actually needs.
        history: this.undoStack.slice(-HISTORY_PERSISTED),
      });
    } catch {
      /* storage blocked: the Cosmos still works for this session */
    }
  }

  private load(): void {
    try {
      const saved = KvStore.getInstance().get<{ objects?: CosmosObject[]; groups?: CosmosGroups; trash?: CosmosObject[]; ids?: number; history?: CosmosSnapshot[] }>(STORE_KEY);
      if (!saved) return;
      this.undoStack = Array.isArray(saved.history) ? saved.history.map(cloneSnapshot) : [];
      for (const object of saved.objects ?? []) {
        if (!object?.id || !object.scene?.objects) continue;
        this.objects.set(object.id, { ...object, children: [...(object.children ?? [])], provenance: [...(object.provenance ?? [])] });
      }
      this.groups = saved.groups ?? {};
      this.trash = saved.trash ?? [];
      this.ids = saved.ids ?? this.objects.size;
    } catch {
      /* an unreadable store starts empty rather than failing the app */
    }
  }
}
