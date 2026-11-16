/**
 * ==========================================================
 * LÉLU HOME — COMPOSITION ENGINE (Mission 15: Home Universe)
 *
 * The Home's modules (weather, LÉLU herself, what she is doing,
 * apps, workspaces, notifications, library, activity) are laid
 * out by ONE pure function from a saved PRESENTATION:
 *
 *   presentation  a named arrangement the person owns
 *                 (create · rename · duplicate · apply · reset ·
 *                 restore); it starts from one of twelve
 *                 compositions and keeps an independent PROFILE
 *                 per device class (phone · tablet · desktop)
 *   profile       module order + per-module settings: size,
 *                 hidden, pinned, locked, collapsed, mode
 *                 (grid | float | dock), a floating rect, a group
 *   solve()       profile + composition + width → cells
 *
 * Window geometry for real app windows stays with the existing
 * owners (layout/moduleLayout + core/interface/WorkspaceSteward);
 * this engine only arranges the Home's own surfaces, which are
 * not windows. "Open as a window", "Chat Universe" and "Cosmos"
 * hand a module to those owners — nothing is re-implemented here.
 *
 * Pure: no React, no DOM, no storage. HomeStore persists.
 * ==========================================================
 */

import { readStyle, type HomeStyle } from "./homeStyle";

export const HOME_MODULES = ["weather", "lelu", "now", "apps", "workspaces", "notifications", "library", "activity", "ask"] as const;
export type HomeModuleId = (typeof HOME_MODULES)[number];

/** Modules a layout must ask for: absent from its order, they start hidden (shown from the dock in edit mode). */
export const OPTIONAL_MODULES: HomeModuleId[] = ["ask"];

export type DeviceClass = "phone" | "tablet" | "desktop";
export const DEVICE_CLASSES: DeviceClass[] = ["phone", "tablet", "desktop"];

/** Layout families the engine can solve. */
export type CompositionKind =
  | "bento"
  | "grid"
  | "masonry"
  | "split"
  | "orbit"
  | "spatial"
  | "focus"
  | "deck"
  | "layered"
  | "freeform"
  // Mission 15.1: the families the sixty concepts needed
  | "column"
  | "strip"
  | "rows"
  | "stage"
  | "lanes"
  | "radial"
  | "constellation"
  | "scatter"
  | "twozone";

export const COMPOSITION_KINDS: Array<{ id: CompositionKind; name: string; blurb: string; absolute?: boolean }> = [
  { id: "bento", name: "Bento", blurb: "Mixed-size tiles packed with no gaps." },
  { id: "grid", name: "Uniform grid", blurb: "Equal tiles, equal weight." },
  { id: "masonry", name: "Masonry", blurb: "Equal-width lanes, shortest lane first." },
  { id: "split", name: "Split", blurb: "A primary pane and a side pane." },
  { id: "stage", name: "Stage", blurb: "One surface on stage, the rest in a side strip." },
  { id: "lanes", name: "Lanes (board)", blurb: "Columns in order, like a board." },
  { id: "column", name: "Column / feed", blurb: "One readable column, top to bottom." },
  { id: "strip", name: "Strip + body", blurb: "Small modules in a strip across the top, the rest below." },
  { id: "rows", name: "Carousel rows", blurb: "Horizontal rows you swipe through." },
  { id: "deck", name: "Deck", blurb: "Full-height cards in one swipeable row." },
  { id: "focus", name: "Focus", blurb: "Only what matters; the rest waits in the dock." },
  { id: "layered", name: "Layered", blurb: "A grid with a near and a far layer." },
  { id: "orbit", name: "Orbit", blurb: "Modules orbit the first one.", absolute: true },
  { id: "spatial", name: "Depth planes", blurb: "Near and far planes in perspective.", absolute: true },
  { id: "radial", name: "Radial fan", blurb: "Modules fan out on an arc from one point.", absolute: true },
  { id: "constellation", name: "Constellation", blurb: "Nodes linked like stars.", absolute: true },
  { id: "scatter", name: "Card table", blurb: "Cards dealt at angles.", absolute: true },
  { id: "twozone", name: "Orbit band + bento", blurb: "An orbit band on top, a bento below.", absolute: true },
  { id: "freeform", name: "Freeform", blurb: "Every surface where you put it.", absolute: true },
];

export const ABSOLUTE_KINDS = new Set<CompositionKind>(COMPOSITION_KINDS.filter((k) => k.absolute).map((k) => k.id));

/** How a layout re-orders itself at render time (never rewriting the saved order). */
export type AdaptiveMode = "none" | "signals" | "time" | "usage";

/** Tunable parameters of a layout (all optional; the engine has a default for each). */
export interface LayoutParams {
  /** masonry · lanes · rows: how many lanes/rows (2..6). */
  lanes?: number;
  /** split · stage: the primary pane's share (0.2..0.9). */
  ratio?: number;
  /** 0 compact … 1 airy: gap and row height. */
  density?: number;
  /** scatter: the largest tilt, degrees (0..20). */
  tilt?: number;
  /** spatial · layered: how deep the far plane sits (0..1). */
  depth?: number;
  /** column · focus: the column's largest width in px (0 = full). */
  maxWidth?: number;
  /** 0..0.6 of the width kept clear as a window onto the live Cosmos (Split Reality). */
  window?: number;
  /** constellation: draw the links. */
  links?: boolean;
  /** Grouped modules: tabs (one at a time) or stacked (all visible). */
  groupView?: "tabs" | "stack";
  adaptive?: AdaptiveMode;
  /** lanes · rows: header labels. */
  laneNames?: string[];
  /** deck: cards overlap like a hand of cards (swipe card stack). */
  stacked?: boolean;
  /** column: a timeline rail with a dot per module. */
  rail?: boolean;
  /** strip: small collapsed modules drawn as story rings. */
  rings?: boolean;
}

export type TemplateId = string;
export type BuiltinTemplateId =
  | "bento-universe"
  | "cosmos-orbit"
  | "spatial-home"
  | "lelu-central"
  | "executive-command"
  | "organic-asymmetry"
  | "creative-gallery"
  | "project-hub"
  | "minimal-focus"
  | "adaptive-intelligence"
  | "workspace-deck"
  | "living-ecosystem";

export type ModuleSize = "s" | "m" | "l" | "xl";
export const SIZES: ModuleSize[] = ["s", "m", "l", "xl"];
export type ModuleMode = "grid" | "float" | "dock";

export interface NRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ModuleSettings {
  size: ModuleSize;
  hidden: boolean;
  pinned: boolean;
  locked: boolean;
  collapsed: boolean;
  mode: ModuleMode;
  /** Floating geometry, 0..1 of the Home's own box. */
  float?: NRect;
  /** Modules sharing a group id render as one tabbed surface. */
  group?: string;
}

export interface DeviceProfile {
  order: HomeModuleId[];
  modules: Record<HomeModuleId, ModuleSettings>;
}

export interface HomePresentation {
  id: string;
  name: string;
  /** The layout it started from: a built-in id, a concept id or a custom layout id. */
  template: TemplateId;
  /** The layout itself, for anything that is not one of the twelve built-ins (concepts, blends, her own). */
  recipe?: HomeTemplate;
  /** Theme, fonts and borders. Absent = the original LÉLU look. */
  style?: HomeStyle;
  profiles: Record<DeviceClass, DeviceProfile>;
  createdAt: number;
  updatedAt: number;
}

export interface DeviceOverride {
  sizes?: Partial<Record<HomeModuleId, ModuleSize>>;
  hidden?: HomeModuleId[];
  docked?: HomeModuleId[];
  order?: HomeModuleId[];
  pinned?: HomeModuleId[];
  collapsed?: HomeModuleId[];
  floats?: Partial<Record<HomeModuleId, NRect>>;
  groups?: Array<{ id: string; members: HomeModuleId[] }>;
}

