/**
 * ==========================================================
 * LÉLUVERSE — ROOM GENERATOR
 *
 * Turns a description ("a cozy pink reading nook with plants
 * and a telescope") into a furnished environment the world
 * engine can store: a kind, lighting/colour settings and a
 * list of objects built from the built-in shapes.
 *
 *   description → kind, palette, mood → settings
 *               → furniture list (named, or the kind's set)
 *               → layout in the circular room
 *
 * Deterministic: the same description and seed always give
 * the same room, so a generated room can be tested, versioned
 * and regenerated. Nothing is fetched and nothing is spent.
 *
 * Layout rules: wall pieces stand against the wall facing the
 * centre, free pieces stand on a ring; nothing overlaps; the
 * sector in front of LÉLU (towards the camera) and her own
 * spot stay clear so she is never hidden by furniture.
 *
 * Pure and DOM-free: the server (plugins/worldEngine.ts) uses
 * it, and tests run it directly.
 * ==========================================================
 */

export type RoomKind = "room" | "lab" | "studio" | "garden" | "observatory" | "open";
export type PartShape = "box" | "sphere" | "cylinder" | "cone" | "torus" | "plane";

export interface RoomSettings {
  floorColor?: string;
  wallColor?: string;
  accent?: string;
  keyColor?: string;
  ambient?: number;
  keyLight?: number;
  fogColor?: string;
  fogDensity?: number;
  radius?: number;
}

/** One built-in shape of a piece of furniture, in world space. */
export interface GeneratedPart {
  /** Furniture piece this part belongs to, e.g. "desk-1". */
  group: string;
  label: string;
  shape: PartShape;
  color: string;
  metalness: number;
  roughness: number;
  emissive: string | null;
  opacity: number;
  /** World position of the part's bottom centre. */
  position: [number, number, number];
  rotationY: number;
  /** Largest dimension (the placement height the renderer scales by). */
  height: number;
  /** Size along x/y/z divided by height, so the renderer can draw non-cubic parts. */
  proportions: [number, number, number];
}

export interface RoomPlan {
  name: string;
  kind: RoomKind;
  description: string;
  settings: RoomSettings;
  /** Furniture pieces placed, by type. */
  pieces: Array<{ group: string; type: FurnitureType; position: [number, number]; rotationY: number }>;
  /** Requested pieces that did not fit, by type. */
  skipped: FurnitureType[];
  parts: GeneratedPart[];
  seed: number;
}

export interface RoomRequest {
  description: string;
  name?: string;
  kind?: string;
  /** Explicit pieces; when absent they come from the description, then from the kind. */
  items?: Array<string | { type: string; count?: number }>;
  seed?: number;
  radius?: number;
}

export interface RoomFrame {
  /** Room centre on the floor, [x, z]. */
  centre: [number, number];
  floorY: number;
  /** Where LÉLU stands, [x, z]; kept clear. */
  lelu: [number, number];
}

/* ------------------------------ vocabulary ------------------------------ */

/** What the place IS (weight 3) outranks what is IN it (weight 1): "a reading nook with plants" is a room. */
const KIND_WORDS: Array<[RoomKind, RegExp, RegExp]> = [
  ["observatory", /\b(observator\w*|planetarium)\b/, /\b(telescopes?|stars?|starry|cosmic|space|galax\w*|night sky|astronom\w*)\b/],
  ["garden", /\b(garden|forest|greenhouse|jungle|conservatory|meadow)\b/, /\b(plants?|flowers?|nature|botanical|trees?|moss)\b/],
  ["lab", /\b(lab|laboratory|workshop|server room)\b/, /\b(science|engineer\w*|computers?|servers?|research|tech)\b/],
  ["studio", /\b(studio|atelier|gallery)\b/, /\b(art|paint\w*|music|record\w*|easel|design)\b/],
  ["open", /\b(field|plaza|courtyard|terrace|rooftop|outdoors?)\b/, /\b(open|sky)\b/],
  ["room", /\b(room|bedroom|living room|lounge|nook|library|den|suite)\b/, /\b(cozy|cosy|home|reading|bed|sofa)\b/],
];

