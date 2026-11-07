/**
 * ==========================================================
 * LÉLU — ONE WORKSPACE LAYOUT
 *
 * The shell has a dock, floating module windows and spatial
 * portals, but their geometry lived only on each module's own
 * state. That is not a workspace: nothing could auto-arrange,
 * nothing could remember a manual placement apart from
 * "position exists", and a viewport change left rects off
 * screen.
 *
 * This module is the ONE authoritative layout model:
 *
 *   • every module has a rect, a z-order, a dock slot and flags
 *     (manual, pinned, minimized, workspace);
 *   • AUTO-ARRANGE tiles the non-manual modules and NEVER moves
 *     a rect the person placed by hand;
 *   • collision resolution pushes overlapping auto rects apart;
 *   • a viewport change re-validates AUTO geometry and clamps
 *     manual geometry without moving it on purpose;
 *   • legacy dock settings and per-module positions migrate in
 *     losslessly, and anything unreadable is COUNTED, not
 *     invented.
 *
 * Pure functions only: no React, no storage, no singletons. The
 * store next door owns persistence; this file owns the rules.
 * ==========================================================
 */

import { layoutWindowRects, rectsOverlap, type WindowRect } from "../windowLayout";

export interface LayoutViewport {
  width: number;
  height: number;
}

export type LayoutRect = WindowRect;

export interface ModuleLayoutEntry {
  moduleId: string;
  rect: LayoutRect;
  zIndex: number;
  /** A rect the person placed or resized: auto-arrange must not move it. */
  manual: boolean;
  /** Kept in the dock rail rather than minimized away. */
  pinned: boolean;
  minimized: boolean;
  /** Which workspace configuration this entry belongs to. */
  workspace: string;
}

export interface WorkspaceLayout {
  version: 2;
  workspace: string;
  entries: ModuleLayoutEntry[];
  updatedAt: number;
}

export const LAYOUT_VERSION = 2 as const;
export const DEFAULT_WORKSPACE = "default";
export const LAYOUT_STORAGE_KEY = "lelu.layout.v2";
/** The dock settings the shell already persisted, read during migration. */
export const LEGACY_DOCK_KEY = "lelu.dock.v1";

const MIN_ENTRY_WIDTH = 240;
const MIN_ENTRY_HEIGHT = 160;
const DOCK_Z_BASE = 200;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(value)));

/** Keep a rect inside the viewport and above the minimum useful size. */
export function clampRect(rect: LayoutRect, viewport: LayoutViewport): LayoutRect {
  const width = clamp(Math.min(rect.width, viewport.width), 1, Math.max(1, viewport.width));
  const height = clamp(Math.min(rect.height, viewport.height), 1, Math.max(1, viewport.height));
  return {
    x: clamp(rect.x, 0, Math.max(0, viewport.width - width)),
    y: clamp(rect.y, 0, Math.max(0, viewport.height - height)),
    width,
    height,
  };
}

function saneRect(rect: LayoutRect, viewport: LayoutViewport): LayoutRect {
  const minW = Math.min(MIN_ENTRY_WIDTH, viewport.width);
  const minH = Math.min(MIN_ENTRY_HEIGHT, viewport.height);
  return clampRect(
    {
      x: Number.isFinite(rect.x) ? rect.x : 0,
      y: Number.isFinite(rect.y) ? rect.y : 0,
      width: Math.max(minW, Number.isFinite(rect.width) ? rect.width : minW),
      height: Math.max(minH, Number.isFinite(rect.height) ? rect.height : minH),
    },
    viewport,
  );
}

/** Auto entries first, in dock order; manual ones keep their own slot. */
function orderedAuto(entries: ModuleLayoutEntry[]): ModuleLayoutEntry[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.zIndex - b.entry.zIndex || a.index - b.index)
    .map((item) => item.entry)
    .filter((entry) => !entry.manual && !entry.minimized);
}

/**
 * Push an overlapping rect off the ones already placed, then clamp.
 * Deterministic: the same input always yields the same layout, which is
 * what makes "restore my layout" reproducible.
 */
