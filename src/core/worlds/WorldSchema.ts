/**
 * ==========================================================
 * LÉLU — WORLD SCHEMA (WP21)
 *
 * A world is an ordered stack of independent layers, each in one of six
 * slots. Renderers (three.js, SVG, later the Cosmos scene layer) read the
 * same data; nothing here knows about React, the DOM or WebGL.
 *
 *   foundation   sky, terrain, water, city, room: what you stand in
 *   atmosphere   rain, snow, ash, embers, fog, lightning, aurora, bubbles
 *   graphics2d   authored SVG: zodiac wheel, contours, frieze, halftone…
 *   objects3d    real geometry: volcano, planet, coral, trees, buildings…
 *   spatialUI    how thread panels are framed and lit in this world
 *   motion       parallax, wind, intensity: shared by every moving layer
 *
 * 2D and 3D coexist by rule: 3D layers are drawn in one WebGL scene behind
 * the 2D overlay; `depth` orders layers inside a slot (3D: distance from the
 * camera; 2D: stacking). 2D layers are never rasterised into the 3D scene,
 * so they stay crisp and individually editable.
 *
 * Pure: no React, no DOM, no storage.
 * ==========================================================
 */

export const SLOTS = ["foundation", "atmosphere", "objects3d", "graphics2d", "spatialUI", "motion"] as const;
export type LayerSlot = (typeof SLOTS)[number];

/** Renderer keys per slot: the adapters implement exactly these. */
export const LAYER_KINDS = {
  foundation: ["sky", "stars", "ocean", "terrain", "seabed", "city", "lava-field"],
  atmosphere: ["rain", "snow", "ash", "embers", "bubbles", "leaves", "fireflies", "fog", "lightning", "aurora", "clouds", "storm-spiral"],
  objects3d: ["volcano", "planet", "zodiac-ring", "coral", "jellyfish", "trees", "crystal", "neural-sphere", "pyramid", "tornado", "wave-packet", "traffic", "prism"],
  graphics2d: ["zodiac-wheel", "constellations", "contours", "isobars", "frieze", "halftone", "comic-burst", "doodle", "circuit", "hud-rings", "flower-of-life", "kaleidoscope", "glyph-rain", "reference-plate"],
  spatialUI: ["panel-frame"],
  motion: ["motion"],
} as const satisfies Record<LayerSlot, readonly string[]>;
export type LayerKind = (typeof LAYER_KINDS)[LayerSlot][number];

export type ParamValue = number | string | boolean;

export interface LayerTransform {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
}

export interface WorldLayer {
  id: string;
  slot: LayerSlot;
  kind: LayerKind;
  label: string;
  enabled: boolean;
  /** 0..1 */
  opacity: number;
  /** Order inside the slot (higher = nearer the viewer). */
  depth: number;
  /** Kind-specific settings (colours, counts, heights…), clamped by the adapters. */
  params: Record<string, ParamValue>;
  transform: LayerTransform;
  /** The family that contributed it, or "user". */
  family: string;
}

export interface WorldPalette {
  /** Sky from zenith to horizon. */
  sky: [string, string, string];
  accent: string;
  glow: string;
  ink: string;
}

export type Quality = "auto" | "low" | "medium" | "high";
export type RenderMode = "combined" | "3d" | "2d";

export interface WorldConfig {
  id: string;
  name: string;
  families: string[];
  palette: WorldPalette;
  layers: WorldLayer[];
  camera: { auto: boolean; distance: number; height: number };
  /** 0..2: scales every moving layer. */
  motion: number;
  /** 0..2: scales particle and instance counts. */
  density: number;
  quality: Quality;
  mode: RenderMode;
  /** For Time & Place worlds: what it reconstructs and how sure that is. */
  place?: { location: string; era: string; confidence: string; sources: string[] };
  updatedAt: number;
}

export const DEFAULT_TRANSFORM: LayerTransform = { x: 0, y: 0, z: 0, scale: 1, rotation: 0 };

const clamp = (n: number, lo: number, hi: number) => (Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : lo);
const HEX = /^#[0-9a-f]{6}$/i;

export function isKind(slot: LayerSlot, kind: string): kind is LayerKind {
  return (LAYER_KINDS[slot] as readonly string[]).includes(kind);
}

/** Validates and clamps a layer; returns null (with a reason) if it cannot be used. */
export function normaliseLayer(input: Omit<Partial<WorldLayer>, "kind" | "slot"> & { slot?: string; kind?: string }, issues: string[] = []): WorldLayer | null {
  const slot = input.slot as LayerSlot;
  if (!SLOTS.includes(slot)) return issues.push(`unknown slot ${String(input.slot)}`), null;
  if (!input.kind || !isKind(slot, input.kind)) return issues.push(`unknown ${slot} kind ${String(input.kind)}`), null;
  const params: Record<string, ParamValue> = {};
  for (const [k, v] of Object.entries(input.params ?? {})) {
    if (typeof v === "number") params[k] = clamp(v, -1e4, 1e4);
    else if (typeof v === "boolean") params[k] = v;
    else if (typeof v === "string" && v.length <= 80) params[k] = v;
  }
  const t = { ...DEFAULT_TRANSFORM, ...(input.transform ?? {}) };
  return {
    id: String(input.id || `${slot}-${input.kind}`).slice(0, 60),
    slot,
    kind: input.kind,
    label: String(input.label || input.kind).slice(0, 60),
    enabled: input.enabled !== false,
    opacity: clamp(input.opacity ?? 1, 0, 1),
    depth: clamp(input.depth ?? 0, -100, 100),
    params,
    transform: { x: clamp(t.x, -200, 200), y: clamp(t.y, -200, 200), z: clamp(t.z, -200, 200), scale: clamp(t.scale, 0.05, 20), rotation: clamp(t.rotation, -360, 360) },
    family: String(input.family || "user").slice(0, 40),
  };
}

