/**
 * ==========================================================
 * LÉLU HOME — LAYOUT MEMORY AND IMMERSION
 *
 * Going home closes the open windows (GenesisCore.openPanel("none")
 * clears the module set), so the layout is remembered first: which
 * windows were open, how each was presented, where it stood and how big
 * it was, and which panel had focus. The home shows those windows as
 * resumable workspaces, and "restore" puts the whole layout back. The
 * tools' runtimes are singletons, so a closed window loses no state.
 *
 * "Immersive" hides the home to look at the Cosmos itself (the central
 * orb). It does not persist across reloads.
 *
 * Phase 1 adds the Cosmos MODE — how the Chat Universe stands in relation
 * to the live scene — and the chat windows the Universe keeps open:
 *
 *   workspace  the Universe is an opaque room; the scene is paused behind
 *              it (frameloop "never"), so a covered scene costs no GPU
 *   floating   the windows float over the LIVE Cosmos: the scene keeps
 *              rendering and only the cards/windows are solid
 *
 * This store is the single owner of that mode (the Universe header and the
 * Worlds sheet both write here) and of the open chat-window set, whose
 * geometry is saved NORMALISED to the viewport so a reload on a different
 * screen keeps the arrangement.
 * ==========================================================
 */

import KvStore from "../../../../core/storage/KvStore";
import type { GenesisPanel, ModuleState } from "../GenesisCore";
import { loadCosmosMode, saveCosmosMode, type CosmosMode } from "../chat/universe/universeModel";
import {
  applyHomeOp,
  cloneLayout,
  layoutFromPresentation,
  layoutOf,
  newPresentationId,
  presentationFromLayout,
  presentationFromTemplate,
  profileFromTemplate,
  readLayout,
  readPresentation,
  templateFor,
  DEVICE_CLASSES,
  HOME_MODULES,
  type DeviceClass,
  type HomeModuleId,
  type HomeOp,
  type HomePresentation,
  type HomeTemplate,
  type TemplateId,
} from "./homeComposition";
import { newLayoutId } from "./homeBlend";
import { readStyle, type HomeStyle } from "./homeStyle";

export type { CosmosMode };

export interface SavedLayout {
  activePanel: GenesisPanel;
  modules: Record<string, ModuleState>;
  savedAt: number;
}

/** The mode's persisted form (lelu.universe.cosmosMode.v1, owned by this
    store — `universeModel` only reads and writes the value). */

/** Window geometry in 0..1 of the viewport. */
export interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UniverseState {
  /** Conversation ids the Universe presents as chat module windows. */
  open: string[];
  geometry: Record<string, NormalizedRect>;
}

/**
 * Mission 15: the Home's saved presentations (homeComposition). One is
 * active; each keeps independent phone/tablet/desktop profiles. A reset
 * keeps a restore point, so nothing the person arranged is silently lost.
 */
export interface HomePresentationsState {
  list: HomePresentation[];
  activeId: string;
  restorePoint: HomePresentation | null;
  /** Edit mode (not persisted). */
  editing: boolean;
  /** Mission 15.1: her own layouts (new, blended, merged, saved from a Home). */
  layouts: HomeTemplate[];
  /** Her research notes, per concept or layout id. */
  notes: Record<string, string>;
  /** How often each module was opened from the Home (usage-learned layouts). Local only. */
  usage: Partial<Record<HomeModuleId, number>>;
  canUndo: boolean;
  canRedo: boolean;
}

export interface HomeState {
  layout: SavedLayout | null;
  immersive: boolean;
  cosmosMode: CosmosMode;
  universe: UniverseState;
  presentations: HomePresentationsState;
}

/** Chat conversations open as module windows are owned by `universe`, not
    by the resumable app layout, so "go home" never shows `chat:<id>`. */
const CHAT_MODULE_PREFIX = "chat:";

const KEY = "lelu.home.v1";
/** Presentations have their own key: a large arrangement never rewrites the window memory. */
export const PRESENTATIONS_KEY = "lelu.home.presentations.v1";
/** Her layout library, research notes and module usage: a separate key again. */
export const LAYOUTS_KEY = "lelu.home.layouts.v1";
const HISTORY_LIMIT = 50;