function resolveCollisions(placed: LayoutRect[], rect: LayoutRect, viewport: LayoutViewport): LayoutRect {
  let candidate = rect;
  let shrunk = 0;
  const overlaps = (value: LayoutRect): boolean => placed.some((other) => rectsOverlap(other, value));
  for (let attempt = 0; attempt < 48 && overlaps(candidate); attempt += 1) {
    if (attempt === 15 || attempt === 31) {
      // A window that already spans the viewport cannot step aside — the clamp
      // pins it. Give it less room instead of looping in place.
      shrunk += 1;
      const factor = shrunk === 1 ? 0.6 : 0.45;
      candidate = clampRect(
        {
          ...candidate,
          width: Math.max(MIN_ENTRY_WIDTH, Math.round(candidate.width * factor)),
          height: Math.max(MIN_ENTRY_HEIGHT, Math.round(candidate.height * factor)),
        },
        viewport,
      );
      continue;
    }
    candidate = clampRect(
      attempt % 4 === 3
        ? { ...candidate, y: candidate.y + 24 }
        : { ...candidate, x: candidate.x + 28 },
      viewport,
    );
  }
  return candidate;
}

/**
 * Auto-arrange the modules that are not manually placed.
 *
 * Manual entries are returned untouched — that is the whole contract.
 * The remaining entries are tiled by the shared window-layout policy and
 * de-overlapped against everything already on screen, manual included.
 */
export function autoArrange(
  entries: ModuleLayoutEntry[],
  viewport: LayoutViewport,
  insets: Parameters<typeof layoutWindowRects>[2] = {},
): ModuleLayoutEntry[] {
  const auto = orderedAuto(entries);
  const manualRects = entries.filter((entry) => entry.manual && !entry.minimized).map((entry) => entry.rect);
  const tiles = layoutWindowRects(auto.length, viewport, insets);
  const placed: LayoutRect[] = [...manualRects];
  const byId = new Map<string, LayoutRect>();
  auto.forEach((entry, index) => {
    const tile = tiles[index] ?? { x: 0, y: 0, width: viewport.width, height: viewport.height };
    const rect = resolveCollisions(placed, saneRect(tile, viewport), viewport);
    placed.push(rect);
    byId.set(entry.moduleId, rect);
  });
  return entries.map((entry) =>
    byId.has(entry.moduleId) ? { ...entry, rect: byId.get(entry.moduleId)! } : entry,
  );
}

/** Place one module by hand. Marks it manual so auto-arrange leaves it alone. */
export function placeManual(
  entries: ModuleLayoutEntry[],
  moduleId: string,
  rect: LayoutRect,
  viewport: LayoutViewport,
): ModuleLayoutEntry[] {
  return entries.map((entry) =>
    entry.moduleId === moduleId
      ? { ...entry, rect: saneRect(rect, viewport), manual: true }
      : entry,
  );
}

/** Hand a module back to auto-arrange, keeping its current rect as the seed. */
export function releaseManual(entries: ModuleLayoutEntry[], moduleId: string): ModuleLayoutEntry[] {
  return entries.map((entry) =>
    entry.moduleId === moduleId ? { ...entry, manual: false } : entry,
  );
}

/** Explicit regeneration: every module returns to the automatic layout. */
export function restoreAutoLayout(
  entries: ModuleLayoutEntry[],
  viewport: LayoutViewport,
): { entries: ModuleLayoutEntry[]; changed: string[] } {
  const released = entries.map((entry) => ({ ...entry, manual: false }));
  const arranged = autoArrange(released, viewport);
  const changed = arranged
    .filter((entry, index) => {
      const before = entries[index].rect;
      return before.x !== entry.rect.x || before.y !== entry.rect.y || before.width !== entry.rect.width || before.height !== entry.rect.height;
    })
    .map((entry) => entry.moduleId);
  return { entries: arranged, changed };
}

/**
 * A viewport change must not lose geometry. Auto rects are re-tiled; manual
 * rects are only clamped, never moved to a different place on purpose.
 */
export function reflowForViewport(
  entries: ModuleLayoutEntry[],
  viewport: LayoutViewport,
  insets: Parameters<typeof layoutWindowRects>[2] = {},
): ModuleLayoutEntry[] {
  const clamped = entries.map((entry) =>
    entry.manual ? { ...entry, rect: saneRect(entry.rect, viewport) } : entry,
  );
  return autoArrange(clamped, viewport, insets);
}

