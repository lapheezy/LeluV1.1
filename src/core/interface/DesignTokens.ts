/**
 * ==========================================================
 * LÉLU — DESIGN TOKENS
 *
 * The structured design system LÉLU reasons about and edits.
 * A theme is DATA: palette, typography, materials, lighting,
 * motion and environment. Nothing here touches a component.
 *
 * The front end compiles a token set into CSS custom
 * properties (`tokensToCssVariables`). The existing Genesis
 * chrome reads those variables with its original values as
 * fallbacks, so:
 *
 *   • the untouched default theme emits NO variables and the
 *     Cosmos looks exactly as it did before this layer existed;
 *   • any approved theme restyles every surface at once — no
 *     component, stylesheet or build is edited to do it.
 *
 * Every value is validated and clamped: a model-authored
 * palette can never inject arbitrary CSS (colours are hex
 * only, enums are closed, numbers are bounded).
 * ==========================================================
 */

import { fontStack, isKnownFont } from "./FontLibrary";

export type HexColor = string;

export interface PaletteTokens {
  background: HexColor;
  surface: HexColor;
  surfaceAlt: HexColor;
  text: HexColor;
  textMuted: HexColor;
  accent: HexColor;
  accentSoft: HexColor;
  border: HexColor;
  glow: HexColor;
  success: HexColor;
  warning: HexColor;
  danger: HexColor;
}

export type TextAlign = "left" | "center" | "justify";
export type HeadingCase = "none" | "uppercase" | "lowercase" | "capitalize";
export type TextAnimation = "none" | "fade" | "rise" | "shimmer" | "typewriter";

export interface TypographyTokens {
  /** Font ids from FontLibrary (or a registered custom font id). */
  bodyFont: string;
  headingFont: string;
  monoFont: string;
  /** Body size in px on desktop. */
  baseSize: number;
  /** Modular scale ratio between heading levels (1.067 minor second … 1.618 golden). */
  scaleRatio: number;
  bodyWeight: number;
  headingWeight: number;
  /** em */
  letterSpacing: number;
  /** em */
  headingLetterSpacing: number;
  lineHeight: number;
  headingLineHeight: number;
  textAlign: TextAlign;
  headingCase: HeadingCase;
  textAnimation: TextAnimation;
  /** Multiplier applied to every size below 720px wide. */
  mobileScale: number;
  /** Why this system works — LÉLU's stated design intent. */
  rationale?: string;
}

export type WindowShape = "rect" | "rounded" | "pill" | "organic";
export type SurfaceTexture = "none" | "grain" | "paper" | "silk" | "stars" | "leaf" | "water";

export interface MaterialTokens {
  /** 0 transparent … 1 opaque */
  surfaceOpacity: number;
  /** backdrop blur, px */
  blur: number;
  borderWidth: number;
  borderOpacity: number;
  /** corner radius, px */
  radius: number;
  windowShape: WindowShape;
  /** 0 flat … 1 deep */
  shadowDepth: number;
  /** 0 none … 1 strong accent glow */
  glowStrength: number;
  texture: SurfaceTexture;
  /** surface gradient angle, degrees */
  gradientAngle: number;
  /** 0.8 dense … 1.25 airy — scales spacing inside windows */
  density: number;
}

export interface LightingTokens {
  ambient: number;
  keyIntensity: number;
  keyColor: HexColor;
  rimColor: HexColor;
  fogColor: HexColor;
  /** 0 none … 0.12 thick */
  fogDensity: number;
}

export type MotionProfile = "still" | "calm" | "fluid" | "lively";
export type MotionEasing = "standard" | "gentle" | "spring" | "linear";

export interface MotionTokens {
  profile: MotionProfile;
  durationMs: number;
  easing: MotionEasing;
  /** px windows drift while idle (0 = static) */
  floatAmplitude: number;
}

export type BackdropKind = "cosmos" | "gradient" | "nebula" | "garden" | "river" | "studio" | "plain";

export interface EnvironmentTokens {
  /** "cosmos" keeps the existing Genesis sky untouched. */
  backdrop: BackdropKind;
  gradientStops: HexColor[];
  nebulaColors: HexColor[];
  particleColor: HexColor;
  /** 0 none … 1 dense */
  particleDensity: number;
  /** 0 none … 1 heavy */
  vignette: number;
}

