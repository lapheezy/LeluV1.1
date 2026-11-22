/**
 * ==========================================================
 * LÉLU HOME — RETRO TERMINAL APPEARANCE (themes · palettes · roles)
 *
 * The Retro Terminal is one more Home layout (homeComposition's
 * "retro-terminal", kind "terminal"). This file holds what it LOOKS
 * like, kept apart from the layout exactly as homeStyle keeps a
 * presentation's look apart from its arrangement:
 *
 *   palette   2–8 colour swatches she picks (multicolour by design)
 *   roles     every interface role — 8 surfaces, 11 kinds of text,
 *             12 accents — takes either a palette swatch ("@2") or
 *             its own colour ("#ff9900"). Editing a swatch recolours
 *             every role that points at it.
 *   gradients optional two-stop gradients on the large surfaces
 *   effects   fonts, size, weight, border, panel opacity, glow,
 *             scanlines, grid, animation, radius, density
 *
 * Built-in presets are data; selecting one never stops her editing it.
 * Contrast is reported, never silently "fixed".
 *
 * Pure: no React, no DOM, no storage. HomeStore owns persistence
 * (lelu.home.terminal.v1, through KvStore like every Home key).
 * ==========================================================
 */

import { FONTS, contrast, fontFor, parseColor } from "./homeStyle";

/* ---------------------------------------------------------------
 * Roles
 * ------------------------------------------------------------- */

export type RoleGroup = "background" | "text" | "accent";

export const TERMINAL_ROLES = [
  // Backgrounds
  { id: "bg", group: "background", label: "Main background" },
  { id: "bg2", group: "background", label: "Secondary background" },
  { id: "panel", group: "background", label: "Panels" },
  { id: "input", group: "background", label: "Inputs" },
  { id: "sidebar", group: "background", label: "Sidebar" },
  { id: "header", group: "background", label: "Header" },
  { id: "footer", group: "background", label: "Footer / command bar" },
  { id: "selected", group: "background", label: "Selected / active surface" },
  // Typography
  { id: "text", group: "text", label: "Primary text" },
  { id: "text2", group: "text", label: "Secondary text" },
  { id: "heading", group: "text", label: "Headings" },
  { id: "label", group: "text", label: "Technical labels" },
  { id: "numeric", group: "text", label: "Numerical readouts" },
  { id: "cmdInput", group: "text", label: "Command input" },
  { id: "cmdOutput", group: "text", label: "Command output" },
  { id: "highlight", group: "text", label: "Highlighted text" },
  { id: "warning", group: "text", label: "Warnings" },
  { id: "error", group: "text", label: "Errors" },
  { id: "selectedText", group: "text", label: "Selected text" },
  // Accents
  { id: "accent1", group: "accent", label: "Primary accent" },
  { id: "accent2", group: "accent", label: "Secondary accent" },
  { id: "accent3", group: "accent", label: "Tertiary accent" },
  { id: "border", group: "accent", label: "Borders" },
  { id: "divider", group: "accent", label: "Dividers" },
  { id: "icon", group: "accent", label: "Icons" },
  { id: "button", group: "accent", label: "Buttons" },
  { id: "navActive", group: "accent", label: "Active navigation" },
  { id: "selectedObject", group: "accent", label: "Selected objects" },
  { id: "status", group: "accent", label: "Status indicators" },
  { id: "control", group: "accent", label: "Interactive controls" },
] as const satisfies ReadonlyArray<{ id: string; group: RoleGroup; label: string }>;

export type TerminalRole = (typeof TERMINAL_ROLES)[number]["id"];
export const ROLE_IDS: TerminalRole[] = TERMINAL_ROLES.map((r) => r.id);
export const ROLE_LABEL = Object.fromEntries(TERMINAL_ROLES.map((r) => [r.id, r.label])) as Record<TerminalRole, string>;

/** Surfaces that may carry a gradient (large areas only: a gradient on a button would only hurt legibility). */
export const GRADIENT_ROLES = ["bg", "bg2", "panel", "sidebar", "header", "footer"] as const;
export type GradientRole = (typeof GRADIENT_ROLES)[number];

export interface Gradient {
  /** The second stop: a swatch ref or a colour. The first stop is the role's own colour. */
  to: string;
  /** Degrees, 0..360. */
  angle: number;
}

/* ---------------------------------------------------------------
 * Effects
 * ------------------------------------------------------------- */