export function addEntry(
  entries: ModuleLayoutEntry[],
  moduleId: string,
  workspace = DEFAULT_WORKSPACE,
): ModuleLayoutEntry[] {
  if (entries.some((entry) => entry.moduleId === moduleId)) return entries;
  return [
    ...entries,
    {
      moduleId,
      rect: { x: 0, y: 0, width: MIN_ENTRY_WIDTH, height: MIN_ENTRY_HEIGHT },
      zIndex: DOCK_Z_BASE + entries.length,
      manual: false,
      pinned: true,
      minimized: false,
      workspace,
    },
  ];
}

export function removeEntry(entries: ModuleLayoutEntry[], moduleId: string): ModuleLayoutEntry[] {
  return entries.filter((entry) => entry.moduleId !== moduleId);
}

export function setPinned(entries: ModuleLayoutEntry[], moduleId: string, pinned: boolean): ModuleLayoutEntry[] {
  return entries.map((entry) => (entry.moduleId === moduleId ? { ...entry, pinned } : entry));
}

export function setMinimized(entries: ModuleLayoutEntry[], moduleId: string, minimized: boolean): ModuleLayoutEntry[] {
  return entries.map((entry) => (entry.moduleId === moduleId ? { ...entry, minimized } : entry));
}

/** Raise a module above the others without disturbing their order. */
export function raiseEntry(entries: ModuleLayoutEntry[], moduleId: string): ModuleLayoutEntry[] {
  const top = entries.reduce((max, entry) => Math.max(max, entry.zIndex), DOCK_Z_BASE);
  return entries.map((entry) => (entry.moduleId === moduleId ? { ...entry, zIndex: top + 1 } : entry));
}

/** Dock order: pinned entries first in their stored order, the rest after. */
export function dockOrder(entries: ModuleLayoutEntry[]): string[] {
  return [...entries]
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.zIndex - b.zIndex)
    .map((entry) => entry.moduleId);
}

/** Move `moduleId` into the slot currently held by `overId`. */
export function reorder(entries: ModuleLayoutEntry[], moduleId: string, overId: string): ModuleLayoutEntry[] {
  const order = [...entries].sort((a, b) => a.zIndex - b.zIndex);
  const from = order.findIndex((entry) => entry.moduleId === moduleId);
  const to = order.findIndex((entry) => entry.moduleId === overId);
  if (from < 0 || to < 0 || from === to) return entries;
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const zById = new Map(order.map((entry, index) => [entry.moduleId, DOCK_Z_BASE + index]));
  return entries.map((entry) => ({ ...entry, zIndex: zById.get(entry.moduleId) ?? entry.zIndex }));
}

/** Entries belonging to one workspace configuration, in dock order. */
export function workspaceEntries(entries: ModuleLayoutEntry[], workspace = DEFAULT_WORKSPACE): ModuleLayoutEntry[] {
  return entries
    .filter((entry) => entry.workspace === workspace)
    .sort((a, b) => a.zIndex - b.zIndex);
}

/* ------------------------------------------------------------------ */
/* migration                                                           */
/* ------------------------------------------------------------------ */

export interface LegacyModuleGeometry {
  moduleId: string;
  position?: { x: number; y: number };
  size?: { width: number; height: number };
  zIndex?: number;
}

export interface LegacyDockSettings {
  order?: string[];
  hidden?: string[];
  size?: string;
}

export interface LayoutMigration {
  layout: WorkspaceLayout;
  /** Entries that could not be read. Reported, never fabricated. */
  skipped: number;
  /** Module ids recovered from legacy state. */
  migrated: string[];
}

/**
 * Read the layout the shell used to keep: per-module geometry plus the dock
 * settings. A module with geometry becomes a MANUAL entry (it was placed by
 * hand); one without becomes an auto entry that auto-arrange may tile.
 *
 * Invalid geometry is skipped and counted. A hidden dock item is kept as an
 * entry with `pinned: false`, so nothing disappears silently.
 */
