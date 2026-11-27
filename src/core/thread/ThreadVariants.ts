/**
 * ==========================================================
 * LÉLU — THREAD LAYOUT VARIANTS (Mission 44.9)
 *
 * How one conversation and its objects are arranged. Five built-in
 * arrangements follow the owner's reference designs:
 *
 *   raindrop   A  messages at the top; objects hang below as droplets on
 *                 liquid threads, three to a row, over a rippling pool
 *   workspace  B  landscape: LÉLU top-left, the conversation in a column on
 *                 the right, objects as liquid-glass panes across the centre
 *   ribbon     C  portrait: each object is a full-width liquid ribbon in the
 *                 thread, a progress spine with nodes down the right edge
 *   live       D  landscape: LÉLU and her live steps left, objects in a
 *                 central 2×2, "LÉLU Live" activity right, a tool dock below
 *   split      E  the conversation left, one focused object (browser, map,
 *                 video) right; the others wait as tabs
 *
 * A variant is DATA: a base arrangement plus a style (shape, glow hue,
 * backdrop). LÉLU can define new ones (createVariant) from these bases;
 * they persist and appear in the variant picker like the built-ins.
 * Every layout is pure: the same inputs give the same rectangles, so a
 * placement can be measured, persisted and restored.
 * ==========================================================
 */

import type { LiquidStyle } from "./ThreadObjects";

export type BaseLayout = "raindrop" | "workspace" | "ribbon" | "live" | "split";

export interface VariantSpec {
  id: string;
  label: string;
  base: BaseLayout;
  description: string;
  style: {
    shape: LiquidStyle["shape"];
    hue: number;
    /** A second glow hue (gold accents in the references). */
    accent: number;
    backdrop: "rain" | "nebula" | "orbit" | "plain";
    glow: number; // 0 – 1
  };
  /** Who made it, and from what (research references, the owner's request). */
  origin: { by: "built-in" | "lelu" | "user"; at: number; sources?: string[]; note?: string };
}

export const BUILT_IN_VARIANTS: VariantSpec[] = [
  { id: "raindrop", label: "Raindrop", base: "raindrop", description: "Objects hang as droplets beneath her reply, over a rippling pool.", style: { shape: "droplet", hue: 280, accent: 32, backdrop: "rain", glow: 0.85 }, origin: { by: "built-in", at: 0, note: "Owner reference A" } },
  { id: "workspace", label: "Liquid workspace", base: "workspace", description: "Landscape: her presence left, the conversation right, liquid panes in between.", style: { shape: "pane", hue: 268, accent: 36, backdrop: "nebula", glow: 0.8 }, origin: { by: "built-in", at: 0, note: "Owner reference B" } },
  { id: "ribbon", label: "Ribbon thread", base: "ribbon", description: "Each object a full-width liquid ribbon in the thread, a spine of progress on the right.", style: { shape: "ribbon", hue: 285, accent: 210, backdrop: "rain", glow: 0.9 }, origin: { by: "built-in", at: 0, note: "Owner reference C" } },
  { id: "live", label: "Live workspace", base: "live", description: "Her live steps left, a central 2×2 of objects, live activity right, a tool dock below.", style: { shape: "pane", hue: 262, accent: 40, backdrop: "orbit", glow: 0.75 }, origin: { by: "built-in", at: 0, note: "Owner reference D" } },
  { id: "split", label: "Chat + browser", base: "split", description: "The conversation beside one focused object; the others wait as tabs.", style: { shape: "capsule", hue: 255, accent: 200, backdrop: "plain", glow: 0.55 }, origin: { by: "built-in", at: 0, note: "Owner reference E" } },
];

const KEY = "lelu.thread.variants.v1";
interface Storage {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}
let storage: Storage | null = typeof localStorage === "undefined" ? null : localStorage;
let custom: VariantSpec[] | null = null;
const listeners = new Set<() => void>();
export function setVariantStorage(s: Storage | null): void {
  storage = s;
  custom = null;
}
function loadCustom(): VariantSpec[] {
  if (custom) return custom;
  try {
    const parsed = JSON.parse(storage?.getItem(KEY) ?? "[]") as VariantSpec[];
    custom = Array.isArray(parsed) ? parsed.filter((v) => v && typeof v.id === "string" && BASES.includes(v.base)) : [];
  } catch {
    custom = [];
  }
  return custom;
}
const BASES: BaseLayout[] = ["raindrop", "workspace", "ribbon", "live", "split"];
const SHAPES: LiquidStyle["shape"][] = ["droplet", "ribbon", "pane", "capsule", "orb"];

