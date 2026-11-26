/**
 * ==========================================================
 * LÉLU — INFINITE COSMOS DESIGN LANGUAGES
 *
 * A Home layout (home/homeComposition TEMPLATES — the ONE layout
 * registry) may name a design LANGUAGE. The language decides how every
 * workspace window looks and is composed while that layout is active.
 * This file adds no second layout registry: it only describes the
 * languages a layout can point at, keyed by id.
 *
 * Two separate layers, on purpose:
 *
 *   COMPOSITION  the structure — window chrome, how the Browser places its
 *                tabs and address, how Settings navigates, how the Neural
 *                Map lays out nodes and links, how a panel heading reads.
 *                A composition is a genuinely different implementation
 *                (the components switch on it), shared by languages that
 *                are structurally compatible.
 *   LANGUAGE     the look — palette, type, material, rule weight, pattern —
 *                compiled through the EXISTING design-token compiler
 *                (DesignTokens.tokensToCssVariables) plus a small set of
 *                `--cl-*` variables the composition CSS reads.
 *
 * The default language ("cosmic") emits NO variables: with it the
 * Cosmos is byte-for-byte what it was before this layer existed.
 *
 * Pure: no React, no DOM, no storage.
 * ==========================================================
 */

import { DEFAULT_TOKENS, mergeTokens, tokensToCssVariables, type DeepPartial, type DesignTokens } from "./DesignTokens";

/* ------------------------------------------------------------------ *
 * COMPOSITIONS — structure
 * ------------------------------------------------------------------ */

export type WindowComposition = "glass" | "console" | "grid" | "editorial" | "slab" | "scroll" | "hud" | "bezel" | "organic";

export interface CompositionSpec {
  id: WindowComposition;
  name: string;
  blurb: string;
  chrome: {
    /** Where the window's title sits. */
    title: "left" | "center" | "vertical" | "prompt" | "plate" | "bracket";
    /** How the window controls are drawn. */
    controls: "icons" | "text" | "keys" | "lamps" | "blocks" | "dots";
  };
  browser: {
    tabs: "top" | "left" | "right" | "bottom" | "line";
    address: "field" | "prompt" | "headline" | "block" | "reticle" | "plate" | "pebble";
    actions: "chips" | "fkeys" | "footnotes" | "blocks" | "switches" | "stamps";
    /** A masthead/readout above the page, drawn only by compositions that want one. */
    masthead: boolean;
  };
  settings: {
    nav: "none" | "command" | "index" | "contents" | "tabs" | "vertical" | "dial" | "switchboard" | "pebbles";
    /** Paged: only the chosen section is shown (every control stays mounted). */
    paged: boolean;
  };
  neural: {
    layout: "ring" | "list" | "grid" | "columns" | "spiral" | "vertical" | "radar" | "matrix" | "cluster";
    node: "circle" | "text" | "square" | "serif" | "block" | "seal" | "reticle" | "lamp" | "blob";
    link: "straight" | "orthogonal" | "hairline" | "heavy" | "brush" | "dashed" | "wire" | "curve";
  };
  /** How a panel's own heading (GenesisWindowFrame in a window) reads. */
  heading: "plain" | "prompt" | "numbered" | "headline" | "block" | "vertical" | "bracket" | "plate" | "soft";
}

