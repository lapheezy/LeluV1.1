/**
 * ==========================================================
 * LÉLU HOME — THE SIXTY CONCEPTS AS WORKING LAYOUTS (Mission 15.1)
 *
 * Mission 15 catalogued sixty Home layout concepts and built eleven.
 * Here every one of the sixty is a real layout recipe for the
 * composition engine: the same live modules, arranged the way the
 * concept describes, on phone, tablet and desktop. The eleven built
 * concepts point at their built-in composition; the other forty-nine
 * have their own recipe (several needed the new families: column,
 * strip, rows, stage, lanes, radial, constellation, scatter, twozone).
 *
 * The research notes (composition, strengths, references, …) are in
 * homeConceptNotes.ts, generated from CONCEPTS.md.
 *
 * Pure data + pure functions. No React, no DOM, no storage.
 * ==========================================================
 */

import { CONCEPT_NOTES, type ConceptNotes } from "./homeConceptNotes";
import {
  dayPart,
  templateFor,
  type CompositionKind,
  type DeviceClass,
  type HomeModuleId,
  type HomeSignals,
  type HomeTemplate,
} from "./homeComposition";

export type { ConceptNotes };

type Recipe = Omit<HomeTemplate, "id" | "name" | "blurb" | "concept"> & { blurb?: string };

const all = (k: CompositionKind): Record<DeviceClass, CompositionKind> => ({ phone: k, tablet: k, desktop: k });
const kinds = (phone: CompositionKind, tablet: CompositionKind, desktop: CompositionKind = tablet) => ({ phone, tablet, desktop });

/** Concepts realised by one of the twelve built-in compositions. */
export const BUILT_CONCEPT: Partial<Record<number, string>> = {
  1: "bento-universe",
  2: "executive-command",
  11: "cosmos-orbit",
  12: "spatial-home",
  18: "organic-asymmetry",
  21: "creative-gallery",
  31: "project-hub",
  34: "workspace-deck",
  37: "minimal-focus",
  41: "adaptive-intelligence",
  53: "living-ecosystem",
};

const CENTRAL: HomeModuleId[] = ["weather", "lelu", "now", "apps", "workspaces", "notifications", "library", "activity"];