export function variants(): VariantSpec[] {
  return [...BUILT_IN_VARIANTS, ...loadCustom()];
}
export function variantById(id: string): VariantSpec {
  return variants().find((v) => v.id === id) ?? BUILT_IN_VARIANTS[1];
}
export function subscribeVariants(l: () => void): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** Define a new variant from an existing base. Validated; returns the stored spec. */
export function createVariant(input: { label: string; base: BaseLayout; description?: string; style?: Partial<VariantSpec["style"]>; by: "lelu" | "user"; sources?: string[]; note?: string }): VariantSpec {
  if (!BASES.includes(input.base)) throw new Error(`Unknown base layout "${input.base}". Bases: ${BASES.join(", ")}.`);
  const label = input.label.trim().slice(0, 40);
  if (!label) throw new Error("A variant needs a name.");
  const base = BUILT_IN_VARIANTS.find((v) => v.base === input.base)!;
  const s = { ...base.style, ...(input.style ?? {}) };
  const spec: VariantSpec = {
    id: `custom-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${Date.now().toString(36)}`,
    label,
    base: input.base,
    description: (input.description ?? `${label}, built on ${base.label}.`).slice(0, 200),
    style: {
      shape: SHAPES.includes(s.shape) ? s.shape : base.style.shape,
      hue: ((Math.round(s.hue) % 360) + 360) % 360,
      accent: ((Math.round(s.accent) % 360) + 360) % 360,
      backdrop: (["rain", "nebula", "orbit", "plain"] as const).includes(s.backdrop) ? s.backdrop : base.style.backdrop,
      glow: Math.min(1, Math.max(0, s.glow)),
    },
    origin: { by: input.by, at: Date.now(), ...(input.sources?.length ? { sources: input.sources.slice(0, 10) } : {}), ...(input.note ? { note: input.note.slice(0, 200) } : {}) },
  };
  const list = loadCustom();
  list.push(spec);
  try {
    storage?.setItem(KEY, JSON.stringify(list));
  } catch {
    /* in memory only */
  }
  for (const l of listeners) l();
  return spec;
}

