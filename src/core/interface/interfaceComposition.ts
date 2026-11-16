/**
 * ==========================================================
 * LÉLU — INTERFACE COMPOSITION RULES (Mission 17)
 *
 * A composition is an ordered set of REGIONS, each a reference to a
 * catalogued interface (InterfaceCatalog). Composing never copies an
 * interface's code or data: a region is a pointer plus presentation
 * (label, size, the seam into the next region). That is what makes the
 * guarantees below cheap and true:
 *
 *   - editing a composition can never change an interface;
 *   - built-in compositions are read-only — an edit forks a copy and
 *     the original stays exactly as it was;
 *   - a clone is independent (its own id, its own history) and records
 *     where it came from (lineage);
 *   - merge / split / variants all produce NEW compositions, so any
 *     result can itself be composed again (recursive).
 *
 * Pure functions over plain data. Persistence lives in
 * InterfaceCompositionStore; rendering in genesis/interfaces/*.
 * ==========================================================
 */

import { INTERFACES, interfaceById, isInterfaceId, type InterfaceId } from "./InterfaceCatalog";

export type Flow = "vertical" | "horizontal";
export type RegionSize = "screen" | "tall" | "compact";
export type Seam = "blend" | "portal" | "cut";

export interface CompositionRegion {
  /** Unique within the composition; stable across reorders. */
  key: string;
  interfaceId: InterfaceId;
  /** Optional override of the interface's name inside this composition. */
  label?: string;
  size: RegionSize;
}

export interface Bookmark {
  name: string;
  regionKey: string;
}

export interface InterfaceComposition {
  id: string;
  name: string;
  description: string;
  flow: Flow;
  seam: Seam;
  regions: CompositionRegion[];
  /** Built-ins ship with LÉLU and are never mutated. */
  builtIn: boolean;
  /** The composition this was made from (clone, fork, variant, merge, split). */
  parentId: string | null;
  /** Every ancestor, oldest first, with how each step was made. */
  lineage: Array<{ id: string; name: string; how: LineageStep }>;
  bookmarks: Bookmark[];
  /** Where the person was when they last left it — the return path. */
  lastRegionKey: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
}

export type LineageStep = "clone" | "fork" | "variant" | "merge" | "split";