/** One recipe per concept that is not a built-in. */
const RECIPES: Record<number, Recipe> = {
  3: {
    blurb: "A strip of small status tiles across the top, the work below.",
    kind: kinds("strip", "strip"),
    order: ["weather", "now", "notifications", "activity", "workspaces", "apps", "lelu", "library"],
    sizes: { weather: "s", now: "s", notifications: "s", activity: "s", workspaces: "l", apps: "xl", lelu: "m", library: "m" },
  },
  4: {
    blurb: "One calm column ordered by what matters now.",
    kind: all("column"),
    order: ["now", "notifications", "activity", "weather", "workspaces", "apps", "lelu", "library"],
    sizes: { now: "m", notifications: "l", activity: "s", weather: "s", workspaces: "l", apps: "m", lelu: "m", library: "s" },
    params: { maxWidth: 760 },
  },
  5: {
    blurb: "Every panel live at equal weight — a monitoring wall.",
    kind: kinds("grid", "grid"),
    order: ["now", "activity", "notifications", "workspaces", "weather", "apps", "library", "lelu", "ask"],
    sizes: {},
    params: { density: 0 },
  },
  6: {
    blurb: "Launcher tiles that also show what they hold; apps lead.",
    kind: kinds("bento", "grid"),
    order: ["apps", "now", "weather", "notifications", "workspaces", "activity", "library", "lelu"],
    sizes: { apps: "xl", now: "m", weather: "s", notifications: "m", workspaces: "m", activity: "s", library: "s", lelu: "s" },
    pinned: ["apps"],
    params: { density: 0.2 },
  },
  7: {
    blurb: "Several modules share one slot as a stack of tabs.",
    kind: all("bento"),
    order: ["lelu", "notifications", "activity", "weather", "now", "apps", "workspaces", "library"],
    sizes: { lelu: "l", notifications: "l", weather: "m", apps: "xl", workspaces: "l", library: "m" },
    groups: [
      { id: "stack-updates", members: ["notifications", "activity"] },
      { id: "stack-today", members: ["weather", "now"] },
    ],
  },
  8: {
    blurb: "A rail of tools beside one large canvas.",
    kind: all("stage"),
    order: ["workspaces", "apps", "library", "notifications", "now", "activity", "weather", "lelu"],
    sizes: { workspaces: "xl" },
    params: { ratio: 0.78 },
  },
  9: {
    blurb: "Notifications are the main surface; everything else is context.",
    kind: kinds("column", "split"),
    order: ["notifications", "now", "activity", "workspaces", "apps", "library", "weather", "lelu"],
    sizes: { notifications: "xl", now: "m", activity: "s", workspaces: "m", apps: "m", library: "s", weather: "s", lelu: "s" },
    pinned: ["notifications"],
    params: { ratio: 0.66 },
  },
  10: {
    blurb: "One command field, the presence and the apps; the rest one key away.",
    kind: all("focus"),
    order: ["ask", "lelu", "apps", "now", "workspaces", "notifications", "library", "activity", "weather"],
    sizes: { ask: "xl", lelu: "m", apps: "xl", now: "m" },
    docked: ["workspaces", "notifications", "library", "activity", "weather"],
  },
  13: {
    blurb: "Apps and surfaces as planets around her, among the stars.",
    kind: kinds("column", "constellation"),
    order: ["lelu", "apps", "workspaces", "now", "notifications", "weather", "library", "activity"],
    sizes: { lelu: "l", apps: "m", workspaces: "m", now: "s", notifications: "s", weather: "s", library: "s", activity: "s" },
    params: { links: false },
    style: { theme: "galaxy", border: "stardust", font: "geometric", headingFont: "geometric" },
  },
  14: {
    blurb: "Work as linked nodes — what relates to what, at a glance.",
    kind: kinds("column", "constellation"),
    order: ["workspaces", "now", "activity", "notifications", "library", "apps", "lelu", "weather"],
    sizes: { workspaces: "l", now: "m", activity: "m", notifications: "s", library: "s", apps: "m", lelu: "s", weather: "s" },
    params: { links: true },
  },
  15: {
    blurb: "A bounded canvas: place every surface freely, it snaps and aligns.",
    kind: kinds("bento", "freeform"),
    order: ["workspaces", "apps", "lelu", "now", "notifications", "library", "activity", "weather"],
    sizes: { workspaces: "l", apps: "l", lelu: "m", now: "m", notifications: "m", library: "s", activity: "m", weather: "s" },
    style: { theme: "mono", border: "none", radius: 12 },
  },
  16: {
    blurb: "A room with doors: the work you walk to sits near, the rest far.",
    kind: kinds("layered", "spatial"),
    order: ["workspaces", "apps", "library", "lelu", "now", "notifications", "activity", "weather"],
    sizes: { workspaces: "l", apps: "l", library: "m", lelu: "m" },
    params: { depth: 1 },
  },
  17: {
    blurb: "Zoomed out, far things fold to their names; near things show detail.",
    kind: all("layered"),
    order: ["lelu", "now", "workspaces", "apps", "notifications", "activity", "library", "weather"],
    sizes: { lelu: "l", now: "m", workspaces: "l", apps: "l", notifications: "s", activity: "s", library: "s", weather: "s" },
    collapsed: ["notifications", "activity", "library", "weather"],
    params: { depth: 0.8 },
  },
  19: {
    blurb: "LÉLU Central in clear glass: the Cosmos shows through every surface.",
    kind: all("bento"),
    order: CENTRAL,
    sizes: { weather: "s", lelu: "s", now: "s", apps: "xl", workspaces: "l", notifications: "m", library: "m", activity: "l" },
    device: { desktop: { sizes: { weather: "m", lelu: "m", now: "m", apps: "xl", workspaces: "l", notifications: "s", library: "s", activity: "xl" } } },
    style: { opacity: 0.15, tint: 0.1, border: "none" },
  },
  20: {
    blurb: "Almost nothing: her presence and a field to ask. The Cosmos is the Home.",
    kind: all("focus"),
    order: ["lelu", "ask", "now", "apps", "workspaces", "notifications", "library", "activity", "weather"],
    sizes: { lelu: "m", ask: "xl" },
    docked: ["now", "apps", "workspaces", "notifications", "library", "activity", "weather"],
    params: { maxWidth: 560 },
    style: { opacity: 0.12, tint: 0 },
  },
  22: {
    blurb: "Rows you swipe sideways, one per kind of thing.",
    kind: all("rows"),
    order: ["lelu", "now", "weather", "workspaces", "apps", "library", "notifications", "activity"],
    sizes: { lelu: "m", now: "m", weather: "s", workspaces: "l", apps: "l", library: "m", notifications: "m", activity: "m" },
    params: { lanes: 3, laneNames: ["Today", "Work", "Updates"] },
  },
  23: {
    blurb: "One large hero, then a feed underneath.",
    kind: all("column"),
    order: ["lelu", "now", "workspaces", "notifications", "activity", "apps", "library", "weather"],
    sizes: { lelu: "xl", now: "m", workspaces: "l", notifications: "m", activity: "s", apps: "m", library: "s", weather: "s" },
    params: { maxWidth: 700 },
  },
  24: {
    blurb: "One card on top of a stack; swipe or step to the next.",
    kind: all("deck"),
    order: ["lelu", "now", "workspaces", "notifications", "apps", "activity", "library", "weather"],
    sizes: {},
    params: { stacked: true },
  },
  25: {
    blurb: "An editorial spread: art-directed sizes and a fashion serif.",
    kind: kinds("column", "bento"),
    order: ["workspaces", "lelu", "now", "library", "notifications", "apps", "activity", "weather"],
    sizes: { workspaces: "xl", lelu: "l", now: "m", library: "m", notifications: "s", apps: "l", activity: "s", weather: "s" },
    style: { font: "serif", headingFont: "didone", radius: 6 },
  },
  26: {
    blurb: "A journal: what happened, newest first, on a timeline.",
    kind: all("column"),
    order: ["activity", "now", "notifications", "workspaces", "library", "lelu", "weather", "apps"],
    sizes: { activity: "m", now: "m", notifications: "l", workspaces: "l", library: "m", lelu: "s", weather: "s", apps: "s" },
    params: { rail: true, maxWidth: 760 },
    style: { font: "storybook", headingFont: "storybook" },
  },
  27: {
    blurb: "Named shelves: what you pinned, your projects, your library.",
    kind: all("rows"),
    order: ["apps", "lelu", "now", "workspaces", "notifications", "activity", "library", "weather"],
    sizes: { apps: "l", workspaces: "l", library: "l" },
    params: { lanes: 3, laneNames: ["Pinned", "Projects", "Library"] },
  },
  28: {
    blurb: "Just the field. Ask, and everything else follows.",
    kind: all("focus"),
    order: ["ask", "apps", "lelu", "now", "workspaces", "notifications", "library", "activity", "weather"],
    sizes: { ask: "xl", apps: "xl" },
    docked: ["lelu", "now", "workspaces", "notifications", "library", "activity", "weather"],
    params: { maxWidth: 680 },
  },
  29: {
    blurb: "Pinned apps first, the windows you left right under them.",
    kind: all("bento"),
    order: ["apps", "workspaces", "now", "notifications", "lelu", "library", "activity", "weather"],
    sizes: { apps: "xl", workspaces: "xl", now: "m", notifications: "m", lelu: "s", library: "s", activity: "m", weather: "s" },
    pinned: ["apps", "workspaces"],
  },
  30: {
    blurb: "A row of rings for each agent and source; tap one to open it.",
    kind: all("strip"),
    order: ["now", "activity", "notifications", "weather", "library", "lelu", "workspaces", "apps"],
    sizes: { now: "s", activity: "s", notifications: "s", weather: "s", library: "s", lelu: "l", workspaces: "l", apps: "xl" },
    collapsed: ["now", "activity", "notifications", "weather", "library"],
    params: { rings: true },
  },
  32: {
    blurb: "Tiles side by side, never overlapping — a tiling layout.",
    kind: kinds("masonry", "masonry"),
    order: ["workspaces", "now", "apps", "notifications", "activity", "library", "weather", "lelu"],
    sizes: { workspaces: "m", now: "m", apps: "m", notifications: "m", activity: "m", library: "m", weather: "m", lelu: "m" },
    params: { lanes: 2, density: 0 },
    deviceParams: { desktop: { lanes: 3 } },
    style: { radius: 6 },
  },
  33: {
    blurb: "An editor-style workspace: centre panel, tabbed side panels, a dock.",
    kind: kinds("column", "split"),
    order: ["workspaces", "now", "apps", "notifications", "activity", "weather", "lelu", "library"],
    sizes: { workspaces: "xl", now: "m", apps: "m", notifications: "l", activity: "l", weather: "m", lelu: "m" },
    groups: [
      { id: "side-updates", members: ["notifications", "activity"] },
      { id: "side-today", members: ["weather", "lelu"] },
    ],
    docked: ["library"],
    params: { ratio: 0.7, density: 0.1 },
    style: { font: "mono", radius: 8 },
  },
  35: {
    blurb: "One surface on stage; your other surfaces wait in a strip at the side.",
    kind: all("stage"),
    order: ["workspaces", "now", "notifications", "apps", "lelu", "activity", "library", "weather"],
    sizes: { workspaces: "xl" },
    params: { ratio: 0.82 },
  },
  36: {
    blurb: "A board: now, next, later.",
    kind: all("lanes"),
    order: ["now", "activity", "notifications", "workspaces", "apps", "ask", "library", "weather", "lelu"],
    sizes: { now: "m", activity: "s", notifications: "l", workspaces: "l", apps: "m", ask: "s", library: "m", weather: "s", lelu: "s" },
    params: { lanes: 3, laneNames: ["Now", "Next", "Later"] },
  },
  38: {
    blurb: "Related modules grouped as tabs — a tidy home.",
    kind: all("bento"),
    order: ["lelu", "workspaces", "library", "notifications", "activity", "weather", "now", "apps"],
    sizes: { lelu: "m", workspaces: "l", notifications: "l", weather: "m", apps: "xl" },
    groups: [
      { id: "tabs-work", members: ["workspaces", "library"] },
      { id: "tabs-updates", members: ["notifications", "activity"] },
      { id: "tabs-today", members: ["weather", "now"] },
    ],
  },
  39: {
    blurb: "The layout, with small palettes floating over it where you need them.",
    kind: all("bento"),
    order: ["workspaces", "apps", "lelu", "notifications", "library", "activity", "weather", "now"],
    sizes: { workspaces: "l", apps: "xl", lelu: "m", notifications: "m", library: "s", activity: "l" },
    floats: { weather: { x: 0.64, y: 0.04, w: 0.32, h: 0.2 }, now: { x: 0.64, y: 0.28, w: 0.32, h: 0.18 } },
  },
  40: {
    blurb: "Your day as one column: what is happening, what is next, what is waiting.",
    kind: all("column"),
    order: ["weather", "now", "activity", "notifications", "workspaces", "apps", "lelu", "library"],
    sizes: { weather: "s", now: "m", activity: "s", notifications: "l", workspaces: "l", apps: "m", lelu: "s", library: "s" },
    params: { rail: true, maxWidth: 760 },
  },
  42: {
    blurb: "Changes with the day: weather and news in the morning, work by day, calm at night.",
    kind: all("bento"),
    order: CENTRAL,
    sizes: { weather: "m", lelu: "m", now: "m", apps: "xl", workspaces: "l", notifications: "m", library: "s", activity: "l" },
    params: { adaptive: "time" },
  },
  43: {
    blurb: "A different arrangement per device: a column on the phone, masonry on a tablet, a bento on a desktop.",
    kind: kinds("column", "masonry", "bento"),
    order: CENTRAL,
    sizes: { weather: "s", lelu: "m", now: "m", apps: "xl", workspaces: "l", notifications: "m", library: "s", activity: "l" },
    device: { phone: { docked: ["library"] } },
  },
  44: {
    blurb: "What she is doing is the hero; everything else supports it.",
    kind: all("bento"),
    order: ["now", "activity", "lelu", "notifications", "workspaces", "apps", "library", "weather"],
    sizes: { now: "xl", activity: "l", lelu: "m", notifications: "m", workspaces: "l", apps: "l", library: "s", weather: "s" },
    pinned: ["now"],
  },
  45: {
    blurb: "Apps first, and the surfaces you open most rise next.",
    kind: all("bento"),
    order: ["apps", "now", "workspaces", "lelu", "notifications", "activity", "library", "weather"],
    sizes: { apps: "xl", now: "m", workspaces: "l", lelu: "m", notifications: "m", activity: "m", library: "s", weather: "s" },
    pinned: ["apps"],
    params: { adaptive: "usage" },
  },
  46: {
    blurb: "Anything waiting for your approval jumps to the top.",
    kind: all("bento"),
    order: ["notifications", "now", "workspaces", "apps", "lelu", "activity", "library", "weather"],
    sizes: { notifications: "l", now: "m", workspaces: "l", apps: "l", lelu: "m", activity: "m", library: "s", weather: "s" },
    params: { adaptive: "signals" },
  },
  47: {
    blurb: "Fewer, larger modules on a phone; everything on a desktop.",
    kind: kinds("focus", "bento"),
    order: ["lelu", "now", "apps", "workspaces", "notifications", "activity", "library", "weather"],
    sizes: { lelu: "m", now: "m", apps: "xl", workspaces: "l", notifications: "m", activity: "l", library: "s", weather: "s" },
    device: { phone: { sizes: { lelu: "l", now: "l", apps: "xl" }, docked: ["workspaces", "notifications", "activity", "library", "weather"] } },
  },
  48: {
    blurb: "She proposes an arrangement from what is happening; you approve it.",
    kind: all("bento"),
    order: ["now", "lelu", "notifications", "workspaces", "apps", "activity", "library", "weather"],
    sizes: { now: "l", lelu: "m", notifications: "m", workspaces: "l", apps: "l", activity: "m", library: "s", weather: "s" },
    params: { adaptive: "signals" },
  },
  49: {
    blurb: "Drifts toward how you use it — shown, opt-in, and never saved over your order.",
    kind: kinds("masonry", "masonry"),
    order: CENTRAL,
    sizes: { lelu: "m", now: "m", apps: "l", workspaces: "l", notifications: "m", activity: "m", library: "s", weather: "s" },
    params: { adaptive: "usage" },
  },
  50: {
    blurb: "A calm, glanceable screen: her presence and the weather, large.",
    kind: all("focus"),
    order: ["lelu", "weather", "now", "apps", "workspaces", "notifications", "library", "activity"],
    sizes: { lelu: "xl", weather: "l" },
    docked: ["now", "apps", "workspaces", "notifications", "library", "activity"],
    style: { font: "geometric", headingFont: "geometric", tint: 0.9, opacity: 0.35 },
  },
  51: {
    blurb: "An orbit band of LÉLU and what she is doing on top; a working bento below.",
    kind: kinds("bento", "twozone"),
    order: ["lelu", "now", "notifications", "apps", "workspaces", "activity", "library", "weather"],
    sizes: { lelu: "l", now: "m", notifications: "m", apps: "l", workspaces: "l", activity: "m", library: "s", weather: "s" },
  },
  52: {
    blurb: "A deck where each card is a small bento of its own.",
    kind: all("deck"),
    order: ["lelu", "now", "workspaces", "library", "notifications", "activity", "apps", "weather"],
    sizes: {},
    groups: [
      { id: "card-presence", members: ["lelu", "now"] },
      { id: "card-work", members: ["workspaces", "library"] },
      { id: "card-updates", members: ["notifications", "activity"] },
      { id: "card-tools", members: ["apps", "weather"] },
    ],
    params: { groupView: "stack" },
  },
  54: {
    blurb: "The conversation is the Home: ask first, then what she is doing.",
    kind: all("column"),
    order: ["ask", "now", "activity", "lelu", "apps", "workspaces", "notifications", "library", "weather"],
    sizes: { ask: "m", now: "m", activity: "s", lelu: "m" },
    docked: ["apps", "workspaces", "notifications", "library", "weather"],
    params: { maxWidth: 720 },
  },
  55: {
    blurb: "A large presence that listens; hold the orb to talk, or type.",
    kind: all("focus"),
    order: ["lelu", "now", "ask", "apps", "workspaces", "notifications", "library", "activity", "weather"],
    sizes: { lelu: "xl", now: "l", ask: "xl" },
    pinned: ["lelu"],
    docked: ["apps", "workspaces", "notifications", "library", "activity", "weather"],
    style: { border: "aurora" },
  },
  56: {
    blurb: "The world first: weather (the door to Earth) leads, the rest frames it.",
    kind: kinds("column", "split"),
    order: ["weather", "now", "lelu", "workspaces", "apps", "notifications", "library", "activity"],
    sizes: { weather: "xl", now: "m", lelu: "m", workspaces: "m", apps: "m", notifications: "s", library: "s", activity: "s" },
    pinned: ["weather"],
    params: { ratio: 0.62 },
    style: { theme: "forest", border: "nature" },
  },
  57: {
    blurb: "Everything fans out on an arc from her, reachable with one thumb.",
    kind: kinds("radial", "radial"),
    order: ["lelu", "apps", "now", "workspaces", "notifications", "library", "activity", "weather"],
    sizes: {},
  },
  58: {
    blurb: "Cards dealt at angles on a table — playful, deliberately loose.",
    kind: kinds("scatter", "scatter"),
    order: ["lelu", "workspaces", "apps", "now", "notifications", "library", "activity", "weather"],
    sizes: { lelu: "m", workspaces: "l", apps: "l", now: "m", notifications: "m", library: "s", activity: "m", weather: "s" },
    params: { tilt: 9 },
  },
  59: {
    blurb: "LÉLU Central in colours generated from one seed — shuffle for a new palette.",
    kind: all("bento"),
    order: CENTRAL,
    sizes: { weather: "m", lelu: "m", now: "m", apps: "xl", workspaces: "l", notifications: "s", library: "s", activity: "xl" },
    style: { theme: "generative", seed: 196, border: "neon" },
  },
  60: {
    blurb: "Work on one side; the other side is a clear window onto the live Cosmos.",
    kind: kinds("column", "split"),
    order: ["now", "workspaces", "apps", "notifications", "lelu", "activity", "library", "weather"],
    sizes: { now: "m", workspaces: "l", apps: "m", notifications: "m", lelu: "s", activity: "s", library: "s", weather: "s" },
    params: { ratio: 0.6, window: 0.42 },
    deviceParams: { phone: { window: 0 } },
  },
};