function loadPresentations(): HomePresentationsState {
  const saved = typeof window !== "undefined" ? KvStore.getInstance().get<{ list?: unknown[]; activeId?: string; restorePoint?: unknown }>(PRESENTATIONS_KEY) : null;
  const list = (saved?.list ?? []).map(readPresentation).filter((p): p is HomePresentation => Boolean(p));
  if (!list.length) list.push(presentationFromTemplate("lelu-central", "My Home", 0));
  const activeId = list.some((p) => p.id === saved?.activeId) ? saved!.activeId! : list[0].id;
  const lib = typeof window !== "undefined" ? KvStore.getInstance().get<{ layouts?: unknown[]; notes?: Record<string, unknown>; usage?: Record<string, unknown> }>(LAYOUTS_KEY) : null;
  const layouts = (lib?.layouts ?? []).map(readLayout).filter((l): l is HomeTemplate => Boolean(l)).map((l) => ({ ...l, custom: true }));
  const notes: Record<string, string> = {};
  for (const [k, v] of Object.entries(lib?.notes ?? {})) if (typeof v === "string" && v.trim()) notes[k.slice(0, 80)] = v.slice(0, 4000);
  const usage: Partial<Record<HomeModuleId, number>> = {};
  for (const id of HOME_MODULES) {
    const n = Number(lib?.usage?.[id]);
    if (Number.isFinite(n) && n > 0) usage[id] = Math.min(1e6, Math.floor(n));
  }
  return { list, activeId, restorePoint: readPresentation(saved?.restorePoint), editing: false, canUndo: false, canRedo: false, layouts, notes, usage };
}
type Listener = (state: HomeState) => void;

class HomeStoreImpl {
  private state: HomeState;
  private readonly listeners = new Set<Listener>();

  constructor() {
    const saved = typeof window !== "undefined" ? KvStore.getInstance().get<Partial<HomeState>>(KEY) : null;
    this.state = {
      layout: saved?.layout ?? null,
      immersive: false,
      cosmosMode: loadCosmosMode(),
      universe: {
        open: Array.isArray(saved?.universe?.open) ? saved!.universe!.open.filter((id) => typeof id === "string") : [],
        geometry: saved?.universe?.geometry ?? {},
      },
      presentations: loadPresentations(),
    };
  }

  /* ---------------- Mission 15: Home presentations ---------------- */

  private undoStack: HomePresentation[] = [];
  private redoStack: HomePresentation[] = [];

  activePresentation(): HomePresentation {
    const { list, activeId } = this.state.presentations;
    return list.find((p) => p.id === activeId) ?? list[0];
  }

  setEditing(editing: boolean): void {
    this.patchPresentations({ editing });
  }