export interface DesignTokens {
  palette: PaletteTokens;
  typography: TypographyTokens;
  materials: MaterialTokens;
  lighting: LightingTokens;
  motion: MotionTokens;
  environment: EnvironmentTokens;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U> ? U[] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

/**
 * The Genesis look as it already exists (values copied from
 * GenesisTheme / GenesisChat / GenesisModuleHost). This is the base
 * every theme composes on top of.
 */
export const DEFAULT_TOKENS: DesignTokens = {
  palette: {
    background: "#020617",
    surface: "#060e20",
    surfaceAlt: "#1e293b",
    text: "#e2e8f0",
    textMuted: "#94a3b8",
    accent: "#67e8f9",
    accentSoft: "#0e7490",
    border: "#67e8f9",
    glow: "#0099ff",
    success: "#4ade80",
    warning: "#facc15",
    danger: "#f87171",
  },
  typography: {
    bodyFont: "system-sans",
    headingFont: "system-sans",
    monoFont: "system-mono",
    baseSize: 15,
    scaleRatio: 1.25,
    bodyWeight: 400,
    headingWeight: 700,
    letterSpacing: 0.015,
    headingLetterSpacing: 0.04,
    lineHeight: 1.55,
    headingLineHeight: 1.2,
    textAlign: "center",
    headingCase: "none",
    textAnimation: "none",
    mobileScale: 0.94,
  },
  materials: {
    surfaceOpacity: 0.95,
    blur: 24,
    borderWidth: 1,
    borderOpacity: 0.22,
    radius: 16,
    windowShape: "rounded",
    shadowDepth: 0.55,
    glowStrength: 0.25,
    texture: "none",
    gradientAngle: 135,
    density: 1,
  },
  lighting: {
    ambient: 0.6,
    keyIntensity: 1.2,
    keyColor: "#ffffff",
    rimColor: "#67e8f9",
    fogColor: "#020617",
    fogDensity: 0,
  },
  motion: {
    profile: "calm",
    durationMs: 260,
    easing: "standard",
    floatAmplitude: 0,
  },
  environment: {
    backdrop: "cosmos",
    gradientStops: ["#020617", "#0f172a", "#1e1b4b"],
    nebulaColors: ["#7c3aed", "#0ea5e9", "#f472b6"],
    particleColor: "#e0f2fe",
    particleDensity: 0.3,
    vignette: 0.3,
  },
};

/* ------------------------------------------------------------------ *
 * VALIDATION
 * ------------------------------------------------------------------ */

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is HexColor {
  return typeof value === "string" && HEX.test(value.trim());
}

function normaliseHex(value: string): string {
  const v = value.trim().toLowerCase();
  if (v.length === 4) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return v;
}

export function hexToRgb(hex: HexColor): [number, number, number] {
  const v = normaliseHex(hex);
  return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16)];
}

export function rgba(hex: HexColor, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(Math.max(0, Math.min(1, alpha)) * 1000) / 1000})`;
}

/** Relative luminance (WCAG). */
export function luminance(hex: HexColor): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: HexColor, b: HexColor): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function pickNumber(value: unknown, fallback: number, lo: number, hi: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
}

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function pickColor(value: unknown, fallback: HexColor, issues: string[], path: string): HexColor {
  if (value === undefined) return fallback;
  if (isHexColor(value)) return normaliseHex(value);
  issues.push(`${path}: "${String(value)}" is not a #rrggbb colour — kept ${fallback}`);
  return fallback;
}

function pickColors(value: unknown, fallback: HexColor[], issues: string[], path: string): HexColor[] {
  if (value === undefined) return fallback;
  if (!Array.isArray(value)) {
    issues.push(`${path}: expected a list of colours`);
    return fallback;
  }
  const colors = value.filter(isHexColor).map(normaliseHex).slice(0, 6);
  if (colors.length !== value.length) issues.push(`${path}: dropped entries that were not #rrggbb colours`);
  return colors.length ? colors : fallback;
}

function pickFont(value: unknown, fallback: string, issues: string[], path: string, customIds: Set<string>): string {
  if (value === undefined) return fallback;
  if (typeof value === "string" && (isKnownFont(value) || customIds.has(value))) return value;
  issues.push(`${path}: "${String(value)}" is not an available font — kept ${fallback}`);
  return fallback;
}