export interface HomeTemplate {
  id: TemplateId;
  name: string;
  /** One line: what the composition is for. */
  blurb: string;
  kind: Record<DeviceClass, CompositionKind>;
  params?: LayoutParams;
  /** Per-device parameter overrides. */
  deviceParams?: Partial<Record<DeviceClass, LayoutParams>>;
  /** The look this layout suggests (concepts that are about a look, e.g. layered glass). */
  style?: Partial<HomeStyle>;
  /** Which of the sixty concepts it realises (1-based), if any. */
  concept?: number;
  /** Layouts it was blended or merged from. */
  parents?: string[];
  /** Made by her (a new layout, a blend, a merge or an edited copy). */
  custom?: boolean;
  order: HomeModuleId[];
  sizes: Partial<Record<HomeModuleId, ModuleSize>>;
  /** Overrides per device (e.g. phone hides the library). */
  device?: Partial<Record<DeviceClass, DeviceOverride>>;
  pinned?: HomeModuleId[];
  hidden?: HomeModuleId[];
  docked?: HomeModuleId[];
  collapsed?: HomeModuleId[];
  /** Surfaces that start floating, at these rects (0..1 of the Home). */
  floats?: Partial<Record<HomeModuleId, NRect>>;
  groups?: Array<{ id: string; members: HomeModuleId[] }>;
}

export const MODULE_LABEL: Record<HomeModuleId, string> = {
  weather: "Weather",
  lelu: "LÉLU",
  now: "Now",
  apps: "Apps",
  workspaces: "Active Workspaces",
  notifications: "Notifications",
  library: "Infinite Library",
  activity: "Activity",
  ask: "Ask LÉLU",
};

/** Which existing Genesis panel each module expands into (Workspace transition). */
export const MODULE_PANEL: Record<HomeModuleId, string | null> = {
  weather: "earth",
  lelu: "avatar",
  now: "chat",
  apps: null,
  workspaces: "projects",
  notifications: "notifications",
  library: null,
  activity: "cognitive-trace",
  ask: "chat",
};

const ALL = [...HOME_MODULES];
const T = (t: HomeTemplate) => t;

/**
 * The twelve Mission 15 prototypes. Each is a real arrangement of the same
 * eight live modules — not a mock-up — so comparing them compares layouts,
 * not content.
 */
export const TEMPLATES: HomeTemplate[] = [
  T({
    id: "lelu-central",
    name: "LÉLU Central",
    blurb: "LÉLU at the centre, her state either side, apps beneath — today's Home, made editable.",
    kind: { phone: "bento", tablet: "bento", desktop: "bento" },
    order: ["weather", "lelu", "now", "apps", "workspaces", "notifications", "library", "activity"],
    sizes: { weather: "s", lelu: "s", now: "s", apps: "xl", workspaces: "l", notifications: "m", library: "m", activity: "l" },
    device: { desktop: { sizes: { weather: "m", lelu: "m", now: "m", notifications: "s", library: "s", activity: "xl" } }, tablet: { sizes: { activity: "xl" } } },
  }),
  T({
    id: "bento-universe",
    name: "Bento Universe",
    blurb: "A dense bento of mixed sizes: one hero tile, supporting tiles packed with no gaps.",
    kind: { phone: "bento", tablet: "bento", desktop: "bento" },
    order: ["lelu", "now", "workspaces", "weather", "apps", "notifications", "activity", "library"],
    sizes: { lelu: "l", now: "m", workspaces: "l", weather: "s", apps: "l", notifications: "m", activity: "m", library: "s" },
    device: { phone: { sizes: { lelu: "m", now: "m" } } },
  }),
  T({
    id: "cosmos-orbit",
    name: "Cosmos Orbit",
    blurb: "Modules orbit LÉLU on an ellipse; the Cosmos shows through the centre.",
    kind: { phone: "bento", tablet: "orbit", desktop: "orbit" },
    order: ["lelu", "now", "apps", "workspaces", "notifications", "weather", "library", "activity"],
    sizes: { lelu: "l", now: "s", apps: "m", workspaces: "m", notifications: "s", weather: "s", library: "s", activity: "s" },
    device: { phone: { sizes: { lelu: "m", apps: "xl" }, docked: ["library"] } },
  }),
  T({
    id: "spatial-home",
    name: "Spatial Home",
    blurb: "Two depth planes in perspective: near work, far context — CSS 3D, no extra renderer.",
    kind: { phone: "layered", tablet: "spatial", desktop: "spatial" },
    order: ["lelu", "now", "workspaces", "apps", "activity", "notifications", "weather", "library"],
    sizes: { lelu: "l", now: "m", workspaces: "l", apps: "l", activity: "m", notifications: "m", weather: "s", library: "s" },
  }),
  T({
    id: "executive-command",
    name: "Executive Command Center",
    blurb: "Status first: what she is doing, what needs you, then the tools. Dense and scannable.",
    kind: { phone: "grid", tablet: "split", desktop: "split" },
    order: ["now", "notifications", "activity", "workspaces", "apps", "library", "weather", "lelu"],
    sizes: { now: "l", notifications: "l", activity: "m", workspaces: "l", apps: "m", library: "m", weather: "s", lelu: "s" },
    pinned: ["now", "notifications"],
    device: { phone: { docked: ["lelu", "weather"] } },
  }),
  T({
    id: "organic-asymmetry",
    name: "Organic Asymmetry",
    blurb: "Deliberately uneven columns, like cloud formations — a masonry with a rhythm.",
    kind: { phone: "masonry", tablet: "masonry", desktop: "masonry" },
    order: ["lelu", "workspaces", "now", "notifications", "weather", "library", "apps", "activity"],
    sizes: { lelu: "l", workspaces: "l", now: "m", notifications: "m", weather: "s", library: "m", apps: "m", activity: "s" },
  }),
  T({
    id: "creative-gallery",
    name: "Creative Gallery",
    blurb: "Your work is the gallery: workspaces fill the stage, everything else frames it.",
    kind: { phone: "masonry", tablet: "masonry", desktop: "masonry" },
    order: ["workspaces", "apps", "lelu", "library", "now", "notifications", "activity", "weather"],
    sizes: { workspaces: "xl", apps: "l", lelu: "m", library: "m", now: "s", notifications: "s", activity: "s", weather: "s" },
    device: { phone: { hidden: ["weather"] } },
  }),
  T({
    id: "project-hub",
    name: "Project Hub",
    blurb: "Split: projects and workspaces on the left, the conversation and updates on the right.",
    kind: { phone: "grid", tablet: "split", desktop: "split" },
    order: ["workspaces", "apps", "library", "now", "notifications", "activity", "weather", "lelu"],
    sizes: { workspaces: "xl", apps: "m", library: "m", now: "m", notifications: "m", activity: "m", weather: "s", lelu: "s" },
    groups: [{ id: "updates", members: ["notifications", "activity"] }],
  }),
  T({
    id: "minimal-focus",
    name: "Minimal Focus",
    blurb: "One thing at a time: LÉLU, what she is doing and the apps. The rest waits in the dock.",
    kind: { phone: "focus", tablet: "focus", desktop: "focus" },
    order: ["lelu", "now", "apps", "workspaces", "notifications", "library", "activity", "weather"],
    sizes: { lelu: "l", now: "l", apps: "xl" },
    docked: ["workspaces", "notifications", "library", "activity", "weather"],
  }),
  T({
    id: "adaptive-intelligence",
    name: "Adaptive Intelligence",
    blurb: "Order follows what matters now: waiting approvals and live work rise to the top.",
    kind: { phone: "bento", tablet: "bento", desktop: "bento" },
    order: ["now", "notifications", "workspaces", "apps", "lelu", "activity", "library", "weather"],
    sizes: { now: "l", notifications: "m", workspaces: "l", apps: "l", lelu: "m", activity: "m", library: "s", weather: "s" },
  }),
  T({
    id: "workspace-deck",
    name: "Workspace Deck",
    blurb: "A horizontal deck of full-height surfaces you swipe through — one per context.",
    kind: { phone: "deck", tablet: "deck", desktop: "deck" },
    order: ["lelu", "workspaces", "apps", "notifications", "library", "now", "activity", "weather"],
    sizes: {},
    groups: [{ id: "today", members: ["now", "activity", "weather"] }],
  }),
  T({
    id: "living-ecosystem",
    name: "Living Home Ecosystem",
    blurb: "Freeform: every surface floats where you put it, over the live Cosmos; snaps to align.",
    kind: { phone: "bento", tablet: "freeform", desktop: "freeform" },
    order: ["lelu", "now", "weather", "apps", "workspaces", "notifications", "library", "activity"],
    sizes: { lelu: "m", now: "m", weather: "s", apps: "l", workspaces: "l", notifications: "m", library: "s", activity: "m" },
  }),
];

