/**
 * ==========================================================
 * LÉLU — THEME FAMILIES (WP21 · WP03)
 *
 * A family is a vocabulary: the layers, palette and panel treatment that
 * make one visual world recognisable. Families are data, so LÉLU (and the
 * owner) can add more without touching a renderer, and they COMPOSE: a
 * world is built from one primary family plus any number of others
 * (underwater + celestial diagrams, Tokyo night + quantum data…).
 *
 * `research` names the reference-atlas entries each family studied
 * (atlas section·number; see docs/missions/wp21/WP01-REFERENCE-ANALYSIS.md).
 * They are research leads, not reused artwork: every layer here is
 * procedural geometry or SVG written for LÉLU.
 *
 * Pure: no React, no DOM, no storage.
 * ==========================================================
 */

import { DEFAULT_TRANSFORM, normaliseLayer, validateWorld, type LayerSlot, type ParamValue, type WorldConfig, type WorldLayer, type WorldPalette } from "./WorldSchema";

export type FamilyGroup = "nature" | "celestial" | "seasonal" | "urban" | "illustrated" | "culture" | "science" | "abstract";

export interface ThemeFamily {
  id: string;
  label: string;
  group: FamilyGroup;
  description: string;
  research: string[];
  /** What the family must not do (rights, cultural accuracy). */
  care?: string;
  palette: WorldPalette;
  layers: Array<{ slot: LayerSlot; kind: string; label?: string; opacity?: number; depth?: number; params?: Record<string, ParamValue> }>;
}

const panel = (tint: string, edge: string, glow: string, extra: Record<string, ParamValue> = {}) => ({ slot: "spatialUI" as const, kind: "panel-frame", label: "Panel frames", params: { tint, edge, glow, blur: 14, ...extra } });
const motion = (wind: number, parallax: number) => ({ slot: "motion" as const, kind: "motion", label: "Motion", params: { wind, parallax } });

