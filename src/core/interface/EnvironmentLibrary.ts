/**
 * ==========================================================
 * LÉLU — ENVIRONMENT LIBRARY & ADVISOR
 *
 * Starting points, not limits. An environment is a complete
 * configuration — tokens (palette, typography, materials,
 * lighting, motion, backdrop) + 3D scene composition + a
 * window arrangement — expressed in exactly the same change
 * format LÉLU writes herself. She can use one as-is, compose
 * it with her own patch, or ignore these and invent a new one;
 * the user can save any result as their own theme.
 *
 * The advisor maps the kind of work in a request to the
 * environment that serves it (research → organised windows,
 * coding → editor/browser/chat columns, creative → floating
 * canvases …). It only RECOMMENDS: nothing here applies.
 * ==========================================================
 */

import type { DeepPartial, DesignTokens, TypographyTokens } from "./DesignTokens";
import type { SceneOp } from "./SceneModel";
import type { WindowOp } from "./SpatialModel";

export interface EnvironmentPreset {
  id: string;
  name: string;
  description: string;
  tokens: DeepPartial<DesignTokens>;
  scene?: SceneOp[];
  windows?: WindowOp[];
}

/* ------------------------------------------------------------------ *
 * TYPOGRAPHY SYSTEMS — named, with the reasoning behind them
 * ------------------------------------------------------------------ */

export const TYPOGRAPHY_SYSTEMS: Record<string, Partial<TypographyTokens> & { rationale: string }> = {
  "futuristic-editorial": {
    headingFont: "unbounded",
    bodyFont: "space-grotesk",
    monoFont: "space-mono",
    baseSize: 15,
    scaleRatio: 1.414,
    headingWeight: 600,
    bodyWeight: 400,
    headingLetterSpacing: -0.02,
    letterSpacing: 0.005,
    lineHeight: 1.6,
    headingLineHeight: 1.05,
    headingCase: "uppercase",
    textAlign: "left",
    textAnimation: "rise",
    rationale:
      "A wide, geometric display face (Unbounded) gives headlines a cosmic, forward-leaning presence; a technical grotesque (Space Grotesk) keeps body text readable while echoing that geometry; a mono for metadata adds the 'editorial caption' layer. The augmented-fourth scale (1.414) creates magazine-like contrast, tight negative tracking keeps large uppercase headings dense, and left alignment restores a reading edge.",
  },
  "organic-soft": {
    headingFont: "fraunces",
    bodyFont: "nunito",
    monoFont: "ibm-plex-mono",
    baseSize: 16,
    scaleRatio: 1.25,
    headingWeight: 500,
    bodyWeight: 400,
    headingLetterSpacing: 0,
    letterSpacing: 0.01,
    lineHeight: 1.7,
    headingLineHeight: 1.2,
    headingCase: "none",
    textAlign: "left",
    textAnimation: "fade",
    rationale:
      "Fraunces' soft, slightly irregular serifs read as hand-made and alive; Nunito's rounded terminals carry the same warmth into body text without sacrificing legibility. Generous line height and a gentle major-third scale feel unhurried — right for organic, fluid environments.",
  },
  "cotton-candy": {
    headingFont: "comfortaa",
    bodyFont: "quicksand",
    monoFont: "system-mono",
    baseSize: 16,
    scaleRatio: 1.2,
    headingWeight: 700,
    bodyWeight: 500,
    headingLetterSpacing: 0.01,
    letterSpacing: 0.01,
    lineHeight: 1.65,
    headingLineHeight: 1.15,
    headingCase: "none",
    textAlign: "center",
    textAnimation: "fade",
    rationale: "Fully rounded geometric forms match a soft nebula atmosphere; medium body weight keeps the light Quicksand strokes legible on translucent glass.",
  },
  "classic-editorial": {
    headingFont: "playfair",
    bodyFont: "lora",
    monoFont: "ibm-plex-mono",
    baseSize: 16,
    scaleRatio: 1.333,
    headingWeight: 600,
    lineHeight: 1.65,
    headingLineHeight: 1.1,
    textAlign: "left",
    headingCase: "none",
    textAnimation: "none",
    rationale: "High-contrast Playfair headlines over a calm text serif: the hierarchy of a printed magazine, for long-form reading.",
  },
  technical: {
    headingFont: "inter",
    bodyFont: "inter",
    monoFont: "jetbrains-mono",
    baseSize: 14,
    scaleRatio: 1.2,
    headingWeight: 600,
    letterSpacing: 0,
    lineHeight: 1.5,
    headingLineHeight: 1.25,
    textAlign: "left",
    headingCase: "none",
    textAnimation: "none",
    rationale: "One highly legible screen sans at a compact scale maximises information density; a code-first mono for anything technical.",
  },
};