export function templateFor(id: TemplateId | string): HomeTemplate {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}

export function isBuiltin(id: string): boolean {
  return TEMPLATES.some((t) => t.id === id);
}

/** The layout a presentation follows: its own recipe, else the built-in it names. */
export function layoutOf(p: Pick<HomePresentation, "template" | "recipe">): HomeTemplate {
  return p.recipe ?? templateFor(p.template);
}

/** A layout's parameters for one device (device overrides win). */
export function paramsFor(layout: HomeTemplate, device: DeviceClass): LayoutParams {
  return { ...(layout.params ?? {}), ...(layout.deviceParams?.[device] ?? {}) };
}

export function deviceClassFor(width: number): DeviceClass {
  if (width < 700) return "phone";
  if (width < 1100) return "tablet";
  return "desktop";
}

export const COLUMNS: Record<DeviceClass, number> = { phone: 6, tablet: 12, desktop: 12 };

/** Grid span of each size, per device class: [columns, rows]. Rows are a
    half-height unit (~30 px), so a strip and a tile can share a grid. */
const SPAN: Record<DeviceClass, Record<ModuleSize, [number, number]>> = {
  phone: { s: [2, 4], m: [3, 5], l: [6, 4], xl: [6, 3] },
  tablet: { s: [4, 4], m: [6, 5], l: [6, 6], xl: [12, 3] },
  desktop: { s: [3, 5], m: [4, 5], l: [6, 6], xl: [12, 3] },
};

/** Strips: when a module runs (nearly) full width it needs no more than this. */
const STRIP_ROWS: Partial<Record<HomeModuleId, number>> = { apps: 3, activity: 2 };

function defaultSettings(size: ModuleSize = "m"): ModuleSettings {
  return { size, hidden: false, pinned: false, locked: false, collapsed: false, mode: "grid" };
}

export function profileFromTemplate(template: HomeTemplate, device: DeviceClass): DeviceProfile {
  const over = template.device?.[device] ?? {};
  const order = [...(over.order ?? template.order)];
  for (const id of ALL) if (!order.includes(id)) order.push(id);
  const modules = {} as Record<HomeModuleId, ModuleSettings>;
  for (const id of ALL) {
    const s = defaultSettings(over.sizes?.[id] ?? template.sizes[id] ?? "m");
    const optionalUnasked = OPTIONAL_MODULES.includes(id) && !template.order.includes(id) && !over.order?.includes(id);
    // A device's own list replaces the layout-wide one (so a saved layout can show what its parent hid).
    s.hidden = over.hidden ? over.hidden.includes(id) : Boolean(template.hidden?.includes(id) || optionalUnasked);
    s.pinned = Boolean((over.pinned ?? template.pinned)?.includes(id));
    s.collapsed = Boolean((over.collapsed ?? template.collapsed)?.includes(id));
    if ((over.docked ?? template.docked)?.includes(id)) s.mode = "dock";
    const rect = (over.floats ?? template.floats)?.[id];
    if (rect && s.mode !== "dock") {
      s.mode = "float";
      s.float = snapRect(rect);
    }
    const group = (over.groups ?? template.groups)?.find((g) => g.members.includes(id));
    if (group && s.mode === "grid") s.group = group.id;
    modules[id] = s;
  }
  if (template.kind[device] === "freeform") {
    const cells = solveGrid(order, modules, device, "bento");
    for (const cell of cells) modules[cell.id].float ??= cellToRect(cell, device, cells);
    for (const id of ALL) if (modules[id].float && modules[id].mode !== "dock") modules[id].mode = "float";
  }
  return { order, modules };
}

let counter = 0;
export function newPresentationId(now = Date.now()): string {
  counter += 1;
  return `hp-${now.toString(36)}-${counter.toString(36)}`;
}

export function presentationFromTemplate(templateId: TemplateId, name?: string, now = Date.now()): HomePresentation {
  return presentationFromLayout(templateFor(templateId), name, now);
}

/** A presentation of ANY layout — a built-in, one of the sixty concepts, a blend or her own. */
export function presentationFromLayout(template: HomeTemplate, name?: string, now = Date.now()): HomePresentation {
  const builtin = isBuiltin(template.id) && !template.custom;
  return {
    id: newPresentationId(now),
    name: name ?? template.name,
    template: template.id,
    ...(builtin ? {} : { recipe: cloneLayout(template) }),
    ...(template.style ? { style: readStyle(template.style) } : {}),
    profiles: {
      phone: profileFromTemplate(template, "phone"),
      tablet: profileFromTemplate(template, "tablet"),
      desktop: profileFromTemplate(template, "desktop"),
    },
    createdAt: now,
    updatedAt: now,
  };
}

/* ---------------------------------------------------------------
 * Solving
 * ------------------------------------------------------------- */

export interface GridCell {
  id: HomeModuleId;
  /** 1-based grid lines, CSS-ready. */
  col: number;
  row: number;
  w: number;
  h: number;
}

export interface SolvedModule {
  id: HomeModuleId;
  /** Members of a tab group render inside their leader's cell. */
  members: HomeModuleId[];
  settings: ModuleSettings;
  cell?: GridCell;
  /** Absolute placement for orbit/spatial/freeform/float, 0..1 of the box. */
  rect?: NRect;
  /** Depth plane (spatial/layered): 0 near, 1 far. */
  depth?: number;
  /** Rotation in degrees (scatter). */
  tilt?: number;
}

export interface SolvedHome {
  kind: CompositionKind;
  device: DeviceClass;
  columns: number;
  rows: number;
  /** Modules laid out on the grid or on the canvas. */
  placed: SolvedModule[];
  /** Floating surfaces (mode float), drawn above the composition. */
  floating: SolvedModule[];
  /** Docked/minimised modules: chips in the Home dock. */
  docked: HomeModuleId[];
  hidden: HomeModuleId[];
  /** The layout's parameters for this device. */
  params: LayoutParams;
  /** Constellation links between modules. */
  links?: Array<[HomeModuleId, HomeModuleId]>;
}

/** Group leaders and their members, in order. Members of a group render in the leader's cell. */
function leaders(order: HomeModuleId[], modules: Record<HomeModuleId, ModuleSettings>, visible: (id: HomeModuleId) => boolean) {
  const out: Array<{ id: HomeModuleId; members: HomeModuleId[] }> = [];
  const seen = new Set<string>();
  for (const id of order) {
    if (!visible(id)) continue;
    const g = modules[id].group;
    if (g) {
      if (seen.has(g)) continue;
      seen.add(g);
      out.push({ id, members: order.filter((m) => modules[m].group === g && visible(m)) });
    } else out.push({ id, members: [id] });
  }
  return out;
}