export interface MonoFont {
  id: string;
  name: string;
  stack: string;
}

/** System monospace stacks only — nothing is downloaded (same rule as homeStyle.FONTS). */
export const MONO_FONTS: MonoFont[] = [
  { id: "system-mono", name: "System mono", stack: "ui-monospace, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace" },
  { id: "courier", name: "Courier (typewriter)", stack: "'Courier New', Courier, 'Nimbus Mono PS', monospace" },
  { id: "console", name: "Console", stack: "'Lucida Console', Monaco, 'DejaVu Sans Mono', monospace" },
  { id: "menlo", name: "Menlo / Andale", stack: "Menlo, 'Andale Mono', 'Bitstream Vera Sans Mono', monospace" },
  { id: "consolas", name: "Consolas / Cascadia", stack: "'Cascadia Mono', Consolas, 'Roboto Mono', monospace" },
];

/** "mono" = use the monospace font for everything (the classic terminal); any other id is a homeStyle font. */
export const TERMINAL_BODY_FONTS: Array<{ id: string; name: string }> = [{ id: "mono", name: "Monospace (classic)" }, ...FONTS.filter((f) => f.id !== "lelu" && f.id !== "mono").map((f) => ({ id: f.id, name: f.name }))];

export interface TerminalEffects {
  /** Body font: "mono" or a homeStyle font id. */
  font: string;
  /** Monospace font for readouts, the command line and (with font "mono") everything. */
  monoFont: string;
  /** Base font size in px (12..20). */
  fontSize: number;
  /** 300..700. */
  weight: number;
  /** 0..1 — how strong panel borders are. */
  borderIntensity: number;
  /** 0..1 — 0 lets the Cosmos through every panel, 1 is solid. */
  panelOpacity: number;
  /** 0..1 — text and border glow. */
  glow: number;
  /** 0..1 — scanline overlay strength (0 = off). */
  scanlines: number;
  /** Background grid. */
  grid: boolean;
  /** 0..1 — cursor blink, flicker, transitions (reduced motion forces 0). */
  animation: number;
  /** Corner radius in px (0..16). */
  radius: number;
  /** 0 compact … 1 airy. */
  density: number;
}

export const DEFAULT_EFFECTS: TerminalEffects = {
  font: "mono",
  monoFont: "system-mono",
  fontSize: 14,
  weight: 400,
  borderIntensity: 0.6,
  panelOpacity: 0.82,
  glow: 0.35,
  scanlines: 0.25,
  grid: true,
  animation: 0.5,
  radius: 2,
  density: 0.5,
};

/** Effects that cost GPU/attention; "reduce effects" turns these down in one step. */
export const REDUCED_EFFECTS: Partial<TerminalEffects> = { glow: 0, scanlines: 0, animation: 0, grid: false };

const EFFECT_RANGES: Record<Exclude<keyof TerminalEffects, "font" | "monoFont" | "grid">, [number, number]> = {
  fontSize: [12, 20],
  weight: [300, 700],
  borderIntensity: [0, 1],
  panelOpacity: [0, 1],
  glow: [0, 1],
  scanlines: [0, 1],
  animation: [0, 1],
  radius: [0, 16],
  density: [0, 1],
};

/* ---------------------------------------------------------------
 * Themes
 * ------------------------------------------------------------- */

export type TerminalPresetId = "classic-retro" | "cybernetic" | "cosmic-violet" | "solar-flare" | "emerald" | "arctic" | "monochrome" | "custom";

export interface TerminalTheme {
  id: string;
  name: string;
  /** The preset it started from: "reset" goes back to it. */
  base: TerminalPresetId;
  /** 2..8 swatches, "#rrggbb". */
  palette: string[];
  /** Every role: "@<swatch index>" or "#rrggbb". */
  roles: Record<TerminalRole, string>;
  gradients: Partial<Record<GradientRole, Gradient>>;
  effects: TerminalEffects;
  /** Saved by her (a preset is never custom). */
  custom: boolean;
  createdAt: number;
  updatedAt: number;
}

export const MIN_SWATCHES = 2;
export const MAX_SWATCHES = 8;
export const PRESET_PREFIX = "preset:";

/**
 * The preset role map, by swatch slot:
 *   0 base · 1 surface · 2 raised/selected · 3 primary ink · 4 dim ink
 *   5 second colour · 6 third colour · 7 danger
 */