/* ------------------------------------------------------------------ *
 * ENVIRONMENT PRESETS
 * ------------------------------------------------------------------ */

export const ENVIRONMENT_PRESETS: EnvironmentPreset[] = [
  {
    id: "genesis",
    name: "Genesis (original)",
    description: "The original LÉLU Cosmos look: deep space glass with cyan light.",
    tokens: {},
  },
  {
    id: "cosmos-garden",
    name: "Cosmos Garden",
    description: "A living garden floating in space: botanical forms, warm atmospheric light, organic floating windows and soft serif typography.",
    tokens: {
      palette: { background: "#06140f", surface: "#0d2419", surfaceAlt: "#24452f", text: "#ecfdf5", textMuted: "#a7c4b5", accent: "#86efac", accentSoft: "#166534", border: "#bbf7d0", glow: "#4ade80" },
      typography: TYPOGRAPHY_SYSTEMS["organic-soft"],
      materials: { surfaceOpacity: 0.78, blur: 22, radius: 26, windowShape: "organic", shadowDepth: 0.5, glowStrength: 0.35, texture: "leaf", borderOpacity: 0.28, density: 1.05 },
      lighting: { ambient: 0.8, keyIntensity: 1.4, keyColor: "#fef3c7", rimColor: "#86efac", fogColor: "#0b2a1c", fogDensity: 0.03 },
      motion: { profile: "fluid", durationMs: 520, easing: "gentle", floatAmplitude: 4 },
      environment: { backdrop: "garden", gradientStops: ["#03140c", "#0f3b25", "#3f2a12"], nebulaColors: ["#4ade80", "#facc15", "#f472b6"], particleColor: "#fef9c3", particleDensity: 0.45, vignette: 0.35 },
    },
    scene: [
      { op: "add", object: { kind: "flora", label: "Fern bloom", position: [-2.6, -1.2, -2.5], scale: 0.9, color: "#86efac", secondaryColor: "#f9a8d4", features: { petals: 7 } } },
      { op: "add", object: { kind: "flora", label: "Lotus", position: [2.8, -1.4, -3], scale: 0.7, color: "#f9a8d4", secondaryColor: "#fde68a", features: { petals: 9 } } },
      { op: "add", object: { kind: "flora", label: "Seedling", position: [0.4, -1.8, -4.2], scale: 0.5, color: "#bbf7d0", features: { petals: 5 } } },
      { op: "add", object: { kind: "particles", label: "Pollen", position: [0, 0, -3], scale: 7, color: "#fef9c3", features: { count: 380 } } },
      { op: "add", object: { kind: "orb", label: "Sun-seed", position: [0, 2.2, -5], scale: 0.4, color: "#fde68a", material: { emissiveIntensity: 1.6 } } },
    ],
    windows: [{ op: "arrange", strategy: "organic" }],
  },
  {
    id: "plain-river",
    name: "Plain / River",
    description: "A quiet, flowing, minimal place: pale water light, natural paper surfaces, soft typography and windows that sit like stones in a stream.",
    tokens: {
      // Panels inside windows draw light text, so the "pale" feeling comes
      // from paper texture, soft borders and the water backdrop — the
      // surface itself stays dark enough for that text to read.
      palette: { background: "#0b1a22", surface: "#14323a", surfaceAlt: "#2a5552", text: "#f0fdfa", textMuted: "#a9c9c4", accent: "#9fd3c7", accentSoft: "#2f7f8f", border: "#cfe8e2", glow: "#9fd3c7" },
      typography: { ...TYPOGRAPHY_SYSTEMS["organic-soft"], headingFont: "cormorant", headingWeight: 600 },
      materials: { surfaceOpacity: 0.9, blur: 14, radius: 22, windowShape: "organic", shadowDepth: 0.3, glowStrength: 0.1, texture: "paper", borderOpacity: 0.35, density: 1.1 },
      lighting: { ambient: 1, keyIntensity: 0.9, keyColor: "#f0f9ff", rimColor: "#9fd3c7", fogColor: "#0f2730", fogDensity: 0.04 },
      motion: { profile: "fluid", durationMs: 600, easing: "gentle", floatAmplitude: 2 },
      environment: { backdrop: "river", gradientStops: ["#0b1a22", "#174652", "#6fa7a3"], nebulaColors: ["#9fd3c7", "#e0f2fe"], particleColor: "#e0f2fe", particleDensity: 0.15, vignette: 0.2 },
    },
    scene: [
      { op: "add", object: { kind: "river", label: "River", position: [0, -1.6, -3.5], scale: 5, color: "#7dd3fc", secondaryColor: "#e0f2fe" } },
      { op: "add", object: { kind: "orb", label: "River stone", position: [-2, -1.3, -2.8], scale: 0.3, color: "#d6d3d1", material: { roughness: 0.9, emissiveIntensity: 0 }, animation: { type: "none", speed: 0 } } },
    ],
    windows: [{ op: "arrange", strategy: "organic" }],
  },
  {
    id: "celestial-cosmos",
    name: "Celestial Cosmos",
    description: "Planets, nebulae and depth: floating workspaces in a 3D planetary system with futuristic type.",
    tokens: {
      palette: { background: "#030014", surface: "#0b0726", surfaceAlt: "#24124a", text: "#f5f3ff", textMuted: "#b7aee0", accent: "#c084fc", accentSoft: "#6d28d9", border: "#c4b5fd", glow: "#a855f7" },
      typography: { ...TYPOGRAPHY_SYSTEMS["futuristic-editorial"], headingFont: "exo-2", headingCase: "none" },
      materials: { surfaceOpacity: 0.74, blur: 26, radius: 22, windowShape: "rounded", shadowDepth: 0.7, glowStrength: 0.55, texture: "stars", borderOpacity: 0.3 },
      lighting: { ambient: 0.4, keyIntensity: 1.8, keyColor: "#e9d5ff", rimColor: "#f472b6", fogColor: "#05001a", fogDensity: 0.015 },
      motion: { profile: "fluid", durationMs: 420, easing: "spring", floatAmplitude: 3 },
      environment: { backdrop: "nebula", gradientStops: ["#030014", "#1e0b3c", "#05001a"], nebulaColors: ["#a855f7", "#f472b6", "#38bdf8"], particleColor: "#f5f3ff", particleDensity: 0.6, vignette: 0.45 },
    },
    scene: [
      { op: "add", object: { kind: "nebula", label: "Nebula", position: [0, 1, -8], scale: 6, color: "#a855f7", secondaryColor: "#f472b6" } },
      { op: "populate", from: "workspaces", kind: "planet", limit: 5, radius: 2.8 },
    ],
    windows: [{ op: "arrange", strategy: "grid" }],
  },
  {
    id: "creative-studio",
    name: "Creative Studio",
    description: "A bright, dynamic studio: artboards floating in space, a focus canvas with references beside it, and an expressive display type.",
    tokens: {
      palette: { background: "#111111", surface: "#1b1b1f", surfaceAlt: "#2a2433", text: "#fafafa", textMuted: "#b5b5bd", accent: "#ff7a59", accentSoft: "#7c2d12", border: "#ffb199", glow: "#ff7a59" },
      typography: { headingFont: "syne", bodyFont: "outfit", monoFont: "space-mono", headingWeight: 700, scaleRatio: 1.333, textAlign: "left", headingCase: "none", rationale: "Syne's gallery-poster character signals 'studio'; Outfit stays neutral underneath so the work, not the UI, is the expressive layer." },
      materials: { surfaceOpacity: 0.9, blur: 12, radius: 10, windowShape: "rounded", shadowDepth: 0.6, glowStrength: 0.2, texture: "grain", borderOpacity: 0.2, density: 0.95 },
      lighting: { ambient: 0.9, keyIntensity: 1.6, keyColor: "#fff7ed", rimColor: "#ff7a59", fogColor: "#111111", fogDensity: 0 },
      motion: { profile: "lively", durationMs: 220, easing: "spring", floatAmplitude: 0 },
      environment: { backdrop: "studio", gradientStops: ["#0d0d10", "#1c1724", "#2b1a12"], nebulaColors: ["#ff7a59", "#7c3aed"], particleColor: "#ffffff", particleDensity: 0.1, vignette: 0.25 },
    },
    scene: [
      { op: "add", object: { kind: "artboard", label: "Artboard A", position: [-2.4, 0.6, -3.4], scale: 1.1, color: "#fafafa", rotation: [0, 0.35, 0] } },
      { op: "add", object: { kind: "artboard", label: "Artboard B", position: [2.4, 0.4, -3.6], scale: 1, color: "#ffedd5", rotation: [0, -0.35, 0] } },
      { op: "add", object: { kind: "crystal", label: "Reference prism", position: [0, -1.4, -3], scale: 0.4, color: "#ff7a59" } },
    ],
    windows: [{ op: "arrange", strategy: "focus" }],
  },
];

