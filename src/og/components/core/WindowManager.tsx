import { create } from "zustand";

export type PanelId =
  | "chat"
  | "memory"
  | "memory-log"
  | "logs"
  | "settings"
  | "executive"
  | "research"
  | "voice"
  | "projects"
  | "files"
  | "agents";

export type PanelInstance = {
  key: string;
  id: PanelId;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  minimized: boolean;
  maximized: boolean;
  pinned: boolean;
  props?: Record<string, unknown>;
};

type OpenInput = {
  id: PanelId;
  key?: string;
  title: string;
  props?: Record<string, unknown>;
  w?: number;
  h?: number;
};

type State = {
  panels: PanelInstance[];
  topZ: number;
  open: (input: OpenInput) => string;
  close: (key: string) => void;
  focus: (key: string) => void;
  update: (key: string, patch: Partial<PanelInstance>) => void;
  minimize: (key: string) => void;
  restore: (key: string) => void;
  toggleMaximize: (key: string) => void;
  togglePin: (key: string) => void;
};

const STORAGE_KEY = "lelu:core:windows:v1";

type Persisted = Pick<PanelInstance, "x" | "y" | "w" | "h" | "minimized" | "maximized" | "pinned">;

function loadPersisted(): Record<string, Persisted> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function persist(panels: PanelInstance[]) {
  if (typeof window === "undefined") return;
  const map: Record<string, Persisted> = {};
  for (const p of panels) {
    map[p.key] = {
      x: p.x, y: p.y, w: p.w, h: p.h,
      minimized: p.minimized, maximized: p.maximized, pinned: p.pinned,
    };
  }
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch { /* ignore */ }
}

function defaultSize() {
  if (typeof window === "undefined") return { w: 720, h: 560 };
  const isMobile = window.innerWidth < 768;
  if (isMobile) return {
    w: Math.min(window.innerWidth - 24, 380),
    h: Math.min(window.innerHeight - 160, 620),
  };
  return { w: 720, h: 560 };
}

export const useWindows = create<State>((set, get) => ({
  panels: [],
  topZ: 10,
  open: (input) => {
    const key = input.key ?? input.id;
    const existing = get().panels.find((p) => p.key === key);
    if (existing) {
      get().focus(key);
      if (existing.minimized) get().restore(key);
      return key;
    }
    const persisted = loadPersisted()[key];
    const size = defaultSize();
    const cx = typeof window !== "undefined" ? window.innerWidth / 2 : 640;
    const cy = typeof window !== "undefined" ? window.innerHeight / 2 : 400;
    const w = persisted?.w ?? input.w ?? size.w;
    const h = persisted?.h ?? input.h ?? size.h;
    const openCount = get().panels.length;
    const inst: PanelInstance = {
      key,
      id: input.id,
      title: input.title,
      x: persisted?.x ?? Math.max(16, cx - w / 2 + (openCount % 5) * 28),
      y: persisted?.y ?? Math.max(64, cy - h / 2 + (openCount % 5) * 28),
      w, h,
      z: get().topZ + 1,
      minimized: persisted?.minimized ?? false,
      maximized: persisted?.maximized ?? false,
      pinned: persisted?.pinned ?? false,
      props: input.props,
    };
    const panels = [...get().panels, inst];
    set({ panels, topZ: inst.z });
    persist(panels);
    return key;
  },
  close: (key) => {
    const panels = get().panels.filter((p) => p.key !== key);
    set({ panels });
    persist(panels);
  },
  focus: (key) => {
    const nextZ = get().topZ + 1;
    const panels = get().panels.map((p) => (p.key === key ? { ...p, z: nextZ } : p));
    set({ panels, topZ: nextZ });
  },
  update: (key, patch) => {
    const panels = get().panels.map((p) => (p.key === key ? { ...p, ...patch } : p));
    set({ panels });
    persist(panels);
  },
  minimize: (key) => get().update(key, { minimized: true }),
  restore: (key) => {
    get().update(key, { minimized: false });
    get().focus(key);
  },
  toggleMaximize: (key) => {
    const p = get().panels.find((x) => x.key === key);
    if (!p) return;
    get().update(key, { maximized: !p.maximized });
  },
  togglePin: (key) => {
    const p = get().panels.find((x) => x.key === key);
    if (!p) return;
    get().update(key, { pinned: !p.pinned });
  },
}));