export interface Concept {
  n: number;
  id: string;
  notes: ConceptNotes;
  layout: HomeTemplate;
  /** "built-in" when one of the twelve compositions realises it. */
  source: "built-in" | "recipe";
}

export function conceptId(n: number): string {
  return `concept-${String(n).padStart(2, "0")}`;
}

function build(notes: ConceptNotes): Concept {
  const builtin = BUILT_CONCEPT[notes.n];
  if (builtin) {
    const t = templateFor(builtin);
    return { n: notes.n, id: conceptId(notes.n), notes, source: "built-in", layout: { ...t, concept: notes.n } };
  }
  const r = RECIPES[notes.n];
  if (!r) throw new Error(`concept ${notes.n} has no layout`);
  const { blurb, ...rest } = r;
  return {
    n: notes.n,
    id: conceptId(notes.n),
    notes,
    source: "recipe",
    layout: { ...rest, id: conceptId(notes.n), name: notes.name, blurb: blurb ?? notes.composition, concept: notes.n },
  };
}

export const CONCEPTS: Concept[] = CONCEPT_NOTES.map(build);

export const CONCEPT_CATEGORIES: string[] = [...new Set(CONCEPT_NOTES.map((c) => c.category))];

export function conceptFor(idOrN: string | number): Concept | undefined {
  return typeof idOrN === "number" ? CONCEPTS.find((c) => c.n === idOrN) : CONCEPTS.find((c) => c.id === idOrN || c.layout.id === idOrN);
}