export const FAMILIES: ThemeFamily[] = [
  {
    id: "celestial",
    label: "Celestial astrology",
    group: "celestial",
    description: "A zodiac wheel in gold relief over a violet starfield, a ringed planet and a 3D ring of the twelve signs.",
    research: ["I·27", "I·28", "I·29", "I·30", "I·31"],
    palette: { sky: ["#05031a", "#1d0b48", "#4b1d7a"], accent: "#c084fc", glow: "#f5c46b", ink: "#fbf3ff" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 1 } },
      { slot: "foundation", kind: "stars", params: { count: 2400 } },
      { slot: "objects3d", kind: "planet", label: "Ringed planet", params: { color: "#7c3aed", ring: "#f5c46b", radius: 5, x: 26, y: 13, z: -40 } },
      { slot: "objects3d", kind: "zodiac-ring", label: "Zodiac ring", params: { radius: 11, color: "#f5c46b" } },
      { slot: "graphics2d", kind: "zodiac-wheel", label: "Zodiac wheel", opacity: 0.55, params: { color: "#f5c46b" } },
      { slot: "graphics2d", kind: "constellations", label: "Constellation paths", opacity: 0.7, params: { color: "#e9d5ff" } },
      panel("#1a0b3a", "#f5c46b", "#a855f7"),
      motion(0.2, 0.6),
    ],
  },
  {
    id: "volcano",
    label: "Volcanic core",
    group: "nature",
    description: "Obsidian ground split by glowing lava, a smoking cone, embers rising through ash.",
    research: ["I·35", "I·36", "I·37", "I·38", "I·39"],
    palette: { sky: ["#070304", "#2a0805", "#6b1a07"], accent: "#ff6a1a", glow: "#ffb347", ink: "#fff1e6" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 0.2 } },
      { slot: "foundation", kind: "lava-field", label: "Basalt and lava", params: { cracks: 0.7, color: "#1a0d0b", lava: "#ff5a12" } },
      { slot: "objects3d", kind: "volcano", label: "Volcano", params: { height: 18, radius: 20, z: -34, lava: "#ff6a1a" } },
      { slot: "atmosphere", kind: "embers", params: { count: 900, color: "#ffb347" } },
      { slot: "atmosphere", kind: "ash", params: { count: 700, color: "#6b5d57" } },
      { slot: "atmosphere", kind: "fog", params: { color: "#2a0d08", density: 0.011 } },
      panel("#1c0905", "#ff7a2a", "#ff4d00"),
      motion(0.6, 0.4),
    ],
  },
  {
    id: "hurricane",
    label: "Hurricane / cyclone",
    group: "nature",
    description: "A spiral storm seen from above its eye, a dark sea, rain, lightning in the shelf cloud and isobars drawn over it.",
    research: ["I·40", "I·41", "I·42", "I·43", "I·45", "I·46", "I·47"],
    palette: { sky: ["#05070d", "#1b2133", "#3d3f5c"], accent: "#7dd3fc", glow: "#e0e7ff", ink: "#eef2ff" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 0 } },
      { slot: "foundation", kind: "ocean", params: { color: "#0b1626", swell: 1.4 } },
      { slot: "atmosphere", kind: "storm-spiral", label: "Cyclone", params: { radius: 30, arms: 5, height: 16 } },
      { slot: "atmosphere", kind: "clouds", params: { count: 26, color: "#5b6278" } },
      { slot: "atmosphere", kind: "rain", params: { count: 2200, color: "#a5b4fc" } },
      { slot: "atmosphere", kind: "lightning", params: { every: 4.5, color: "#c7d2fe" } },
      { slot: "atmosphere", kind: "fog", params: { color: "#101624", density: 0.018 } },
      { slot: "graphics2d", kind: "isobars", label: "Isobars", opacity: 0.55, params: { color: "#bae6fd" } },
      panel("#0d1424", "#93c5fd", "#60a5fa"),
      motion(1.6, 0.4),
    ],
  },
  {
    id: "underwater",
    label: "Underwater bioluminescence",
    group: "nature",
    description: "A deep-sea floor of glowing coral and drifting jellyfish under shafts of light, bubbles rising.",
    research: ["I·48", "I·49", "I·50", "I·51"],
    palette: { sky: ["#010b14", "#032b3d", "#06505e"], accent: "#2dd4bf", glow: "#67e8f9", ink: "#ecfeff" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 0, rays: 1 } },
      { slot: "foundation", kind: "seabed", params: { color: "#062a33" } },
      { slot: "objects3d", kind: "coral", params: { count: 34, color: "#f472b6", glow: "#2dd4bf" } },
      { slot: "objects3d", kind: "jellyfish", params: { count: 9, color: "#a5f3fc" } },
      { slot: "atmosphere", kind: "bubbles", params: { count: 500, color: "#a5f3fc" } },
      { slot: "atmosphere", kind: "fog", params: { color: "#03303b", density: 0.018 } },
      panel("#03222b", "#5eead4", "#22d3ee"),
      motion(0.3, 0.7),
    ],
  },
  {
    id: "valley",
    label: "Valley / forest",
    group: "nature",
    description: "Hills and a winding river at dusk, a forest of layered trees, fireflies and low mist, contour lines over the land.",
    research: ["I·52", "I·53", "I·54", "I·55"],
    palette: { sky: ["#0d1a2b", "#3b4a6b", "#d58a5a"], accent: "#86efac", glow: "#fde68a", ink: "#f7fee7" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 0.4, sun: 1 } },
      { slot: "foundation", kind: "terrain", params: { height: 9, color: "#2f4a2a", peak: "#6b7a52", river: "#7dd3fc", snow: 0 } },
      { slot: "objects3d", kind: "trees", params: { count: 260, color: "#2e6b3a", season: "summer" } },
      { slot: "atmosphere", kind: "fireflies", params: { count: 220, color: "#fde68a" } },
      { slot: "atmosphere", kind: "fog", params: { color: "#4a5872", density: 0.014 } },
      { slot: "graphics2d", kind: "contours", label: "Topographic contours", opacity: 0.35, params: { color: "#d9f99d" } },
      panel("#122018", "#bbf7d0", "#4ade80"),
      motion(0.4, 0.6),
    ],
  },
  {
    id: "urban-neon",
    label: "Urban neon",
    group: "urban",
    description: "A night city of lit towers on wet streets, traffic light trails, rain and haze.",
    research: ["I·61", "II·10", "II·11", "II·41", "II·42", "III·21"],
    care: "An original city: no game assets, logos or real signage.",
    palette: { sky: ["#03020a", "#170a2e", "#3a0f4f"], accent: "#f0abfc", glow: "#22d3ee", ink: "#fdf4ff" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 0.1 } },
      { slot: "foundation", kind: "city", params: { blocks: 14, height: 1, neon: "#f0abfc", window: "#fde68a" } },
      { slot: "objects3d", kind: "traffic", params: { count: 90, head: "#fef3c7", tail: "#f43f5e" } },
      { slot: "atmosphere", kind: "rain", params: { count: 1600, color: "#c4b5fd" } },
      { slot: "atmosphere", kind: "fog", params: { color: "#1b0b30", density: 0.02 } },
      panel("#140a26", "#f0abfc", "#22d3ee"),
      motion(0.8, 0.5),
    ],
  },
  {
    id: "doodle",
    label: "Hand-drawn doodle",
    group: "illustrated",
    description: "A paper-white world covered in wobbling hand-drawn ink icons, arrows and stars.",
    research: ["I·66", "I·69"],
    palette: { sky: ["#f6f1e7", "#efe7d7", "#e5dac3"], accent: "#1f1b16", glow: "#f97316", ink: "#1f1b16" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 0, paper: 1 } },
      { slot: "graphics2d", kind: "doodle", label: "Ink doodles", params: { color: "#1f1b16", density: 1 } },
      panel("#fffaf0", "#1f1b16", "#f97316", { ink: 1 }),
      motion(0.2, 0.2),
    ],
  },
  {
    id: "liquid-prism",
    label: "Liquid prism",
    group: "abstract",
    description: "Iridescent glass prisms turning in a violet void, light split into a kaleidoscope behind them.",
    research: ["I·09", "I·73", "I·74", "I·71"],
    palette: { sky: ["#07021a", "#22064a", "#4c0d6b"], accent: "#e879f9", glow: "#67e8f9", ink: "#fdf4ff" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 0.6 } },
      { slot: "foundation", kind: "stars", params: { count: 900 } },
      { slot: "objects3d", kind: "prism", params: { count: 7 } },
      { slot: "graphics2d", kind: "kaleidoscope", opacity: 0.4, params: { color: "#e879f9", folds: 12 } },
      panel("#1a0833", "#e879f9", "#67e8f9"),
      motion(0.5, 0.8),
    ],
  },
  ...(["spring", "summer", "autumn", "winter"] as const).map((season): ThemeFamily => {
    const s = {
      spring: { sky: ["#1c2a4a", "#6d8bc4", "#f6c3d7"], ground: "#4c7a3a", tree: "#f9a8d4", air: "leaves", airColor: "#fbcfe8", snow: 0, ink: "#fff7fb" },
      summer: { sky: ["#0b2a55", "#3d7fc4", "#ffd59a"], ground: "#3f7a2a", tree: "#2f8a3a", air: "fireflies", airColor: "#fde68a", snow: 0, ink: "#fefce8" },
      autumn: { sky: ["#1a1030", "#6b3a4a", "#f29a4a"], ground: "#6b4a24", tree: "#ea7a1c", air: "leaves", airColor: "#f59e0b", snow: 0, ink: "#fff7ed" },
      winter: { sky: ["#050c1f", "#1d3561", "#7aa2d6"], ground: "#c7d6ea", tree: "#1f3a33", air: "snow", airColor: "#f8fafc", snow: 1, ink: "#f8fafc" },
    }[season];
    return {
      id: season,
      label: season[0].toUpperCase() + season.slice(1),
      group: "seasonal",
      description: `The valley in ${season}: ${{ spring: "blossom trees and drifting petals", summer: "deep green and fireflies at dusk", autumn: "copper canopy and falling leaves", winter: "snow on the hills, dark pines, falling snow" }[season]}.`,
      research: ["I·54", "I·55", "I·56", "I·57", "I·58", "I·59"],
      palette: { sky: s.sky as [string, string, string], accent: s.tree, glow: s.airColor, ink: s.ink },
      layers: [
        { slot: "foundation", kind: "sky", params: { stars: season === "winter" ? 0.7 : 0.2, sun: 1 } },
        { slot: "foundation", kind: "terrain", params: { height: 8, color: s.ground, peak: season === "winter" ? "#ffffff" : "#7a8a62", river: season === "winter" ? "#cfe8ff" : "#7dd3fc", snow: s.snow } },
        { slot: "objects3d", kind: "trees", params: { count: 240, color: s.tree, season } },
        { slot: "atmosphere", kind: s.air, params: { count: season === "summer" ? 200 : 700, color: s.airColor } },
        { slot: "atmosphere", kind: "fog", params: { color: s.sky[1], density: 0.012 } },
        panel(season === "winter" ? "#0f1c33" : "#1a1424", s.airColor, s.tree),
        motion(season === "autumn" ? 1 : 0.5, 0.5),
      ],
    };
  }),
  {
    id: "aurora",
    label: "Aurora",
    group: "celestial",
    description: "Green and violet aurora curtains over snowy hills under a deep starfield.",
    research: ["I·57"],
    palette: { sky: ["#020617", "#0b1f3a", "#173a5c"], accent: "#4ade80", glow: "#a78bfa", ink: "#ecfdf5" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 1 } },
      { slot: "foundation", kind: "stars", params: { count: 1800 } },
      { slot: "foundation", kind: "terrain", params: { height: 5, color: "#cbd5e1", peak: "#ffffff", river: "#93c5fd", snow: 1 } },
      { slot: "atmosphere", kind: "aurora", params: { colorA: "#4ade80", colorB: "#a78bfa", bands: 4 } },
      { slot: "atmosphere", kind: "snow", params: { count: 400, color: "#f8fafc" } },
      panel("#071426", "#86efac", "#a78bfa"),
      motion(0.4, 0.5),
    ],
  },
  {
    id: "street-comic",
    label: "Street comic / halftone",
    group: "illustrated",
    description: "Bold ink, halftone dots, kinetic action marks and colour-blocked bursts over a flat-coloured city.",
    research: ["I·62", "I·64", "I·65", "I·68", "II·01", "II·09"],
    care: "Traits only (bold contour, halftone, colour blocks). No existing characters, frames or likenesses.",
    palette: { sky: ["#1e1b4b", "#7c3aed", "#f472b6"], accent: "#facc15", glow: "#22d3ee", ink: "#111827" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 0, flat: 1 } },
      { slot: "foundation", kind: "city", params: { blocks: 10, height: 0.8, neon: "#facc15", window: "#fde047", toon: 1 } },
      { slot: "graphics2d", kind: "halftone", opacity: 0.45, params: { color: "#111827", size: 7 } },
      { slot: "graphics2d", kind: "comic-burst", params: { color: "#facc15", ink: "#111827" } },
      panel("#fef9c3", "#111827", "#facc15", { ink: 1 }),
      motion(0.6, 0.3),
    ],
  },
  {
    id: "kemet",
    label: "Kemet geometric",
    group: "culture",
    description: "A gold-lit desert plain with a stepped pyramid, framed by a lotus-and-bud frieze (a documented New Kingdom border ornament).",
    research: ["II·25", "II·26", "II·27", "II·28", "II·29"],
    care: "Ornament only: no hieroglyphs with invented meanings, no mixing with other traditions. The frieze follows the lotus-and-bud border; text in Medu Neter is not generated.",
    palette: { sky: ["#0c0a1a", "#3b2a5a", "#e0a95a"], accent: "#e8b04a", glow: "#38bdf8", ink: "#fff7e6" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 0.5, sun: 1 } },
      { slot: "foundation", kind: "terrain", params: { height: 2.5, color: "#b98a4a", peak: "#d8b27a", river: "#2563eb", snow: 0 } },
      { slot: "objects3d", kind: "pyramid", params: { size: 12, color: "#d7b072", z: -40 } },
      { slot: "graphics2d", kind: "frieze", label: "Lotus-and-bud frieze", opacity: 0.85, params: { color: "#e8b04a", blue: "#1d4ed8" } },
      panel("#1d1405", "#e8b04a", "#38bdf8"),
      motion(0.3, 0.3),
    ],
  },
  {
    id: "quantum",
    label: "Quantum / science",
    group: "science",
    description: "A two-slit interference surface rising and falling, a glowing node sphere and circuit traces. Labelled as illustrative, not a simulation.",
    research: ["II·31", "II·32", "II·33", "I·21", "I·24"],
    care: "Illustrative: the surface is an interference pattern formula, not a physics simulation, and is labelled so.",
    palette: { sky: ["#020617", "#0f172a", "#1e3a8a"], accent: "#38bdf8", glow: "#a78bfa", ink: "#e0f2fe" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 0.3, grid: 1 } },
      { slot: "objects3d", kind: "wave-packet", label: "Two-slit interference (illustrative)", params: { size: 30, color: "#38bdf8" } },
      { slot: "objects3d", kind: "neural-sphere", params: { radius: 6, nodes: 220, color: "#a78bfa", y: 10 } },
      { slot: "graphics2d", kind: "circuit", opacity: 0.35, params: { color: "#38bdf8" } },
      panel("#07122a", "#38bdf8", "#a78bfa"),
      motion(0.6, 0.6),
    ],
  },
  {
    id: "holo-hud",
    label: "Holographic HUD",
    group: "science",
    description: "Concentric floor rings, a central node sphere and radial gauges: the control-room language of the spatial-UI references.",
    research: ["I·01", "I·02", "I·08", "I·11", "I·16", "I·18"],
    palette: { sky: ["#030014", "#140637", "#2b0b5e"], accent: "#a855f7", glow: "#22d3ee", ink: "#f5f3ff" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 0.5, grid: 1 } },
      { slot: "objects3d", kind: "neural-sphere", params: { radius: 7, nodes: 300, color: "#c084fc", y: 4 } },
      { slot: "graphics2d", kind: "hud-rings", opacity: 0.6, params: { color: "#67e8f9" } },
      panel("#120529", "#a855f7", "#22d3ee"),
      motion(0.5, 0.7),
    ],
  },
  {
    id: "sacred-geometry",
    label: "Sacred geometry",
    group: "abstract",
    description: "The overlapping-circle pattern (found in several traditions; drawn here as geometry, attributed to none) and a turning kaleidoscope.",
    research: ["I·31", "I·32", "I·72", "I·76", "II·30"],
    care: "Cross-cultural: geometry only, no claim of a specific tradition's meaning.",
    palette: { sky: ["#0a0416", "#2a0f3a", "#5a2a4a"], accent: "#f5c46b", glow: "#c084fc", ink: "#fff7ed" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 0.8 } },
      { slot: "foundation", kind: "stars", params: { count: 800 } },
      { slot: "objects3d", kind: "crystal", params: { count: 5, color: "#c084fc" } },
      { slot: "graphics2d", kind: "flower-of-life", opacity: 0.6, params: { color: "#f5c46b" } },
      { slot: "graphics2d", kind: "kaleidoscope", opacity: 0.25, params: { color: "#c084fc", folds: 8 } },
      panel("#1a0a24", "#f5c46b", "#c084fc"),
      motion(0.3, 0.5),
    ],
  },
  {
    id: "digital-rain",
    label: "Digital rain",
    group: "abstract",
    description: "Columns of falling original glyphs in green over black: simulation imagery as a broad visual language.",
    research: ["II·24"],
    care: "Original glyph set; no film frames or typefaces copied.",
    palette: { sky: ["#000000", "#01120a", "#032a14"], accent: "#22c55e", glow: "#86efac", ink: "#dcfce7" },
    layers: [
      { slot: "foundation", kind: "sky", params: { stars: 0, grid: 1 } },
      { slot: "graphics2d", kind: "glyph-rain", params: { color: "#22c55e", columns: 48 } },
      panel("#011208", "#22c55e", "#86efac"),
      motion(1, 0.3),
    ],
  },
];

