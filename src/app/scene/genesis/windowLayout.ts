/**
 * LÉLU — WORKSPACE WINDOW LAYOUT
 *
 * The module host used to cascade every window from a fixed offset, so two
 * workspaces covered each other. This is the single tiling policy: equal
 * columns on desktop, one column on a phone, and a stable rect for every
 * window. It is deliberately pure so the geometry can be tested.
 */

export interface LayoutViewport {
  width: number;
  height: number;
}

export interface WindowRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  gap?: number;
  minWidth?: number;
  minHeight?: number;
  /** Optional breathing room between the two desktop columns, so the scene
      and LÉLU are not completely hidden behind the workspaces. */
  centerGap?: number;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/**
 * Tile `count` inline windows inside the usable viewport. Desktop uses two
 * columns; narrow screens use one column so controls remain finger-sized.
 * Extra windows form additional rows instead of being stacked on top of the
 * first pair.
 */
export function layoutWindowRects(count: number, viewport: LayoutViewport, insets: LayoutInsets = {}): WindowRect[] {
  const total = Math.max(0, Math.floor(count));
  if (!total) return [];

  const width = Math.max(1, viewport.width);
  const height = Math.max(1, viewport.height);
  const compact = width < 720;
  const gap = Math.max(0, insets.gap ?? (compact ? 8 : 12));
  const left = Math.max(0, insets.left ?? (compact ? 8 : 88));
  const right = Math.max(0, insets.right ?? 16);
  const top = Math.max(0, insets.top ?? (compact ? 16 : 64));
  const bottom = Math.max(0, insets.bottom ?? (compact ? 96 : 20));
  const minWidth = Math.max(1, insets.minWidth ?? (compact ? 280 : 320));
  const minHeight = Math.max(1, insets.minHeight ?? 220);

  const availableWidth = Math.max(1, width - left - right);
  const availableHeight = Math.max(1, height - top - bottom);
  const columns = compact ? 1 : total === 1 ? 1 : 2;
  const rows = Math.max(1, Math.ceil(total / columns));
  const centerGap = columns > 1 ? Math.max(0, insets.centerGap ?? 0) : 0;
  const gridWidth = Math.max(1, availableWidth - centerGap);
  const cellWidth = Math.max(1, (gridWidth - gap * (columns - 1)) / columns);
  const cellHeight = Math.max(1, (availableHeight - gap * (rows - 1)) / rows);

  return Array.from({ length: total }, (_, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = left + column * (cellWidth + gap + centerGap);
    const y = top + row * (cellHeight + gap);
    const isLastInOddRow = columns === 2 && total % 2 === 1 && index === total - 1;
    const cellSpan = isLastInOddRow ? availableWidth : cellWidth;
    const maxWidth = Math.max(1, width - x - right);
    const maxHeight = Math.max(1, height - y - bottom);
    return {
      x: Math.round(clamp(x, 0, Math.max(0, width - 1))),
      y: Math.round(clamp(y, 0, Math.max(0, height - 1))),
      width: Math.round(clamp(cellSpan, Math.min(minWidth, maxWidth), maxWidth)),
      height: Math.round(clamp(cellHeight, Math.min(minHeight, maxHeight), maxHeight)),
    };
  });
}

export function rectsOverlap(a: WindowRect, b: WindowRect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