const ROLE_MAP: Record<TerminalRole, string> = {
  bg: "@0",
  bg2: "@1",
  panel: "@1",
  input: "@0",
  sidebar: "@0",
  header: "@1",
  footer: "@1",
  selected: "@2",
  text: "@3",
  text2: "@4",
  heading: "@3",
  label: "@4",
  numeric: "@5",
  cmdInput: "@3",
  cmdOutput: "@4",
  highlight: "@6",
  warning: "#ffd23f",
  error: "@7",
  selectedText: "@3",
  accent1: "@3",
  accent2: "@5",
  accent3: "@6",
  border: "@4",
  divider: "@2",
  icon: "@3",
  button: "@3",
  navActive: "@5",
  selectedObject: "@6",
  status: "@5",
  control: "@3",
};

interface PresetDef {
  id: TerminalPresetId;
  name: string;
  blurb: string;
  palette: string[];
  roles?: Partial<Record<TerminalRole, string>>;
  gradients?: Partial<Record<GradientRole, Gradient>>;
  effects?: Partial<TerminalEffects>;
}

const PRESET_DEFS: PresetDef[] = [
  {
    id: "classic-retro",
    name: "Classic Retro",
    blurb: "Charcoal and amber — the vintage phosphor terminal.",
    palette: ["#12100e", "#1b1814", "#3a2a12", "#ffb000", "#c98a2b", "#ff7a1a", "#ffd27a", "#ff4b3a"],
    roles: { warning: "#ffd23f" },
  },
  {
    id: "cybernetic",
    name: "Cybernetic",
    blurb: "Deep black, electric blue and cyan highlights.",
    palette: ["#020409", "#070d18", "#0f2a52", "#3d8bff", "#7fa6d9", "#00e5ff", "#c6f6ff", "#ff3d6e"],
    roles: { text: "#d7e8ff", heading: "@3", cmdInput: "@5", selectedText: "#ffffff", warning: "#ffcc33" },
    effects: { glow: 0.5, radius: 4 },
  },
  {
    id: "cosmic-violet",
    name: "Cosmic Violet",
    blurb: "Deep purple, violet type, pink and blue accents.",
    palette: ["#12081f", "#1c0f30", "#3b1d63", "#c9a2ff", "#9a83c4", "#ff6ad5", "#62b6ff", "#ff5a7a"],
    roles: { numeric: "@6", highlight: "@5", warning: "#ffd166", navActive: "@5", status: "@6" },
    gradients: { bg: { to: "#0a0f2a", angle: 160 } },
    effects: { radius: 6, glow: 0.45 },
  },
  {
    id: "solar-flare",
    name: "Solar Flare",
    blurb: "Dark graphite, orange and gold, warm yellow highlights.",
    palette: ["#151517", "#1f1f22", "#3d2a14", "#ff8a1f", "#b8a89a", "#ffc93c", "#ffe66d", "#ff4d4d"],
    roles: { heading: "@5", warning: "@6" },
    effects: { glow: 0.4 },
  },
  {
    id: "emerald",
    name: "Emerald Terminal",
    blurb: "Dark green, bright green type, lime and muted gold accents.",
    palette: ["#03110a", "#061b11", "#0f3a22", "#3dff7a", "#7fbf93", "#b6ff3b", "#c9a84a", "#ff5c5c"],
    roles: { warning: "@6" },
    effects: { scanlines: 0.35 },
  },
  {
    id: "arctic",
    name: "Arctic Interface",
    blurb: "Deep navy, ice blue, white and cyan highlights.",
    palette: ["#061226", "#0b1d3a", "#173763", "#a8dcff", "#8fa9c8", "#3fe0ff", "#ffffff", "#ff6b81"],
    roles: { heading: "@6", selectedText: "@6", warning: "#ffd666" },
    effects: { font: "system", radius: 8, scanlines: 0.1, glow: 0.25 },
  },
  {
    id: "monochrome",
    name: "Monochrome",
    blurb: "Black, white and greys; contrast adjustable.",
    palette: ["#000000", "#111111", "#333333", "#f2f2f2", "#a6a6a6", "#d9d9d9", "#ffffff", "#ff4d4d"],
    roles: { warning: "#e6e6e6" },
    effects: { glow: 0.15, scanlines: 0.15 },
  },
  {
    id: "custom",
    name: "Custom",
    blurb: "Your own: black, amber and electric blue to start — change every role.",
    palette: ["#0a0a0c", "#15151a", "#1f2a44", "#ffb000", "#9aa4b8", "#2f7bff", "#00e5ff", "#ff4b3a"],
    roles: { heading: "@5", label: "@6", numeric: "@6", highlight: "@5", navActive: "@5", selectedObject: "@6", accent2: "@5", accent3: "@6" },
  },
];