export const COMPOSITIONS: Record<WindowComposition, CompositionSpec> = {
  glass: {
    id: "glass",
    name: "Floating glass",
    blurb: "The original LÉLU window: a glass card floating over the Cosmos.",
    chrome: { title: "center", controls: "icons" },
    browser: { tabs: "top", address: "field", actions: "chips", masthead: false },
    settings: { nav: "none", paged: false },
    neural: { layout: "ring", node: "circle", link: "straight" },
    heading: "plain",
  },
  console: {
    id: "console",
    name: "Console",
    blurb: "Text-mode: box-drawn frames, a prompt for every address, function keys for actions.",
    chrome: { title: "prompt", controls: "keys" },
    browser: { tabs: "line", address: "prompt", actions: "fkeys", masthead: true },
    settings: { nav: "command", paged: true },
    neural: { layout: "list", node: "text", link: "orthogonal" },
    heading: "prompt",
  },
  grid: {
    id: "grid",
    name: "Modular grid",
    blurb: "A strict grid: an index column, numbered sections, flush-left type and hard rules.",
    chrome: { title: "left", controls: "text" },
    browser: { tabs: "left", address: "headline", actions: "chips", masthead: true },
    settings: { nav: "index", paged: false },
    neural: { layout: "grid", node: "square", link: "orthogonal" },
    heading: "numbered",
  },
  editorial: {
    id: "editorial",
    name: "Editorial",
    blurb: "A printed page: masthead, contents, columns, hairline rules and footnotes.",
    chrome: { title: "center", controls: "text" },
    browser: { tabs: "top", address: "headline", actions: "footnotes", masthead: true },
    settings: { nav: "contents", paged: false },
    neural: { layout: "columns", node: "serif", link: "hairline" },
    heading: "headline",
  },
  slab: {
    id: "slab",
    name: "Slab",
    blurb: "Heavy blocks, hard shadows and loud tabs — form follows force.",
    chrome: { title: "left", controls: "blocks" },
    browser: { tabs: "top", address: "block", actions: "blocks", masthead: false },
    settings: { nav: "tabs", paged: true },
    neural: { layout: "matrix", node: "block", link: "heavy" },
    heading: "block",
  },
  scroll: {
    id: "scroll",
    name: "Hanging scroll",
    blurb: "Vertical titles, a seal, generous emptiness and a right-to-left index.",
    chrome: { title: "vertical", controls: "dots" },
    browser: { tabs: "right", address: "field", actions: "stamps", masthead: false },
    settings: { nav: "vertical", paged: true },
    neural: { layout: "vertical", node: "seal", link: "brush" },
    heading: "vertical",
  },
  hud: {
    id: "hud",
    name: "Instrument HUD",
    blurb: "Bracketed corners, scales and readouts: windows as instruments.",
    chrome: { title: "bracket", controls: "keys" },
    browser: { tabs: "bottom", address: "reticle", actions: "chips", masthead: true },
    settings: { nav: "dial", paged: true },
    neural: { layout: "radar", node: "reticle", link: "dashed" },
    heading: "bracket",
  },
  bezel: {
    id: "bezel",
    name: "Control bezel",
    blurb: "Screwed steel plates, status lamps, LED readouts and a switchboard.",
    chrome: { title: "plate", controls: "lamps" },
    browser: { tabs: "top", address: "plate", actions: "switches", masthead: true },
    settings: { nav: "switchboard", paged: true },
    neural: { layout: "matrix", node: "lamp", link: "wire" },
    heading: "plate",
  },
  organic: {
    id: "organic",
    name: "Biomorphic",
    blurb: "Soft cells and pebbles that grow around the content; nothing is square.",
    chrome: { title: "left", controls: "dots" },
    browser: { tabs: "top", address: "pebble", actions: "chips", masthead: false },
    settings: { nav: "pebbles", paged: false },
    neural: { layout: "cluster", node: "blob", link: "curve" },
    heading: "soft",
  },
};

/* ------------------------------------------------------------------ *
 * LANGUAGES — look
 * ------------------------------------------------------------------ */

export type CosmosLanguageId =
  | "cosmic"
  | "terminal"
  | "swiss"
  | "bauhaus"
  | "editorial"
  | "artdeco"
  | "exhibition"
  | "brutalist"
  | "constructivist"
  | "memphis"
  | "japanese"
  | "y2k"
  | "organic"
  | "scifi"
  | "observatory"
  | "industrial";

export interface LanguagePalette {
  /** Window paper/surface. */
  paper: string;
  /** Inset surfaces (cards, inputs). */
  paper2: string;
  ink: string;
  ink2: string;
  accent: string;
  accent2: string;
  accent3: string;
  /** Rules and borders. */
  rule: string;
  /** The window's outer frame colour. */
  frame: string;
  /** Title-bar fill. */
  bar: string;
  barInk: string;
  danger: string;
}

export interface CosmosLanguage {
  id: CosmosLanguageId;
  name: string;
  /** The design territory it comes from. */
  territory: string;
  blurb: string;
  composition: WindowComposition;
  tone: "light" | "dark";
  palette: LanguagePalette;
  fonts: { body: string; heading: string; mono: string };
  /** Rule weight (px), corner radius (px), heading case/tracking/weight. */
  shape: { rule: number; radius: number; headCase: "none" | "uppercase" | "lowercase"; headTrack: string; headWeight: number };
  /** Window shadow (a full CSS box-shadow). */
  shadow: string;
  /** Optional background pattern for the window paper (CSS image). */
  pattern?: string;
}

