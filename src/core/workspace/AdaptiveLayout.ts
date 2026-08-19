/**
 * ==========================================================
 * LÉLU
 * ADAPTIVE LAYOUT ENGINE
 *
 * Pure layout calculation for the workspace. Given the active
 * views and the viewport, it decides:
 *
 *   - how many columns the grid gets (mobile / tablet / desktop /
 *     ultrawide),
 *   - which view gets the large focused cell,
 *   - which views are pinned/large (span more columns),
 *   - which views fall out of the grid into the secondary strip
 *     (mobile: everything but focus + pinned),
 *   - split (two-up) and stack (layered) arrangements.
 *
 * No hard-coded task layouts — the arrangement falls out of the
 * number/type/priority of the views and the screen. Pure and
 * testable: no DOM, no React.
 * ==========================================================
 */

import type { WorkspaceView, WorkspaceLayoutMode } from "./WorkspaceEngine";

export interface LayoutCell {
  viewId: string;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
  /** In a stack layout: the layer index (0 = bottom). */
  layer: number;
}

export interface WorkspaceLayout {
  /** Cells placed in the main grid / surface. */
  cells: LayoutCell[];
  /** On mobile, views that fall out of the grid into the secondary strip. */
  secondary: string[];
  mode: "grid" | "split" | "stack";
  cols: number;
}

export interface ViewportSize {
  width: number;
  height: number;
}

export function columnCount(width: number): number {
  if (width < 480) return 1;
  if (width < 768) return 1;
  if (width < 1024) return 2;
  if (width < 1600) return 3;
  return 4;
}

export function isMobile(width: number): boolean {
  return width < 768;
}

/** Rank used to decide which views stay primary when space is tight. */
export function viewRank(view: WorkspaceView, focusId: string | null): number {
  // Lower = more primary.
  if (view.pinned) return 0;
  if (view.id === focusId) return 1;
  if (view.weight > 1) return 2;
  return 3 + view.stackOrder;
}

/**
 * Compute the arrangement for a set of views.
 *
 * @param views   active (non-minimized) views
 * @param focusId currently focused view
 * @param layout  engine layout mode ("auto" resolves to a grid)
 * @param splitIds two-up split members (used when mode is split)
 * @param viewport current screen size
 */
export function computeLayout(
  views: WorkspaceView[],
  focusId: string | null,
  layout: WorkspaceLayoutMode,
  splitIds: string[],
  viewport: ViewportSize,
): WorkspaceLayout {
  const active = views.filter((view) => !view.minimized);

  if (active.length === 0) {
    return { cells: [], secondary: [], mode: "grid", cols: columnCount(viewport.width) };
  }

  if (layout === "split" || (layout === "auto" && splitIds.length >= 2 && active.length <= 2)) {
    const members = splitIds
      .map((id) => active.find((view) => view.id === id))
      .filter((view): view is WorkspaceView => Boolean(view));
    if (members.length >= 2) {
      const cols = isMobile(viewport.width) ? 1 : 2;
      return {
        cells: members.map((view, index) => ({
          viewId: view.id,
          col: index % cols,
          row: Math.floor(index / cols),
          colSpan: 1,
          rowSpan: 1,
          layer: 0,
        })),
        secondary: [],
        mode: "split",
        cols,
      };
    }
  }

  if (layout === "stack") {
    const ordered = [...active].sort((a, b) => a.stackOrder - b.stackOrder);
    return {
      cells: ordered.map((view, index) => ({
        viewId: view.id,
        col: 0,
        row: 0,
        colSpan: 1,
        rowSpan: 1,
        layer: index,
      })),
      secondary: [],
      mode: "stack",
      cols: 1,
    };
  }

  // Grid (auto): decide primary vs secondary by rank and viewport.
  const cols = columnCount(viewport.width);
  const mobile = isMobile(viewport.width);

  const ordered = [...active].sort((a, b) => viewRank(a, focusId) - viewRank(b, focusId));

  const primary: WorkspaceView[] = [];
  const secondary: string[] = [];

  if (mobile) {
    // Mobile grid: focus + pinned + one large recent view; the rest
    // become secondary strip surfaces.
    for (const view of ordered) {
      if (view.pinned || view.id === focusId) {
        primary.push(view);
      } else if (primary.length < 1) {
        primary.push(view);
      } else {
        secondary.push(view.id);
      }
    }
  } else {
    // Desktop/tablet: everything in the grid; pinned and focused
    // views get wider cells.
    for (const view of ordered) {
      primary.push(view);
    }
  }

  // Place cells in reading order with spans.
  const cells: LayoutCell[] = [];
  let row = 0;
  let col = 0;
  for (const view of primary) {
    const span = Math.min(
      cols,
      view.pinned || view.id === focusId || view.weight > 1 ? Math.min(2, cols) : 1,
    );
    if (col + span > cols) {
      row += 1;
      col = 0;
    }
    cells.push({
      viewId: view.id,
      col,
      row,
      colSpan: span,
      rowSpan: 1,
      layer: 0,
    });
    col += span;
  }

  return { cells, secondary, mode: "grid", cols };
}