/** Free-text search over names and research notes. */
export function searchConcepts(query: string, list: Concept[] = CONCEPTS): Concept[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((c) => {
    const hay = [c.n, c.notes.name, c.notes.category, c.notes.composition, c.notes.strengths, c.notes.weaknesses, c.notes.refs, c.layout.blurb, Object.values(c.layout.kind).join(" ")].join(" ").toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** The prompt "Research with LÉLU" puts in the composer (the chat's own /research command). */
export function researchPrompt(c: Pick<ConceptNotes, "name" | "refs" | "refKind">): string {
  const refs = c.refKind === "product" ? ` (references: ${c.refs.replace(/^Product,\s*/i, "")})` : "";
  return `/research "${c.name}" home screen layout — UX patterns, accessibility, examples${refs}`.slice(0, 400);
}

/**
 * LÉLU arranges it (#48): a proposal from what is happening right now.
 * It only PROPOSES — the Design Studio shows it, and nothing changes
 * until she presses "Use".
 */
export function suggestConcept(input: { device: DeviceClass; hour: number; signals: HomeSignals }): { concept: Concept; reason: string } {
  const { device, hour, signals } = input;
  const pick = (n: number, reason: string) => ({ concept: conceptFor(n)!, reason });
  if (signals.approvals > 0) return pick(46, `${signals.approvals} approval${signals.approvals === 1 ? " is" : "s are"} waiting, so approvals should come first.`);
  if (signals.working) return pick(44, "She is working on something, so what she is doing should be the hero.");
  const part = dayPart(hour);
  if (part === "night") return pick(50, "It is night: a calm, glanceable screen.");
  if (signals.unread > 3) return pick(9, `${signals.unread} unread notifications: an inbox-first Home helps clear them.`);
  if (signals.openWindows > 1) return pick(35, `${signals.openWindows} windows are waiting: a stage with the others beside it.`);
  if (device === "phone") return pick(part === "morning" ? 4 : 47, part === "morning" ? "A phone in the morning: a short briefing column." : "A phone: fewer, larger modules.");
  if (part === "morning") return pick(4, "Morning: a status-first briefing.");
  return pick(2, "Daytime on a large screen: status first, then the tools.");
}