function spanOf(id: HomeModuleId, settings: ModuleSettings, device: DeviceClass, kind: CompositionKind): [number, number] {
  const cols = COLUMNS[device];
  let [w, h] = SPAN[device][settings.size];
  if (kind === "grid") [w, h] = [device === "phone" ? 3 : cols / (device === "tablet" ? 2 : 3), 5];
  const strip = STRIP_ROWS[id];
  if (strip && w >= cols * 0.75) h = Math.min(h, strip);
  if (settings.collapsed) h = 2;
  return [Math.min(w, cols), h];
}

type SpanFn = (id: HomeModuleId, settings: ModuleSettings) => [number, number];

/** First-fit dense packing — deterministic, so a saved arrangement reproduces exactly. */
export function solveGrid(
  order: HomeModuleId[],
  modules: Record<HomeModuleId, ModuleSettings>,
  device: DeviceClass,
  kind: CompositionKind,
  span?: SpanFn,
  cols = COLUMNS[device],
): GridCell[] {
  const occupied: boolean[][] = [];
  const free = (r: number, c: number, w: number, h: number) => {
    for (let y = r; y < r + h; y += 1) for (let x = c; x < c + w; x += 1) if (occupied[y]?.[x]) return false;
    return true;
  };
  const fill = (r: number, c: number, w: number, h: number) => {
    for (let y = r; y < r + h; y += 1) {
      occupied[y] ??= [];
      for (let x = c; x < c + w; x += 1) occupied[y][x] = true;
    }
  };
  const cells: GridCell[] = [];
  // Pinned modules claim the first slots, whatever their order.
  const sorted = [...order].sort((a, b) => Number(modules[b].pinned) - Number(modules[a].pinned));
  for (const id of sorted) {
    const [w0, h] = span ? span(id, modules[id]) : spanOf(id, modules[id], device, kind);
    const w = Math.max(1, Math.min(cols, w0));
    let placed = false;
    for (let r = 0; !placed && r < 400; r += 1) {
      for (let c = 0; c + w <= cols; c += 1) {
        if (free(r, c, w, h)) {
          fill(r, c, w, h);
          cells.push({ id, col: c + 1, row: r + 1, w, h });
          placed = true;
          break;
        }
      }
    }
  }
  return cells;
}

const pinnedFirst = (order: HomeModuleId[], modules: Record<HomeModuleId, ModuleSettings>) =>
  [...order].sort((a, b) => Number(modules[b].pinned) - Number(modules[a].pinned));

/** Masonry: shortest-column-first, columns of equal width. */
function solveMasonry(order: HomeModuleId[], modules: Record<HomeModuleId, ModuleSettings>, device: DeviceClass, lanesParam?: number): { cells: GridCell[]; columns: number } {
  const lanes = clampInt(lanesParam ?? (device === "phone" ? 2 : device === "tablet" ? 3 : 4), 1, device === "phone" ? 3 : 6);
  const fits = COLUMNS[device] % lanes === 0;
  const columns = fits ? COLUMNS[device] : lanes;
  const laneW = columns / lanes;
  const heights = new Array(lanes).fill(0);
  const rowsFor: Record<ModuleSize, number> = { s: 4, m: 6, l: 8, xl: 10 };
  const cells = pinnedFirst(order, modules).map((id) => {
    const lane = heights.indexOf(Math.min(...heights));
    const h = modules[id].collapsed ? 2 : rowsFor[modules[id].size];
    const cell = { id, col: lane * laneW + 1, row: heights[lane] + 1, w: laneW, h };
    heights[lane] += h;
    return cell;
  });
  return { cells, columns };
}

/** Lanes (a board): contiguous runs of the order, one lane each, under optional headers. */
function solveLanes(order: HomeModuleId[], modules: Record<HomeModuleId, ModuleSettings>, device: DeviceClass, params: LayoutParams): { cells: GridCell[]; columns: number } {
  const lanes = clampInt(params.lanes ?? 3, 1, device === "phone" ? 2 : 6);
  const per = Math.ceil(order.length / lanes) || 1;
  const head = params.laneNames?.length ? 1 : 0;
  const rowsFor: Record<ModuleSize, number> = { s: 4, m: 5, l: 7, xl: 9 };
  const heights = new Array(lanes).fill(head);
  const cells = pinnedFirst(order, modules).map((id, i) => {
    const lane = Math.min(lanes - 1, Math.floor(i / per));
    const h = modules[id].collapsed ? 2 : rowsFor[modules[id].size];
    const cell = { id, col: lane + 1, row: heights[lane] + 1, w: 1, h };
    heights[lane] += h;
    return cell;
  });
  return { cells, columns: lanes };
}

/** Split: pinned + first half on the primary (wider) pane, the rest on the side. */
function solveSplit(order: HomeModuleId[], modules: Record<HomeModuleId, ModuleSettings>, device: DeviceClass, ratio = 7 / 12): GridCell[] {
  const cols = COLUMNS[device];
  const mainW = clampInt(Math.round(cols * ratio), 1, cols - 1);
  const list = pinnedFirst(order, modules);
  const half = Math.ceil(list.length / 2);
  const rows = [0, 0];
  const rowsFor: Record<ModuleSize, number> = { s: 4, m: 5, l: 6, xl: 8 };
  return list.map((id, i) => {
    const side = i < half ? 0 : 1;
    const h = modules[id].collapsed ? 2 : Math.min(rowsFor[modules[id].size], STRIP_ROWS[id] ?? 99);
    const cell = { id, col: side === 0 ? 1 : mainW + 1, row: rows[side] + 1, w: side === 0 ? mainW : cols - mainW, h };
    rows[side] += h;
    return cell;
  });
}

/** Stage: the first module on stage; the others in a strip beside it (below it on a phone). */
function solveStage(order: HomeModuleId[], modules: Record<HomeModuleId, ModuleSettings>, device: DeviceClass, ratio = 0.75): GridCell[] {
  const cols = COLUMNS[device];
  const list = pinnedFirst(order, modules);
  if (!list.length) return [];
  const [star, ...rest] = list;
  if (device === "phone") {
    const cells: GridCell[] = [{ id: star, col: 1, row: 1, w: cols, h: modules[star].collapsed ? 2 : 10 }];
    rest.forEach((id, i) => cells.push({ id, col: (i % 2) * 3 + 1, row: 11 + Math.floor(i / 2) * 4, w: 3, h: modules[id].collapsed ? 2 : 4 }));
    return cells;
  }
  const stripW = clampInt(Math.round(cols * (1 - ratio)), 2, cols - 4);
  const cells: GridCell[] = [];
  let row = 0;
  for (const id of rest) {
    const h = modules[id].collapsed ? 2 : 4;
    cells.push({ id, col: 1, row: row + 1, w: stripW, h });
    row += h;
  }
  cells.unshift({ id: star, col: stripW + 1, row: 1, w: cols - stripW, h: Math.max(14, row) });
  return cells;
}

/** Column: one module per row, full width — a feed, a briefing, a timeline. */
function solveColumn(order: HomeModuleId[], modules: Record<HomeModuleId, ModuleSettings>, device: DeviceClass): GridCell[] {
  const cols = COLUMNS[device];
  const rowsFor: Record<ModuleSize, number> = { s: 3, m: 5, l: 7, xl: 9 };
  let row = 0;
  return pinnedFirst(order, modules).map((id) => {
    const h = modules[id].collapsed ? 2 : Math.min(rowsFor[modules[id].size], id === "apps" ? 4 : id === "activity" || id === "ask" ? 3 : 99);
    const cell = { id, col: 1, row: row + 1, w: cols, h };
    row += h;
    return cell;
  });
}

