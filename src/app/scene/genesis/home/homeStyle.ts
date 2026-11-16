/**
 * ==========================================================
 * LÉLU HOME — STYLE (themes · fonts · elemental borders)
 *
 * A presentation's LOOK, kept apart from its LAYOUT so either can
 * change without the other:
 *
 *   theme     a palette (glass, edge, ink, accent, backdrop tint);
 *             "generative" derives one from a seed she can shuffle
 *   font      body and heading font stacks — system fonts only, so
 *             nothing is downloaded (how a stack looks depends on the
 *             fonts the device has; the fallback is always readable)
 *   borders   up to two layered elemental effects around every
 *             surface — water, fire, snow, ice, aurora, lightning,
 *             neon, nature, gold, lava, stardust, sakura — drawn in
 *             CSS + one SVG filter each (homeEffects.css)
 *
 * Pure: no React, no DOM. styleVars() returns CSS custom properties
 * the Home and the Design Studio put on their root.
 * ==========================================================
 */

export type BorderEffect =
  | "none"
  | "water"
  | "fire"
  | "snow"
  | "ice"
  | "aurora"
  | "lightning"
  | "neon"
  | "nature"
  | "gold"
  | "lava"
  | "stardust"
  | "sakura";

export const BORDER_EFFECTS: Array<{ id: BorderEffect; name: string; blurb: string }> = [
  { id: "none", name: "Plain glass", blurb: "The original thin glass edge." },
  { id: "water", name: "Water barrier", blurb: "A flowing, rippling ring of water with a wave along the bottom." },
  { id: "fire", name: "Fire", blurb: "A burning edge: heat rising through the ring, flames licking the top." },
  { id: "snow", name: "Snow", blurb: "A frosted ring, a snow cap on top and flakes drifting down." },
  { id: "ice", name: "Ice crystal", blurb: "Faceted, glinting ice with icicles hanging from the bottom edge." },
  { id: "aurora", name: "Aurora", blurb: "Northern lights circling the surface." },
  { id: "lightning", name: "Lightning", blurb: "A crackling electric edge that flickers." },
  { id: "neon", name: "Neon", blurb: "A clean, glowing tube in the accent colour." },
  { id: "nature", name: "Nature", blurb: "A mossy, organic edge with leaves at the corners." },
  { id: "gold", name: "Gold leaf", blurb: "Polished metal with a light sweeping across it." },
  { id: "lava", name: "Lava", blurb: "Slow molten rock, glowing from the cracks." },
  { id: "stardust", name: "Stardust", blurb: "A cosmic ring with twinkling stars." },
  { id: "sakura", name: "Sakura", blurb: "A soft pink edge with petals falling." },
];

export interface HomePalette {
  /** Module glass fill. */
  glass: string;
  /** Glass edge (hairline). */
  edge: string;
  ink: string;
  ink2: string;
  accent: string;
  accent2: string;
  /** Backdrop tint over the Cosmos: two colours of a soft gradient. */
  tintA: string;
  tintB: string;
}

export interface HomeTheme {
  id: string;
  name: string;
  palette: HomePalette;
  /** The border and font the theme suggests (applying a theme sets them; she can change them after). */
  border: BorderEffect;
  font: string;
}