export function migrateLayout(
  legacyModules:
    | LegacyModuleGeometry[]
    | Record<string, Omit<LegacyModuleGeometry, "moduleId">>
    | null
    | undefined,
  legacyDock?: LegacyDockSettings | null,
  viewport: LayoutViewport = { width: 1440, height: 900 },
  workspace = DEFAULT_WORKSPACE,
  now: () => number = () => Date.now(),
): LayoutMigration {
  const list: LegacyModuleGeometry[] = Array.isArray(legacyModules)
    ? legacyModules
    : legacyModules && typeof legacyModules === "object"
      ? Object.entries(legacyModules).map(([moduleId, value]) => ({ moduleId, ...(value as object) }))
      : [];

  const hidden = new Set(Array.isArray(legacyDock?.hidden) ? legacyDock.hidden : []);
  const order = Array.isArray(legacyDock?.order) ? legacyDock.order : [];
  const entries: ModuleLayoutEntry[] = [];
  const migrated: string[] = [];
  let skipped = 0;

  for (const item of list) {
    const moduleId = typeof item?.moduleId === "string" ? item.moduleId.trim() : "";
    if (!moduleId) {
      skipped += 1;
      continue;
    }
    const hasPosition =
      Number.isFinite(item.position?.x) && Number.isFinite(item.position?.y);
    const hasSize = Number.isFinite(item.size?.width) && Number.isFinite(item.size?.height);
    if (!hasPosition && (item.position !== undefined || item.size !== undefined)) {
      // Geometry was present but unreadable: report it instead of inventing one.
      skipped += 1;
      continue;
    }
    const rect = hasPosition
      ? saneRect(
          {
            x: item.position!.x,
            y: item.position!.y,
            width: hasSize ? item.size!.width : MIN_ENTRY_WIDTH,
            height: hasSize ? item.size!.height : MIN_ENTRY_HEIGHT,
          },
          viewport,
        )
      : { x: 0, y: 0, width: MIN_ENTRY_WIDTH, height: MIN_ENTRY_HEIGHT };

    const orderIndex = order.indexOf(moduleId);
    entries.push({
      moduleId,
      rect,
      zIndex: Number.isFinite(item.zIndex)
        ? item.zIndex!
        : DOCK_Z_BASE + (orderIndex >= 0 ? orderIndex : entries.length),
      manual: hasPosition,
      pinned: !hidden.has(moduleId),
      minimized: false,
      workspace,
    });
    migrated.push(moduleId);
  }

  return {
    layout: {
      version: LAYOUT_VERSION,
      workspace,
      entries: autoArrange(entries, viewport),
      updatedAt: now(),
    },
    skipped,
    migrated,
  };
}

/** Read a stored layout, tolerating absent/older shapes. */
export function readLayout(
  raw: unknown,
  viewport: LayoutViewport = { width: 1440, height: 900 },
): { layout: WorkspaceLayout; skipped: number } {
  if (!raw || typeof raw !== "object") {
    return {
      layout: { version: LAYOUT_VERSION, workspace: DEFAULT_WORKSPACE, entries: [], updatedAt: 0 },
      skipped: 0,
    };
  }
  const stored = raw as Partial<WorkspaceLayout>;
  const entries: ModuleLayoutEntry[] = [];
  let skipped = 0;
  for (const candidate of Array.isArray(stored.entries) ? stored.entries : []) {
    const entry = candidate as Partial<ModuleLayoutEntry>;
    if (typeof entry?.moduleId !== "string" || !entry.rect) {
      skipped += 1;
      continue;
    }
    if (!Number.isFinite(entry.rect.x) || !Number.isFinite(entry.rect.y)) {
      skipped += 1;
      continue;
    }
    entries.push({
      moduleId: entry.moduleId,
      rect: saneRect(entry.rect as LayoutRect, viewport),
      zIndex: Number.isFinite(entry.zIndex) ? Number(entry.zIndex) : DOCK_Z_BASE + entries.length,
      manual: entry.manual === true,
      pinned: entry.pinned !== false,
      minimized: entry.minimized === true,
      workspace: typeof entry.workspace === "string" ? entry.workspace : DEFAULT_WORKSPACE,
    });
  }
  return {
    layout: {
      version: LAYOUT_VERSION,
      workspace: typeof stored.workspace === "string" ? stored.workspace : DEFAULT_WORKSPACE,
      entries,
      updatedAt: Number.isFinite(stored.updatedAt) ? Number(stored.updatedAt) : 0,
    },
    skipped,
  };
}