/**
 * Merge a partial token patch over a base, validating every field.
 * Returns the merged tokens plus every problem found, so a refusal
 * can tell LÉLU precisely what she got wrong.
 */
export function mergeTokens(
  base: DesignTokens,
  patch: DeepPartial<DesignTokens> | undefined,
  customFontIds: Iterable<string> = [],
): { tokens: DesignTokens; issues: string[] } {
  const issues: string[] = [];
  if (!patch) return { tokens: structuredClone(base), issues };
  const custom = new Set(customFontIds);
  const p = patch.palette ?? {};
  const t = patch.typography ?? {};
  const m = patch.materials ?? {};
  const l = patch.lighting ?? {};
  const mo = patch.motion ?? {};
  const e = patch.environment ?? {};

  const palette = Object.fromEntries(
    (Object.keys(base.palette) as Array<keyof PaletteTokens>).map((key) => [
      key,
      pickColor((p as Record<string, unknown>)[key], base.palette[key], issues, `palette.${key}`),
    ]),
  ) as unknown as PaletteTokens;

  const typography: TypographyTokens = {
    bodyFont: pickFont(t.bodyFont, base.typography.bodyFont, issues, "typography.bodyFont", custom),
    headingFont: pickFont(t.headingFont, base.typography.headingFont, issues, "typography.headingFont", custom),
    monoFont: pickFont(t.monoFont, base.typography.monoFont, issues, "typography.monoFont", custom),
    baseSize: pickNumber(t.baseSize, base.typography.baseSize, 12, 22),
    scaleRatio: pickNumber(t.scaleRatio, base.typography.scaleRatio, 1.05, 1.7),
    bodyWeight: Math.round(pickNumber(t.bodyWeight, base.typography.bodyWeight, 100, 900) / 100) * 100,
    headingWeight: Math.round(pickNumber(t.headingWeight, base.typography.headingWeight, 100, 900) / 100) * 100,
    letterSpacing: pickNumber(t.letterSpacing, base.typography.letterSpacing, -0.06, 0.3),
    headingLetterSpacing: pickNumber(t.headingLetterSpacing, base.typography.headingLetterSpacing, -0.08, 0.4),
    lineHeight: pickNumber(t.lineHeight, base.typography.lineHeight, 1, 2.2),
    headingLineHeight: pickNumber(t.headingLineHeight, base.typography.headingLineHeight, 0.9, 1.8),
    textAlign: pickEnum(t.textAlign, ["left", "center", "justify"] as const, base.typography.textAlign),
    headingCase: pickEnum(t.headingCase, ["none", "uppercase", "lowercase", "capitalize"] as const, base.typography.headingCase),
    textAnimation: pickEnum(t.textAnimation, ["none", "fade", "rise", "shimmer", "typewriter"] as const, base.typography.textAnimation),
    mobileScale: pickNumber(t.mobileScale, base.typography.mobileScale, 0.75, 1.15),
    rationale: typeof t.rationale === "string" ? t.rationale.slice(0, 600) : base.typography.rationale,
  };

  const materials: MaterialTokens = {
    surfaceOpacity: pickNumber(m.surfaceOpacity, base.materials.surfaceOpacity, 0.15, 1),
    blur: pickNumber(m.blur, base.materials.blur, 0, 48),
    borderWidth: pickNumber(m.borderWidth, base.materials.borderWidth, 0, 4),
    borderOpacity: pickNumber(m.borderOpacity, base.materials.borderOpacity, 0, 1),
    radius: pickNumber(m.radius, base.materials.radius, 0, 48),
    windowShape: pickEnum(m.windowShape, ["rect", "rounded", "pill", "organic"] as const, base.materials.windowShape),
    shadowDepth: pickNumber(m.shadowDepth, base.materials.shadowDepth, 0, 1),
    glowStrength: pickNumber(m.glowStrength, base.materials.glowStrength, 0, 1),
    texture: pickEnum(m.texture, ["none", "grain", "paper", "silk", "stars", "leaf", "water"] as const, base.materials.texture),
    gradientAngle: pickNumber(m.gradientAngle, base.materials.gradientAngle, 0, 360),
    density: pickNumber(m.density, base.materials.density, 0.8, 1.25),
  };

  const lighting: LightingTokens = {
    ambient: pickNumber(l.ambient, base.lighting.ambient, 0, 2),
    keyIntensity: pickNumber(l.keyIntensity, base.lighting.keyIntensity, 0, 4),
    keyColor: pickColor(l.keyColor, base.lighting.keyColor, issues, "lighting.keyColor"),
    rimColor: pickColor(l.rimColor, base.lighting.rimColor, issues, "lighting.rimColor"),
    fogColor: pickColor(l.fogColor, base.lighting.fogColor, issues, "lighting.fogColor"),
    fogDensity: pickNumber(l.fogDensity, base.lighting.fogDensity, 0, 0.12),
  };

  const motion: MotionTokens = {
    profile: pickEnum(mo.profile, ["still", "calm", "fluid", "lively"] as const, base.motion.profile),
    durationMs: pickNumber(mo.durationMs, base.motion.durationMs, 0, 1200),
    easing: pickEnum(mo.easing, ["standard", "gentle", "spring", "linear"] as const, base.motion.easing),
    floatAmplitude: pickNumber(mo.floatAmplitude, base.motion.floatAmplitude, 0, 12),
  };

  const environment: EnvironmentTokens = {
    backdrop: pickEnum(e.backdrop, ["cosmos", "gradient", "nebula", "garden", "river", "studio", "plain"] as const, base.environment.backdrop),
    gradientStops: pickColors(e.gradientStops, base.environment.gradientStops, issues, "environment.gradientStops"),
    nebulaColors: pickColors(e.nebulaColors, base.environment.nebulaColors, issues, "environment.nebulaColors"),
    particleColor: pickColor(e.particleColor, base.environment.particleColor, issues, "environment.particleColor"),
    particleDensity: pickNumber(e.particleDensity, base.environment.particleDensity, 0, 1),
    vignette: pickNumber(e.vignette, base.environment.vignette, 0, 1),
  };

  // Unknown top-level groups are reported, not silently dropped.
  for (const key of Object.keys(patch)) {
    if (!["palette", "typography", "materials", "lighting", "motion", "environment"].includes(key)) {
      issues.push(`"${key}" is not a token group (palette, typography, materials, lighting, motion, environment)`);
    }
  }

  return { tokens: { palette, typography, materials, lighting, motion, environment }, issues };
}