export const TERMINAL_PRESETS: Array<{ id: TerminalPresetId; name: string; blurb: string }> = PRESET_DEFS.map(({ id, name, blurb }) => ({ id, name, blurb }));
export const DEFAULT_PRESET: TerminalPresetId = "classic-retro";
const PRESET_IDS = new Set<string>(PRESET_DEFS.map((p) => p.id));

export function presetThemeId(id: TerminalPresetId): string {
  return `${PRESET_PREFIX}${id}`;
}

export function isPresetThemeId(id: string): boolean {
  return id.startsWith(PRESET_PREFIX) && PRESET_IDS.has(id.slice(PRESET_PREFIX.length));
}

/** A preset as a full (fresh, independent) theme. */
export function presetTheme(id: TerminalPresetId | string): TerminalTheme {
  const def = PRESET_DEFS.find((p) => p.id === id) ?? PRESET_DEFS[0];
  return {
    id: presetThemeId(def.id),
    name: def.name,
    base: def.id,
    palette: [...def.palette],
    roles: { ...ROLE_MAP, ...(def.roles ?? {}) },
    gradients: JSON.parse(JSON.stringify(def.gradients ?? {})) as TerminalTheme["gradients"],
    effects: { ...DEFAULT_EFFECTS, ...(def.effects ?? {}) },
    custom: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

export function cloneTheme(theme: TerminalTheme): TerminalTheme {
  return JSON.parse(JSON.stringify(theme)) as TerminalTheme;
}

/* ---------------------------------------------------------------
 * Colours
 * ------------------------------------------------------------- */

const hex2 = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/**
 * Any colour she types — #rgb, #rrggbb, rgb(), hsl(), with or without "#" — as "#rrggbb",
 * or null when it is not a colour (the field then shows an error and keeps the old value).
 * Alpha is dropped: transparency is the panel-opacity effect's job.
 */
export function normalizeHex(input: string): string | null {
  const raw = input.trim().toLowerCase();
  const withHash = /^[0-9a-f]{3}$|^[0-9a-f]{6}$/.test(raw) ? `#${raw}` : raw;
  const c = parseColor(withHash);
  if (!c || c.slice(0, 3).some((v) => !Number.isFinite(v))) return null;
  return `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = normalizeHex(hex) ?? "#000000";
  return [parseInt(n.slice(1, 3), 16), parseInt(n.slice(3, 5), 16), parseInt(n.slice(5, 7), 16)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export function hexToHsl(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [Math.round(h) % 360, Math.round(s * 100), Math.round(l * 100)];
}

export function hslToHex(h: number, s: number, l: number): string {
  return normalizeHex(`hsl(${h}, ${Math.max(0, Math.min(100, s))}%, ${Math.max(0, Math.min(100, l))}%)`) ?? "#000000";
}

export function isSwatchRef(value: string): boolean {
  return /^@\d$/.test(value);
}

/** A role or gradient value as a concrete "#rrggbb" (a missing swatch falls back to the first). */
export function resolveValue(theme: Pick<TerminalTheme, "palette">, value: string): string {
  if (isSwatchRef(value)) return theme.palette[Number(value.slice(1))] ?? theme.palette[0] ?? "#000000";
  return normalizeHex(value) ?? "#000000";
}

export function roleColor(theme: TerminalTheme, role: TerminalRole): string {
  return resolveValue(theme, theme.roles[role]);
}

export function resolveRoles(theme: TerminalTheme): Record<TerminalRole, string> {
  return Object.fromEntries(ROLE_IDS.map((r) => [r, roleColor(theme, r)])) as Record<TerminalRole, string>;
}

function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.round(Math.max(0, Math.min(1, alpha)) * 1000) / 1000})`;
}

/* ---------------------------------------------------------------
 * Edits — each returns a NEW theme (the input is never mutated)
 * ------------------------------------------------------------- */

const touch = (t: TerminalTheme, now: number): TerminalTheme => ({ ...t, updatedAt: now });

/** Give a role a swatch ("@3") or its own colour (any accepted notation). Invalid input changes nothing. */
export function setRole(theme: TerminalTheme, role: TerminalRole, value: string, now = Date.now()): TerminalTheme {
  let next: string | null;
  if (isSwatchRef(value)) next = Number(value.slice(1)) < theme.palette.length ? value : null;
  else next = normalizeHex(value);
  if (!next || theme.roles[role] === next) return theme;
  return touch({ ...theme, roles: { ...theme.roles, [role]: next } }, now);
}

/** Recolour one swatch: every role that points at it follows. */
export function setSwatch(theme: TerminalTheme, index: number, value: string, now = Date.now()): TerminalTheme {
  const hex = normalizeHex(value);
  if (!hex || index < 0 || index >= theme.palette.length || theme.palette[index] === hex) return theme;
  const palette = [...theme.palette];
  palette[index] = hex;
  return touch({ ...theme, palette }, now);
}

export function addSwatch(theme: TerminalTheme, value: string, now = Date.now()): TerminalTheme {
  const hex = normalizeHex(value);
  if (!hex || theme.palette.length >= MAX_SWATCHES) return theme;
  return touch({ ...theme, palette: [...theme.palette, hex] }, now);
}

/** Remove a swatch: roles that used it keep its colour as their own; later refs shift down. */
export function removeSwatch(theme: TerminalTheme, index: number, now = Date.now()): TerminalTheme {
  if (theme.palette.length <= MIN_SWATCHES || index < 0 || index >= theme.palette.length) return theme;
  const removed = theme.palette[index];
  const remap = (v: string) => {
    if (!isSwatchRef(v)) return v;
    const i = Number(v.slice(1));
    if (i === index) return removed;
    return i > index ? `@${i - 1}` : v;
  };
  const roles = Object.fromEntries(ROLE_IDS.map((r) => [r, remap(theme.roles[r])])) as TerminalTheme["roles"];
  const gradients: TerminalTheme["gradients"] = {};
  for (const [k, g] of Object.entries(theme.gradients)) if (g) gradients[k as GradientRole] = { ...g, to: remap(g.to) };
  return touch({ ...theme, palette: theme.palette.filter((_, i) => i !== index), roles, gradients }, now);
}

export function setGradient(theme: TerminalTheme, role: GradientRole, gradient: Gradient | null, now = Date.now()): TerminalTheme {
  const gradients = { ...theme.gradients };
  if (!gradient) {
    if (!gradients[role]) return theme;
    delete gradients[role];
  } else {
    const to = isSwatchRef(gradient.to) ? gradient.to : normalizeHex(gradient.to);
    if (!to) return theme;
    gradients[role] = { to, angle: ((Math.round(gradient.angle) % 360) + 360) % 360 };
  }
  return touch({ ...theme, gradients }, now);
}

export function setEffects(theme: TerminalTheme, patch: Partial<TerminalEffects>, now = Date.now()): TerminalTheme {
  const effects = readEffects({ ...theme.effects, ...patch });
  if (JSON.stringify(effects) === JSON.stringify(theme.effects)) return theme;
  return touch({ ...theme, effects }, now);
}

/** One role back to what the theme's base preset gives it. */
export function resetRole(theme: TerminalTheme, role: TerminalRole, now = Date.now()): TerminalTheme {
  const base = presetTheme(theme.base);
  const value = base.roles[role];
  // The preset's swatch ref only means the same colour if that swatch is unchanged; otherwise use the preset's colour.
  const resolved = isSwatchRef(value) && theme.palette[Number(value.slice(1))] === resolveValue(base, value) ? value : resolveValue(base, value);
  if (theme.roles[role] === resolved) return theme;
  return touch({ ...theme, roles: { ...theme.roles, [role]: resolved } }, now);
}

/** The whole theme back to its base preset (name, id and saved-ness kept). */
export function resetTheme(theme: TerminalTheme, now = Date.now()): TerminalTheme {
  const base = presetTheme(theme.base);
  return { ...base, id: theme.id, name: theme.name, custom: theme.custom, createdAt: theme.createdAt, updatedAt: now };
}

/** Monochrome contrast: 0 soft greys … 1 pure black and white. Recolours the grey swatches only. */
export function monochromeContrast(theme: TerminalTheme, amount: number, now = Date.now()): TerminalTheme {
  const a = Math.max(0, Math.min(1, amount));
  const grey = (l: number) => hslToHex(0, 0, l);
  const palette = [...theme.palette];
  const set = (i: number, l: number) => {
    if (i < palette.length) palette[i] = grey(Math.round(l));
  };
  set(0, 14 - 14 * a);
  set(1, 19 - 12 * a);
  set(2, 30 - 6 * a);
  set(3, 72 + 28 * a);
  set(4, 52 + 18 * a);
  set(5, 64 + 24 * a);
  set(6, 82 + 18 * a);
  return touch({ ...theme, palette }, now);
}

/* ---------------------------------------------------------------
 * To CSS
 * ------------------------------------------------------------- */

export interface ResolvedTerminal {
  colors: Record<TerminalRole, string>;
  vars: Record<string, string>;
}

/** CSS custom properties for the terminal root. Everything the terminal paints reads these. */
export function terminalVars(theme: TerminalTheme): ResolvedTerminal {
  const colors = resolveRoles(theme);
  const e = theme.effects;
  const vars: Record<string, string> = {};
  for (const r of ROLE_IDS) vars[`--rt-${r}`] = colors[r];
  // Surfaces: the panel opacity lets the live Cosmos through (0 = clear, 1 = solid).
  const surfaceAlpha = 0.25 + 0.75 * e.panelOpacity;
  for (const r of GRADIENT_ROLES) {
    const g = theme.gradients[r];
    const a = r === "bg" ? Math.min(1, surfaceAlpha * 0.9) : surfaceAlpha;
    vars[`--rt-${r}-fill`] = g ? `linear-gradient(${g.angle}deg, ${rgba(colors[r], a)}, ${rgba(resolveValue(theme, g.to), a)})` : rgba(colors[r], a);
  }
  vars["--rt-input-fill"] = rgba(colors.input, Math.min(1, surfaceAlpha + 0.1));
  vars["--rt-selected-fill"] = rgba(colors.selected, Math.min(1, surfaceAlpha + 0.1));
  const borderAlpha = 0.15 + 0.85 * e.borderIntensity;
  vars["--rt-border-c"] = rgba(colors.border, borderAlpha);
  vars["--rt-divider-c"] = rgba(colors.divider, Math.max(0.2, borderAlpha * 0.9));
  vars["--rt-border-w"] = e.borderIntensity > 0.8 ? "2px" : "1px";
  vars["--rt-glow"] = `${(e.glow * 10).toFixed(1)}px`;
  vars["--rt-glow-c"] = rgba(colors.accent1, 0.25 + 0.5 * e.glow);
  vars["--rt-glow-on"] = e.glow > 0 ? "1" : "0";
  vars["--rt-scan"] = (e.scanlines * 0.35).toFixed(3);
  vars["--rt-grid-c"] = rgba(colors.accent1, e.grid ? 0.08 : 0);
  vars["--rt-anim"] = e.animation.toFixed(2);
  vars["--rt-anim-ms"] = `${Math.round(120 + 260 * e.animation)}ms`;
  vars["--rt-radius"] = `${Math.round(e.radius)}px`;
  vars["--rt-gap"] = `${Math.round(4 + e.density * 10)}px`;
  vars["--rt-pad"] = `${Math.round(6 + e.density * 10)}px`;
  vars["--rt-size"] = `${e.fontSize}px`;
  vars["--rt-weight"] = String(Math.round(e.weight));
  const mono = (MONO_FONTS.find((f) => f.id === e.monoFont) ?? MONO_FONTS[0]).stack;
  vars["--rt-mono"] = mono;
  vars["--rt-font"] = e.font === "mono" ? mono : fontFor(e.font).stack === "inherit" ? mono : fontFor(e.font).stack;
  vars["--rt-focus"] = colors.accent1;
  return { colors, vars };
}

/* ---------------------------------------------------------------
 * Readability — reported, never silently overridden
 * ------------------------------------------------------------- */

export type ContrastLevel = "pass" | "large" | "fail";

export interface ContrastCheck {
  id: string;
  label: string;
  fg: TerminalRole;
  bg: TerminalRole;
  ratio: number;
  /** Text needs 4.5:1 (pass) — 3:1 is only enough for large text; UI graphics need 3:1. */
  level: ContrastLevel;
  /** "text" (4.5 / 3) or "ui" (3 / 1.5). */
  kind: "text" | "ui";
}

const CHECKS: Array<[TerminalRole, TerminalRole, "text" | "ui"]> = [
  ["text", "panel", "text"],
  ["text", "bg", "text"],
  ["text2", "panel", "text"],
  ["heading", "panel", "text"],
  ["label", "panel", "text"],
  ["numeric", "panel", "text"],
  ["highlight", "panel", "text"],
  ["warning", "panel", "text"],
  ["error", "panel", "text"],
  ["cmdInput", "input", "text"],
  ["cmdOutput", "footer", "text"],
  ["selectedText", "selected", "text"],
  ["navActive", "sidebar", "text"],
  ["text", "sidebar", "text"],
  ["text", "header", "text"],
  ["button", "panel", "text"],
  ["control", "panel", "ui"],
  ["accent1", "bg", "ui"],
  ["border", "panel", "ui"],
  ["selectedObject", "panel", "ui"],
  ["status", "panel", "ui"],
];

/**
 * Contrast of every text/background pair the terminal actually draws, against the
 * OPAQUE surface colour. With a low panel opacity the Cosmos behind changes the real
 * contrast; the studio says so next to the opacity slider.
 */
export function contrastReport(theme: TerminalTheme): ContrastCheck[] {
  const c = resolveRoles(theme);
  return CHECKS.map(([fg, bg, kind]) => {
    const ratio = Math.round(contrast(c[fg], c[bg]) * 100) / 100;
    const [pass, large] = kind === "text" ? [4.5, 3] : [3, 1.5];
    return { id: `${fg}/${bg}`, label: `${ROLE_LABEL[fg]} on ${ROLE_LABEL[bg].toLowerCase()}`, fg, bg, ratio, kind, level: ratio >= pass ? "pass" : ratio >= large ? "large" : "fail" };
  });
}

export function contrastSummary(theme: TerminalTheme): { fails: number; warnings: number; worst: ContrastCheck | null } {
  const report = contrastReport(theme);
  const fails = report.filter((c) => c.level === "fail").length;
  const warnings = report.filter((c) => c.level === "large").length;
  const worst = [...report].sort((a, b) => a.ratio - b.ratio)[0] ?? null;
  return { fails, warnings, worst };
}

/** The contrast of one role against the surface it is mostly drawn on (for the studio's per-role badge). */
export function roleContrast(theme: TerminalTheme, role: TerminalRole): ContrastCheck | null {
  return contrastReport(theme).find((c) => c.fg === role || (c.bg === role && c.kind === "text")) ?? null;
}

/* ---------------------------------------------------------------
 * Reading saved / imported data defensively
 * ------------------------------------------------------------- */

const clampNum = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);

export function readEffects(raw: unknown): TerminalEffects {
  const r = (raw && typeof raw === "object" ? raw : {}) as Partial<TerminalEffects>;
  const out = { ...DEFAULT_EFFECTS };
  out.font = typeof r.font === "string" && TERMINAL_BODY_FONTS.some((f) => f.id === r.font) ? r.font : DEFAULT_EFFECTS.font;
  out.monoFont = typeof r.monoFont === "string" && MONO_FONTS.some((f) => f.id === r.monoFont) ? r.monoFont : DEFAULT_EFFECTS.monoFont;
  out.grid = typeof r.grid === "boolean" ? r.grid : DEFAULT_EFFECTS.grid;
  for (const [k, [lo, hi]] of Object.entries(EFFECT_RANGES) as Array<[keyof typeof EFFECT_RANGES, [number, number]]>) {
    out[k] = clampNum(r[k], lo, hi, DEFAULT_EFFECTS[k]);
  }
  return out;
}

/** A saved or imported theme, read defensively: bad colours fall back to the base preset's, unknown fields are dropped. */
export function readTerminalTheme(raw: unknown): TerminalTheme | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<TerminalTheme>;
  const base: TerminalPresetId = typeof r.base === "string" && PRESET_IDS.has(r.base) ? (r.base as TerminalPresetId) : DEFAULT_PRESET;
  const fallback = presetTheme(base);
  const palette = Array.isArray(r.palette) ? r.palette.map((v) => (typeof v === "string" ? normalizeHex(v) : null)).filter((v): v is string => Boolean(v)).slice(0, MAX_SWATCHES) : [];
  const pal = palette.length >= MIN_SWATCHES ? palette : fallback.palette;
  const roleIn = (r.roles && typeof r.roles === "object" ? r.roles : {}) as Record<string, unknown>;
  const roles = {} as TerminalTheme["roles"];
  for (const id of ROLE_IDS) {
    const v = roleIn[id];
    if (typeof v === "string" && isSwatchRef(v) && Number(v.slice(1)) < pal.length) roles[id] = v;
    else if (typeof v === "string" && normalizeHex(v)) roles[id] = normalizeHex(v)!;
    else roles[id] = resolveValue(fallback, fallback.roles[id]);
  }
  const gradients: TerminalTheme["gradients"] = {};
  const gIn = (r.gradients && typeof r.gradients === "object" ? r.gradients : {}) as Record<string, unknown>;
  for (const id of GRADIENT_ROLES) {
    const g = gIn[id] as Partial<Gradient> | undefined;
    if (!g || typeof g.to !== "string") continue;
    const to = isSwatchRef(g.to) && Number(g.to.slice(1)) < pal.length ? g.to : normalizeHex(g.to);
    if (to) gradients[id] = { to, angle: clampNum(g.angle, 0, 360, 180) };
  }
  const id = typeof r.id === "string" && r.id.trim() ? r.id.slice(0, 80) : fallback.id;
  const name = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 60) : fallback.name;
  return {
    id,
    name,
    base,
    palette: pal,
    roles,
    gradients,
    effects: readEffects(r.effects),
    custom: r.custom === true,
    createdAt: clampNum(r.createdAt, 0, Number.MAX_SAFE_INTEGER, 0),
    updatedAt: clampNum(r.updatedAt, 0, Number.MAX_SAFE_INTEGER, 0),
  };
}

