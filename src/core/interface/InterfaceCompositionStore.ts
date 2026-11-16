/**
 * ==========================================================
 * LÉLU — INTERFACE COMPOSITION STORE (Mission 17)
 *
 * The one owner of saved interface compositions and of which one is
 * open. Persists through the existing KvStore (key
 * `lelu.interfaces.compositions.v1`) — no new database, no network.
 *
 *   - built-ins are recomputed, never stored, and never changed: an
 *     edit to one forks a user-owned copy and returns its id;
 *   - every user edit keeps the previous version (undo, 20 deep);
 *   - removing a composition moves it to a trash it can be restored
 *     from; nothing is deleted silently.
 *
 * The open state (which composition is on screen, which region is
 * current) is NOT persisted beyond `lastRegionKey`: a reload starts at
 * the Cosmos, and reopening a composition resumes where it was left.
 * ==========================================================
 */

import KvStore from "../storage/KvStore";
import {
  applyEdit,
  builtInCompositions,
  cloneComposition,
  forkComposition,
  isNavigationEdit,
  mergeCompositions,
  sanitize,
  splitComposition,
  variantOf,
  type CompositionEdit,
  type InterfaceComposition,
  type VariantStyle,
} from "./interfaceComposition";
import { interfaceById, type InterfaceId } from "./InterfaceCatalog";

const KEY = "interfaces.compositions.v1";
const HISTORY_DEPTH = 20;

export interface OpenComposition {
  compositionId: string;
  /** The region most in view right now. */
  currentKey: string | null;
  /** Interface of the current region — read by the scene router. */
  currentInterface: InterfaceId | null;
}

export interface InterfaceCompositionState {
  user: InterfaceComposition[];
  trash: InterfaceComposition[];
  open: OpenComposition | null;
  revision: number;
}

type Listener = (state: InterfaceCompositionState) => void;

interface Persisted {
  user?: InterfaceComposition[];
  trash?: InterfaceComposition[];
  history?: Record<string, InterfaceComposition[]>;
  future?: Record<string, InterfaceComposition[]>;
}