export function removeVariant(id: string): boolean {
  const list = loadCustom();
  const i = list.findIndex((v) => v.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  storage?.setItem(KEY, JSON.stringify(list));
  for (const l of listeners) l();
  return true;
}

/* ---------------------------------------------------------- layout */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ThreadLayout {
  base: BaseLayout;
  /** The conversation's own region (scrolls inside). */
  chat: Rect;
  /** Where LÉLU's companion stands (data-lelu-preview-host): never over content. */
  avatar: Rect | null;
  /** Her live activity panel (live variant). */
  activity: Rect | null;
  /** One rectangle per object id, in the variant's automatic placement. */
  objects: Record<string, Rect>;
  /** Objects shown only as tabs (split variant). */
  tabs: string[];
  /** Total content height (the thread scrolls when taller than the viewport). */
  height: number;
  compact: boolean;
}

/**
 * The automatic placement of a conversation and `ids` objects in a
 * `width`×`height` frame. Below 700 px wide every base becomes a single
 * readable column (the references' phone forms); its shapes are kept.
 */
export function layoutThread(base: BaseLayout, width: number, height: number, ids: string[], focus: string | null = null, chatHeight = 260): ThreadLayout {
  const compact = width < 700;
  const objects: Record<string, Rect> = {};
  const pad = compact ? 10 : 18;
  if (compact) {
    // Phone: avatar as a small presence in the header band; the conversation,
    // then each object full-width (droplets two to a row when small).
    const avatar = { x: width - 74, y: 4, w: 64, h: 64 };
    const chat = { x: pad, y: 76, w: width - pad * 2, h: chatHeight };
    let y = chat.y + chat.h + 12;
    if (base === "raindrop") {
      const cols = width >= 400 ? 2 : 1;
      const cw = (width - pad * 2 - (cols - 1) * 12) / cols;
      ids.forEach((id, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        objects[id] = { x: pad + col * (cw + 12), y: y + row * (cw * 1.05 + 28), w: cw, h: cw * 1.05 };
      });
      y += Math.ceil(ids.length / cols) * ((width - pad * 2) / cols * 1.05 + 28);
    } else {
      for (const id of ids) {
        const h = Math.round(Math.min(360, (width - pad * 2) * 0.62));
        objects[id] = { x: pad, y, w: width - pad * 2, h };
        y += h + 14;
      }
    }
    return { base, chat, avatar, activity: null, objects, tabs: [], height: Math.max(height, y + 20), compact };
  }

  switch (base) {
    case "raindrop": {
      const chat = { x: width * 0.16, y: 88, w: width * 0.68, h: Math.min(chatHeight, height * 0.36) };
      const avatar = { x: width / 2 - 42, y: 4, w: 84, h: 84 };
      const cols = Math.min(3, Math.max(1, ids.length));
      const size = Math.min(300, (width - pad * 2) / 3.3);
      const top = chat.y + chat.h + 70;
      ids.forEach((id, i) => {
        const row = Math.floor(i / 3);
        const inRow = Math.min(3, ids.length - row * 3);
        const col = i % 3;
        const rowWidth = inRow * size + (inRow - 1) * 28;
        // Alternate rows hang lower in the middle, like the reference's drops.
        const sag = col === 1 ? 46 : 0;
        objects[id] = { x: (width - rowWidth) / 2 + col * (size + 28), y: top + row * (size * 1.08 + 70) + sag, w: size, h: size * 1.08 };
        void cols;
      });
      const rows = Math.ceil(ids.length / 3);
      return { base, chat, avatar, activity: null, objects, tabs: [], height: Math.max(height, top + rows * (size * 1.08 + 70) + 120), compact };
    }
    case "workspace": {
      // A readable conversation column: at least 300 px.
      const chatW = Math.max(300, width * 0.25);
      const chat = { x: width - chatW - pad - 12, y: 64, w: chatW, h: height - 150 };
      const avatar = { x: pad, y: 8, w: Math.min(250, width * 0.17), h: Math.min(330, height * 0.42) };
      // Objects start right of her spot: she never stands on content.
      const left = avatar.x + avatar.w + pad;
      const right = chat.x - pad;
      const areaW = right - left;
      const cols = ids.length <= 1 ? 1 : ids.length <= 4 ? 2 : 3;
      const cw = (areaW - (cols - 1) * 20) / cols;
      const rows = Math.max(1, Math.ceil(ids.length / cols));
      const ch = Math.max(170, Math.min(cw * 0.75, (height - 150) / Math.min(rows, 2) - 22));
      ids.forEach((id, i) => {
        const r = Math.floor(i / cols);
        const c = i % cols;
        // Organic offset: panes stagger like the reference's liquid frames.
        objects[id] = { x: left + c * (cw + 20), y: 70 + r * (ch + 22) + (c % 2) * 26, w: cw, h: ch };
      });
      return { base, chat, avatar, activity: null, objects, tabs: [], height: Math.max(height, 70 + Math.ceil(ids.length / cols) * (ch + 22) + 120), compact };
    }
    case "ribbon": {
      const chat = { x: width * 0.08, y: 88, w: width * 0.78, h: Math.min(chatHeight, height * 0.3) };
      const avatar = { x: width / 2 - 38, y: 6, w: 76, h: 76 };
      let y = chat.y + chat.h + 24;
      for (const id of ids) {
        const h = Math.min(260, Math.max(150, height * 0.24));
        objects[id] = { x: width * 0.06, y, w: width * 0.82, h };
        y += h + 22;
      }
      return { base, chat, avatar, activity: null, objects, tabs: [], height: Math.max(height, y + 120), compact };
    }
    case "live": {
      const side = Math.max(240, Math.min(320, width * 0.2));
      const avatar = { x: pad, y: 8, w: side, h: Math.min(220, height * 0.3) };
      const chat = { x: pad, y: avatar.y + avatar.h + 10, w: side, h: height - avatar.h - 140 };
      const activity = { x: width - side - pad, y: 64, w: side, h: height - 160 };
      const left = side + pad * 2;
      const areaW = activity.x - pad - left;
      const cols = ids.length <= 1 ? 1 : 2;
      const cw = (areaW - (cols - 1) * 18) / cols;
      const rows = Math.max(1, Math.ceil(ids.length / cols));
      const ch = Math.max(160, Math.min(cw * 0.66, (height - 170) / Math.min(rows, 2) - 18));
      ids.forEach((id, i) => {
        objects[id] = { x: left + (i % cols) * (cw + 18), y: 70 + Math.floor(i / cols) * (ch + 18), w: cw, h: ch };
      });
      return { base, chat, avatar, activity, objects, tabs: [], height: Math.max(height, 70 + rows * (ch + 18) + 110), compact };
    }
    case "split": {
      const avatar = { x: width * 0.47 - 40, y: 4, w: 80, h: 80 };
      const chat = { x: pad, y: 90, w: width * 0.5 - pad * 1.5, h: height - 170 };
      const shown = focus && ids.includes(focus) ? focus : ids.at(-1);
      if (shown) objects[shown] = { x: width * 0.5 + pad / 2, y: 90, w: width * 0.5 - pad * 1.5, h: height - 170 };
      return { base, chat, avatar, activity: null, objects, tabs: ids.filter((i) => i !== shown), height, compact };
    }
  }
}

/** Where an object is drawn: its automatic rectangle plus its transform. */
export function placed(auto: Rect, t: { dx: number; dy: number; w: number | null; h: number | null } | undefined): Rect {
  if (!t) return auto;
  return { x: auto.x + t.dx, y: auto.y + t.dy, w: t.w ?? auto.w, h: t.h ?? auto.h };
}
