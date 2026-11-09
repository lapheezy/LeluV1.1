/**
 * ==========================================================
 * LÉLU — FONT LIBRARY
 *
 * The typefaces LÉLU may design with, each with its licence,
 * its character, and what it is good for — so a typographic
 * choice is an intentional decision she can explain, not a
 * random family name.
 *
 * Every library font is either a system stack (no download)
 * or an SIL Open Font License family served by Google Fonts.
 * Custom fonts can be added only with a declared licence that
 * permits use (OFL, Apache-2.0, MIT, Ubuntu, or "user-owned" /
 * "licensed" asserted by the user), from an https URL of a
 * real font file. Anything else is refused.
 * ==========================================================
 */

export type FontCategory = "sans" | "serif" | "display" | "mono" | "handwriting" | "rounded";

export interface FontEntry {
  id: string;
  family: string;
  category: FontCategory;
  licence: "system" | "OFL-1.1" | "Apache-2.0";
  /** Google Fonts css2 family spec, absent for system stacks. */
  google?: string;
  fallback: string;
  character: string;
  goodFor: string;
}

const SANS = `system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
const SERIF = `ui-serif, Georgia, "Times New Roman", serif`;
const MONO = `ui-monospace, "SF Mono", Menlo, Consolas, monospace`;
const ROUNDED = `ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif`;

export const FONT_LIBRARY: FontEntry[] = [
  { id: "system-sans", family: "System UI", category: "sans", licence: "system", fallback: SANS, character: "neutral, native, instant", goodFor: "the default Genesis voice; dense tools" },
  { id: "system-serif", family: "System Serif", category: "serif", licence: "system", fallback: SERIF, character: "bookish, calm", goodFor: "long reading without a download" },
  { id: "system-mono", family: "System Mono", category: "mono", licence: "system", fallback: MONO, character: "technical", goodFor: "code, data" },
  { id: "system-rounded", family: "System Rounded", category: "rounded", licence: "system", fallback: ROUNDED, character: "soft, friendly", goodFor: "casual, organic environments" },

  { id: "inter", family: "Inter", category: "sans", licence: "OFL-1.1", google: "Inter:wght@300;400;500;600;700", fallback: SANS, character: "precise, highly legible screen sans", goodFor: "interfaces, research, dense information" },
  { id: "manrope", family: "Manrope", category: "sans", licence: "OFL-1.1", google: "Manrope:wght@300;400;500;700", fallback: SANS, character: "modern geometric-grotesque, open", goodFor: "calm product UI, project management" },
  { id: "space-grotesk", family: "Space Grotesk", category: "sans", licence: "OFL-1.1", google: "Space+Grotesk:wght@300;400;500;700", fallback: SANS, character: "quirky technical grotesque", goodFor: "futuristic editorial body and labels" },
  { id: "sora", family: "Sora", category: "sans", licence: "OFL-1.1", google: "Sora:wght@300;400;600;700", fallback: SANS, character: "wide, airy, techno-humanist", goodFor: "spacious futuristic layouts" },
  { id: "outfit", family: "Outfit", category: "sans", licence: "OFL-1.1", google: "Outfit:wght@300;400;500;700", fallback: SANS, character: "clean geometric, friendly", goodFor: "creative studios, dashboards" },
  { id: "quicksand", family: "Quicksand", category: "rounded", licence: "OFL-1.1", google: "Quicksand:wght@400;500;600;700", fallback: ROUNDED, character: "rounded, light, gentle", goodFor: "organic, garden, casual conversation" },
  { id: "nunito", family: "Nunito", category: "rounded", licence: "OFL-1.1", google: "Nunito:wght@300;400;600;700", fallback: ROUNDED, character: "balanced rounded sans", goodFor: "readable soft body text" },
  { id: "comfortaa", family: "Comfortaa", category: "rounded", licence: "OFL-1.1", google: "Comfortaa:wght@400;600;700", fallback: ROUNDED, character: "very round, playful geometric", goodFor: "organic headings, cotton-candy moods" },

  { id: "unbounded", family: "Unbounded", category: "display", licence: "OFL-1.1", google: "Unbounded:wght@400;600;800", fallback: SANS, character: "wide, bold, cosmic", goodFor: "futuristic headlines" },
  { id: "syne", family: "Syne", category: "display", licence: "OFL-1.1", google: "Syne:wght@400;600;700;800", fallback: SANS, character: "art-gallery avant-garde", goodFor: "editorial and creative-studio headlines" },
  { id: "orbitron", family: "Orbitron", category: "display", licence: "OFL-1.1", google: "Orbitron:wght@400;600;800", fallback: SANS, character: "sci-fi geometric", goodFor: "short HUD labels only — tiring as body text" },
  { id: "exo-2", family: "Exo 2", category: "display", licence: "OFL-1.1", google: "Exo+2:wght@300;400;600;700", fallback: SANS, character: "futuristic but readable", goodFor: "celestial and sci-fi environments" },

  { id: "fraunces", family: "Fraunces", category: "serif", licence: "OFL-1.1", google: "Fraunces:opsz,wght@9..144,300;9..144,500;9..144,700", fallback: SERIF, character: "soft 'wonky' old-style serif", goodFor: "organic editorial headlines" },
  { id: "playfair", family: "Playfair Display", category: "serif", licence: "OFL-1.1", google: "Playfair+Display:wght@400;600;800", fallback: SERIF, character: "high-contrast editorial", goodFor: "magazine headlines" },
  { id: "cormorant", family: "Cormorant Garamond", category: "serif", licence: "OFL-1.1", google: "Cormorant+Garamond:wght@300;400;600", fallback: SERIF, character: "elegant, delicate", goodFor: "quiet, luxurious headings" },
  { id: "instrument-serif", family: "Instrument Serif", category: "serif", licence: "OFL-1.1", google: "Instrument+Serif", fallback: SERIF, character: "condensed contemporary serif", goodFor: "futuristic editorial display" },
  { id: "lora", family: "Lora", category: "serif", licence: "OFL-1.1", google: "Lora:wght@400;500;600", fallback: SERIF, character: "brushed contemporary serif", goodFor: "readable serif body text" },

  { id: "jetbrains-mono", family: "JetBrains Mono", category: "mono", licence: "OFL-1.1", google: "JetBrains+Mono:wght@400;600", fallback: MONO, character: "code-first mono", goodFor: "engineering workspaces" },
  { id: "ibm-plex-mono", family: "IBM Plex Mono", category: "mono", licence: "OFL-1.1", google: "IBM+Plex+Mono:wght@400;500", fallback: MONO, character: "corporate-technical mono", goodFor: "editorial captions, data" },
  { id: "space-mono", family: "Space Mono", category: "mono", licence: "OFL-1.1", google: "Space+Mono:wght@400;700", fallback: MONO, character: "retro-futurist mono", goodFor: "futuristic labels and metadata" },

  { id: "caveat", family: "Caveat", category: "handwriting", licence: "OFL-1.1", google: "Caveat:wght@400;600", fallback: `"Comic Sans MS", cursive`, character: "casual handwriting", goodFor: "sketch notes, accents only" },
];

const BY_ID = new Map(FONT_LIBRARY.map((font) => [font.id, font]));

export function isKnownFont(id: string): boolean {
  return BY_ID.has(id);
}

export function getFont(id: string): FontEntry | undefined {
  return BY_ID.get(id);
}

/** The CSS font-family value for a library font id. */
export function fontStack(id: string): string {
  const font = BY_ID.get(id);
  if (!font) return SANS;
  if (font.licence === "system") return font.fallback;
  return `"${font.family}", ${font.fallback}`;
}

/** One Google Fonts stylesheet URL for every non-system font in the list. */
export function googleFontsUrl(ids: string[]): string | null {
  const specs = [...new Set(ids)].map((id) => BY_ID.get(id)?.google).filter((spec): spec is string => Boolean(spec));
  if (!specs.length) return null;
  return `https://fonts.googleapis.com/css2?${specs.map((spec) => `family=${spec}`).join("&")}&display=swap`;
}