export const THEMES: HomeTheme[] = [
  { id: "cosmic", name: "Cosmic", border: "none", font: "lelu", palette: { glass: "rgba(46, 18, 82, 0.52)", edge: "rgba(255, 206, 255, 0.2)", ink: "#fbf3ff", ink2: "rgba(240, 226, 255, 0.72)", accent: "#e879f9", accent2: "#a78bfa", tintA: "rgba(120, 40, 170, 0.0)", tintB: "rgba(219, 39, 119, 0.0)" } },
  { id: "ocean", name: "Ocean", border: "water", font: "rounded", palette: { glass: "rgba(8, 47, 73, 0.55)", edge: "rgba(125, 211, 252, 0.28)", ink: "#ecfeff", ink2: "rgba(207, 250, 254, 0.75)", accent: "#22d3ee", accent2: "#3b82f6", tintA: "rgba(14, 116, 144, 0.35)", tintB: "rgba(30, 64, 175, 0.3)" } },
  { id: "ember", name: "Ember", border: "fire", font: "geometric", palette: { glass: "rgba(69, 20, 10, 0.55)", edge: "rgba(253, 186, 116, 0.28)", ink: "#fff7ed", ink2: "rgba(254, 215, 170, 0.78)", accent: "#fb923c", accent2: "#ef4444", tintA: "rgba(194, 65, 12, 0.32)", tintB: "rgba(127, 29, 29, 0.35)" } },
  { id: "frost", name: "Frost", border: "snow", font: "humanist", palette: { glass: "rgba(30, 58, 95, 0.45)", edge: "rgba(226, 242, 255, 0.4)", ink: "#f8fbff", ink2: "rgba(224, 236, 255, 0.8)", accent: "#bae6fd", accent2: "#e0e7ff", tintA: "rgba(186, 230, 253, 0.22)", tintB: "rgba(148, 163, 184, 0.25)" } },
  { id: "glacier", name: "Glacier", border: "ice", font: "condensed", palette: { glass: "rgba(12, 74, 110, 0.42)", edge: "rgba(165, 243, 252, 0.45)", ink: "#f0fdff", ink2: "rgba(204, 251, 241, 0.78)", accent: "#67e8f9", accent2: "#a5b4fc", tintA: "rgba(103, 232, 249, 0.2)", tintB: "rgba(165, 180, 252, 0.22)" } },
  { id: "aurora", name: "Aurora", border: "aurora", font: "lelu", palette: { glass: "rgba(6, 40, 46, 0.52)", edge: "rgba(110, 231, 183, 0.3)", ink: "#f0fdf4", ink2: "rgba(209, 250, 229, 0.76)", accent: "#34d399", accent2: "#a78bfa", tintA: "rgba(16, 185, 129, 0.25)", tintB: "rgba(139, 92, 246, 0.28)" } },
  { id: "storm", name: "Storm", border: "lightning", font: "condensed", palette: { glass: "rgba(23, 23, 46, 0.6)", edge: "rgba(196, 181, 253, 0.32)", ink: "#f5f3ff", ink2: "rgba(221, 214, 254, 0.75)", accent: "#c4b5fd", accent2: "#fde047", tintA: "rgba(55, 48, 107, 0.4)", tintB: "rgba(30, 27, 75, 0.45)" } },
  { id: "forest", name: "Forest", border: "nature", font: "storybook", palette: { glass: "rgba(20, 46, 26, 0.55)", edge: "rgba(187, 247, 208, 0.28)", ink: "#f7fee7", ink2: "rgba(217, 249, 157, 0.75)", accent: "#86efac", accent2: "#facc15", tintA: "rgba(22, 101, 52, 0.32)", tintB: "rgba(63, 98, 18, 0.3)" } },
  { id: "gilded", name: "Gilded", border: "gold", font: "didone", palette: { glass: "rgba(28, 22, 12, 0.6)", edge: "rgba(253, 230, 138, 0.35)", ink: "#fffbeb", ink2: "rgba(254, 243, 199, 0.78)", accent: "#fbbf24", accent2: "#d97706", tintA: "rgba(120, 83, 15, 0.3)", tintB: "rgba(28, 25, 23, 0.45)" } },
  { id: "volcanic", name: "Volcanic", border: "lava", font: "slab", palette: { glass: "rgba(24, 10, 8, 0.65)", edge: "rgba(248, 113, 113, 0.3)", ink: "#fff1f2", ink2: "rgba(254, 205, 211, 0.75)", accent: "#f97316", accent2: "#dc2626", tintA: "rgba(127, 29, 29, 0.4)", tintB: "rgba(12, 10, 9, 0.5)" } },
  { id: "galaxy", name: "Galaxy", border: "stardust", font: "geometric", palette: { glass: "rgba(15, 12, 41, 0.58)", edge: "rgba(199, 210, 254, 0.28)", ink: "#eef2ff", ink2: "rgba(199, 210, 254, 0.78)", accent: "#818cf8", accent2: "#f0abfc", tintA: "rgba(49, 46, 129, 0.38)", tintB: "rgba(112, 26, 117, 0.3)" } },
  { id: "sakura", name: "Sakura", border: "sakura", font: "hand", palette: { glass: "rgba(80, 24, 52, 0.48)", edge: "rgba(251, 207, 232, 0.4)", ink: "#fff1f7", ink2: "rgba(252, 231, 243, 0.8)", accent: "#f9a8d4", accent2: "#fda4af", tintA: "rgba(244, 114, 182, 0.25)", tintB: "rgba(253, 164, 175, 0.2)" } },
  { id: "neon-city", name: "Neon City", border: "neon", font: "mono", palette: { glass: "rgba(10, 10, 20, 0.66)", edge: "rgba(244, 114, 182, 0.35)", ink: "#fdf4ff", ink2: "rgba(245, 208, 254, 0.75)", accent: "#f472b6", accent2: "#22d3ee", tintA: "rgba(76, 5, 25, 0.35)", tintB: "rgba(8, 51, 68, 0.35)" } },
  { id: "mono", name: "Monochrome", border: "none", font: "system", palette: { glass: "rgba(24, 24, 27, 0.62)", edge: "rgba(244, 244, 245, 0.22)", ink: "#fafafa", ink2: "rgba(228, 228, 231, 0.72)", accent: "#e4e4e7", accent2: "#a1a1aa", tintA: "rgba(9, 9, 11, 0.35)", tintB: "rgba(39, 39, 42, 0.35)" } },
  { id: "desert", name: "Desert Dusk", border: "none", font: "serif", palette: { glass: "rgba(67, 38, 22, 0.52)", edge: "rgba(254, 215, 170, 0.3)", ink: "#fff7ed", ink2: "rgba(253, 230, 200, 0.78)", accent: "#fdba74", accent2: "#f472b6", tintA: "rgba(180, 83, 9, 0.28)", tintB: "rgba(157, 23, 77, 0.25)" } },
];