/** Design-quality checks LÉLU is told about (not refusals). */
export function designWarnings(tokens: DesignTokens): string[] {
  const warnings: string[] = [];
  const surface = tokens.palette.surface;
  const ratio = contrastRatio(tokens.palette.text, surface);
  if (ratio < 4.5) warnings.push(`text on surface contrast is ${ratio.toFixed(2)}:1 (below WCAG AA 4.5:1) — readability will suffer`);
  const mutedRatio = contrastRatio(tokens.palette.textMuted, surface);
  if (mutedRatio < 3) warnings.push(`muted text contrast is ${mutedRatio.toFixed(2)}:1 (below 3:1)`);
  if (tokens.materials.surfaceOpacity < 0.5 && tokens.materials.blur < 8) {
    warnings.push("very transparent surfaces without blur make text hard to read over the Cosmos");
  }
  if (tokens.typography.baseSize * tokens.typography.mobileScale < 13) {
    warnings.push("body text drops below 13px on phones");
  }
  return warnings;
}

/* ------------------------------------------------------------------ *
 * COMPILATION → CSS CUSTOM PROPERTIES
 * ------------------------------------------------------------------ */

const EASINGS: Record<MotionEasing, string> = {
  standard: "cubic-bezier(0.2, 0, 0, 1)",
  gentle: "cubic-bezier(0.4, 0, 0.2, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  linear: "linear",
};