const SANS_SWISS = `"Helvetica Neue", Helvetica, "Nimbus Sans", Arial, "Liberation Sans", sans-serif`;
const GEOMETRIC = `Futura, "Century Gothic", "Avenir Next", "URW Gothic", "Trebuchet MS", sans-serif`;
const DIDONE = `Didot, "Bodoni 72", "Bodoni MT", "Playfair Display", "DejaVu Serif", Georgia, serif`;
const BOOK = `"Iowan Old Style", Palatino, "Palatino Linotype", "Book Antiqua", Georgia, "DejaVu Serif", serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace`;
const GROTESK_HEAVY = `"Arial Black", "Helvetica Neue", Impact, "Liberation Sans", sans-serif`;
const CONDENSED = `Impact, Haettenschweiler, "Arial Narrow", "Roboto Condensed", "Liberation Sans Narrow", sans-serif`;
const ROUNDED = `"Arial Rounded MT Bold", ui-rounded, "Nunito", "Varela Round", "Trebuchet MS", sans-serif`;
const MINCHO = `"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif CJK JP", "Noto Serif JP", "DejaVu Serif", serif`;
const KAKU = `"Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", "Noto Sans JP", "Helvetica Neue", sans-serif`;
const Y2K = `Verdana, Tahoma, "Trebuchet MS", "DejaVu Sans", sans-serif`;
const HUMANIST = `Optima, Candara, "Gill Sans", "Noto Sans", "Segoe UI", sans-serif`;
const TECH = `Eurostile, "Microgramma", "Bank Gothic", "Orbitron", "Arial Narrow", "DejaVu Sans Condensed", sans-serif`;
const DIN = `"DIN Alternate", DIN, Bahnschrift, "Roboto Condensed", "Arial Narrow", "DejaVu Sans Condensed", sans-serif`;
const SERIF_SCI = `Baskerville, "Libre Baskerville", "Times New Roman", "DejaVu Serif", serif`;
const LIGHT_SANS = `"Avenir Next", Avenir, "Helvetica Neue", "Segoe UI", "Liberation Sans", sans-serif`;

