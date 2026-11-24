/**
 * ==========================================================
 * LÉLU — INTERACTION GEOMETRY
 *
 * Pure placement maths for circular controls, radial rings and
 * contextual menus. Kept free of React and the DOM so it can be tested
 * directly, and used by every menu so none of them can be clipped by a
 * viewport edge.
 * ==========================================================
 */

export interface InteractionRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface InteractionSize {
  width: number;
  height: number;
}

export interface RadialPlacement {
  centerX: number;
  centerY: number;
  radius: number;
  optionSize: number;
}

export interface ContextPlacement {
  left: number;
  top: number;
  /** below the anchor, or flipped above when there is no room. */
  placement: "below" | "above";
  maxHeight: number;
}

export function clamp(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

/** Centre of a rect — the point a ring is built around. */
export function centerOf(rect: InteractionRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * The largest ring that fits the viewport, and the centre nearest the
 * control that keeps the whole ring on screen. On a narrow phone the
 * radius shrinks before the ring is ever allowed to clip.
 */
export function placeRadial(
  anchor: InteractionRect,
  viewport: InteractionSize,
  options: { itemCount: number; optionSize: number; preferredRadius: number; padding?: number },
): RadialPlacement {
  const padding = options.padding ?? 12;
  const optionSize = options.optionSize;
  const edge = optionSize / 2 + padding;
  const available = Math.max(0, Math.min(viewport.width, viewport.height) / 2 - edge);
  const radius = Math.max(optionSize * 0.65, Math.min(options.preferredRadius, available));
  const anchorCenter = centerOf(anchor);
  const min = radius + edge;
  const maxX = viewport.width - min;
  const maxY = viewport.height - min;
  return {
    centerX: clamp(anchorCenter.x, min, maxX),
    centerY: clamp(anchorCenter.y, min, maxY),
    radius,
    optionSize,
  };
}

/** Where one option sits on the ring. 0deg is to the right; first option starts at the top. */
export function radialOptionPosition(
  index: number,
  count: number,
  radius: number,
  startAngleDeg = -90,
): { x: number; y: number; angleDeg: number } {
  const safeCount = Math.max(1, count);
  const step = safeCount === 1 ? 0 : 360 / safeCount;
  const angleDeg = startAngleDeg + step * index;
  const angle = (angleDeg * Math.PI) / 180;
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, angleDeg };
}

/** All option offsets in one call, used by the renderer and its tests. */
export function radialOptionPositions(
  count: number,
  radius: number,
  startAngleDeg = -90,
): Array<{ x: number; y: number; angleDeg: number }> {
  return Array.from({ length: Math.max(0, count) }, (_, index) =>
    radialOptionPosition(index, count, radius, startAngleDeg),
  );
}

/**
 * A context menu opens below its control, flips above when the bottom
 * edge would clip it, and is clamped sideways. Its height is capped to
 * the space on the chosen side so a long list scrolls instead of
 * running off-screen.
 */
export function placeContextMenu(
  anchor: InteractionRect,
  menu: InteractionSize,
  viewport: InteractionSize,
  padding = 12,
): ContextPlacement {
  const belowTop = anchor.top + anchor.height + 8;
  const aboveTop = anchor.top - menu.height - 8;
  const spaceBelow = viewport.height - belowTop - padding;
  const spaceAbove = anchor.top - 8 - padding;
  const placement: "below" | "above" = spaceBelow >= menu.height || spaceBelow >= spaceAbove ? "below" : "above";
  const preferredTop = placement === "below" ? belowTop : aboveTop;
  const maxHeight = Math.max(120, placement === "below" ? spaceBelow : spaceAbove);
  const height = Math.min(menu.height, maxHeight);
  return {
    left: clamp(anchor.left + anchor.width / 2 - menu.width / 2, padding, viewport.width - menu.width - padding),
    top: clamp(preferredTop, padding, Math.max(padding, viewport.height - height - padding)),
    placement,
    maxHeight,
  };
}

/** Read the current visual viewport, falling back to the layout viewport. */
export function currentViewport(): InteractionSize {
  if (typeof window === "undefined") return { width: 1024, height: 768 };
  const vv = window.visualViewport;
  return {
    width: Math.max(320, Math.round(vv?.width ?? window.innerWidth)),
    height: Math.max(320, Math.round(vv?.height ?? window.innerHeight)),
  };
}

export function rectOf(element: Element): InteractionRect {
  const rect = element.getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
}