let counter = 0;
export function newId(prefix: string, now: number = Date.now()): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}-${now.toString(36)}-${counter.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function region(interfaceId: InterfaceId, key?: string, size: RegionSize = "screen"): CompositionRegion {
  return { key: key ?? newId("r"), interfaceId, size };
}

/** The compositions LÉLU ships with. Read-only. */
export function builtInCompositions(now = 0): InterfaceComposition[] {
  const base = (id: string, name: string, description: string, ids: InterfaceId[], flow: Flow = "vertical", seam: Seam = "blend"): InterfaceComposition => ({
    id,
    name,
    description,
    flow,
    seam,
    regions: ids.map((iid, i) => region(iid, `${id}-${i}-${iid}`)),
    builtIn: true,
    parentId: null,
    lineage: [],
    bookmarks: [],
    lastRegionKey: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
  return [
    base(
      "one-lelu",
      "One LÉLU",
      "Every interface she has, in one continuous universe: the original LÉLU, her Room, the Cosmos and the System.",
      ["og-inner-sky", "lelu-room", "cosmos", "lelu-system", "og-core"],
    ),
    base(
      "original-and-room",
      "Original LÉLU + LÉLU's Room",
      "The original companion app flowing straight into Genesis V2.",
      ["og-inner-sky", "lelu-room"],
    ),
    base(
      "room-and-cosmos",
      "LÉLU's Room + Cosmos",
      "Genesis V2's Core and heartbeat, then out into the living Neural Map.",
      ["lelu-room", "cosmos", "lelu-system"],
      "horizontal",
      "portal",
    ),
  ];
}

/* ---------------------------------------------------------------- */
/* Validation                                                        */
/* ---------------------------------------------------------------- */

/** Drop anything that does not resolve to a real interface; keep keys unique. */
export function sanitize(c: InterfaceComposition): InterfaceComposition {
  const seen = new Set<string>();
  const regions = (Array.isArray(c.regions) ? c.regions : [])
    .filter((r) => r && isInterfaceId(r.interfaceId))
    .map((r) => {
      let key = typeof r.key === "string" && r.key ? r.key : newId("r");
      while (seen.has(key)) key = newId("r");
      seen.add(key);
      const size: RegionSize = r.size === "tall" || r.size === "compact" ? r.size : "screen";
      return { key, interfaceId: r.interfaceId, size, ...(typeof r.label === "string" && r.label.trim() ? { label: r.label.trim().slice(0, 60) } : {}) };
    });
  const keys = new Set(regions.map((r) => r.key));
  return {
    ...c,
    name: String(c.name || "Untitled composition").slice(0, 80),
    description: String(c.description ?? "").slice(0, 280),
    flow: c.flow === "horizontal" ? "horizontal" : "vertical",
    seam: c.seam === "portal" || c.seam === "cut" ? c.seam : "blend",
    regions,
    bookmarks: (Array.isArray(c.bookmarks) ? c.bookmarks : []).filter((b) => b && keys.has(b.regionKey)).slice(0, 24),
    lastRegionKey: c.lastRegionKey && keys.has(c.lastRegionKey) ? c.lastRegionKey : null,
    lineage: Array.isArray(c.lineage) ? c.lineage.slice(-32) : [],
  };
}

export function regionName(r: CompositionRegion): string {
  return r.label ?? interfaceById(r.interfaceId)?.name ?? r.interfaceId;
}

/* ---------------------------------------------------------------- */
/* Making new compositions from old ones                             */
/* ---------------------------------------------------------------- */

function derive(source: InterfaceComposition, how: LineageStep, patch: Partial<InterfaceComposition>, now: number): InterfaceComposition {
  return sanitize({
    ...source,
    // Fresh region keys: a derived composition shares nothing mutable with its source.
    regions: source.regions.map((r) => ({ ...r, key: newId("r", now) })),
    bookmarks: [],
    lastRegionKey: null,
    ...patch,
    id: newId("comp", now),
    builtIn: false,
    parentId: source.id,
    lineage: [...source.lineage, { id: source.id, name: source.name, how }],
    version: 1,
    createdAt: now,
    updatedAt: now,
  });
}

/** An independent copy. Its edits never reach the source, nor the source's its. */
export function cloneComposition(source: InterfaceComposition, now = Date.now(), name?: string): InterfaceComposition {
  return derive(source, "clone", { name: name ?? `${source.name} (copy)` }, now);
}

/** What an edit to a built-in becomes: a user-owned copy carrying the edit. */
export function forkComposition(source: InterfaceComposition, now = Date.now()): InterfaceComposition {
  return derive(source, "fork", { name: `My ${source.name}` }, now);
}

/** Join two compositions end to end into a new one. Neither source changes. */
export function mergeCompositions(a: InterfaceComposition, b: InterfaceComposition, now = Date.now(), opts: { dedupe?: boolean } = {}): InterfaceComposition {
  const regions = [...a.regions, ...b.regions].filter((r, i, all) => !opts.dedupe || all.findIndex((x) => x.interfaceId === r.interfaceId) === i);
  const merged = derive(a, "merge", { name: `${a.name} + ${b.name}`, description: `Merged from “${a.name}” and “${b.name}”.`, regions }, now);
  merged.lineage = [...merged.lineage, { id: b.id, name: b.name, how: "merge" }];
  return merged;
}

/** Cut a composition in two at `index` (the second part starts there). */
export function splitComposition(source: InterfaceComposition, index: number, now = Date.now()): [InterfaceComposition, InterfaceComposition] | null {
  if (index <= 0 || index >= source.regions.length) return null;
  const first = derive(source, "split", { name: `${source.name} · part 1`, regions: source.regions.slice(0, index) }, now);
  const second = derive(source, "split", { name: `${source.name} · part 2`, regions: source.regions.slice(index) }, now + 1);
  return [first, second];
}

/**
 * Alternative unified interfaces from the same source regions — the
 * "multiple variants" requirement. Each is a different arrangement of
 * the SAME interfaces (order, flow, seam, sizes), never a different set
 * of capabilities:
 *
 *   classic    original LÉLU first, vertical, soft seams
 *   cinematic  3D worlds first, horizontal, portal seams
 *   minimal    the fewest regions that still cover chat + a world
 *   spatial    worlds and legacy views interleaved, compact legacy panels
 */
export type VariantStyle = "classic" | "cinematic" | "minimal" | "spatial";
export const VARIANT_STYLES: VariantStyle[] = ["classic", "cinematic", "minimal", "spatial"];

export function variantOf(source: InterfaceComposition, style: VariantStyle, now = Date.now()): InterfaceComposition {
  const ids = source.regions.map((r) => r.interfaceId);
  const unique = ids.filter((id, i) => ids.indexOf(id) === i);
  const family = (id: InterfaceId) => interfaceById(id)?.family ?? "legacy";
  const rank = (order: InterfaceId[]) => (id: InterfaceId) => {
    const i = order.indexOf(id);
    return i < 0 ? order.length : i;
  };
  let order: InterfaceId[];
  let flow: Flow = source.flow;
  let seam: Seam = source.seam;
  let size = (_id: InterfaceId): RegionSize => "screen";
  switch (style) {
    case "classic":
      order = [...unique].sort((a, b) => rank(["og-inner-sky", "og-core", "lelu-system", "lelu-room", "cosmos"])(a) - rank(["og-inner-sky", "og-core", "lelu-system", "lelu-room", "cosmos"])(b));
      flow = "vertical";
      seam = "blend";
      break;
    case "cinematic":
      order = [...unique].sort((a, b) => Number(interfaceById(b)?.webgl) - Number(interfaceById(a)?.webgl));
      flow = "horizontal";
      seam = "portal";
      break;
    case "minimal": {
      const chat = unique.find((id) => id === "og-inner-sky") ?? unique.find((id) => family(id) === "legacy");
      const world = unique.find((id) => family(id) === "cosmos");
      order = [chat, world].filter((x): x is InterfaceId => Boolean(x));
      if (order.length === 0) order = unique.slice(0, 1);
      flow = "vertical";
      seam = "cut";
      break;
    }
    case "spatial": {
      const worlds = unique.filter((id) => family(id) === "cosmos");
      const legacy = unique.filter((id) => family(id) !== "cosmos");
      order = [];
      for (let i = 0; i < Math.max(worlds.length, legacy.length); i += 1) {
        if (worlds[i]) order.push(worlds[i]);
        if (legacy[i]) order.push(legacy[i]);
      }
      flow = "horizontal";
      seam = "portal";
      size = (id) => (family(id) === "cosmos" ? "screen" : "tall");
      break;
    }
  }
  const label = style[0].toUpperCase() + style.slice(1);
  const v = derive(
    source,
    "variant",
    {
      name: `${source.name} — ${label}`,
      description: `${label} arrangement of “${source.name}”.`,
      flow,
      seam,
      regions: order.map((id) => region(id, newId("r", now), size(id))),
    },
    now,
  );
  return v;
}

/* ---------------------------------------------------------------- */
/* Edits (applied by the store to user-owned compositions only)      */
/* ---------------------------------------------------------------- */

export type CompositionEdit =
  | { op: "move"; key: string; to: number }
  | { op: "remove"; key: string }
  | { op: "add"; interfaceId: InterfaceId; at?: number }
  | { op: "rename"; name: string }
  | { op: "label"; key: string; label: string }
  | { op: "size"; key: string; size: RegionSize }
  | { op: "flow"; flow: Flow }
  | { op: "seam"; seam: Seam }
  | { op: "bookmark"; regionKey: string; name: string }
  | { op: "unbookmark"; regionKey: string }
  | { op: "position"; regionKey: string };

/** Edits that only record where the person is; they do not count as a version. */
export function isNavigationEdit(edit: CompositionEdit): boolean {
  return edit.op === "position";
}

export function applyEdit(c: InterfaceComposition, edit: CompositionEdit, now = Date.now()): InterfaceComposition {
  const regions = [...c.regions];
  const idx = (key: string) => regions.findIndex((r) => r.key === key);
  let next: InterfaceComposition = c;
  switch (edit.op) {
    case "move": {
      const from = idx(edit.key);
      if (from < 0) return c;
      const [r] = regions.splice(from, 1);
      regions.splice(Math.max(0, Math.min(regions.length, edit.to)), 0, r);
      next = { ...c, regions };
      break;
    }
    case "remove": {
      const at = idx(edit.key);
      if (at < 0 || regions.length <= 1) return c; // a composition always keeps one region
      regions.splice(at, 1);
      next = { ...c, regions };
      break;
    }
    case "add": {
      if (!isInterfaceId(edit.interfaceId)) return c;
      const at = edit.at === undefined ? regions.length : Math.max(0, Math.min(regions.length, edit.at));
      regions.splice(at, 0, region(edit.interfaceId, newId("r", now)));
      next = { ...c, regions };
      break;
    }
    case "rename":
      next = { ...c, name: edit.name.trim() || c.name };
      break;
    case "label": {
      const at = idx(edit.key);
      if (at < 0) return c;
      regions[at] = { ...regions[at], ...(edit.label.trim() ? { label: edit.label.trim() } : { label: undefined }) };
      next = { ...c, regions };
      break;
    }
    case "size": {
      const at = idx(edit.key);
      if (at < 0) return c;
      regions[at] = { ...regions[at], size: edit.size };
      next = { ...c, regions };
      break;
    }
    case "flow":
      next = { ...c, flow: edit.flow };
      break;
    case "seam":
      next = { ...c, seam: edit.seam };
      break;
    case "bookmark":
      if (idx(edit.regionKey) < 0) return c;
      next = { ...c, bookmarks: [...c.bookmarks.filter((b) => b.regionKey !== edit.regionKey), { regionKey: edit.regionKey, name: edit.name.trim() || "Bookmark" }] };
      break;
    case "unbookmark":
      next = { ...c, bookmarks: c.bookmarks.filter((b) => b.regionKey !== edit.regionKey) };
      break;
    case "position":
      if (idx(edit.regionKey) < 0) return c;
      return { ...c, lastRegionKey: edit.regionKey };
  }
  return sanitize({ ...next, version: c.version + 1, updatedAt: now });
}

/** Every catalogued interface, for "add a region" pickers. */
export function addableInterfaces(): InterfaceId[] {
  return INTERFACES.map((entry) => entry.id);
}

/* ---------------------------------------------------------------- */
/* Rendering policy (pure, so it can be tested without a browser)    */
/* ---------------------------------------------------------------- */

/**
 * Which regions are mounted live, given how much of each is visible.
 *
 * - The region most in view is always live.
 * - Any other visible DOM-only region is live too (so a seam shows both
 *   sides during a scroll).
 * - At most ONE WebGL region is live — the current one if it is WebGL,
 *   otherwise none. A second canvas on a phone is the cost the render
 *   budget exists to avoid.
 * Everything else is a lightweight preview: unmounted, not hidden.
 */
export function liveRegions(regions: CompositionRegion[], visibility: Record<string, number>): { current: string | null; live: Set<string> } {
  let current: string | null = null;
  let best = 0;
  for (const r of regions) {
    const v = visibility[r.key] ?? 0;
    if (v > best) {
      best = v;
      current = r.key;
    }
  }
  const live = new Set<string>();
  if (current) live.add(current);
  for (const r of regions) {
    if ((visibility[r.key] ?? 0) <= 0 || r.key === current) continue;
    if (!interfaceById(r.interfaceId)?.webgl) live.add(r.key);
  }
  return { current, live };
}