export const LANGUAGES: CosmosLanguage[] = [
  {
    id: "cosmic",
    name: "Cosmic glass",
    territory: "The original LÉLU look",
    blurb: "Violet glass floating over the live Cosmos — the default, unchanged.",
    composition: "glass",
    tone: "dark",
    palette: { paper: "#060e20", paper2: "#1e293b", ink: "#e2e8f0", ink2: "#94a3b8", accent: "#67e8f9", accent2: "#a78bfa", accent3: "#f472b6", rule: "#67e8f9", frame: "#67e8f9", bar: "#081026", barInk: "#dbeafe", danger: "#f87171" },
    fonts: { body: "inherit", heading: "inherit", mono: MONO },
    shape: { rule: 1, radius: 16, headCase: "uppercase", headTrack: "0.1em", headWeight: 700 },
    shadow: "none",
  },
  {
    id: "terminal",
    name: "Retro Terminal",
    territory: "Retro computing and terminal environments",
    blurb: "Phosphor on black, box-drawn panes, prompts and function keys — in her own terminal colours.",
    composition: "console",
    tone: "dark",
    palette: { paper: "#05080a", paper2: "#0b1410", ink: "#7dffa0", ink2: "#3fae63", accent: "#ffb000", accent2: "#5ad1ff", accent3: "#ff5f87", rule: "#2a6b3f", frame: "#3fae63", bar: "#0b1410", barInk: "#7dffa0", danger: "#ff5f5f" },
    fonts: { body: MONO, heading: MONO, mono: MONO },
    shape: { rule: 1, radius: 0, headCase: "uppercase", headTrack: "0.08em", headWeight: 700 },
    shadow: "0 0 0 1px rgba(0,0,0,0.6), 0 0 28px rgba(60, 255, 120, 0.12)",
    pattern: "repeating-linear-gradient(0deg, rgba(0,0,0,0.22) 0px, rgba(0,0,0,0.22) 1px, transparent 1px, transparent 3px)",
  },
  {
    id: "swiss",
    name: "Swiss International",
    territory: "Swiss and International Typographic Style",
    blurb: "White paper, black grotesk, one red, a strict grid and numbered sections.",
    composition: "grid",
    tone: "light",
    palette: { paper: "#ffffff", paper2: "#f2f2f2", ink: "#111111", ink2: "#555555", accent: "#e30613", accent2: "#111111", accent3: "#e30613", rule: "#111111", frame: "#111111", bar: "#ffffff", barInk: "#111111", danger: "#e30613" },
    fonts: { body: SANS_SWISS, heading: SANS_SWISS, mono: MONO },
    shape: { rule: 2, radius: 0, headCase: "none", headTrack: "-0.01em", headWeight: 800 },
    shadow: "0 1px 0 #111111, 0 18px 40px rgba(0,0,0,0.18)",
  },
  {
    id: "bauhaus",
    name: "Bauhaus Workshop",
    territory: "Bauhaus and modernism",
    blurb: "Cream ground, primary red, blue and yellow, circles and squares, geometric type.",
    composition: "grid",
    tone: "light",
    palette: { paper: "#f2ead8", paper2: "#e7dcc3", ink: "#1a1a1a", ink2: "#4a4438", accent: "#d62828", accent2: "#1d4e9e", accent3: "#f2c12e", rule: "#1a1a1a", frame: "#1a1a1a", bar: "#1d4e9e", barInk: "#f2ead8", danger: "#d62828" },
    fonts: { body: GEOMETRIC, heading: GEOMETRIC, mono: MONO },
    shape: { rule: 3, radius: 0, headCase: "lowercase", headTrack: "0.02em", headWeight: 700 },
    shadow: "10px 10px 0 #f2c12e, 0 16px 40px rgba(0,0,0,0.25)",
    pattern: "radial-gradient(circle at 100% 0%, rgba(214,40,40,0.14) 0 70px, transparent 71px), linear-gradient(90deg, transparent calc(100% - 8px), rgba(29,78,158,0.9) calc(100% - 8px))",
  },
  {
    id: "editorial",
    name: "Editorial Magazine",
    territory: "Editorial and magazine composition",
    blurb: "Newsprint cream, Didone headlines, hairline rules, columns, contents and footnotes.",
    composition: "editorial",
    tone: "light",
    palette: { paper: "#f7f2e7", paper2: "#efe7d6", ink: "#1b1713", ink2: "#5b5249", accent: "#9b1c1c", accent2: "#1b1713", accent3: "#b7791f", rule: "#1b1713", frame: "#1b1713", bar: "#f7f2e7", barInk: "#1b1713", danger: "#9b1c1c" },
    fonts: { body: BOOK, heading: DIDONE, mono: MONO },
    shape: { rule: 1, radius: 0, headCase: "none", headTrack: "-0.01em", headWeight: 700 },
    shadow: "0 1px 2px rgba(0,0,0,0.25), 0 24px 50px rgba(40,25,10,0.28)",
  },
  {
    id: "artdeco",
    name: "Art Deco Salon",
    territory: "Art Deco",
    blurb: "Black lacquer and gold leaf, stepped corners, symmetric capitals and fan motifs.",
    composition: "editorial",
    tone: "dark",
    palette: { paper: "#0d0d0f", paper2: "#17161a", ink: "#f3e7c4", ink2: "#b9a77a", accent: "#c9a44c", accent2: "#1f5c4a", accent3: "#e8d08a", rule: "#c9a44c", frame: "#c9a44c", bar: "#0d0d0f", barInk: "#e8d08a", danger: "#d1604f" },
    fonts: { body: LIGHT_SANS, heading: DIDONE, mono: MONO },
    shape: { rule: 1, radius: 0, headCase: "uppercase", headTrack: "0.28em", headWeight: 500 },
    shadow: "0 0 0 4px #0d0d0f, 0 0 0 5px #c9a44c, 0 28px 60px rgba(0,0,0,0.6)",
    pattern: "repeating-radial-gradient(circle at 50% 120%, rgba(201,164,76,0.07) 0 2px, transparent 2px 18px)",
  },
  {
    id: "exhibition",
    name: "Exhibition Hall",
    territory: "Architectural and exhibition spaces",
    blurb: "A white cube: vast margins, light type, wall labels and one quiet line.",
    composition: "editorial",
    tone: "light",
    palette: { paper: "#fafaf8", paper2: "#f1f1ee", ink: "#222222", ink2: "#7a7a76", accent: "#222222", accent2: "#9a9a94", accent3: "#c4b49a", rule: "#d6d6d0", frame: "#e4e4df", bar: "#fafaf8", barInk: "#222222", danger: "#b3261e" },
    fonts: { body: LIGHT_SANS, heading: LIGHT_SANS, mono: MONO },
    shape: { rule: 1, radius: 0, headCase: "none", headTrack: "0.01em", headWeight: 300 },
    shadow: "0 40px 80px rgba(0,0,0,0.12), 0 2px 6px rgba(0,0,0,0.06)",
  },
  {
    id: "brutalist",
    name: "Neo-Brutalist",
    territory: "Brutalist and neo-brutalist interfaces",
    blurb: "Raw black outlines, hard offset shadows, flat yellow and pink, shouting labels.",
    composition: "slab",
    tone: "light",
    palette: { paper: "#fffdf5", paper2: "#ffffff", ink: "#000000", ink2: "#333333", accent: "#ffde03", accent2: "#ff4fa3", accent3: "#2b6bff", rule: "#000000", frame: "#000000", bar: "#ffde03", barInk: "#000000", danger: "#ff3b30" },
    fonts: { body: MONO, heading: GROTESK_HEAVY, mono: MONO },
    shape: { rule: 3, radius: 0, headCase: "uppercase", headTrack: "0.02em", headWeight: 900 },
    shadow: "8px 8px 0 #000000",
  },
  {
    id: "constructivist",
    name: "Constructivist Poster",
    territory: "Constructivism",
    blurb: "Red and black on raw paper, diagonal bars, condensed capitals, agitprop energy.",
    composition: "slab",
    tone: "light",
    palette: { paper: "#efe6d2", paper2: "#e5d9bf", ink: "#111111", ink2: "#3d3528", accent: "#c8102e", accent2: "#111111", accent3: "#c8102e", rule: "#111111", frame: "#111111", bar: "#c8102e", barInk: "#efe6d2", danger: "#c8102e" },
    fonts: { body: SANS_SWISS, heading: CONDENSED, mono: MONO },
    shape: { rule: 3, radius: 0, headCase: "uppercase", headTrack: "0.04em", headWeight: 900 },
    shadow: "-6px 6px 0 #c8102e, 0 18px 40px rgba(0,0,0,0.3)",
    pattern: "linear-gradient(115deg, transparent 0 78%, rgba(200,16,46,0.12) 78% 86%, transparent 86%)",
  },
  {
    id: "memphis",
    name: "Memphis Milano",
    territory: "Memphis design",
    blurb: "Confetti and squiggles, candy colours, rounded type and offset colour shadows.",
    composition: "slab",
    tone: "light",
    palette: { paper: "#fff7f0", paper2: "#ffffff", ink: "#1d1d1b", ink2: "#4b4b47", accent: "#ff6b9d", accent2: "#00c2c7", accent3: "#ffd23f", rule: "#1d1d1b", frame: "#1d1d1b", bar: "#00c2c7", barInk: "#1d1d1b", danger: "#ff3b30" },
    fonts: { body: ROUNDED, heading: ROUNDED, mono: MONO },
    shape: { rule: 2, radius: 18, headCase: "none", headTrack: "0", headWeight: 800 },
    shadow: "7px 7px 0 #ff6b9d, 14px 14px 0 #1d1d1b",
    pattern: "radial-gradient(circle at 12px 12px, rgba(108,92,231,0.35) 2.5px, transparent 3px) 0 0 / 46px 46px, radial-gradient(circle at 34px 30px, rgba(255,210,63,0.6) 3px, transparent 3.5px) 0 0 / 46px 46px",
  },
  {
    id: "japanese",
    name: "Japanese Ma",
    territory: "Japanese graphic design",
    blurb: "Washi paper, sumi ink, one vermilion seal, vertical titles and deliberate emptiness.",
    composition: "scroll",
    tone: "light",
    palette: { paper: "#f5f0e6", paper2: "#ece5d6", ink: "#1c1c1c", ink2: "#6b645a", accent: "#c73e3a", accent2: "#2f4b7c", accent3: "#b89b5e", rule: "#1c1c1c", frame: "#d9d0bf", bar: "#f5f0e6", barInk: "#1c1c1c", danger: "#c73e3a" },
    fonts: { body: KAKU, heading: MINCHO, mono: MONO },
    shape: { rule: 1, radius: 2, headCase: "none", headTrack: "0.12em", headWeight: 500 },
    shadow: "0 30px 60px rgba(60,40,20,0.18)",
  },
  {
    id: "y2k",
    name: "Y2K Aqua",
    territory: "Memphis-to-Y2K, glass and liquid materials",
    blurb: "Brushed chrome, aqua gel buttons, lime highlights and glossy pills — circa 2000.",
    composition: "glass",
    tone: "light",
    palette: { paper: "#dfe7f0", paper2: "#f4f8fc", ink: "#0a2540", ink2: "#3c5875", accent: "#0096ff", accent2: "#8ee000", accent3: "#ff4fd8", rule: "#7f9bb8", frame: "#6d87a3", bar: "#b9c8d8", barInk: "#0a2540", danger: "#e0245e" },
    fonts: { body: Y2K, heading: Y2K, mono: MONO },
    shape: { rule: 1, radius: 14, headCase: "none", headTrack: "0", headWeight: 700 },
    shadow: "0 1px 0 rgba(255,255,255,0.9) inset, 0 18px 40px rgba(10,37,64,0.35)",
    pattern: "repeating-linear-gradient(90deg, rgba(255,255,255,0.18) 0 1px, transparent 1px 3px), linear-gradient(180deg, #eef3f9, #c6d3e1)",
  },
  {
    id: "organic",
    name: "Organic Biome",
    territory: "Organic and biomorphic composition",
    blurb: "Sage and clay, cell-shaped windows, pebble controls and tendril links.",
    composition: "organic",
    tone: "light",
    palette: { paper: "#eef0e4", paper2: "#e2e6d2", ink: "#2f3a2a", ink2: "#5f6b55", accent: "#6b8f4e", accent2: "#c97b52", accent3: "#9fb8a0", rule: "#9fae8c", frame: "#9fae8c", bar: "#dde3cc", barInk: "#2f3a2a", danger: "#b5523b" },
    fonts: { body: HUMANIST, heading: BOOK, mono: MONO },
    shape: { rule: 1, radius: 28, headCase: "none", headTrack: "0", headWeight: 600 },
    shadow: "0 22px 50px rgba(47,58,42,0.28)",
    pattern: "radial-gradient(ellipse at 0% 100%, rgba(107,143,78,0.16), transparent 55%), radial-gradient(ellipse at 100% 0%, rgba(201,123,82,0.12), transparent 50%)",
  },
  {
    id: "scifi",
    name: "Futurist HUD",
    territory: "Futurist and science-fiction environments",
    blurb: "Cyan wireframe on deep space, chamfered corners, scan lines and targeting reticles.",
    composition: "hud",
    tone: "dark",
    palette: { paper: "#03090f", paper2: "#071822", ink: "#b9f6ff", ink2: "#5fa9b8", accent: "#00e5ff", accent2: "#ff3d6e", accent3: "#f5d90a", rule: "#00e5ff", frame: "#00e5ff", bar: "#03131c", barInk: "#00e5ff", danger: "#ff3d6e" },
    fonts: { body: TECH, heading: TECH, mono: MONO },
    shape: { rule: 1, radius: 0, headCase: "uppercase", headTrack: "0.22em", headWeight: 600 },
    shadow: "0 0 0 1px rgba(0,229,255,0.35), 0 0 36px rgba(0,229,255,0.18)",
    pattern: "repeating-linear-gradient(0deg, rgba(0,229,255,0.05) 0 1px, transparent 1px 4px)",
  },
  {
    id: "observatory",
    name: "Observatory",
    territory: "Astronomical and scientific instrumentation",
    blurb: "Night navy and brass, graticule grids, coordinates and engraved serif labels.",
    composition: "hud",
    tone: "dark",
    palette: { paper: "#0b1426", paper2: "#101d36", ink: "#e8dfc8", ink2: "#a99f86", accent: "#c8a15a", accent2: "#7fb3d5", accent3: "#e9c46a", rule: "#c8a15a", frame: "#8a6f3c", bar: "#0e1a31", barInk: "#e8dfc8", danger: "#e07a5f" },
    fonts: { body: SERIF_SCI, heading: SERIF_SCI, mono: MONO },
    shape: { rule: 1, radius: 4, headCase: "uppercase", headTrack: "0.18em", headWeight: 500 },
    shadow: "0 0 0 3px #0b1426, 0 0 0 4px rgba(200,161,90,0.55), 0 24px 60px rgba(0,0,0,0.55)",
    pattern: "linear-gradient(rgba(200,161,90,0.07) 1px, transparent 1px) 0 0 / 32px 32px, linear-gradient(90deg, rgba(200,161,90,0.07) 1px, transparent 1px) 0 0 / 32px 32px",
  },
  {
    id: "industrial",
    name: "Industrial Control",
    territory: "Industrial control systems",
    blurb: "Steel plates and screws, amber LED readouts, status lamps, hazard stripes and switches.",
    composition: "bezel",
    tone: "dark",
    palette: { paper: "#2b2f33", paper2: "#1e2124", ink: "#e6e6e1", ink2: "#a3a7a8", accent: "#ffb000", accent2: "#39d353", accent3: "#ff3b30", rule: "#4a4f55", frame: "#5b6168", bar: "#3a3f45", barInk: "#e6e6e1", danger: "#ff3b30" },
    fonts: { body: DIN, heading: DIN, mono: MONO },
    shape: { rule: 2, radius: 3, headCase: "uppercase", headTrack: "0.12em", headWeight: 700 },
    shadow: "inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -2px 0 rgba(0,0,0,0.4), 0 16px 40px rgba(0,0,0,0.5)",
    pattern: "linear-gradient(180deg, rgba(255,255,255,0.04), rgba(0,0,0,0.08)), repeating-linear-gradient(90deg, rgba(255,255,255,0.015) 0 2px, transparent 2px 4px)",
  },
];