const COLOURS: Record<string, string> = {
  pink: "#f472b6", rose: "#fb7185", magenta: "#e879f9", purple: "#a855f7", violet: "#8b5cf6", lavender: "#c4b5fd",
  blue: "#3b82f6", navy: "#1e3a8a", sky: "#7dd3fc", teal: "#14b8a6", cyan: "#22d3ee", green: "#22c55e",
  emerald: "#10b981", sage: "#84a98c", gold: "#eab308", golden: "#eab308", amber: "#f59e0b", orange: "#f97316",
  red: "#ef4444", crimson: "#be123c", white: "#f5f5f4", cream: "#fef3c7", ivory: "#fffbeb", black: "#171717",
  silver: "#cbd5e1", grey: "#9ca3af", gray: "#9ca3af", brown: "#92400e", wood: "#a16207", wooden: "#a16207",
  copper: "#c2410c", bronze: "#b45309", marble: "#e7e5e4", obsidian: "#0f0f14",
};

export const FURNITURE = [
  "desk", "chair", "sofa", "bed", "bookshelf", "table", "lamp", "plant", "tree", "crystal", "pillar",
  "rug", "telescope", "easel", "screen", "bench", "fountain", "cushion", "candles", "globe", "planter",
] as const;
export type FurnitureType = (typeof FURNITURE)[number];

const FURNITURE_WORDS: Record<FurnitureType, RegExp> = {
  desk: /\bdesks?\b|\bworkbench/,
  chair: /\b(chairs?|armchairs?|stools?)\b/,
  sofa: /\b(sofas?|couch(es)?|loveseat)\b/,
  bed: /\bbeds?\b/,
  bookshelf: /\b(book\s?shel(f|ves)|books|library|shelves)\b/,
  table: /\b(tables?|coffee table)\b/,
  lamp: /\blamps?\b|\blights?\b/,
  plant: /\b(plants?|ferns?|potted|succulents?|flowers?)\b/,
  tree: /\btrees?\b/,
  crystal: /\bcrystals?\b|\bgems?\b/,
  pillar: /\b(pillars?|columns?)\b/,
  rug: /\b(rugs?|carpets?)\b/,
  telescope: /\btelescopes?\b/,
  easel: /\beasels?\b|\bcanvas\b/,
  screen: /\b(screens?|monitors?|computers?|displays?|terminals?)\b/,
  bench: /\bbench(es)?\b/,
  fountain: /\bfountains?\b|\bwater feature/,
  cushion: /\b(cushions?|pillows?|poufs?|beanbags?)\b/,
  candles: /\bcandles?\b|\bcandlelit\b/,
  globe: /\bglobes?\b|\borbs?\b/,
  planter: /\bplanters?\b|\bflower ?beds?\b/,
};

const KIND_FURNITURE: Record<RoomKind, FurnitureType[]> = {
  room: ["rug", "sofa", "table", "lamp", "bookshelf", "plant", "cushion", "candles"],
  lab: ["desk", "chair", "screen", "screen", "bookshelf", "globe", "lamp", "table"],
  studio: ["easel", "easel", "table", "chair", "lamp", "rug", "plant", "bench"],
  garden: ["tree", "tree", "planter", "plant", "plant", "fountain", "bench", "crystal"],
  observatory: ["telescope", "globe", "crystal", "crystal", "bench", "pillar", "pillar", "rug"],
  open: ["pillar", "pillar", "bench", "plant", "fountain", "lamp"],
};

/** Lighting and colour per kind (the world engine's presets carry the rest). */
const KIND_SETTINGS: Record<RoomKind, RoomSettings> = {
  room: { floorColor: "#1c1526", wallColor: "#2a1f38", accent: "#f0abfc", keyColor: "#ffd9b0", ambient: 0.55, keyLight: 1.4 },
  lab: { floorColor: "#11181f", wallColor: "#1d2a35", accent: "#38bdf8", keyColor: "#e0f2fe", ambient: 0.7, keyLight: 1.8 },
  studio: { floorColor: "#1f1a1a", wallColor: "#3a2b2b", accent: "#fb923c", keyColor: "#fff1e6", ambient: 0.8, keyLight: 2 },
  garden: { floorColor: "#13261a", wallColor: "#1f3b26", accent: "#4ade80", keyColor: "#fef9c3", ambient: 0.75, keyLight: 1.6 },
  observatory: { floorColor: "#0c0f1f", wallColor: "#161c3a", accent: "#a78bfa", keyColor: "#c7d2fe", ambient: 0.4, keyLight: 1.1 },
  open: { floorColor: "#1a1a1a", wallColor: "#1a1a1a", accent: "#e5e7eb", keyColor: "#ffffff", ambient: 0.7, keyLight: 1.5 },
};