function textureImage(texture: SurfaceTexture, accent: HexColor): string {
  const enc = (svg: string) => `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
  const [r, g, b] = hexToRgb(accent);
  switch (texture) {
    case "grain":
      return enc(
        `<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 0.07 0'/></filter><rect width='100%' height='100%' filter='url(#n)'/></svg>`,
      );
    case "paper":
      return enc(
        `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'><filter id='p'><feTurbulence type='fractalNoise' baseFrequency='0.04' numOctaves='4'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 0.97 0 0 0 0 0.9 0 0 0 0.06 0'/></filter><rect width='100%' height='100%' filter='url(#p)'/></svg>`,
      );
    case "silk":
      return `linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.05) 45%, rgba(255,255,255,0) 60%)`;
    case "stars":
      return enc(
        `<svg xmlns='http://www.w3.org/2000/svg' width='120' height='120'><g fill='white' fill-opacity='0.35'><circle cx='12' cy='18' r='0.8'/><circle cx='64' cy='9' r='0.6'/><circle cx='98' cy='44' r='0.9'/><circle cx='33' cy='76' r='0.5'/><circle cx='81' cy='101' r='0.7'/><circle cx='8' cy='110' r='0.6'/></g></svg>`,
      );
    case "leaf":
      return enc(
        `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><g fill='none' stroke='rgb(${r},${g},${b})' stroke-opacity='0.09' stroke-width='1.2'><path d='M20 160 C60 120 60 60 120 20'/><path d='M60 170 C90 130 110 110 170 90'/><path d='M40 130 q20 -10 30 -34'/><path d='M100 60 q18 4 34 -8'/></g></svg>`,
      );
    case "water":
      return enc(
        `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='60'><path d='M0 30 Q25 18 50 30 T100 30 T150 30 T200 30' fill='none' stroke='rgb(${r},${g},${b})' stroke-opacity='0.08' stroke-width='1.5'/></svg>`,
      );
    default:
      return "none";
  }
}

function windowRadius(m: MaterialTokens): string {
  switch (m.windowShape) {
    case "rect":
      return `${Math.min(m.radius, 4)}px`;
    case "pill":
      return `${Math.max(m.radius, 28)}px`;
    case "organic": {
      // Asymmetric elliptical corners: soft and hand-made, but bounded so
      // window content is never clipped by the curve.
      const r = Math.max(m.radius, 18);
      return `${r * 1.6}px ${r * 2.4}px ${r * 1.8}px ${r * 2.8}px / ${r * 2.2}px ${r * 1.5}px ${r * 2.6}px ${r * 1.7}px`;
    }
    default:
      return `${m.radius}px`;
  }
}

export interface CompiledTheme {
  variables: Record<string, string>;
  /** Attributes set on <html> to switch CSS behaviours (animation, motion). */
  attributes: Record<string, string>;
  /** Font ids that must be loaded. */
  fonts: string[];
}

/**
 * Compile tokens into CSS custom properties. Pure function — the same
 * tokens always produce the same variables, which is what makes a
 * preview faithful to what approval will apply.
 */