const BY_ID = new Map(LANGUAGES.map((l) => [l.id, l]));
export const DEFAULT_LANGUAGE: CosmosLanguageId = "cosmic";

export function isLanguageId(id: unknown): id is CosmosLanguageId {
  return typeof id === "string" && BY_ID.has(id as CosmosLanguageId);
}

export function languageFor(id: string | undefined | null): CosmosLanguage {
  return BY_ID.get((id ?? DEFAULT_LANGUAGE) as CosmosLanguageId) ?? BY_ID.get(DEFAULT_LANGUAGE)!;
}

export function compositionFor(id: string | undefined | null): CompositionSpec {
  return COMPOSITIONS[languageFor(id).composition];
}

/**
 * The language a layout speaks: its own `language`, else the Retro
 * Terminal's console for any terminal composition, else the original glass.
 */
export function languageOfLayout(layout: { language?: string; kind?: Partial<Record<string, string>> } | null | undefined): CosmosLanguageId {
  if (layout?.language && isLanguageId(layout.language)) return layout.language;
  if (layout?.kind && Object.values(layout.kind).includes("terminal")) return "terminal";
  return DEFAULT_LANGUAGE;
}

/* ------------------------------------------------------------------ *
 * Compiling a language to CSS custom properties
 * ------------------------------------------------------------------ */