class Store {
  private state: InterfaceCompositionState = { user: [], trash: [], open: null, revision: 0 };
  private history: Record<string, InterfaceComposition[]> = {};
  /** Versions undone and not yet redone; a new edit clears them. */
  private future: Record<string, InterfaceComposition[]> = {};
  private listeners = new Set<Listener>();
  private readonly builtIns = builtInCompositions();
  private loaded = false;

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const saved = typeof window !== "undefined" ? KvStore.getInstance().get<Persisted>(KEY) : null;
    if (!saved) return;
    this.state = {
      ...this.state,
      user: (saved.user ?? []).map(sanitize).filter((c) => c.regions.length > 0),
      trash: (saved.trash ?? []).map(sanitize).slice(0, 20),
    };
    this.history = saved.history ?? {};
    this.future = saved.future ?? {};
  }

  private persist(): void {
    if (typeof window === "undefined") return;
    KvStore.getInstance().set(KEY, { user: this.state.user, trash: this.state.trash, history: this.history, future: this.future });
  }

  private commit(patch: Partial<InterfaceCompositionState>, persist = true): void {
    this.state = { ...this.state, ...patch, revision: this.state.revision + 1 };
    if (persist) this.persist();
    for (const listener of this.listeners) listener(this.state);
  }

  getState(): InterfaceCompositionState {
    this.load();
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.load();
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  builtIn(): InterfaceComposition[] {
    return this.builtIns;
  }

  /** Built-ins first, then the person's own, newest first. */
  list(): InterfaceComposition[] {
    this.load();
    return [...this.builtIns, ...[...this.state.user].sort((a, b) => b.updatedAt - a.updatedAt)];
  }

  get(id: string): InterfaceComposition | undefined {
    this.load();
    return this.builtIns.find((c) => c.id === id) ?? this.state.user.find((c) => c.id === id);
  }

  private add(c: InterfaceComposition): InterfaceComposition {
    this.commit({ user: [c, ...this.state.user] });
    return c;
  }

  private replace(c: InterfaceComposition, keepHistory: boolean): void {
    const before = this.state.user.find((x) => x.id === c.id);
    if (before && keepHistory) {
      this.history[c.id] = [...(this.history[c.id] ?? []), before].slice(-HISTORY_DEPTH);
      delete this.future[c.id];
    }
    this.commit({ user: this.state.user.map((x) => (x.id === c.id ? c : x)) });
  }

  /** A new composition from a list of interfaces. */
  create(name: string, interfaceIds: InterfaceId[], now = Date.now()): InterfaceComposition {
    const base = this.builtIns[0];
    const made = cloneComposition({ ...base, regions: [] }, now, name);
    made.lineage = [];
    made.parentId = null;
    made.description = "";
    const withRegions = interfaceIds.reduce((c, id) => (interfaceById(id) ? applyEdit(c, { op: "add", interfaceId: id }, now) : c), made);
    return this.add({ ...withRegions, version: 1 });
  }

  /**
   * Apply an edit. On a built-in the edit lands on a fresh fork and the
   * built-in is untouched; the returned id is the one that now holds the
   * edit (the caller switches to it).
   */
  edit(id: string, edit: CompositionEdit, now = Date.now()): { id: string; forked: boolean } | null {
    const source = this.get(id);
    if (!source) return null;
    if (source.builtIn) {
      if (isNavigationEdit(edit)) return { id, forked: false }; // where you are in a built-in is not an edit
      // Carry the edit by region POSITION: the fork has fresh keys.
      const fork = forkComposition(source, now);
      const remap = (key: string) => fork.regions[source.regions.findIndex((r) => r.key === key)]?.key ?? key;
      const mapped: CompositionEdit = "key" in edit ? ({ ...edit, key: remap(edit.key) } as CompositionEdit) : "regionKey" in edit ? ({ ...edit, regionKey: remap(edit.regionKey) } as CompositionEdit) : edit;
      const edited = applyEdit(fork, mapped, now);
      this.add({ ...edited, version: 1 });
      if (this.state.open?.compositionId === id) this.commit({ open: { ...this.state.open, compositionId: edited.id, currentKey: this.state.open.currentKey ? remap(this.state.open.currentKey) : null } }, false);
      return { id: edited.id, forked: true };
    }
    const next = applyEdit(source, edit, now);
    if (next === source) return { id, forked: false };
    this.replace(next, !isNavigationEdit(edit));
    return { id, forked: false };
  }

  canUndo(id: string): boolean {
    return (this.history[id]?.length ?? 0) > 0;
  }

  undo(id: string): boolean {
    const stack = this.history[id];
    const previous = stack?.at(-1);
    const now = this.state.user.find((x) => x.id === id);
    if (!previous || !now) return false;
    this.history[id] = stack.slice(0, -1);
    this.future[id] = [...(this.future[id] ?? []), now].slice(-HISTORY_DEPTH);
    this.replace(previous, false);
    return true;
  }

  canRedo(id: string): boolean {
    return (this.future[id]?.length ?? 0) > 0;
  }

  redo(id: string): boolean {
    const stack = this.future[id];
    const next = stack?.at(-1);
    const now = this.state.user.find((x) => x.id === id);
    if (!next || !now) return false;
    this.future[id] = stack.slice(0, -1);
    this.history[id] = [...(this.history[id] ?? []), now].slice(-HISTORY_DEPTH);
    this.replace(next, false);
    return true;
  }

  clone(id: string, now = Date.now()): InterfaceComposition | null {
    const source = this.get(id);
    return source ? this.add(cloneComposition(source, now)) : null;
  }

  variants(id: string, styles: VariantStyle[], now = Date.now()): InterfaceComposition[] {
    const source = this.get(id);
    if (!source) return [];
    const made = styles.map((style, i) => variantOf(source, style, now + i));
    this.commit({ user: [...made, ...this.state.user] });
    return made;
  }

  merge(a: string, b: string, now = Date.now()): InterfaceComposition | null {
    const x = this.get(a);
    const y = this.get(b);
    return x && y ? this.add(mergeCompositions(x, y, now)) : null;
  }

  split(id: string, index: number, now = Date.now()): [InterfaceComposition, InterfaceComposition] | null {
    const source = this.get(id);
    const parts = source ? splitComposition(source, index, now) : null;
    if (!parts) return null;
    this.commit({ user: [...parts, ...this.state.user] });
    return parts;
  }

  /** Into the trash; restorable. Built-ins cannot be removed. */
  remove(id: string): boolean {
    const c = this.state.user.find((x) => x.id === id);
    if (!c) return false;
    this.commit({
      user: this.state.user.filter((x) => x.id !== id),
      trash: [c, ...this.state.trash].slice(0, 20),
      open: this.state.open?.compositionId === id ? null : this.state.open,
    });
    return true;
  }

  restore(id: string): boolean {
    const c = this.state.trash.find((x) => x.id === id);
    if (!c) return false;
    this.commit({ user: [c, ...this.state.user], trash: this.state.trash.filter((x) => x.id !== id) });
    return true;
  }

  /* -------------------------- open state -------------------------- */

  open(id: string, regionKey?: string): boolean {
    const c = this.get(id);
    if (!c) return false;
    const key = (regionKey && c.regions.some((r) => r.key === regionKey) ? regionKey : null) ?? c.lastRegionKey ?? c.regions[0]?.key ?? null;
    const region = c.regions.find((r) => r.key === key);
    this.commit({ open: { compositionId: id, currentKey: key, currentInterface: region?.interfaceId ?? null } }, false);
    return true;
  }

  setCurrent(regionKey: string): void {
    const open = this.state.open;
    if (!open || open.currentKey === regionKey) return;
    const c = this.get(open.compositionId);
    const region = c?.regions.find((r) => r.key === regionKey);
    if (!c || !region) return;
    this.commit({ open: { ...open, currentKey: regionKey, currentInterface: region.interfaceId } }, false);
    if (!c.builtIn) this.edit(c.id, { op: "position", regionKey });
  }

  close(): void {
    if (this.state.open) this.commit({ open: null }, false);
  }

  /** For tests: forget everything in memory (storage is the test's to clear). */
  resetForTests(): void {
    this.state = { user: [], trash: [], open: null, revision: 0 };
    this.history = {};
    this.future = {};
    this.loaded = false;
    this.listeners.clear();
  }
}

const InterfaceCompositionStore = new Store();
export default InterfaceCompositionStore;

/**
 * Whether an open composition currently hides the Cosmos world. The scene
 * router reads this so the world is NOT painted (nor mounted) behind an
 * opaque region — and is mounted, and shown through, when the Cosmos
 * region is the one in view.
 */
export function compositionCoversWorld(state: InterfaceCompositionState): boolean {
  return Boolean(state.open) && state.open?.currentInterface !== "cosmos";
}