/** Layers of a slot, enabled ones only, nearest last. */
export function layersOf(world: WorldConfig, slot: LayerSlot): WorldLayer[] {
  return world.layers.filter((l) => l.slot === slot && l.enabled).sort((a, b) => a.depth - b.depth);
}

export function validateWorld(input: unknown): { world: WorldConfig | null; issues: string[] } {
  const issues: string[] = [];
  const w = input as Partial<WorldConfig> | null;
  if (!w || typeof w !== "object") return { world: null, issues: ["not an object"] };
  const layers: WorldLayer[] = [];
  const seen = new Set<string>();
  for (const l of Array.isArray(w.layers) ? w.layers : []) {
    const n = normaliseLayer(l, issues);
    if (!n) continue;
    while (seen.has(n.id)) n.id = `${n.id}-2`;
    seen.add(n.id);
    layers.push(n);
  }
  if (layers.length > 48) issues.push("more than 48 layers: extra layers dropped");
  const p = w.palette;
  const col = (c: unknown, d: string) => (typeof c === "string" && HEX.test(c) ? c : d);
  const palette: WorldPalette = {
    sky: [col(p?.sky?.[0], "#0b0620"), col(p?.sky?.[1], "#2a0f52"), col(p?.sky?.[2], "#5b2a86")],
    accent: col(p?.accent, "#a855f7"),
    glow: col(p?.glow, "#f5c46b"),
    ink: col(p?.ink, "#f4ecff"),
  };
  const quality = (["auto", "low", "medium", "high"] as const).includes(w.quality as Quality) ? (w.quality as Quality) : "auto";
  const mode = (["combined", "3d", "2d"] as const).includes(w.mode as RenderMode) ? (w.mode as RenderMode) : "combined";
  return {
    issues,
    world: {
      id: String(w.id || "world").slice(0, 60),
      name: String(w.name || "Untitled world").slice(0, 80),
      families: (Array.isArray(w.families) ? w.families : []).map(String).slice(0, 8),
      palette,
      layers: layers.slice(0, 48),
      camera: { auto: w.camera?.auto !== false, distance: clamp(w.camera?.distance ?? 30, 8, 120), height: clamp(w.camera?.height ?? 6, -20, 60) },
      motion: clamp(w.motion ?? 1, 0, 2),
      density: clamp(w.density ?? 1, 0, 2),
      quality,
      mode,
      place: w.place && typeof w.place === "object" ? { location: String(w.place.location), era: String(w.place.era), confidence: String(w.place.confidence), sources: (w.place.sources ?? []).map(String).slice(0, 12) } : undefined,
      updatedAt: Number(w.updatedAt) || 0,
    },
  };
}

/* ------------------------------------------------------------------ *
 * Edits: every one returns a new world (the store persists it).
 * ------------------------------------------------------------------ */

export type WorldEdit =
  | { op: "toggle"; id: string; enabled?: boolean }
  | { op: "set"; id: string; changes: Partial<Pick<WorldLayer, "opacity" | "depth" | "label">> & { params?: Record<string, ParamValue>; transform?: Partial<LayerTransform> } }
  | { op: "add"; layer: Partial<WorldLayer> & { slot: LayerSlot; kind: string } }
  | { op: "remove"; id: string }
  | { op: "world"; changes: Partial<Pick<WorldConfig, "name" | "motion" | "density" | "quality" | "mode">> & { palette?: Partial<WorldPalette>; camera?: Partial<WorldConfig["camera"]> } };

export function editWorld(world: WorldConfig, edit: WorldEdit, now = Date.now()): { world: WorldConfig; issues: string[] } {
  const issues: string[] = [];
  let layers = world.layers;
  let next: Partial<WorldConfig> = {};
  switch (edit.op) {
    case "toggle":
      layers = layers.map((l) => (l.id === edit.id ? { ...l, enabled: edit.enabled ?? !l.enabled } : l));
      if (!world.layers.some((l) => l.id === edit.id)) issues.push(`no layer ${edit.id}`);
      break;
    case "set":
      layers = layers.map((l) =>
        l.id === edit.id ? normaliseLayer({ ...l, ...edit.changes, params: { ...l.params, ...(edit.changes.params ?? {}) }, transform: { ...l.transform, ...(edit.changes.transform ?? {}) } }, issues) ?? l : l,
      );
      if (!world.layers.some((l) => l.id === edit.id)) issues.push(`no layer ${edit.id}`);
      break;
    case "add": {
      const n = normaliseLayer({ family: "user", ...edit.layer }, issues);
      if (n) {
        while (layers.some((l) => l.id === n.id)) n.id = `${n.id}-2`;
        layers = [...layers, n];
      }
      break;
    }
    case "remove":
      layers = layers.filter((l) => l.id !== edit.id);
      break;
    case "world":
      next = {
        ...edit.changes,
        palette: { ...world.palette, ...(edit.changes.palette ?? {}) },
        camera: { ...world.camera, ...(edit.changes.camera ?? {}) },
      } as Partial<WorldConfig>;
      break;
  }
  const v = validateWorld({ ...world, ...next, layers, updatedAt: now });
  return { world: v.world!, issues: [...issues, ...v.issues] };
}