  /** One edit to the ACTIVE presentation's profile for this device class. Undoable. */
  applyHomeOp(device: DeviceClass, op: HomeOp): boolean {
    const before = this.activePresentation();
    const after = applyHomeOp(before, device, op);
    if (after === before) return false;
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.replacePresentation(after);
    return true;
  }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(this.activePresentation());
    this.replacePresentation(previous, previous.id);
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.activePresentation());
    this.replacePresentation(next, next.id);
    return true;
  }

  /** A NEW presentation from a composition (a built-in id, or any layout); the current one is untouched. */
  createPresentation(template: TemplateId | HomeTemplate, name?: string): HomePresentation {
    const layout = typeof template === "string" ? (this.state.presentations.layouts.find((l) => l.id === template) ?? templateFor(template)) : template;
    const label = this.freeName(name?.trim() || layout.name);
    const created = typeof template === "string" && !layout.custom ? presentationFromTemplate(layout.id, label) : presentationFromLayout(layout, label);
    this.switchTo(created.id, [...this.state.presentations.list, created]);
    return created;
  }

  private freeName(wanted: string): string {
    const taken = new Set(this.state.presentations.list.map((p) => p.name));
    const base = wanted.slice(0, 56) || "Home";
    let label = base;
    for (let n = 2; taken.has(label); n += 1) label = `${base} ${n}`;
    return label;
  }

  /* ---------------- Mission 15.1: looks, layouts, notes ---------------- */

  /** Change the active presentation's look (theme, fonts, borders). Undoable like any edit. */
  setStyle(style: HomeStyle | null): void {
    const before = this.activePresentation();
    const clean = style ? readStyle(style) : undefined;
    if (JSON.stringify(before.style ?? null) === JSON.stringify(clean ?? null)) return;
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    const { style: _old, ...rest } = before;
    this.replacePresentation({ ...rest, ...(clean ? { style: clean } : {}), updatedAt: Date.now() });
  }

  /** Replace the active presentation's layout, look and arrangement (from the Design Studio). Undoable; keeps its id and name. */
  updateActive(next: HomePresentation): void {
    const before = this.activePresentation();
    const read = readPresentation({ ...structuredCloneSafe(next), id: before.id, name: before.name, createdAt: before.createdAt, updatedAt: Date.now() });
    if (!read) return;
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
    this.redoStack = [];
    this.patchPresentations({ restorePoint: before });
    this.replacePresentation(read);
  }

  /** Save a layout into her library (a new id if it would collide with one she has). */
  saveLayout(layout: HomeTemplate): HomeTemplate {
    const lib = this.state.presentations.layouts;
    const names = new Set(lib.map((l) => l.name));
    let name = layout.name.slice(0, 60) || "My layout";
    for (let n = 2; names.has(name) && !lib.some((l) => l.id === layout.id); n += 1) name = `${layout.name.slice(0, 56)} ${n}`;
    const exists = lib.some((l) => l.id === layout.id);
    const saved = { ...cloneLayout(layout), name, custom: true, id: exists || !layout.custom ? (exists ? layout.id : newLayoutId()) : layout.id };
    this.patchPresentations({ layouts: exists ? lib.map((l) => (l.id === saved.id ? saved : l)) : [...lib, saved] });
    return saved;
  }

  deleteLayout(id: string): boolean {
    const lib = this.state.presentations.layouts;
    if (!lib.some((l) => l.id === id)) return false;
    this.patchPresentations({ layouts: lib.filter((l) => l.id !== id) });
    return true;
  }

  /** The active Home, exactly as arranged on every device, as a reusable layout. */
  saveActiveAsLayout(name?: string): HomeTemplate {
    const p = this.activePresentation();
    return this.saveLayout(layoutFromPresentation(p, newLayoutId(), name?.trim() || `${p.name} layout`));
  }

  setNote(key: string, text: string): void {
    const notes = { ...this.state.presentations.notes };
    if (text.trim()) notes[key.slice(0, 80)] = text.slice(0, 4000);
    else delete notes[key];
    this.patchPresentations({ notes });
  }

  /** A module was opened from the Home (feeds the usage-learned layouts; never leaves the device). */
  noteUse(id: HomeModuleId): void {
    const usage = { ...this.state.presentations.usage, [id]: (this.state.presentations.usage[id] ?? 0) + 1 };
    this.patchPresentations({ usage });
  }

  /** Save an arrangement made elsewhere (the Design Studio) as a NEW presentation. */
  adoptPresentation(source: HomePresentation, name: string): HomePresentation {
    const taken = new Set(this.state.presentations.list.map((p) => p.name));
    let label = name.trim().slice(0, 60) || source.name;
    for (let n = 2; taken.has(label); n += 1) label = `${name.trim()} ${n}`;
    const now = Date.now();
    const copy = { ...structuredCloneSafe(source), id: newPresentationId(now), name: label, createdAt: now, updatedAt: now };
    this.switchTo(copy.id, [...this.state.presentations.list, copy]);
    return copy;
  }

  duplicatePresentation(id: string): HomePresentation | null {
    const source = this.state.presentations.list.find((p) => p.id === id);
    if (!source) return null;
    const copy = { ...structuredCloneSafe(source), id: newPresentationId(), name: this.freeName(`${source.name} copy`), createdAt: Date.now(), updatedAt: Date.now() };
    this.switchTo(copy.id, [...this.state.presentations.list, copy]);
    return copy;
  }

  renamePresentation(id: string, name: string): void {
    const clean = name.trim().slice(0, 60);
    if (!clean) return;
    this.patchPresentations({ list: this.state.presentations.list.map((p) => (p.id === id ? { ...p, name: clean, updatedAt: Date.now() } : p)) });
  }

  applyPresentation(id: string): void {
    if (!this.state.presentations.list.some((p) => p.id === id)) return;
    this.switchTo(id, this.state.presentations.list);
  }

  deletePresentation(id: string): boolean {
    const list = this.state.presentations.list;
    if (list.length <= 1) return false;
    const gone = list.find((p) => p.id === id);
    if (!gone) return false;
    const rest = list.filter((p) => p.id !== id);
    // The deleted arrangement becomes the restore point: a delete is undoable too.
    this.patchPresentations({ restorePoint: gone });
    this.switchTo(this.state.presentations.activeId === id ? rest[0].id : this.state.presentations.activeId, rest);
    return true;
  }

  /** Back to the composition's defaults — for one device, or all. Keeps a restore point. */
  resetPresentation(device?: DeviceClass): void {
    const current = this.activePresentation();
    const template = layoutOf(current);
    const profiles = { ...current.profiles };
    for (const d of device ? [device] : DEVICE_CLASSES) profiles[d] = profileFromTemplate(template, d);
    this.patchPresentations({ restorePoint: current });
    this.undoStack.push(current);
    this.replacePresentation({ ...current, profiles, updatedAt: Date.now() });
  }

  /** Bring back the arrangement a reset or delete replaced. */
  restorePresentation(): boolean {
    const point = this.state.presentations.restorePoint;
    if (!point) return false;
    const exists = this.state.presentations.list.some((p) => p.id === point.id);
    const list = exists ? this.state.presentations.list.map((p) => (p.id === point.id ? point : p)) : [...this.state.presentations.list, point];
    this.patchPresentations({ restorePoint: null });
    this.switchTo(point.id, list);
    return true;
  }

  private switchTo(activeId: string, list: HomePresentation[]): void {
    // History belongs to one presentation: switching starts a fresh one.
    this.undoStack = [];
    this.redoStack = [];
    this.patchPresentations({ list, activeId });
  }

  private replacePresentation(next: HomePresentation, activeId = this.state.presentations.activeId): void {
    const list = this.state.presentations.list.map((p) => (p.id === next.id ? next : p));
    this.patchPresentations({ list, activeId });
  }

  private patchPresentations(next: Partial<HomePresentationsState>): void {
    const presentations = { ...this.state.presentations, ...next, canUndo: this.undoStack.length > 0, canRedo: this.redoStack.length > 0 };
    this.state = { ...this.state, presentations };
    try {
      KvStore.getInstance().set(PRESENTATIONS_KEY, { list: presentations.list, activeId: presentations.activeId, restorePoint: presentations.restorePoint });
      if (next.layouts || next.notes || next.usage) KvStore.getInstance().set(LAYOUTS_KEY, { layouts: presentations.layouts, notes: presentations.notes, usage: presentations.usage });
    } catch {
      // storage unavailable: this session only
    }
    for (const listener of this.listeners) listener(this.state);
  }

  get(): HomeState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Remember the windows before going home (nothing to remember → keep the last layout). */
  rememberLayout(activePanel: GenesisPanel, modules: Record<string, ModuleState>): void {
    const open = Object.fromEntries(
      Object.entries(modules).filter(
        ([id, m]) => id !== "chat" && !id.startsWith(CHAT_MODULE_PREFIX) && m.presentation !== "closed",
      ),
    );
    if (Object.keys(open).length === 0 && activePanel !== "chat") return;
    this.patch({ layout: { activePanel, modules: open, savedAt: Date.now() } });
  }

  forgetWindow(id: string): void {
    const layout = this.state.layout;
    if (!layout || !layout.modules[id]) return;
    const { [id]: _gone, ...rest } = layout.modules;
    this.patch({ layout: Object.keys(rest).length || layout.activePanel === "chat" ? { ...layout, modules: rest } : null });
  }

  clearLayout(): void {
    this.patch({ layout: null });
  }

  setImmersive(immersive: boolean): void {
    this.patch({ immersive });
    // Read-only diagnostic (same convention as __leluSpatialProbe): whether
    // the world, rather than the workspace, currently owns the screen.
    if (typeof window !== "undefined") {
      (window as unknown as { __leluImmersive?: boolean }).__leluImmersive = immersive;
    }
  }

  /** The single owner of the Cosmos mode. Persisted. */
  setCosmosMode(mode: CosmosMode): void {
    if (mode === this.state.cosmosMode) return;
    saveCosmosMode(mode);
    this.patch({ cosmosMode: mode });
  }

  toggleCosmosMode(): void {
    this.setCosmosMode(this.state.cosmosMode === "floating" ? "workspace" : "floating");
  }

  /** The chats the Universe keeps as module windows (survives a closed Universe). */
  rememberUniverseOpen(open: string[]): void {
    const current = this.state.universe.open;
    if (open.length === current.length && open.every((id, index) => id === current[index])) return;
    const geometry = Object.fromEntries(Object.entries(this.state.universe.geometry).filter(([id]) => open.includes(id)));
    this.patch({ universe: { open, geometry } });
  }

  rememberUniverseGeometry(conversationId: string, rect: NormalizedRect): void {
    const current = this.state.universe.geometry[conversationId];
    if (
      current &&
      Math.abs(current.x - rect.x) < 0.002 &&
      Math.abs(current.y - rect.y) < 0.002 &&
      Math.abs(current.width - rect.width) < 0.002 &&
      Math.abs(current.height - rect.height) < 0.002
    ) {
      return;
    }
    this.patch({
      universe: {
        ...this.state.universe,
        geometry: { ...this.state.universe.geometry, [conversationId]: rect },
      },
    });
  }

  private patch(next: Partial<HomeState>): void {
    this.state = { ...this.state, ...next };
    try {
      // The Cosmos mode has its own key (universeModel's load/save), so it is
      // not duplicated into this snapshot.
      KvStore.getInstance().set(KEY, {
        layout: this.state.layout,
        immersive: false,
        universe: this.state.universe,
      });
    } catch {
      // storage unavailable: the layout lives for this session only
    }
    for (const listener of this.listeners) listener(this.state);
  }
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const HomeStore = new HomeStoreImpl();
export default HomeStore;