export const EXPORT_FORMAT = "lelu.terminal-theme";

/** A theme as a portable JSON document (export / share / back up). */
export function exportTheme(theme: TerminalTheme): string {
  const { id: _id, custom: _custom, createdAt: _c, updatedAt: _u, ...rest } = theme;
  return JSON.stringify({ format: EXPORT_FORMAT, version: 1, theme: rest }, null, 2);
}

/** Parse an exported theme (or a bare theme object). Never throws. */
export function importTheme(text: string): { ok: true; theme: TerminalTheme } | { ok: false; reason: string } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "That is not valid JSON." };
  }
  if (!data || typeof data !== "object") return { ok: false, reason: "That is not a theme." };
  const doc = data as { format?: unknown; theme?: unknown };
  if (doc.format !== undefined && doc.format !== EXPORT_FORMAT) return { ok: false, reason: `Unknown format "${String(doc.format)}".` };
  const inner = doc.theme ?? data;
  if (!inner || typeof inner !== "object" || !Array.isArray((inner as { palette?: unknown }).palette)) return { ok: false, reason: "No palette found in that theme." };
  const theme = readTerminalTheme(inner);
  return theme ? { ok: true, theme } : { ok: false, reason: "That theme could not be read." };
}

let themeCounter = 0;
export function newTerminalThemeId(now = Date.now()): string {
  themeCounter += 1;
  return `tt-${now.toString(36)}-${themeCounter.toString(36)}`;
}

/**
 * The Home's own module variables (homeStyle's --glass, --ink, …) mapped onto the
 * terminal theme, so the live modules inside the terminal wear its colours without
 * a second module renderer.
 */
export function homeSkinVars(theme: TerminalTheme): Record<string, string> {
  const { colors, vars } = terminalVars(theme);
  const surfaceAlpha = 0.25 + 0.75 * theme.effects.panelOpacity;
  return {
    "--glass": rgba(colors.panel, surfaceAlpha),
    "--glass-strong": rgba(colors.panel, Math.min(1, surfaceAlpha + 0.1)),
    "--edge": vars["--rt-border-c"],
    "--edge-hi": colors.accent1,
    "--ink": colors.text,
    "--ink-2": colors.text2,
    "--ink-3": colors.label,
    "--magenta": colors.accent1,
    "--violet": colors.accent2,
    "--accent": colors.accent1,
    "--hc-accent2": colors.accent2,
    "--radius": vars["--rt-radius"],
    "--hc-font": vars["--rt-font"],
    "--hc-heading": vars["--rt-font"],
  };
}
