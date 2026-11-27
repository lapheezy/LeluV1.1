/**
 * ==========================================================
 * LÉLU — NEURAL MAP MULTIVERSE: SAVED VIEWS
 *
 * A view is presentation, never canonical data: which aspect, which
 * shared layout, what is filtered and focused, how it is styled.
 * Saving one stores only that; the graph is re-derived from its
 * authorities when the view is restored, so a view can never go stale
 * against the truth or duplicate it.
 *
 * Persisted to localStorage when there is one (the app); in memory
 * otherwise (tests, server). One key, versioned.
 * ==========================================================
 */

import type { AspectId } from "./MultiverseTypes";
import { LAYOUTS, type LayoutId } from "./Layouts";

export interface ViewSettings {
  aspect: AspectId;
  layout: LayoutId | "neighbourhood";
  /** Free-text filter over labels. */
  query: string;
  /** Groups hidden from the view. */
  hiddenGroups: string[];
  focus: string | null;
  labels: "all" | "focus" | "none";
  density: number; // 0.5 … 2, node size multiplier
  motion: boolean;
  theme: "cosmos" | "paper" | "infrared";
}

export interface SavedView {
  id: string;
  name: string;
  favorite: boolean;
  createdAt: number;
  updatedAt: number;
  settings: ViewSettings;
}

export const DEFAULT_SETTINGS: ViewSettings = {
  aspect: "v1",
  layout: "neighbourhood",
  query: "",
  hiddenGroups: [],
  focus: null,
  labels: "focus",
  density: 1,
  motion: true,
  theme: "cosmos",
};

const KEY = "lelu.neural.multiverse.views.v1";
const LAYOUT_IDS = new Set<string>(["neighbourhood", ...LAYOUTS.map((l) => l.id)]);

interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function memoryStorage(): Storage {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

/** Accepts only well-formed settings; anything else falls back to defaults. */
export function sanitize(s: Partial<ViewSettings> | undefined): ViewSettings {
  const v = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
  return {
    aspect: v.aspect === "v2" || v.aspect === "v3" ? v.aspect : "v1",
    layout: LAYOUT_IDS.has(v.layout) ? v.layout : "neighbourhood",
    query: typeof v.query === "string" ? v.query.slice(0, 200) : "",
    hiddenGroups: Array.isArray(v.hiddenGroups) ? v.hiddenGroups.filter((g) => typeof g === "string").slice(0, 100) : [],
    focus: typeof v.focus === "string" ? v.focus : null,
    labels: v.labels === "all" || v.labels === "none" ? v.labels : "focus",
    density: Number.isFinite(v.density) ? Math.min(2, Math.max(0.5, v.density)) : 1,
    motion: v.motion !== false,
    theme: v.theme === "paper" || v.theme === "infrared" ? v.theme : "cosmos",
  };
}

type Listener = (views: SavedView[]) => void;

export class SavedViewStore {
  private views: SavedView[] = [];
  private listeners = new Set<Listener>();
  private seq = 0;

  constructor(
    private storage: Storage = typeof localStorage !== "undefined" ? localStorage : memoryStorage(),
    private now: () => number = () => Date.now(),
  ) {
    try {
      const raw = JSON.parse(this.storage.getItem(KEY) ?? "[]");
      if (Array.isArray(raw))
        this.views = raw
          .filter((v) => v && typeof v.id === "string" && typeof v.name === "string")
          .map((v) => ({ id: v.id, name: v.name, favorite: !!v.favorite, createdAt: Number(v.createdAt) || 0, updatedAt: Number(v.updatedAt) || 0, settings: sanitize(v.settings) }));
    } catch {
      this.views = [];
    }
  }

  list(): SavedView[] {
    return [...this.views].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
  }

  get(id: string): SavedView | undefined {
    return this.views.find((v) => v.id === id);
  }

  search(text: string): SavedView[] {
    const t = text.trim().toLowerCase();
    return t ? this.list().filter((v) => v.name.toLowerCase().includes(t)) : this.list();
  }

  save(name: string, settings: Partial<ViewSettings>): SavedView {
    const at = this.now();
    const view: SavedView = { id: `view_${at.toString(36)}_${(this.seq++).toString(36)}`, name: name.trim() || "Untitled view", favorite: false, createdAt: at, updatedAt: at, settings: sanitize(settings) };
    this.views.push(view);
    this.commit();
    return view;
  }

  /** Overwrite a view's settings with the current ones. */
  update(id: string, settings: Partial<ViewSettings>): SavedView | undefined {
    return this.patch(id, { settings: sanitize({ ...this.get(id)?.settings, ...settings }) });
  }

  rename(id: string, name: string): SavedView | undefined {
    return name.trim() ? this.patch(id, { name: name.trim() }) : undefined;
  }

  toggleFavorite(id: string): SavedView | undefined {
    const v = this.get(id);
    return v ? this.patch(id, { favorite: !v.favorite }) : undefined;
  }

  duplicate(id: string): SavedView | undefined {
    const v = this.get(id);
    return v ? this.save(`${v.name} (copy)`, v.settings) : undefined;
  }

  remove(id: string): boolean {
    const before = this.views.length;
    this.views = this.views.filter((v) => v.id !== id);
    if (this.views.length !== before) this.commit();
    return this.views.length !== before;
  }

  /** The settings to apply to restore a view. */
  restore(id: string): ViewSettings | undefined {
    const v = this.get(id);
    return v ? sanitize(v.settings) : undefined;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  }

  private patch(id: string, p: Partial<SavedView>): SavedView | undefined {
    const i = this.views.findIndex((v) => v.id === id);
    if (i < 0) return undefined;
    this.views[i] = { ...this.views[i], ...p, updatedAt: this.now() };
    this.commit();
    return this.views[i];
  }

  private commit(): void {
    try {
      this.storage.setItem(KEY, JSON.stringify(this.views));
    } catch {
      /* storage full or unavailable: the views still work for this session */
    }
    const list = this.list();
    for (const l of this.listeners) l(list);
  }
}

let shared: SavedViewStore | null = null;
export function savedViews(): SavedViewStore {
  return (shared ??= new SavedViewStore());
}