export function family(id: string): ThemeFamily | undefined {
  return FAMILIES.find((f) => f.id === id);
}

let customFamilies: ThemeFamily[] = [];
/** Families LÉLU or the owner add at runtime (validated like built-ins when composed). */
export function registerFamily(f: ThemeFamily): void {
  customFamilies = [...customFamilies.filter((c) => c.id !== f.id), f];
}
export function allFamilies(): ThemeFamily[] {
  return [...FAMILIES, ...customFamilies.filter((c) => !FAMILIES.some((f) => f.id === c.id))];
}
const find = (id: string) => allFamilies().find((f) => f.id === id);

function layersFrom(f: ThemeFamily, primary: boolean, taken: Set<string>): WorldLayer[] {
  const out: WorldLayer[] = [];
  f.layers.forEach((l, i) => {
    // Only the primary family sets the panel treatment and the motion profile.
    if (!primary && (l.slot === "spatialUI" || l.slot === "motion")) return;
    // A secondary family adds ground only where the primary has none of that kind,
    // and never a second sky: underwater + celestial keeps the sea, adds the stars and the wheel.
    if (!primary && l.slot === "foundation" && (l.kind === "sky" || taken.has(`foundation:${l.kind}`) || (l.kind !== "stars" && [...taken].some((t) => /terrain|seabed|city|lava-field|ocean/.test(t))))) return;
    const n = normaliseLayer({ ...l, id: `${f.id}-${l.kind}${i ? `-${i}` : ""}`, family: f.id, depth: l.depth ?? i, transform: DEFAULT_TRANSFORM });
    if (!n) return;
    taken.add(`${n.slot}:${n.kind}`);
    out.push(n);
  });
  return out;
}

/** Builds a world from a primary family plus others layered on top. */
export function composeWorld(ids: string[], opts: { id?: string; name?: string; now?: number } = {}): WorldConfig {
  const fams = ids.map(find).filter((f): f is ThemeFamily => !!f);
  if (!fams.length) fams.push(FAMILIES[0]);
  const taken = new Set<string>();
  const layers = fams.flatMap((f, i) => layersFrom(f, i === 0, taken));
  const { world } = validateWorld({
    id: opts.id ?? `world-${fams.map((f) => f.id).join("+")}`,
    name: opts.name ?? fams.map((f) => f.label).join(" + "),
    families: fams.map((f) => f.id),
    palette: fams[0].palette,
    layers,
    camera: { auto: true, distance: 30, height: 6 },
    motion: 1,
    density: 1,
    quality: "auto",
    mode: "combined",
    updatedAt: opts.now ?? 0,
  });
  return world!;
}
