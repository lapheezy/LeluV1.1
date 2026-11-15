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

export const HOME_MODULES = ["weather", "lelu", "now", "apps", "workspaces", "notifications", "library", "activity"] as const;
export type HomeModuleId = (typeof HOME_MODULES)[number];

export type DeviceClass = "phone" | "tablet" | "desktop";
export const DEVICE_CLASSES: DeviceClass[] = ["phone", "tablet", "desktop"];

/** Layout families the engine can solve. */
export type CompositionKind = "bento" | "grid" | "masonry" | "split" | "orbit" | "spatial" | "focus" | "deck" | "layered" | "freeform";

export type TemplateId =
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
  template: TemplateId;
  profiles: Record<DeviceClass, DeviceProfile>;
  createdAt: number;
  updatedAt: number;
}

export interface HomeTemplate {
  id: TemplateId;
  name: string;
  /** One line: what the composition is for. */
  blurb: string;
  kind: Record<DeviceClass, CompositionKind>;
  order: HomeModuleId[];
  sizes: Partial<Record<HomeModuleId, ModuleSize>>;
  /** Overrides per device (e.g. phone hides the library). */
  device?: Partial<Record<DeviceClass, { sizes?: Partial<Record<HomeModuleId, ModuleSize>>; hidden?: HomeModuleId[]; docked?: HomeModuleId[]; order?: HomeModuleId[] }>>;
  pinned?: HomeModuleId[];
  hidden?: HomeModuleId[];
  docked?: HomeModuleId[];
  groups?: Array<{ id: string; members: HomeModuleId[] }>;
}

export const MODULE_LABEL: Record<HomeModuleId, string> = {
  weather: "Weather",
  lelu: "LÉLU",
  now: "Now",
  apps: "Apps",
  workspaces: "Active Workspaces",
  notifications: "Notifications",
  library: "App Library",
  activity: "Activity",
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
    s.hidden = Boolean(template.hidden?.includes(id) || over.hidden?.includes(id));
    s.pinned = Boolean(template.pinned?.includes(id));
    if (template.docked?.includes(id) || over.docked?.includes(id)) s.mode = "dock";
    const group = template.groups?.find((g) => g.members.includes(id));
    if (group) s.group = group.id;
    modules[id] = s;
  }
  if (template.kind[device] === "freeform") {
    const cells = solveGrid(order, modules, device, "bento");
    for (const cell of cells) modules[cell.id].float = cellToRect(cell, device, cells);
    for (const id of ALL) if (modules[id].float) modules[id].mode = "float";
  }
  return { order, modules };
}

let counter = 0;
export function newPresentationId(now = Date.now()): string {
  counter += 1;
  return `hp-${now.toString(36)}-${counter.toString(36)}`;
}