export function tokensToCssVariables(
  tokens: DesignTokens,
  customFontFamilies: Record<string, string> = {},
  options: { mobile?: boolean; reducedMotion?: boolean } = {},
): CompiledTheme {
  const { palette: p, typography: t, materials: m, lighting: l, motion: mo, environment: e } = tokens;
  const family = (id: string) => (customFontFamilies[id] ? `"${customFontFamilies[id]}", ${fontStack("system-sans")}` : fontStack(id));
  // Responsive typography: the whole scale shrinks (or grows) together on
  // phones, so hierarchy is preserved at every width.
  const base = t.baseSize * (options.mobile ? t.mobileScale : 1);
  const size = (step: number) => `${Math.round(base * t.scaleRatio ** step * 10) / 10}px`;
  const shadowA = 0.25 + m.shadowDepth * 0.45;
  const shadowSpread = Math.round(16 + m.shadowDepth * 56);
  const glow = m.glowStrength > 0 ? `, 0 ${Math.round(shadowSpread / 3)}px ${shadowSpread}px ${rgba(p.glow, m.glowStrength * 0.6)}` : "";
  const texture = textureImage(m.texture, p.accent);
  const surfaceGradient = `linear-gradient(${m.gradientAngle}deg, ${rgba(p.surface, m.surfaceOpacity)}, ${rgba(p.surfaceAlt, m.surfaceOpacity * 0.82)})`;

  const variables: Record<string, string> = {
    "--lelu-font-body": family(t.bodyFont),
    "--lelu-font-heading": family(t.headingFont),
    "--lelu-font-mono": family(t.monoFont),
    "--lelu-font-size-small": size(-1),
    "--lelu-font-size-body": size(0),
    "--lelu-font-size-dialogue": options.mobile ? size(0.5) : `clamp(${size(0)}, 1.2vw + ${Math.round(base * 0.6)}px, ${size(1)})`,
    "--lelu-font-size-h4": size(1),
    "--lelu-font-size-h3": size(2),
    "--lelu-font-size-h2": size(3),
    "--lelu-font-size-h1": size(4),
    "--lelu-font-weight-body": String(t.bodyWeight),
    "--lelu-font-weight-heading": String(t.headingWeight),
    "--lelu-letter-spacing": `${t.letterSpacing}em`,
    "--lelu-heading-letter-spacing": `${t.headingLetterSpacing}em`,
    "--lelu-line-height": String(t.lineHeight),
    "--lelu-heading-line-height": String(t.headingLineHeight),
    "--lelu-text-align": t.textAlign,
    "--lelu-heading-case": t.headingCase,
    "--lelu-mobile-type-scale": String(t.mobileScale),

    "--lelu-color-bg": p.background,
    "--lelu-color-surface": rgba(p.surface, m.surfaceOpacity),
    "--lelu-color-surface-alt": rgba(p.surfaceAlt, m.surfaceOpacity),
    "--lelu-color-text": p.text,
    "--lelu-color-text-muted": p.textMuted,
    "--lelu-color-accent": p.accent,
    "--lelu-color-accent-soft": rgba(p.accentSoft, 0.35),
    "--lelu-color-glow": p.glow,
    "--lelu-color-success": p.success,
    "--lelu-color-warning": p.warning,
    "--lelu-color-danger": p.danger,

    "--lelu-surface-bg": texture === "none" ? surfaceGradient : `${texture}, ${surfaceGradient}`,
    "--lelu-chrome-bg": rgba(p.surface, Math.min(1, m.surfaceOpacity * 0.9)),
    "--lelu-border": `${m.borderWidth}px solid ${rgba(p.border, m.borderOpacity)}`,
    "--lelu-border-soft": `${Math.max(0, m.borderWidth)}px solid ${rgba(p.border, m.borderOpacity * 0.6)}`,
    "--lelu-border-accent": `${Math.max(1, m.borderWidth)}px solid ${rgba(p.accent, Math.min(1, m.borderOpacity + 0.25))}`,
    "--lelu-radius": `${m.radius}px`,
    "--lelu-window-radius": windowRadius(m),
    "--lelu-backdrop": m.blur > 0 ? `blur(${m.blur}px) saturate(1.15)` : "none",
    "--lelu-shadow": `0 ${Math.round(shadowSpread / 4)}px ${shadowSpread}px rgba(2, 6, 23, ${shadowA.toFixed(2)})${glow}, inset 0 1px 0 rgba(255,255,255,0.06)`,
    "--lelu-density": String(m.density),

    "--lelu-motion-duration": options.reducedMotion ? "0ms" : `${mo.durationMs}ms`,
    "--lelu-motion-easing": EASINGS[mo.easing],
    "--lelu-float-amplitude": options.reducedMotion || options.mobile ? "0px" : `${mo.floatAmplitude}px`,

    "--lelu-env-vignette": String(e.vignette),
    "--lelu-light-fog": l.fogColor,
  };

  const attributes: Record<string, string> = {
    "data-lelu-theme": "custom",
    "data-lelu-text-animation": options.reducedMotion ? "none" : t.textAnimation,
    "data-lelu-motion": options.reducedMotion ? "still" : mo.profile,
    "data-lelu-window-shape": m.windowShape,
  };

  const fonts = [...new Set([t.bodyFont, t.headingFont, t.monoFont])];
  return { variables, attributes, fonts };
}

export function tokensEqual(a: DesignTokens, b: DesignTokens): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Human-readable list of what differs between two token sets. */
export function diffTokens(before: DesignTokens, after: DesignTokens): string[] {
  const changes: string[] = [];
  for (const group of Object.keys(after) as Array<keyof DesignTokens>) {
    const a = before[group] as unknown as Record<string, unknown>;
    const b = after[group] as unknown as Record<string, unknown>;
    for (const key of Object.keys(b)) {
      if (key === "rationale") continue;
      const va = JSON.stringify(a[key]);
      const vb = JSON.stringify(b[key]);
      if (va !== vb) changes.push(`${group}.${key}: ${va} → ${vb}`);
    }
  }
  return changes;
}