/* ------------------------------------------------------------------ *
 * CUSTOM FONTS
 * ------------------------------------------------------------------ */

export const PERMITTED_FONT_LICENCES = ["OFL-1.1", "Apache-2.0", "MIT", "Ubuntu", "user-owned", "licensed"] as const;
export type PermittedFontLicence = (typeof PERMITTED_FONT_LICENCES)[number];

export interface CustomFont {
  id: string;
  family: string;
  url: string;
  licence: PermittedFontLicence;
  weight?: string;
}

export function validateCustomFont(input: unknown): { font?: CustomFont; error?: string } {
  if (!input || typeof input !== "object") return { error: "a custom font needs { family, url, licence }" };
  const raw = input as Record<string, unknown>;
  const family = typeof raw.family === "string" ? raw.family.trim() : "";
  const url = typeof raw.url === "string" ? raw.url.trim() : "";
  const licence = typeof raw.licence === "string" ? raw.licence.trim() : typeof raw.license === "string" ? (raw.license as string).trim() : "";
  if (!/^[\w -]{2,60}$/.test(family)) return { error: `"${family}" is not a usable font family name` };
  if (!/^https:\/\/[^\s"'()]+\.(woff2?|ttf|otf)(\?[^\s"'()]*)?$/i.test(url)) {
    return { error: "the font URL must be an https link to a .woff2, .woff, .ttf or .otf file" };
  }
  if (!(PERMITTED_FONT_LICENCES as readonly string[]).includes(licence)) {
    return {
      error: `licence "${licence || "unknown"}" does not permit use — declare one of ${PERMITTED_FONT_LICENCES.join(", ")} (only declare user-owned/licensed if the user said so)`,
    };
  }
  const id = `custom-${family.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const weight = typeof raw.weight === "string" && /^\d{3}( \d{3})?$/.test(raw.weight) ? raw.weight : undefined;
  return { font: { id, family, url, licence: licence as PermittedFontLicence, ...(weight ? { weight } : {}) } };
}

export function fontFaceCss(font: CustomFont): string {
  return `@font-face { font-family: "${font.family}"; src: url("${font.url}"); font-display: swap;${font.weight ? ` font-weight: ${font.weight};` : ""} }`;
}

export function describeFontLibrary(): string {
  return FONT_LIBRARY.map((f) => `${f.id} (${f.family}, ${f.category}, ${f.licence}): ${f.character}; good for ${f.goodFor}`).join("\n");
}