const HEX = /^#[0-9a-f]{6}$/i;

/** Colours a terminal theme supplies (resolved roles), when the language is "terminal". */
export interface TerminalColours {
  bg?: string;
  bg2?: string;
  panel?: string;
  header?: string;
  text?: string;
  text2?: string;
  heading?: string;
  accent1?: string;
  accent2?: string;
  accent3?: string;
  border?: string;
  divider?: string;
  error?: string;
}

/** The terminal language follows her own terminal theme, colour for colour. */
export function terminalPalette(base: LanguagePalette, roles: TerminalColours | null | undefined): LanguagePalette {
  if (!roles) return base;
  const pick = (v: string | undefined, d: string) => (v && HEX.test(v) ? v : d);
  return {
    paper: pick(roles.bg, base.paper),
    paper2: pick(roles.panel ?? roles.bg2, base.paper2),
    ink: pick(roles.text, base.ink),
    ink2: pick(roles.text2, base.ink2),
    accent: pick(roles.accent1, base.accent),
    accent2: pick(roles.accent2, base.accent2),
    accent3: pick(roles.accent3, base.accent3),
    rule: pick(roles.divider ?? roles.border, base.rule),
    frame: pick(roles.border, base.frame),
    bar: pick(roles.header ?? roles.bg2, base.bar),
    barInk: pick(roles.heading ?? roles.text, base.barInk),
    danger: pick(roles.error, base.danger),
  };
}