export const GENERATIVE = "generative";

export interface HomeFont {
  id: string;
  name: string;
  stack: string;
}

/** System font stacks only — no font is fetched from the network. */
export const FONTS: HomeFont[] = [
  { id: "lelu", name: "LÉLU (default)", stack: "inherit" },
  { id: "system", name: "System sans", stack: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
  { id: "rounded", name: "Rounded", stack: "ui-rounded, 'SF Pro Rounded', 'Nunito', 'Varela Round', 'Arial Rounded MT Bold', system-ui, sans-serif" },
  { id: "geometric", name: "Geometric", stack: "'Avenir Next', Avenir, 'Century Gothic', Futura, 'Montserrat', system-ui, sans-serif" },
  { id: "humanist", name: "Humanist", stack: "Optima, Candara, 'Gill Sans', 'Noto Sans', 'Segoe UI', sans-serif" },
  { id: "condensed", name: "Condensed", stack: "'Avenir Next Condensed', 'Roboto Condensed', 'Arial Narrow', 'Helvetica Neue', sans-serif" },
  { id: "serif", name: "Serif", stack: "ui-serif, 'New York', Georgia, Cambria, 'Times New Roman', serif" },
  { id: "storybook", name: "Storybook", stack: "'Iowan Old Style', Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif" },
  { id: "didone", name: "Didone (fashion)", stack: "Didot, 'Bodoni 72', 'Bodoni MT', 'Playfair Display', Georgia, serif" },
  { id: "slab", name: "Slab", stack: "Rockwell, 'Roboto Slab', 'Courier New', Georgia, serif" },
  { id: "mono", name: "Monospace", stack: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace" },
  { id: "hand", name: "Handwritten", stack: "'Bradley Hand', 'Segoe Print', 'Chalkboard SE', 'Comic Neue', 'Comic Sans MS', cursive" },
];

export interface HomeStyle {
  theme: string;
  /** Seed for the generative theme (0..359 → base hue). */
  seed: number;
  font: string;
  headingFont: string;
  border: BorderEffect;
  /** A second effect layered inside the first (e.g. fire outside, water inside). */
  border2: BorderEffect;
  /** 0..1 — ring width and glow. */
  intensity: number;
  /** Corner radius in px. */
  radius: number;
  /** 0..1 — how solid the glass is. */
  opacity: number;
  /** 0..1 — how strongly the backdrop is tinted. */
  tint: number;
  /** Border animation on/off (reduced motion always turns it off). */
  motion: boolean;
  /** Optional colour overrides on top of the theme. */
  accent?: string;
  ink?: string;
}

export const DEFAULT_STYLE: HomeStyle = {
  theme: "cosmic",
  seed: 280,
  font: "lelu",
  headingFont: "lelu",
  border: "none",
  border2: "none",
  intensity: 0.5,
  radius: 22,
  opacity: 0.5,
  tint: 0.5,
  motion: true,
};

export function themeFor(id: string, seed = DEFAULT_STYLE.seed): HomeTheme {
  if (id === GENERATIVE) return generativeTheme(seed);
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

export function fontFor(id: string): HomeFont {
  return FONTS.find((f) => f.id === id) ?? FONTS[0];
}

/** Material-You-style palette from one hue, with contrast held (light ink on a dark glass). */
export function generativeTheme(seed: number): HomeTheme {
  const h = ((Math.round(seed) % 360) + 360) % 360;
  const h2 = (h + 48) % 360;
  return {
    id: GENERATIVE,
    name: "Generative",
    border: "neon",
    font: "lelu",
    palette: {
      glass: `hsla(${h}, 45%, 16%, 0.55)`,
      edge: `hsla(${h}, 80%, 85%, 0.28)`,
      ink: `hsl(${h}, 60%, 97%)`,
      ink2: `hsla(${h}, 50%, 90%, 0.78)`,
      accent: `hsl(${h}, 85%, 70%)`,
      accent2: `hsl(${h2}, 80%, 68%)`,
      tintA: `hsla(${h}, 70%, 35%, 0.32)`,
      tintB: `hsla(${h2}, 70%, 30%, 0.3)`,
    },
  };
}

/** Apply a theme: its palette, and its suggested border and font. Intensity, radius etc. are kept. */
export function withTheme(style: HomeStyle, themeId: string): HomeStyle {
  const theme = themeFor(themeId, style.seed);
  return { ...style, theme: theme.id, border: theme.border, font: theme.font, headingFont: theme.font, accent: undefined, ink: undefined };
}

/* ---------------------------------------------------------------
 * Colour helpers (enough CSS colour parsing for our own palettes)
 * ------------------------------------------------------------- */

type RGBA = [number, number, number, number];

export function parseColor(input: string): RGBA | null {
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s);
  if (m) {
    const hex = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), 1];
  }
  m = /^rgba?\(([^)]+)\)$/.exec(s);
  if (m) {
    const [r, g, b, a = "1"] = m[1].split(/[\s,/]+/).filter(Boolean);
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  m = /^hsla?\(([^)]+)\)$/.exec(s);
  if (m) {
    const [hRaw, sRaw, lRaw, a = "1"] = m[1].split(/[\s,/]+/).filter(Boolean);
    const [r, g, b] = hslToRgb(Number(hRaw), parseFloat(sRaw) / 100, parseFloat(lRaw) / 100);
    return [r, g, b, Number(a)];
  }
  return null;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