/** Strip: every small module in one strip across the top (scorecards, story rings), the rest a bento below. */
function solveStrip(order: HomeModuleId[], modules: Record<HomeModuleId, ModuleSettings>, device: DeviceClass): GridCell[] {
  const cols = COLUMNS[device];
  const small = order.filter((id) => modules[id].size === "s");
  const perRow = Math.max(1, Math.min(small.length, device === "phone" ? 3 : 6));
  const w = Math.max(1, Math.floor(cols / perRow));
  const ordered = [...small, ...order.filter((id) => modules[id].size !== "s")];
  return solveGrid(ordered, Object.fromEntries(ordered.map((id) => [id, { ...modules[id], pinned: false }])) as Record<HomeModuleId, ModuleSettings>, device, "bento", (id, st) =>
    st.size === "s" ? [w, st.collapsed ? 2 : 3] : spanOf(id, st, device, "bento"),
  );
}

/** Rows: contiguous runs of the order, one horizontally scrolling row each. */
function solveRows(order: HomeModuleId[], modules: Record<HomeModuleId, ModuleSettings>, lanes = 3): GridCell[] {
  const list = pinnedFirst(order, modules);
  const n = clampInt(lanes, 1, Math.max(1, list.length));
  const per = Math.ceil(list.length / n) || 1;
  return list.map((id, i) => ({ id, col: (i % per) + 1, row: Math.floor(i / per) + 1, w: 1, h: 1 }));
}

function cellToRect(cell: GridCell, device: DeviceClass, all: GridCell[], cols = COLUMNS[device]): NRect {
  const rows = Math.max(1, ...all.map((c) => c.row + c.h - 1));
  return { x: (cell.col - 1) / cols, y: (cell.row - 1) / rows, w: cell.w / cols, h: cell.h / rows };
}

type Abs = { id: HomeModuleId; rect: NRect; depth: number; tilt?: number };

/** Orbit: the first module at the centre, the rest on an ellipse around it. */
function solveOrbit(ids: HomeModuleId[]): Abs[] {
  if (!ids.length) return [];
  const [center, ...ring] = ids;
  const out: Abs[] = [{ id: center, rect: { x: 0.36, y: 0.32, w: 0.28, h: 0.36 }, depth: 0 }];
  const n = ring.length;
  ring.forEach((id, i) => {
    const a = -Math.PI / 2 + (i / Math.max(1, n)) * Math.PI * 2;
    const w = 0.24;
    const h = 0.2;
    const cx = 0.5 + Math.cos(a) * 0.37;
    const cy = 0.5 + Math.sin(a) * 0.38;
    out.push({ id, rect: { x: clamp01(cx - w / 2, 1 - w), y: clamp01(cy - h / 2, 1 - h), w, h }, depth: Math.sin(a) < 0 ? 0.5 : 0 });
  });
  return out;
}

/** Spatial: two rows on two depth planes (near work below, far context above). */
function solveSpatial(ids: HomeModuleId[]): Abs[] {
  const near = ids.slice(0, Math.ceil(ids.length / 2));
  const far = ids.slice(near.length);
  const row = (list: HomeModuleId[], y: number, h: number, depth: number) =>
    list.map((id, i) => {
      const w = 0.94 / list.length;
      return { id, rect: { x: 0.03 + i * w, y, w: w - 0.012, h }, depth };
    });
  return [...row(far, 0.02, 0.36, 1), ...row(near, 0.44, 0.52, 0)];
}

/** Radial: the first module at the bottom centre, the rest fanned on an arc above it. */
function solveRadial(ids: HomeModuleId[]): Abs[] {
  if (!ids.length) return [];
  const [hub, ...arc] = ids;
  const out: Abs[] = [{ id: hub, rect: { x: 0.37, y: 0.66, w: 0.26, h: 0.3 }, depth: 0 }];
  const n = arc.length;
  arc.forEach((id, i) => {
    const a = Math.PI + ((i + 0.5) / Math.max(1, n)) * Math.PI;
    const w = 0.2;
    const h = 0.17;
    const cx = 0.5 + Math.cos(a) * 0.38;
    const cy = 0.78 + Math.sin(a) * 0.62;
    out.push({ id, rect: { x: clamp01(cx - w / 2, 1 - w), y: clamp01(cy - h / 2, 1 - h), w, h }, depth: 0 });
  });
  return out;
}

const NODE: Record<ModuleSize, [number, number]> = { s: [0.17, 0.15], m: [0.2, 0.18], l: [0.24, 0.21], xl: [0.28, 0.24] };

/** Constellation: the first module at the centre, the rest on a golden-angle spiral, linked like stars. */
function solveConstellation(ids: HomeModuleId[], modules: Record<HomeModuleId, ModuleSettings>): { nodes: Abs[]; links: Array<[HomeModuleId, HomeModuleId]> } {
  const nodes: Abs[] = [];
  const links: Array<[HomeModuleId, HomeModuleId]> = [];
  const n = ids.length;
  ids.forEach((id, i) => {
    const [w, h] = NODE[modules[id].size];
    if (i === 0) {
      nodes.push({ id, rect: { x: 0.5 - w / 2, y: 0.5 - h / 2, w, h }, depth: 0 });
      return;
    }
    const a = i * 2.39996 + 0.6;
    const r = 0.22 + 0.17 * Math.sqrt(i / Math.max(1, n - 1));
    const cx = 0.5 + Math.cos(a) * r * 1.05;
    const cy = 0.5 + Math.sin(a) * r * 1.12;
    nodes.push({ id, rect: { x: round4(clamp01(cx - w / 2, 1 - w)), y: round4(clamp01(cy - h / 2, 1 - h)), w, h }, depth: r > 0.33 ? 0.5 : 0 });
    links.push(i % 2 === 1 || i === 1 ? [ids[0], id] : [ids[i - 1], id]);
  });
  return { nodes, links };
}

/** A small stable hash: the same module always gets the same tilt and offset. */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/** Scatter: a bento, then each card dealt at its own small angle and offset. */
function solveScatter(ids: HomeModuleId[], modules: Record<HomeModuleId, ModuleSettings>, device: DeviceClass, tilt = 8): Abs[] {
  const cells = solveGrid(ids, modules, device, "bento");
  return cells.map((cell) => {
    const r = cellToRect(cell, device, cells);
    const k = hash(cell.id);
    const k2 = hash(`${cell.id}~`);
    const dx = (k2 - 0.5) * 0.04;
    const dy = (k - 0.5) * 0.04;
    const shrink = 0.9;
    const w = r.w * shrink;
    const h = r.h * shrink;
    return {
      id: cell.id,
      rect: { x: round4(clamp01(r.x + (r.w - w) / 2 + dx, 1 - w)), y: round4(clamp01(r.y + (r.h - h) / 2 + dy, 1 - h)), w: round4(w), h: round4(h) },
      depth: 0,
      tilt: Math.round((k * 2 - 1) * Math.max(0, Math.min(20, tilt)) * 10) / 10,
    };
  });
}