/* ------------------------------- helpers ------------------------------- */

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("")}`;
}

const r2 = (n: number) => Math.round(n * 1000) / 1000;

/* -------------------------- furniture recipes -------------------------- */

interface Palette {
  accent: string;
  wood: string;
  fabric: string;
  metal: string;
  leaf: string;
  stone: string;
  glow: string;
}

/** A part in the piece's own frame: size [w, h, d] and the offset of its bottom centre. */
interface LocalPart {
  label: string;
  shape: PartShape;
  size: [number, number, number];
  at: [number, number, number];
  color: string;
  metalness?: number;
  roughness?: number;
  emissive?: string | null;
  opacity?: number;
}

interface Recipe {
  /** Footprint radius used for spacing. */
  footprint: number;
  /** Stands against the wall, facing the centre. */
  wall: boolean;
  parts: (p: Palette) => LocalPart[];
}

const leg = (x: number, z: number, h: number, color: string): LocalPart => ({ label: "leg", shape: "cylinder", size: [0.05, h, 0.05], at: [x, 0, z], color, metalness: 0.3 });

const RECIPES: Record<FurnitureType, Recipe> = {
  desk: {
    footprint: 0.85,
    wall: true,
    parts: (p) => [
      { label: "top", shape: "box", size: [1.4, 0.05, 0.7], at: [0, 0.74, 0], color: p.wood, roughness: 0.6 },
      leg(-0.65, -0.3, 0.74, p.metal), leg(0.65, -0.3, 0.74, p.metal), leg(-0.65, 0.3, 0.74, p.metal), leg(0.65, 0.3, 0.74, p.metal),
    ],
  },
  chair: {
    footprint: 0.4,
    wall: false,
    parts: (p) => [
      { label: "seat", shape: "box", size: [0.45, 0.06, 0.45], at: [0, 0.44, 0], color: p.fabric },
      { label: "back", shape: "box", size: [0.45, 0.5, 0.05], at: [0, 0.5, -0.2], color: p.fabric },
      leg(-0.19, -0.19, 0.44, p.metal), leg(0.19, -0.19, 0.44, p.metal), leg(-0.19, 0.19, 0.44, p.metal), leg(0.19, 0.19, 0.44, p.metal),
    ],
  },
  sofa: {
    footprint: 1.05,
    wall: true,
    parts: (p) => [
      { label: "base", shape: "box", size: [1.9, 0.42, 0.85], at: [0, 0, 0], color: p.fabric, roughness: 0.9 },
      { label: "back", shape: "box", size: [1.9, 0.45, 0.2], at: [0, 0.42, -0.32], color: p.fabric, roughness: 0.9 },
      { label: "arm", shape: "box", size: [0.2, 0.25, 0.85], at: [-0.85, 0.42, 0], color: p.fabric, roughness: 0.9 },
      { label: "arm", shape: "box", size: [0.2, 0.25, 0.85], at: [0.85, 0.42, 0], color: p.fabric, roughness: 0.9 },
    ],
  },
  bed: {
    footprint: 1.2,
    wall: true,
    parts: (p) => [
      { label: "frame", shape: "box", size: [1.5, 0.35, 2], at: [0, 0, 0.2], color: p.wood },
      { label: "mattress", shape: "box", size: [1.4, 0.2, 1.9], at: [0, 0.35, 0.2], color: "#f5f5f4", roughness: 0.95 },
      { label: "headboard", shape: "box", size: [1.5, 0.9, 0.08], at: [0, 0, -0.82], color: p.fabric },
      { label: "pillow", shape: "box", size: [0.5, 0.12, 0.3], at: [-0.35, 0.55, -0.55], color: "#ffffff" },
      { label: "pillow", shape: "box", size: [0.5, 0.12, 0.3], at: [0.35, 0.55, -0.55], color: "#ffffff" },
    ],
  },
  bookshelf: {
    footprint: 0.6,
    wall: true,
    parts: (p) => [
      { label: "frame", shape: "box", size: [1, 1.8, 0.32], at: [0, 0, 0], color: p.wood },
      ...[0.35, 0.8, 1.25].map((y, i): LocalPart => ({ label: "books", shape: "box", size: [0.85, 0.3, 0.26], at: [0, y, 0.04], color: [p.accent, p.fabric, p.glow][i % 3], roughness: 0.8 })),
    ],
  },
  table: {
    footprint: 0.55,
    wall: false,
    parts: (p) => [
      { label: "top", shape: "cylinder", size: [0.9, 0.05, 0.9], at: [0, 0.45, 0], color: p.wood, roughness: 0.5 },
      { label: "stem", shape: "cylinder", size: [0.1, 0.45, 0.1], at: [0, 0, 0], color: p.metal, metalness: 0.6 },
    ],
  },
  lamp: {
    footprint: 0.3,
    wall: true,
    parts: (p) => [
      { label: "base", shape: "cylinder", size: [0.3, 0.04, 0.3], at: [0, 0, 0], color: p.metal, metalness: 0.7 },
      { label: "pole", shape: "cylinder", size: [0.04, 1.5, 0.04], at: [0, 0.04, 0], color: p.metal, metalness: 0.7 },
      { label: "shade", shape: "cone", size: [0.42, 0.32, 0.42], at: [0, 1.48, 0], color: p.glow, emissive: p.glow, opacity: 0.9 },
    ],
  },
  plant: {
    footprint: 0.3,
    wall: false,
    parts: (p) => [
      { label: "pot", shape: "cylinder", size: [0.32, 0.34, 0.32], at: [0, 0, 0], color: p.stone, roughness: 0.8 },
      { label: "leaves", shape: "sphere", size: [0.55, 0.6, 0.55], at: [0, 0.3, 0], color: p.leaf, roughness: 0.9 },
    ],
  },
  tree: {
    footprint: 0.7,
    wall: false,
    parts: (p) => [
      { label: "trunk", shape: "cylinder", size: [0.2, 1.4, 0.2], at: [0, 0, 0], color: "#78350f", roughness: 0.95 },
      { label: "canopy", shape: "sphere", size: [1.3, 1.2, 1.3], at: [0, 1.2, 0], color: p.leaf, roughness: 0.9 },
    ],
  },
  crystal: {
    footprint: 0.3,
    wall: false,
    parts: (p) => [
      { label: "crystal", shape: "cone", size: [0.3, 0.8, 0.3], at: [0, 0, 0], color: p.glow, emissive: p.glow, metalness: 0.2, roughness: 0.1, opacity: 0.85 },
      { label: "shard", shape: "cone", size: [0.16, 0.45, 0.16], at: [0.18, 0, 0.08], color: p.accent, emissive: p.accent, roughness: 0.1, opacity: 0.85 },
    ],
  },
  pillar: {
    footprint: 0.35,
    wall: true,
    parts: (p) => [
      { label: "plinth", shape: "box", size: [0.5, 0.1, 0.5], at: [0, 0, 0], color: p.stone },
      { label: "column", shape: "cylinder", size: [0.36, 2.1, 0.36], at: [0, 0.1, 0], color: p.stone, roughness: 0.4 },
      { label: "capital", shape: "box", size: [0.5, 0.1, 0.5], at: [0, 2.2, 0], color: p.stone },
    ],
  },
  rug: {
    footprint: 0,
    wall: false,
    parts: (p) => [{ label: "rug", shape: "cylinder", size: [2.6, 0.015, 2.6], at: [0, 0, 0], color: p.fabric, roughness: 1 }],
  },
  telescope: {
    footprint: 0.6,
    wall: false,
    parts: (p) => [
      leg(-0.2, -0.12, 1, p.metal), leg(0.2, -0.12, 1, p.metal), leg(0, 0.22, 1, p.metal),
      { label: "tube", shape: "cylinder", size: [0.18, 1.1, 0.18], at: [0, 0.95, 0], color: p.metal, metalness: 0.8, roughness: 0.25 },
      { label: "lens", shape: "torus", size: [0.22, 0.07, 0.22], at: [0, 2.02, 0], color: p.accent, emissive: p.accent },
    ],
  },
  easel: {
    footprint: 0.5,
    wall: false,
    parts: (p) => [
      leg(-0.3, 0, 1.6, p.wood), leg(0.3, 0, 1.6, p.wood), leg(0, -0.35, 1.5, p.wood),
      { label: "canvas", shape: "box", size: [0.8, 0.95, 0.04], at: [0, 0.7, 0.05], color: "#fafaf9" },
      { label: "painting", shape: "box", size: [0.6, 0.6, 0.01], at: [0, 0.88, 0.075], color: p.accent, emissive: p.accent },
    ],
  },
  screen: {
    footprint: 0.5,
    wall: true,
    parts: (p) => [
      { label: "stand", shape: "box", size: [0.3, 1.1, 0.2], at: [0, 0, 0], color: p.metal, metalness: 0.6 },
      { label: "display", shape: "box", size: [1.1, 0.65, 0.05], at: [0, 1.05, 0.05], color: "#0b1220", emissive: p.glow, metalness: 0.4 },
    ],
  },
  bench: {
    footprint: 0.75,
    wall: false,
    parts: (p) => [
      { label: "seat", shape: "box", size: [1.4, 0.08, 0.42], at: [0, 0.42, 0], color: p.wood },
      { label: "support", shape: "box", size: [0.08, 0.42, 0.38], at: [-0.55, 0, 0], color: p.stone },
      { label: "support", shape: "box", size: [0.08, 0.42, 0.38], at: [0.55, 0, 0], color: p.stone },
    ],
  },
  fountain: {
    footprint: 0.85,
    wall: false,
    parts: (p) => [
      { label: "basin", shape: "cylinder", size: [1.5, 0.35, 1.5], at: [0, 0, 0], color: p.stone, roughness: 0.4 },
      { label: "water", shape: "cylinder", size: [1.36, 0.02, 1.36], at: [0, 0.34, 0], color: "#38bdf8", emissive: "#0ea5e9", opacity: 0.7, roughness: 0.05 },
      { label: "spout", shape: "cylinder", size: [0.18, 0.8, 0.18], at: [0, 0.35, 0], color: p.stone },
      { label: "bowl", shape: "sphere", size: [0.5, 0.2, 0.5], at: [0, 1.1, 0], color: p.stone },
    ],
  },
  cushion: {
    footprint: 0.3,
    wall: false,
    parts: (p) => [{ label: "cushion", shape: "cylinder", size: [0.55, 0.22, 0.55], at: [0, 0, 0], color: p.accent, roughness: 0.95 }],
  },
  candles: {
    footprint: 0.25,
    wall: false,
    parts: (p) =>
      [[0, 0, 0.32], [0.12, 0.05, 0.22], [-0.1, 0.08, 0.26]].map(([x, z, h]): LocalPart => ({
        label: "candle",
        shape: "cylinder",
        size: [0.07, h, 0.07],
        at: [x, 0, z],
        color: "#fef3c7",
        emissive: p.glow,
      })),
  },
  globe: {
    footprint: 0.35,
    wall: false,
    parts: (p) => [
      { label: "stand", shape: "cylinder", size: [0.08, 0.8, 0.08], at: [0, 0, 0], color: p.metal, metalness: 0.7 },
      { label: "globe", shape: "sphere", size: [0.5, 0.5, 0.5], at: [0, 0.78, 0], color: p.accent, emissive: p.glow, metalness: 0.3, roughness: 0.3 },
      { label: "ring", shape: "torus", size: [0.62, 0.62, 0.15], at: [0, 0.72, 0], color: p.metal, metalness: 0.9 },
    ],
  },
  planter: {
    footprint: 0.75,
    wall: true,
    parts: (p) => [
      { label: "box", shape: "box", size: [1.3, 0.4, 0.5], at: [0, 0, 0], color: p.wood },
      ...[-0.42, 0, 0.42].map((x): LocalPart => ({ label: "flowers", shape: "sphere", size: [0.42, 0.35, 0.42], at: [x, 0.32, 0], color: x === 0 ? p.accent : p.leaf, roughness: 0.9 })),
    ],
  },
};

/* ------------------------------- planning ------------------------------- */

function detectKind(text: string, requested?: string): RoomKind {
  if (requested && requested in KIND_SETTINGS) return requested as RoomKind;
  let best: RoomKind = "room";
  let score = 0;
  for (const [kind, place, contents] of KIND_WORDS) {
    const s = (text.match(new RegExp(place.source, "g"))?.length ?? 0) * 3 + (text.match(new RegExp(contents.source, "g"))?.length ?? 0);
    if (s > score) [best, score] = [kind, s];
  }
  return best;
}

function coloursIn(text: string): string[] {
  const found: Array<[number, string]> = [];
  for (const [word, hex] of Object.entries(COLOURS)) {
    const at = text.search(new RegExp(`\\b${word}\\b`));
    if (at >= 0) found.push([at, hex]);
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, hex]) => hex).filter((h, i, all) => all.indexOf(h) === i);
}

function settingsFor(kind: RoomKind, text: string, colours: string[], radius?: number): RoomSettings {
  const s: RoomSettings = { ...KIND_SETTINGS[kind] };
  if (colours[0]) {
    s.accent = colours[0];
    s.wallColor = mix(s.wallColor!, colours[0], 0.25);
    s.fogColor = mix("#05050a", colours[0], 0.12);
  }
  if (colours[1]) s.floorColor = mix(s.floorColor!, colours[1], 0.3);
  if (/\b(cozy|cosy|warm|candlelit|snug)\b/.test(text)) Object.assign(s, { keyColor: "#ffcf99", ambient: Math.min(s.ambient!, 0.5), keyLight: 1.2 });
  if (/\b(bright|airy|sunny|daylight|white)\b/.test(text)) Object.assign(s, { ambient: 0.95, keyLight: 2.1 });
  if (/\b(dark|moody|dim|night|mysterious)\b/.test(text)) Object.assign(s, { ambient: 0.32, keyLight: 0.9 });
  if (/\b(misty|foggy|hazy|dreamy)\b/.test(text)) s.fogDensity = 0.05;
  if (/\b(huge|large|big|spacious|grand|hall)\b/.test(text)) s.radius = 9;
  else if (/\b(small|tiny|little|nook|cramped)\b/.test(text)) s.radius = 4.5;
  if (radius !== undefined) s.radius = Math.min(20, Math.max(3, radius));
  return s;
}

function paletteFor(settings: RoomSettings, colours: string[], text: string): Palette {
  const accent = settings.accent ?? "#f0abfc";
  const darkWood = /\b(dark|ebony|walnut|obsidian)\b/.test(text);
  return {
    accent,
    wood: COLOURS[text.match(/\b(marble|white|black|silver|gold|copper)\s+(furniture|desk|table|shelves)/)?.[1] ?? ""] ?? (darkWood ? "#3f2a1d" : "#8b5e3c"),
    fabric: colours[1] ?? mix(accent, "#1f1f2e", 0.45),
    metal: /\bgold(en)?\b/.test(text) ? "#d4a017" : /\bcopper\b/.test(text) ? "#c2410c" : "#9ca3af",
    leaf: /\b(autumn|fall)\b/.test(text) ? "#c2410c" : "#2f7d4a",
    stone: /\bmarble\b/.test(text) ? "#e7e5e4" : "#a8a29e",
    glow: colours[2] ?? mix(accent, "#ffffff", 0.35),
  };
}

function furnitureFor(kind: RoomKind, text: string, items: RoomRequest["items"]): FurnitureType[] {
  const valid = (t: string): t is FurnitureType => (FURNITURE as readonly string[]).includes(t);
  if (items?.length) {
    const out: FurnitureType[] = [];
    for (const item of items) {
      const type = (typeof item === "string" ? item : item.type).toLowerCase().trim();
      const count = typeof item === "string" ? 1 : Math.min(8, Math.max(1, Math.round(item.count ?? 1)));
      if (valid(type)) for (let i = 0; i < count; i++) out.push(type);
    }
    return out.slice(0, 24);
  }
  const named = FURNITURE.filter((t) => FURNITURE_WORDS[t].test(text));
  if (!named.length) return [...KIND_FURNITURE[kind]];
  // What was named, plus a few of the kind's pieces so the room is not bare.
  const extras = KIND_FURNITURE[kind].filter((t) => !named.includes(t)).slice(0, Math.max(0, 6 - named.length));
  return [...named, ...extras];
}

/**
 * Plan a furnished room. Positions are absolute world coordinates in the
 * frame the world engine renders (its room centre and floor height).
 */
export function generateRoom(request: RoomRequest, frame: RoomFrame): RoomPlan {
  const description = String(request.description ?? "").slice(0, 400).trim();
  const text = description.toLowerCase();
  const kind = detectKind(text, request.kind);
  const colours = coloursIn(text);
  const settings = settingsFor(kind, text, colours, request.radius);
  const palette = paletteFor(settings, colours, text);
  const seed = (request.seed ?? hash(`${description}|${kind}`)) >>> 0;
  const random = rng(seed);
  const radius = settings.radius ?? 6.5;
  const [cx, cz] = frame.centre;
  const lelu = frame.lelu;
  const front = Math.atan2(lelu[0] - cx, lelu[1] - cz); // direction from centre to her (towards the camera)
  const keepClear = (Math.PI / 180) * 50;

  const wanted = furnitureFor(kind, text, request.items);
  // Big pieces first so they get the best spots.
  const order = wanted.map((type, i) => ({ type, i })).sort((a, b) => RECIPES[b.type].footprint - RECIPES[a.type].footprint || a.i - b.i);
  const placed: Array<{ x: number; z: number; r: number }> = [{ x: lelu[0], z: lelu[1], r: 0.9 }];
  const pieces: RoomPlan["pieces"] = [];
  const parts: GeneratedPart[] = [];
  const skipped: FurnitureType[] = [];
  const counts: Partial<Record<FurnitureType, number>> = {};

  const angleOff = (a: number) => Math.abs(Math.atan2(Math.sin(a - front), Math.cos(a - front)));

  for (const { type } of order) {
    const recipe = RECIPES[type];
    let spot: { x: number; z: number; rot: number } | null = null;
    if (type === "rug") {
      // The rug lies in the middle of the room, under everything.
      spot = { x: cx, z: cz, rot: 0 };
    } else {
      for (let attempt = 0; attempt < 60 && !spot; attempt++) {
        const angle = front + Math.PI + (random() - 0.5) * 2 * (Math.PI - keepClear);
        if (angleOff(angle) < keepClear) continue;
        const dist = recipe.wall ? radius - recipe.footprint - 0.25 : radius * (0.35 + random() * 0.4);
        const x = cx + Math.sin(angle) * dist;
        const z = cz + Math.cos(angle) * dist;
        if (Math.hypot(x - cx, z - cz) + recipe.footprint > radius - 0.15) continue;
        if (placed.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + recipe.footprint + 0.15)) continue;
        // Wall pieces face the centre; free pieces face the centre with a little variety.
        const toCentre = Math.atan2(cx - x, cz - z);
        spot = { x, z, rot: recipe.wall ? toCentre : toCentre + (random() - 0.5) * 0.8 };
      }
    }
    if (!spot) {
      skipped.push(type);
      continue;
    }
    if (recipe.footprint > 0) placed.push({ x: spot.x, z: spot.z, r: recipe.footprint });
    counts[type] = (counts[type] ?? 0) + 1;
    const group = `${type}-${counts[type]}`;
    pieces.push({ group, type, position: [r2(spot.x), r2(spot.z)], rotationY: r2(spot.rot) });
    const cos = Math.cos(spot.rot);
    const sin = Math.sin(spot.rot);
    for (const part of recipe.parts(palette)) {
      const [ox, oy, oz] = part.at;
      const height = Math.max(...part.size);
      parts.push({
        group,
        label: `${type} ${part.label}`,
        shape: part.shape,
        color: part.color,
        metalness: part.metalness ?? 0.1,
        roughness: part.roughness ?? 0.6,
        emissive: part.emissive ?? null,
        opacity: part.opacity ?? 1,
        position: [r2(spot.x + ox * cos + oz * sin), r2(frame.floorY + oy), r2(spot.z - ox * sin + oz * cos)],
        rotationY: r2(spot.rot),
        height: r2(height),
        proportions: part.size.map((v) => r2(v / height)) as [number, number, number],
      });
    }
  }

  const name =
    request.name?.trim().slice(0, 80) ||
    (description ? description.replace(/^(an?|the)\s+/i, "").split(/[,.;]| with /)[0].trim().slice(0, 48) : `${kind}`).replace(/^\w/, (c) => c.toUpperCase());

  return { name, kind, description, settings, pieces, skipped, parts, seed };
}