export function mixColor(a: string, b: string, t: number): string {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return t < 0.5 ? a : b;
  const v = ca.map((x, i) => x + (cb[i] - x) * t);
  return `rgba(${Math.round(v[0])}, ${Math.round(v[1])}, ${Math.round(v[2])}, ${Math.round(v[3] * 1000) / 1000})`;
}

function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  if (!c) return color;
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${Math.round(Math.max(0, Math.min(1, alpha)) * 1000) / 1000})`;
}

/** WCAG relative luminance contrast between two opaque colours. */
export function contrast(a: string, b: string): number {
  const lum = (c: string) => {
    const rgb = parseColor(c);
    if (!rgb) return 0;
    const [r, g, bl] = rgb.slice(0, 3).map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* ---------------------------------------------------------------
 * Resolving a style to CSS
 * ------------------------------------------------------------- */

export interface ResolvedStyle {
  palette: HomePalette;
  font: string;
  headingFont: string;
  border: BorderEffect;
  border2: BorderEffect;
  vars: Record<string, string>;
}

export function resolveStyle(input?: Partial<HomeStyle> | null): ResolvedStyle {
  const style = { ...DEFAULT_STYLE, ...(input ?? {}) };
  const theme = themeFor(style.theme, style.seed);
  const p = { ...theme.palette };
  if (style.accent) p.accent = style.accent;
  if (style.ink) p.ink = style.ink;
  // Opacity 0.5 = the theme's own glass; 0 = clearer, 1 = nearly solid.
  const base = parseColor(p.glass)?.[3] ?? 0.52;
  const glassAlpha = style.opacity <= 0.5 ? base * (0.35 + 1.3 * style.opacity) : base + (0.96 - base) * ((style.opacity - 0.5) * 2);
  const glass = withAlpha(p.glass, glassAlpha);
  const tintScale = style.tint * 2;
  const vars: Record<string, string> = {
    "--glass": glass,
    "--glass-strong": withAlpha(p.glass, Math.min(0.98, glassAlpha + 0.08)),
    "--edge": p.edge,
    "--edge-hi": withAlpha(p.edge, Math.min(1, (parseColor(p.edge)?.[3] ?? 0.3) * 2)),
    "--ink": p.ink,
    "--ink-2": p.ink2,
    "--ink-3": withAlpha(p.ink2, 0.55),
    "--magenta": p.accent,
    "--violet": p.accent2,
    "--accent": p.accent,
    "--hc-accent2": p.accent2,
    "--radius": `${Math.round(Math.max(0, Math.min(40, style.radius)))}px`,
    "--hc-tint-a": withAlpha(p.tintA, (parseColor(p.tintA)?.[3] ?? 0) * tintScale),
    "--hc-tint-b": withAlpha(p.tintB, (parseColor(p.tintB)?.[3] ?? 0) * tintScale),
    "--fx-w": `${(2 + style.intensity * 6).toFixed(1)}px`,
    "--fx-glow": `${Math.round(6 + style.intensity * 26)}px`,
    "--fx-o": `${(0.55 + style.intensity * 0.45).toFixed(2)}`,
  };
  const font = fontFor(style.font).stack;
  const heading = fontFor(style.headingFont).stack;
  if (font !== "inherit") vars["--hc-font"] = font;
  if (heading !== "inherit") vars["--hc-heading"] = heading;
  return { palette: p, font, headingFont: heading, border: style.border, border2: style.border2, vars };
}

/* ---------------------------------------------------------------
 * Blending two looks (Design Studio · Blend): colours interpolate,
 * numbers interpolate, choices come from the dominant side — and
 * the two borders can be kept together as an outer + inner pair.
 * ------------------------------------------------------------- */

export function blendStyles(a: Partial<HomeStyle> | undefined, b: Partial<HomeStyle> | undefined, t: number, keepBothBorders = true): HomeStyle {
  const sa = { ...DEFAULT_STYLE, ...(a ?? {}) };
  const sb = { ...DEFAULT_STYLE, ...(b ?? {}) };
  const pa = resolveStyle(sa).palette;
  const pb = resolveStyle(sb).palette;
  const dominant = t < 0.5 ? sa : sb;
  const other = t < 0.5 ? sb : sa;
  const lerp = (x: number, y: number) => x + (y - x) * t;
  const borders = keepBothBorders && sa.border !== sb.border ? [dominant.border, other.border] : [dominant.border, dominant.border2];
  return {
    theme: dominant.theme,
    seed: Math.round(lerp(sa.seed, sb.seed)),
    font: dominant.font,
    headingFont: other.headingFont,
    border: borders[0] === "none" ? borders[1] : borders[0],
    border2: borders[0] === "none" ? "none" : borders[1],
    intensity: lerp(sa.intensity, sb.intensity),
    radius: Math.round(lerp(sa.radius, sb.radius)),
    opacity: lerp(sa.opacity, sb.opacity),
    tint: lerp(sa.tint, sb.tint),
    motion: sa.motion || sb.motion,
    accent: mixColor(pa.accent, pb.accent, t),
    ink: mixColor(pa.ink, pb.ink, t),
  };
}

const EFFECT_IDS = new Set(BORDER_EFFECTS.map((e) => e.id));

/** Saved data is read defensively: unknown values fall back to the defaults. */
export function readStyle(raw: unknown): HomeStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Partial<HomeStyle>;
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  const color = (v: unknown) => (typeof v === "string" && parseColor(v) ? v : undefined);
  return {
    theme: typeof r.theme === "string" && (r.theme === GENERATIVE || THEMES.some((t) => t.id === r.theme)) ? r.theme : DEFAULT_STYLE.theme,
    seed: num(r.seed, 0, 359, DEFAULT_STYLE.seed),
    font: typeof r.font === "string" && FONTS.some((f) => f.id === r.font) ? r.font : DEFAULT_STYLE.font,
    headingFont: typeof r.headingFont === "string" && FONTS.some((f) => f.id === r.headingFont) ? r.headingFont : DEFAULT_STYLE.headingFont,
    border: EFFECT_IDS.has(r.border as BorderEffect) ? (r.border as BorderEffect) : "none",
    border2: EFFECT_IDS.has(r.border2 as BorderEffect) ? (r.border2 as BorderEffect) : "none",
    intensity: num(r.intensity, 0, 1, DEFAULT_STYLE.intensity),
    radius: num(r.radius, 0, 40, DEFAULT_STYLE.radius),
    opacity: num(r.opacity, 0, 1, DEFAULT_STYLE.opacity),
    tint: num(r.tint, 0, 1, DEFAULT_STYLE.tint),
    motion: r.motion !== false,
    accent: color(r.accent),
    ink: color(r.ink),
  };
}