/** Two zones: the first three modules in an orbit band on top, a bento of the rest below. */
function solveTwoZone(ids: HomeModuleId[], modules: Record<HomeModuleId, ModuleSettings>, device: DeviceClass): Abs[] {
  const band = ids.slice(0, 3);
  const rest = ids.slice(3);
  const top = 0.4;
  const out: Abs[] = [];
  const bandRects: NRect[] = [
    { x: 0.35, y: 0.01, w: 0.3, h: top - 0.03 },
    { x: 0.03, y: 0.07, w: 0.29, h: top - 0.14 },
    { x: 0.68, y: 0.07, w: 0.29, h: top - 0.14 },
  ];
  band.forEach((id, i) => out.push({ id, rect: bandRects[i], depth: i === 0 ? 0 : 0.5 }));
  const cells = solveGrid(rest, modules, device, "bento");
  for (const cell of cells) {
    const r = cellToRect(cell, device, cells);
    out.push({ id: cell.id, rect: { x: r.x, y: round4(top + r.y * (1 - top)), w: r.w, h: round4(r.h * (1 - top)) }, depth: 0 });
  }
  return out;
}

const clamp01 = (v: number, max = 1) => Math.max(0, Math.min(max, v));
const clampInt = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));

export interface SolveOptions {
  /** Overrides the layout's kind for this render (time-of-day layouts). */
  kind?: CompositionKind;
}

export function solveHome(presentation: HomePresentation, device: DeviceClass, options: SolveOptions = {}): SolvedHome {
  const template = layoutOf(presentation);
  const kind = options.kind ?? template.kind[device];
  const params = paramsFor(template, device);
  const profile = presentation.profiles[device];
  const { modules } = profile;
  const order = sanitizeOrder(profile.order);
  const hidden = order.filter((id) => modules[id].hidden);
  const docked = order.filter((id) => !modules[id].hidden && modules[id].mode === "dock");
  const floatingIds = order.filter((id) => !modules[id].hidden && modules[id].mode === "float" && kind !== "freeform");
  const inFlow = (id: HomeModuleId) => !modules[id].hidden && (kind === "freeform" ? modules[id].mode !== "dock" : modules[id].mode === "grid");
  const groups = leaders(order, modules, inFlow);
  const flowIds = groups.map((g) => g.id);
  const membersOf = new Map(groups.map((g) => [g.id, g.members]));
  const mk = (id: HomeModuleId): SolvedModule => ({ id, members: membersOf.get(id) ?? [id], settings: modules[id] });

  let placed: SolvedModule[] = [];
  let rows = 0;
  let columns = COLUMNS[device];
  let links: Array<[HomeModuleId, HomeModuleId]> | undefined;
  const fromAbs = (list: Abs[]) => list.map((s) => ({ ...mk(s.id), rect: s.rect, depth: s.depth, ...(s.tilt ? { tilt: s.tilt } : {}) }));
  const fromCells = (cells: GridCell[]) => {
    placed = cells.map((cell) => ({ ...mk(cell.id), cell, depth: kind === "layered" ? (cell.row > 3 ? 1 : 0) : undefined }));
    rows = Math.max(0, ...cells.map((c) => c.row + c.h - 1));
  };

  switch (kind) {
    case "orbit":
      placed = fromAbs(solveOrbit(flowIds));
      break;
    case "spatial":
      placed = fromAbs(solveSpatial(flowIds));
      break;
    case "radial":
      placed = fromAbs(solveRadial(flowIds));
      break;
    case "scatter":
      placed = fromAbs(solveScatter(flowIds, modules, device, params.tilt));
      break;
    case "twozone":
      placed = fromAbs(solveTwoZone(flowIds, modules, device));
      break;
    case "constellation": {
      const c = solveConstellation(flowIds, modules);
      placed = fromAbs(c.nodes);
      links = params.links === false ? [] : c.links;
      break;
    }
    case "freeform": {
      const fallback = solveGrid(flowIds, modules, device, "bento");
      placed = flowIds.map((id) => {
        const cell = fallback.find((c) => c.id === id)!;
        return { ...mk(id), rect: modules[id].float ?? cellToRect(cell, device, fallback) };
      });
      break;
    }
    case "deck":
      placed = flowIds.map((id, i) => ({ ...mk(id), cell: { id, col: i + 1, row: 1, w: 1, h: 1 } }));
      rows = 1;
      columns = flowIds.length;
      break;
    case "rows": {
      const cells = solveRows(flowIds, modules, params.lanes ?? 3);
      placed = cells.map((cell) => ({ ...mk(cell.id), cell }));
      rows = Math.max(0, ...cells.map((c) => c.row));
      columns = Math.max(1, ...cells.map((c) => c.col));
      break;
    }
    case "masonry": {
      const m = solveMasonry(flowIds, modules, device, params.lanes);
      fromCells(m.cells);
      columns = m.columns;
      break;
    }
    case "lanes": {
      const m = solveLanes(flowIds, modules, device, params);
      fromCells(m.cells);
      columns = m.columns;
      break;
    }
    case "split":
      fromCells(solveSplit(flowIds, modules, device, params.ratio));
      break;
    case "stage":
      fromCells(solveStage(flowIds, modules, device, params.ratio));
      break;
    case "column":
      fromCells(solveColumn(flowIds, modules, device));
      break;
    case "strip":
      fromCells(solveStrip(flowIds, modules, device));
      break;
    default:
      fromCells(solveGrid(flowIds, modules, device, kind === "focus" ? "bento" : kind));
  }
  const floating = floatingIds.map((id) => ({ ...mk(id), rect: modules[id].float ?? { x: 0.55, y: 0.1, w: 0.4, h: 0.3 } }));
  return { kind, device, columns, rows, placed, floating, docked, hidden, params, ...(links ? { links } : {}) };
}