function tokensForLanguage(lang: CosmosLanguage, p: LanguagePalette): DeepPartial<DesignTokens> {
  const hex = (v: string, d: string) => (HEX.test(v) ? v : d);
  return {
    palette: {
      background: hex(p.paper, DEFAULT_TOKENS.palette.background),
      surface: hex(p.paper, DEFAULT_TOKENS.palette.surface),
      surfaceAlt: hex(p.paper2, DEFAULT_TOKENS.palette.surfaceAlt),
      text: hex(p.ink, DEFAULT_TOKENS.palette.text),
      textMuted: hex(p.ink2, DEFAULT_TOKENS.palette.textMuted),
      accent: hex(p.accent, DEFAULT_TOKENS.palette.accent),
      accentSoft: hex(p.accent2, DEFAULT_TOKENS.palette.accentSoft),
      border: hex(p.rule, DEFAULT_TOKENS.palette.border),
      glow: hex(p.accent, DEFAULT_TOKENS.palette.glow),
      danger: hex(p.danger, DEFAULT_TOKENS.palette.danger),
    },
    materials: {
      surfaceOpacity: 1,
      blur: 0,
      borderWidth: lang.shape.rule,
      borderOpacity: 1,
      radius: lang.shape.radius,
      windowShape: lang.composition === "organic" ? "organic" : lang.shape.radius === 0 ? "rect" : "rounded",
      shadowDepth: 0.4,
      glowStrength: 0,
      gradientAngle: 180,
    },
    typography: { textAlign: "left", headingCase: lang.shape.headCase === "lowercase" ? "lowercase" : lang.shape.headCase === "uppercase" ? "uppercase" : "none" },
  };
}

/**
 * Every CSS custom property the language sets on the surfaces it owns
 * (windows, the Neural Map, the Home). The design-token compiler produces
 * the `--lelu-*` set every Genesis panel already reads; the `--cl-*` set is
 * what the composition stylesheet reads. "cosmic" returns nothing.
 */
export function languageVariables(
  id: string,
  options: { mobile?: boolean; reducedMotion?: boolean; terminal?: TerminalColours | null } = {},
): Record<string, string> {
  const lang = languageFor(id);
  if (lang.id === DEFAULT_LANGUAGE) return {};
  const p = lang.id === "terminal" ? terminalPalette(lang.palette, options.terminal) : lang.palette;
  const { tokens } = mergeTokens(DEFAULT_TOKENS, tokensForLanguage(lang, p));
  const compiled = tokensToCssVariables(tokens, {}, { mobile: options.mobile, reducedMotion: options.reducedMotion });
  const vars: Record<string, string> = { ...compiled.variables };
  // System stacks only: nothing is downloaded for a language.
  vars["--lelu-font-body"] = lang.fonts.body;
  vars["--lelu-font-heading"] = lang.fonts.heading;
  vars["--lelu-font-mono"] = lang.fonts.mono;
  vars["--lelu-surface-bg"] = lang.pattern ? `${lang.pattern}, ${p.paper}` : p.paper;
  vars["--lelu-chrome-bg"] = p.bar;
  vars["--lelu-shadow"] = lang.shadow;
  vars["--lelu-backdrop"] = "none";
  Object.assign(vars, {
    "--cl-paper": p.paper,
    "--cl-paper-2": p.paper2,
    "--cl-ink": p.ink,
    "--cl-ink-2": p.ink2,
    "--cl-accent": p.accent,
    "--cl-accent-2": p.accent2,
    "--cl-accent-3": p.accent3,
    "--cl-rule": p.rule,
    "--cl-frame": p.frame,
    "--cl-bar": p.bar,
    "--cl-bar-ink": p.barInk,
    "--cl-danger": p.danger,
    "--cl-rule-w": `${lang.shape.rule}px`,
    "--cl-radius": `${lang.shape.radius}px`,
    "--cl-font": lang.fonts.body,
    "--cl-font-head": lang.fonts.heading,
    "--cl-font-mono": lang.fonts.mono,
    "--cl-head-case": lang.shape.headCase,
    "--cl-head-track": lang.shape.headTrack,
    "--cl-head-weight": String(lang.shape.headWeight),
    "--cl-shadow": lang.shadow,
    "--cl-pattern": lang.pattern ?? "none",
  });
  return vars;
}