export function getPreset(id: string): EnvironmentPreset | undefined {
  return ENVIRONMENT_PRESETS.find((p) => p.id === id);
}

/* ------------------------------------------------------------------ *
 * ADVISOR
 * ------------------------------------------------------------------ */

export interface EnvironmentRecommendation {
  task: "research" | "coding" | "creative" | "project-management" | "conversation";
  presetId: string | null;
  windows: string[];
  arrangement: WindowOp;
  typography: string;
  why: string;
}

/**
 * Recommend an environment for a kind of work. Advisory only — the
 * caller must turn it into a proposal, and the user must approve it.
 */
export function recommendEnvironment(request: string): EnvironmentRecommendation {
  const r = request.toLowerCase();
  if (/\b(code|coding|debug|bug|build|deploy|program|refactor|terminal|compile)\b/.test(r)) {
    return {
      task: "coding",
      presetId: null,
      windows: ["engineering", "browser", "chat"],
      arrangement: { op: "arrange", strategy: "columns", ids: ["engineering", "browser", "chat"] },
      typography: "technical",
      why: "Coding needs the editor/sandbox, documentation and the conversation side by side without overlap; a compact technical type system maximises visible code.",
    };
  }
  if (/\b(design|draw|sketch|art|render|3d|model|creative|paint|illustrat|animation)\b/.test(r)) {
    return {
      task: "creative",
      presetId: "creative-studio",
      windows: ["sketch", "render", "chat"],
      arrangement: { op: "arrange", strategy: "focus", primary: "sketch", ids: ["sketch", "render", "chat"] },
      typography: "classic-editorial",
      why: "Creative work benefits from one large focus canvas with references and the conversation beside it, plus floating artboards in the Cosmos.",
    };
  }
  if (/\b(research|compare|sources|find out|investigate|study|analy[sz]e|read about)\b/.test(r)) {
    return {
      task: "research",
      presetId: null,
      windows: ["browser", "knowledge", "memory", "chat"],
      arrangement: { op: "arrange", strategy: "grid", ids: ["browser", "knowledge", "memory", "chat"] },
      typography: "technical",
      why: "Research benefits from several organised information windows visible at once, in a grid so none hides another.",
    };
  }
  if (/\b(project|plan|roadmap|tasks?|milestones?|schedule|organi[sz]e)\b/.test(r)) {
    return {
      task: "project-management",
      presetId: "celestial-cosmos",
      windows: ["projects", "cognition", "chat"],
      arrangement: { op: "arrange", strategy: "focus", primary: "projects", ids: ["projects", "cognition", "chat"] },
      typography: "futuristic-editorial",
      why: "Project work benefits from interconnected workspaces: one planet per workspace in the Cosmos, the project board in focus, planning beside it.",
    };
  }
  return {
    task: "conversation",
    presetId: "plain-river",
    windows: ["chat"],
    arrangement: { op: "arrange", strategy: "fit", ids: ["chat"] },
    typography: "organic-soft",
    why: "Casual conversation benefits from a quieter, more organic environment with fewer windows competing for attention.",
  };
}