function sanitizeOrder(order: HomeModuleId[]): HomeModuleId[] {
  const seen = new Set<HomeModuleId>();
  const out: HomeModuleId[] = [];
  for (const id of order) {
    if ((HOME_MODULES as readonly string[]).includes(id) && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of HOME_MODULES) if (!seen.has(id)) out.push(id);
  return out;
}

/* ---------------------------------------------------------------
 * Operations — each returns a NEW presentation (or the same object
 * when refused, e.g. a locked module), touching ONE device profile.
 * ------------------------------------------------------------- */

export type HomeOp =
  | { op: "move"; id: HomeModuleId; before: HomeModuleId | null }
  | { op: "shift"; id: HomeModuleId; delta: number }
  | { op: "resize"; id: HomeModuleId; size: ModuleSize }
  | { op: "grow"; id: HomeModuleId; delta: 1 | -1 }
  | { op: "toggle"; id: HomeModuleId; flag: "hidden" | "pinned" | "locked" | "collapsed" }
  | { op: "float"; id: HomeModuleId; rect?: NRect }
  | { op: "place"; id: HomeModuleId; rect: NRect }
  | { op: "dock"; id: HomeModuleId }
  | { op: "restore"; id: HomeModuleId }
  | { op: "group"; id: HomeModuleId; with: HomeModuleId }
  | { op: "ungroup"; id: HomeModuleId };

/** Ops a locked module refuses (it can still be unlocked, shown or hidden). */
const LOCK_GUARDED = new Set<HomeOp["op"]>(["move", "shift", "resize", "grow", "float", "place", "dock", "group", "ungroup"]);

export const SNAP = 0.02;
export function snap(v: number, step = SNAP): number {
  return Math.round(v / step) * step;
}

/** Snap a floating rect to the grid and to the box edges, and keep it inside. */
export function snapRect(rect: NRect, others: NRect[] = []): NRect {
  let { x, y, w, h } = rect;
  w = Math.max(0.12, Math.min(1, snap(w)));
  h = Math.max(0.08, Math.min(1, snap(h)));
  x = snap(Math.max(0, Math.min(1 - w, x)));
  y = snap(Math.max(0, Math.min(1 - h, y)));
  // Align: an edge within 1.5 snap steps of another surface's edge joins it.
  const near = (a: number, b: number) => Math.abs(a - b) < SNAP * 1.5;
  for (const o of others) {
    if (near(x, o.x)) x = o.x;
    if (near(x, o.x + o.w)) x = o.x + o.w;
    if (near(y, o.y)) y = o.y;
    if (near(y, o.y + o.h)) y = o.y + o.h;
  }
  return { x: round4(x), y: round4(y), w: round4(w), h: round4(h) };
}
const round4 = (v: number) => Math.round(v * 10000) / 10000;

export function applyHomeOp(p: HomePresentation, device: DeviceClass, op: HomeOp, now = Date.now()): HomePresentation {
  const profile = p.profiles[device];
  const current = profile.modules[op.id];
  if (!current) return p;
  if (current.locked && LOCK_GUARDED.has(op.op)) return p;
  let order = sanitizeOrder(profile.order);
  const modules = { ...profile.modules };
  const set = (id: HomeModuleId, patch: Partial<ModuleSettings>) => (modules[id] = { ...modules[id], ...patch });

  switch (op.op) {
    case "move": {
      if (op.before === op.id) return p;
      order = order.filter((id) => id !== op.id);
      const at = op.before ? order.indexOf(op.before) : -1;
      order.splice(at < 0 ? order.length : at, 0, op.id);
      break;
    }
    case "shift": {
      const i = order.indexOf(op.id);
      const j = Math.max(0, Math.min(order.length - 1, i + op.delta));
      if (i === j) return p;
      order.splice(i, 1);
      order.splice(j, 0, op.id);
      break;
    }
    case "resize":
      set(op.id, { size: op.size, collapsed: false });
      break;
    case "grow": {
      const i = SIZES.indexOf(current.size) + op.delta;
      if (i < 0 || i >= SIZES.length) return p;
      set(op.id, { size: SIZES[i], collapsed: false });
      break;
    }
    case "toggle":
      set(op.id, { [op.flag]: !current[op.flag] } as Partial<ModuleSettings>);
      break;
    case "float":
      set(op.id, { mode: "float", float: snapRect(op.rect ?? current.float ?? { x: 0.52, y: 0.08, w: 0.42, h: 0.32 }), group: undefined });
      break;
    case "place": {
      const others = order.filter((id) => id !== op.id && modules[id].float).map((id) => modules[id].float!);
      set(op.id, { mode: "float", float: snapRect(op.rect, others) });
      break;
    }
    case "dock":
      set(op.id, { mode: "dock" });
      break;
    case "restore":
      set(op.id, { mode: layoutOf(p).kind[device] === "freeform" ? "float" : "grid", hidden: false });
      break;
    case "group": {
      if (op.with === op.id || modules[op.with].locked) return p;
      const gid = modules[op.with].group ?? `g-${op.with}`;
      set(op.with, { group: gid, mode: "grid" });
      set(op.id, { group: gid, mode: "grid" });
      // Keep the group contiguous: the joining module moves next to its leader.
      order = order.filter((id) => id !== op.id);
      order.splice(order.indexOf(op.with) + 1, 0, op.id);
      break;
    }
    case "ungroup": {
      const gid = current.group;
      if (!gid) return p;
      set(op.id, { group: undefined });
      const rest = order.filter((id) => modules[id].group === gid);
      if (rest.length === 1) set(rest[0], { group: undefined });
      break;
    }
  }
  return { ...p, updatedAt: now, profiles: { ...p.profiles, [device]: { order, modules } } };
}

/* ---------------------------------------------------------------
 * Adaptive ordering (Adaptive Intelligence): a pure function of the
 * live signals, applied at render time — it never rewrites the saved
 * order, so the person's arrangement is not silently overwritten.
 * ------------------------------------------------------------- */

export interface HomeSignals {
  working: boolean;
  unread: number;
  approvals: number;
  openWindows: number;
}

export function adaptiveOrder(order: HomeModuleId[], signals: HomeSignals): HomeModuleId[] {
  const score = (id: HomeModuleId): number => {
    switch (id) {
      case "notifications":
        return signals.approvals * 3 + signals.unread;
      case "now":
      case "activity":
        return signals.working ? 4 : 0;
      case "workspaces":
        return signals.openWindows > 0 ? 3 : 0;
      default:
        return 0;
    }
  };
  return order
    .map((id, index) => ({ id, index, s: score(id) }))
    .sort((a, b) => b.s - a.s || a.index - b.index)
    .map((x) => x.id);
}

/** Time of day (Time-of-day Home): which modules lead in each part of the day. */
export type DayPart = "morning" | "day" | "evening" | "night";
export function dayPart(hour: number): DayPart {
  if (hour >= 5 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "day";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}
const DAY_LEAD: Record<DayPart, HomeModuleId[]> = {
  morning: ["weather", "now", "notifications", "ask"],
  day: ["workspaces", "apps", "now", "notifications"],
  evening: ["activity", "library", "lelu", "workspaces"],
  night: ["lelu", "ask", "weather"],
};
/** At night a time-of-day Home calms down to a focus layout. */
export function timeKind(kind: CompositionKind, hour: number): CompositionKind {
  return dayPart(hour) === "night" ? "focus" : kind;
}
export function timeOrder(order: HomeModuleId[], hour: number): HomeModuleId[] {
  const lead = DAY_LEAD[dayPart(hour)].filter((id) => order.includes(id));
  return [...lead, ...order.filter((id) => !lead.includes(id))];
}

/** Usage-learned order: most-opened first; ties keep her order. Computed at render, never saved. */
export function usageOrder(order: HomeModuleId[], counts: Partial<Record<HomeModuleId, number>>): HomeModuleId[] {
  return order
    .map((id, index) => ({ id, index, n: counts[id] ?? 0 }))
    .sort((a, b) => b.n - a.n || a.index - b.index)
    .map((x) => x.id);
}

/** Which adaptive mode a layout uses (the original Adaptive Intelligence keeps "signals"). */
export function adaptiveModeOf(layout: HomeTemplate, device: DeviceClass): AdaptiveMode {
  return paramsFor(layout, device).adaptive ?? (layout.id === "adaptive-intelligence" ? "signals" : "none");
}

export function cloneLayout(layout: HomeTemplate): HomeTemplate {
  return JSON.parse(JSON.stringify(layout)) as HomeTemplate;
}

const KIND_IDS = new Set<string>(COMPOSITION_KINDS.map((k) => k.id));
const isModule = (v: unknown): v is HomeModuleId => typeof v === "string" && (HOME_MODULES as readonly string[]).includes(v);
const moduleList = (v: unknown): HomeModuleId[] | undefined => (Array.isArray(v) ? v.filter(isModule) : undefined);
const sizeMap = (v: unknown): Partial<Record<HomeModuleId, ModuleSize>> => {
  const out: Partial<Record<HomeModuleId, ModuleSize>> = {};
  if (v && typeof v === "object") for (const [k, size] of Object.entries(v)) if (isModule(k) && SIZES.includes(size as ModuleSize)) out[k] = size as ModuleSize;
  return out;
};
function readParams(v: unknown): LayoutParams | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Record<string, unknown>;
  const num = (x: unknown, lo: number, hi: number) => (typeof x === "number" && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : undefined);
  const out: LayoutParams = {
    lanes: num(r.lanes, 1, 6),
    ratio: num(r.ratio, 0.2, 0.9),
    density: num(r.density, 0, 1),
    tilt: num(r.tilt, 0, 20),
    depth: num(r.depth, 0, 1),
    maxWidth: num(r.maxWidth, 0, 2000),
    window: num(r.window, 0, 0.6),
    links: typeof r.links === "boolean" ? r.links : undefined,
    groupView: r.groupView === "stack" || r.groupView === "tabs" ? r.groupView : undefined,
    adaptive: r.adaptive === "signals" || r.adaptive === "time" || r.adaptive === "usage" || r.adaptive === "none" ? r.adaptive : undefined,
    stacked: typeof r.stacked === "boolean" ? r.stacked : undefined,
    rail: typeof r.rail === "boolean" ? r.rail : undefined,
    rings: typeof r.rings === "boolean" ? r.rings : undefined,
    laneNames: Array.isArray(r.laneNames) ? r.laneNames.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 24)).slice(0, 6) : undefined,
  };
  for (const k of Object.keys(out) as Array<keyof LayoutParams>) if (out[k] === undefined) delete out[k];
  return out;
}