export function presentationFromTemplate(templateId: TemplateId, name?: string, now = Date.now()): HomePresentation {
  const template = templateFor(templateId);
  return {
    id: newPresentationId(now),
    name: name ?? template.name,
    template: template.id,
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

/** First-fit dense packing — deterministic, so a saved arrangement reproduces exactly. */
export function solveGrid(
  order: HomeModuleId[],
  modules: Record<HomeModuleId, ModuleSettings>,
  device: DeviceClass,
  kind: CompositionKind,
): GridCell[] {
  const cols = COLUMNS[device];
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
    const [w, h] = spanOf(id, modules[id], device, kind);
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

/** Masonry: shortest-column-first, columns of equal width. */
function solveMasonry(order: HomeModuleId[], modules: Record<HomeModuleId, ModuleSettings>, device: DeviceClass): GridCell[] {
  const lanes = device === "phone" ? 2 : device === "tablet" ? 3 : 4;
  const laneW = COLUMNS[device] / lanes;
  const heights = new Array(lanes).fill(0);
  const rowsFor: Record<ModuleSize, number> = { s: 4, m: 6, l: 8, xl: 10 };
  return order.map((id) => {
    const lane = heights.indexOf(Math.min(...heights));
    const h = modules[id].collapsed ? 2 : rowsFor[modules[id].size];
    const cell = { id, col: lane * laneW + 1, row: heights[lane] + 1, w: laneW, h };
    heights[lane] += h;
    return cell;
  });
}

/** Split: pinned + first half on the primary (wider) pane, the rest on the side. */
function solveSplit(order: HomeModuleId[], modules: Record<HomeModuleId, ModuleSettings>, device: DeviceClass): GridCell[] {
  const cols = COLUMNS[device];
  const mainW = Math.round(cols * (7 / 12));
  const half = Math.ceil(order.length / 2);
  const rows = [0, 0];
  const rowsFor: Record<ModuleSize, number> = { s: 4, m: 5, l: 6, xl: 8 };
  return order.map((id, i) => {
    const side = i < half ? 0 : 1;
    const h = modules[id].collapsed ? 2 : Math.min(rowsFor[modules[id].size], STRIP_ROWS[id] ?? 99);
    const cell = { id, col: side === 0 ? 1 : mainW + 1, row: rows[side] + 1, w: side === 0 ? mainW : cols - mainW, h };
    rows[side] += h;
    return cell;
  });
}

function cellToRect(cell: GridCell, device: DeviceClass, all: GridCell[]): NRect {
  const cols = COLUMNS[device];
  const rows = Math.max(1, ...all.map((c) => c.row + c.h - 1));
  return { x: (cell.col - 1) / cols, y: (cell.row - 1) / rows, w: cell.w / cols, h: cell.h / rows };
}

/** Orbit: the first module at the centre, the rest on an ellipse around it. */
function solveOrbit(ids: HomeModuleId[]): Array<{ id: HomeModuleId; rect: NRect; depth: number }> {
  if (!ids.length) return [];
  const [center, ...ring] = ids;
  const out = [{ id: center, rect: { x: 0.36, y: 0.32, w: 0.28, h: 0.36 }, depth: 0 }];
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
function solveSpatial(ids: HomeModuleId[]): Array<{ id: HomeModuleId; rect: NRect; depth: number }> {
  const near = ids.slice(0, Math.ceil(ids.length / 2));
  const far = ids.slice(near.length);
  const row = (list: HomeModuleId[], y: number, h: number, depth: number) =>
    list.map((id, i) => {
      const w = 0.94 / list.length;
      return { id, rect: { x: 0.03 + i * w, y, w: w - 0.012, h }, depth };
    });
  return [...row(far, 0.02, 0.36, 1), ...row(near, 0.44, 0.52, 0)];
}

const clamp01 = (v: number, max = 1) => Math.max(0, Math.min(max, v));

export function solveHome(presentation: HomePresentation, device: DeviceClass): SolvedHome {
  const template = templateFor(presentation.template);
  const kind = template.kind[device];
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
  if (kind === "orbit" || kind === "spatial") {
    const solved = kind === "orbit" ? solveOrbit(flowIds) : solveSpatial(flowIds);
    placed = solved.map((s) => ({ ...mk(s.id), rect: s.rect, depth: s.depth }));
  } else if (kind === "freeform") {
    const fallback = solveGrid(flowIds, modules, device, "bento");
    placed = flowIds.map((id) => {
      const cell = fallback.find((c) => c.id === id)!;
      return { ...mk(id), rect: modules[id].float ?? cellToRect(cell, device, fallback) };
    });
  } else if (kind === "deck") {
    placed = flowIds.map((id, i) => ({ ...mk(id), cell: { id, col: i + 1, row: 1, w: 1, h: 1 } }));
    rows = 1;
  } else {
    const cells =
      kind === "masonry"
        ? solveMasonry(flowIds, modules, device)
        : kind === "split"
          ? solveSplit(flowIds, modules, device)
          : solveGrid(flowIds, modules, device, kind === "focus" ? "bento" : kind);
    placed = cells.map((cell) => ({ ...mk(cell.id), cell, depth: kind === "layered" ? (cell.row > 3 ? 1 : 0) : undefined }));
    rows = Math.max(0, ...cells.map((c) => c.row + c.h - 1));
  }
  const floating = floatingIds.map((id) => ({ ...mk(id), rect: modules[id].float ?? { x: 0.55, y: 0.1, w: 0.4, h: 0.3 } }));
  return { kind, device, columns: kind === "deck" ? flowIds.length : COLUMNS[device], rows, placed, floating, docked, hidden };
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
      set(op.id, { mode: templateFor(p.template).kind[device] === "freeform" ? "float" : "grid", hidden: false });
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

/* ---------------------------------------------------------------
 * Reading saved data defensively: unknown templates fall back,
 * missing modules are filled, nothing unreadable is invented.
 * ------------------------------------------------------------- */

export function readPresentation(raw: unknown): HomePresentation | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<HomePresentation>;
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  const template = templateFor(String(r.template ?? ""));
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
    template: template.id,
    profiles,
    createdAt: Number(r.createdAt) || 0,
    updatedAt: Number(r.updatedAt) || 0,
  };
}