/* ------------------------------------------------------------------ *
 * The window matrix — how each registered window takes part
 * ------------------------------------------------------------------ */

export type WindowRole = "browser" | "map" | "settings" | "conversation" | "document" | "files" | "studio" | "canvas" | "board" | "list" | "dashboard" | "tools";

export interface WindowParticipation {
  role: WindowRole;
  /**
   * dedicated  the window's own component switches on the composition
   *            (structure changes: placement, navigation, node drawing)
   * shared     the window renders through the shared layout-aware primitives
   *            (GenesisWindowFrame heading per composition + the role's
   *            composition stylesheet for its controls, lists, cards, forms)
   */
  implementation: "dedicated" | "shared";
  /** What stays outside the language, and why (documented exception). */
  exception?: string;
}

export const WINDOW_MATRIX: Record<string, WindowParticipation> = {
  browser: { role: "browser", implementation: "dedicated", exception: "The embedded web page itself is another site's document; the language frames and navigates it but does not restyle it." },
  "neural-map": { role: "map", implementation: "dedicated" },
  settings: { role: "settings", implementation: "dedicated" },
  chat: { role: "conversation", implementation: "shared" },
  "chat:*": { role: "conversation", implementation: "shared" },
  knowledge: { role: "list", implementation: "shared" },
  reasoning: { role: "document", implementation: "shared" },
  creation: { role: "document", implementation: "shared" },
  "artifact:*": { role: "document", implementation: "shared" },
  projects: { role: "files", implementation: "shared" },
  visualstudio: { role: "studio", implementation: "shared", exception: "The WebGL/3D viewport inside the studio is a live render; its controls follow the language, its pixels do not." },
  "atelier:*": { role: "studio", implementation: "shared" },
  render: { role: "canvas", implementation: "shared", exception: "Rendered images and the 3D preview are the user's work, shown as made." },
  genesisv2: { role: "canvas", implementation: "shared", exception: "The 3D room is a live render; only its surrounding controls follow the language." },
  earth: { role: "canvas", implementation: "shared", exception: "The globe is a live map render; its controls and readouts follow the language." },
  avatar: { role: "canvas", implementation: "shared", exception: "Her avatar is drawn as she is; the panel around it follows the language." },
  video: { role: "canvas", implementation: "shared", exception: "Video frames are shown as recorded." },
  sketch: { role: "board", implementation: "shared", exception: "The drawing surface (Excalidraw) keeps its own canvas; toolbars and panels follow the language." },
  executive: { role: "board", implementation: "shared" },
  agents: { role: "dashboard", implementation: "shared" },
  memory: { role: "list", implementation: "shared" },
  history: { role: "list", implementation: "shared" },
  logs: { role: "list", implementation: "shared" },
  notifications: { role: "list", implementation: "shared" },
  briefings: { role: "document", implementation: "shared" },
  cognition: { role: "dashboard", implementation: "shared" },
  "cognitive-trace": { role: "list", implementation: "shared" },
  diagnostics: { role: "dashboard", implementation: "shared" },
  device: { role: "dashboard", implementation: "shared" },
  identity: { role: "document", implementation: "shared" },
  evolution: { role: "dashboard", implementation: "shared" },
  engineering: { role: "tools", implementation: "shared" },
  command: { role: "tools", implementation: "shared" },
  "eng-studio": { role: "tools", implementation: "shared" },
  "voice-studio": { role: "tools", implementation: "shared" },
  "infra-monitor": { role: "dashboard", implementation: "shared" },
  "security-center": { role: "dashboard", implementation: "shared" },
};

/** How a module window id takes part (dynamic ids — chats, artifacts, atelier — by prefix). */
export function participationFor(moduleId: string): WindowParticipation {
  if (WINDOW_MATRIX[moduleId]) return WINDOW_MATRIX[moduleId];
  const prefix = moduleId.includes(":") ? `${moduleId.split(":")[0]}:*` : "";
  if (prefix && WINDOW_MATRIX[prefix]) return WINDOW_MATRIX[prefix];
  return { role: "dashboard", implementation: "shared" };
}