function readGroups(v: unknown): Array<{ id: string; members: HomeModuleId[] }> | undefined {
  if (!Array.isArray(v)) return undefined;
  return (v as Array<Record<string, unknown>>)
    .filter((g) => g && typeof g.id === "string")
    .map((g) => ({ id: String(g.id).slice(0, 40), members: moduleList(g.members) ?? [] }))
    .filter((g) => g.members.length > 1);
}
function rectMap(v: unknown): Partial<Record<HomeModuleId, NRect>> | undefined {
  if (!v || typeof v !== "object") return undefined;
  const out: Partial<Record<HomeModuleId, NRect>> = {};
  for (const [k, r] of Object.entries(v as Record<string, Partial<NRect>>)) {
    if (isModule(k) && r && [r.x, r.y, r.w, r.h].every((n) => typeof n === "number" && Number.isFinite(n))) out[k] = snapRect(r as NRect);
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Her current arrangement as a reusable LAYOUT: the kind and parameters
 * of the layout it follows, plus every device's order, sizes, hidden,
 * docked, pinned, collapsed, floating and grouped modules — so a layout
 * saved from a presentation reproduces it exactly.
 */
export function layoutFromPresentation(p: HomePresentation, id: string, name: string): HomeTemplate {
  const base = layoutOf(p);
  const device: Partial<Record<DeviceClass, DeviceOverride>> = {};
  for (const d of DEVICE_CLASSES) {
    const prof = p.profiles[d];
    const order = sanitizeOrder(prof.order);
    const pick = (f: (m: ModuleSettings) => boolean) => order.filter((m) => f(prof.modules[m]));
    const floats: Partial<Record<HomeModuleId, NRect>> = {};
    for (const m of order) if (prof.modules[m].mode === "float" && prof.modules[m].float) floats[m] = prof.modules[m].float!;
    const groupIds = [...new Set(order.map((m) => prof.modules[m].group).filter((g): g is string => Boolean(g)))];
    device[d] = {
      order,
      sizes: Object.fromEntries(order.map((m) => [m, prof.modules[m].size])),
      hidden: pick((m) => m.hidden),
      docked: pick((m) => m.mode === "dock"),
      pinned: pick((m) => m.pinned),
      collapsed: pick((m) => m.collapsed),
      floats,
      groups: groupIds.map((g) => ({ id: g, members: order.filter((m) => prof.modules[m].group === g) })).filter((g) => g.members.length > 1),
    };
  }
  return {
    ...cloneLayout(base),
    id,
    name: name.slice(0, 60),
    order: device.desktop!.order!,
    // Optional modules she showed stay shown wherever the layout is used.
    device,
    style: p.style ?? base.style,
    parents: [...new Set([...(base.parents ?? []), base.id])].slice(0, 8),
    custom: true,
  };
}

/** A saved layout recipe, read defensively (unknown kinds fall back to bento; unknown modules are dropped). */
export function readLayout(raw: unknown): HomeTemplate | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  const kindRaw = (r.kind ?? {}) as Record<string, unknown>;
  const kind = {} as Record<DeviceClass, CompositionKind>;
  for (const d of DEVICE_CLASSES) kind[d] = typeof kindRaw[d] === "string" && KIND_IDS.has(kindRaw[d] as string) ? (kindRaw[d] as CompositionKind) : "bento";
  const device: HomeTemplate["device"] = {};
  const deviceParams: HomeTemplate["deviceParams"] = {};
  const dRaw = (r.device ?? {}) as Record<string, Record<string, unknown>>;
  const dpRaw = (r.deviceParams ?? {}) as Record<string, unknown>;
  for (const d of DEVICE_CLASSES) {
    const o = dRaw[d];
    if (o && typeof o === "object") {
      const ov: DeviceOverride = { sizes: sizeMap(o.sizes), hidden: moduleList(o.hidden), docked: moduleList(o.docked), order: moduleList(o.order), pinned: moduleList(o.pinned), collapsed: moduleList(o.collapsed), floats: rectMap(o.floats), groups: readGroups(o.groups) };
      for (const k of Object.keys(ov) as Array<keyof DeviceOverride>) if (ov[k] === undefined) delete ov[k];
      device[d] = ov;
    }
    const dp = readParams(dpRaw[d]);
    if (dp) deviceParams[d] = dp;
  }
  const groups = readGroups(r.groups);
  const style = readStyle(r.style);
  return {
    id: r.id.slice(0, 80),
    name: r.name.slice(0, 60) || "Layout",
    blurb: typeof r.blurb === "string" ? r.blurb.slice(0, 400) : "",
    kind,
    order: sanitizeOrder(moduleList(r.order) ?? []).filter((id) => !OPTIONAL_MODULES.includes(id) || (moduleList(r.order) ?? []).includes(id)),
    sizes: sizeMap(r.sizes),
    device,
    deviceParams,
    params: readParams(r.params),
    pinned: moduleList(r.pinned),
    hidden: moduleList(r.hidden),
    docked: moduleList(r.docked),
    collapsed: moduleList(r.collapsed),
    floats: rectMap(r.floats),
    groups,
    ...(style ? { style } : {}),
    ...(typeof r.concept === "number" ? { concept: r.concept } : {}),
    ...(Array.isArray(r.parents) ? { parents: (r.parents as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 8) } : {}),
    ...(r.custom ? { custom: true } : {}),
  };
}

/* ---------------------------------------------------------------
 * Reading saved data defensively: unknown templates fall back,
 * missing modules are filled, nothing unreadable is invented.
 * ------------------------------------------------------------- */

export function readPresentation(raw: unknown): HomePresentation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<HomePresentation>;
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  const recipe = readLayout(r.recipe);
  const template = recipe ?? templateFor(String(r.template ?? ""));
  const style = readStyle(r.style);
  const profiles = {} as Record<DeviceClass, DeviceProfile>;
  for (const device of DEVICE_CLASSES) {
    const saved = r.profiles?.[device];
    const base = profileFromTemplate(template, device);
    if (!saved || !Array.isArray(saved.order) || !saved.modules) {
      profiles[device] = base;
      continue;
    }
    const modules = { ...base.modules };
    for (const id of HOME_MODULES) {
      const m = (saved.modules as Partial<Record<HomeModuleId, Partial<ModuleSettings>>>)[id];
      if (m && typeof m === "object") {
        modules[id] = {
          ...base.modules[id],
          ...m,
          size: SIZES.includes(m.size as ModuleSize) ? (m.size as ModuleSize) : base.modules[id].size,
          mode: m.mode === "float" || m.mode === "dock" || m.mode === "grid" ? m.mode : base.modules[id].mode,
        };
      }
    }
    profiles[device] = { order: sanitizeOrder(saved.order as HomeModuleId[]), modules };
  }
  return {
    id: r.id,
    name: r.name.slice(0, 60) || template.name,
    template: recipe ? String(r.template ?? recipe.id) : template.id,
    ...(recipe ? { recipe } : {}),
    ...(style ? { style } : {}),
    profiles,
    createdAt: Number(r.createdAt) || 0,
    updatedAt: Number(r.updatedAt) || 0,
  };
}
