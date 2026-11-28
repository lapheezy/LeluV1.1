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

/**
 * A dial at the BOTTOM EDGE fans its options UPWARD, in arcs, instead of a full circle.
 *
 * Measured (2026-11-28): the bottom dial put 14 options on one circle. Its centre was pushed up to fit the
 * circle, the lower options sat on the screen edge, and on a 390 px phone they overlapped. Here the
 * options sit on arcs above the dial, centred on it:
 * - `inner` options (the workspace utilities) take the first arc, right around the dial;
 * - the rest fill further arcs outward, as many as fit.
 * Each arc's radius grows until its options are spaced at least one option apart, as far as the screen
 * allows.
 */
export interface ArcPlacement {
  centerX: number;
  centerY: number;
  /** Each arc, innermost first: horizontal and vertical radius (an arc is an oval on a narrow screen). */
  rings: Array<{ rx: number; ry: number }>;
  positions: Array<{ x: number; y: number; angleDeg: number; ring: number }>;
  optionSize: number;
}

export function placeArcs(
  anchor: InteractionRect,
  viewport: InteractionSize,
  options: { optionSize: number; inner: boolean[]; padding?: number; gap?: number },
): ArcPlacement {
  const padding = options.padding ?? 12;
  const size = options.optionSize;
  const gap = options.gap ?? 10;
  const center = centerOf(anchor);
  const half = size / 2 + padding;
  // A dial in a bottom CORNER fans a quarter-arc into the screen (up-left from the right corner, up-right
  // from the left one); centred, it fans over the top. Measured: from the bottom-right corner a centred
  // arc crowded its options against the edge, one label over another.
  const corner = center.x > viewport.width - (size * 2 + half) ? "right" : center.x < size * 2 + half ? "left" : null;
  const centerX = corner ? center.x : clamp(center.x, half + size, viewport.width - half - size);
  const centerY = center.y;
  // Hard limits: an option's centre never closer than half an option (+padding) to an edge, and room
  // for the caption (≈ 18 px) under each option and the title above the outer arc.
  const roomX = corner === "right" ? centerX - half : corner === "left" ? viewport.width - centerX - half : Math.min(centerX, viewport.width - centerX) - half;
  const roomY = centerY - half - 46;
  // Start a little above the horizon so the lowest option's caption stays on screen.
  // Start a little above the horizon (the lowest caption stays on screen) and end straight up (nothing
  // crosses to the edge side of the dial).
  const start = corner === "right" ? 194 : corner === "left" ? 270 : 192;
  const sweep = corner ? 76 : 156;
  const firstRadius = Math.max(anchor.width, anchor.height) / 2 + size / 2 + 16;
  const step = size + gap + 14;
  const oval = (r: number) => ({ rx: Math.min(r, roomX), ry: Math.min(r, roomY) });
  // An arc capped at the screen's width is narrowed as it goes out, so its ends rise above the ends of
  // the arc inside it instead of landing on them (measured on a 390 px phone: ends 16 px apart).
  const insetFor = (k: number, r: number) => (Math.min(r, roomX) < r ? Math.min(54, 16 * k) : 0);
  const capacity = (r: number, k: number) => {
    const { rx, ry } = oval(r);
    const mean = Math.sqrt((rx * rx + ry * ry) / 2);
    const sw = ((sweep - 2 * insetFor(k, r)) * Math.PI) / 180;
    return Math.max(1, Math.floor((sw * mean) / (size + gap)) + 1);
  };
  const maxR = Math.max(roomX, roomY);

  const innerIdx = options.inner.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const outerIdx = options.inner.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
  const groups: number[][] = [];
  const radii: number[] = [];
  let r = firstRadius;
  // The inner options share ONE arc, grown until they fit.
  if (innerIdx.length) {
    while (capacity(r, 0) < innerIdx.length && r < maxR) r += 4;
    groups.push(innerIdx);
    radii.push(r);
    r += step;
  }
  // How many outer arcs are needed, then spread the options over them in proportion to their room
  // (no arc left holding a single straggler).
  const outerRadii: number[] = [];
  const caps: number[] = [];
  let left = outerIdx.length;
  // Prefer ONE arc for all the destinations, in their order: grow it until they fit (on a phone it grows
  // upward, into an arch). Only when no single arc can hold them do they split over several.
  {
    let one = r;
    while (capacity(one, radii.length) < outerIdx.length && one < maxR) one += 6;
    if (capacity(Math.min(one, maxR), radii.length) >= outerIdx.length && outerIdx.length) {
      outerRadii.push(Math.min(one, maxR));
      caps.push(outerIdx.length);
      left = 0;
    }
  }
  while (left > 0) {
    const k = radii.length + outerRadii.length;
    const rr = Math.min(r, maxR);
    const cap = r + step > maxR ? left : capacity(rr, k);
    outerRadii.push(rr);
    caps.push(cap);
    left -= cap;
    r += step;
  }
  const total = outerIdx.length;
  const capSum = caps.reduce((a, b) => a + b, 0) || 1;
  const counts = caps.map((c) => Math.floor((total * c) / capSum));
  for (let i = counts.length - 1, extra = total - counts.reduce((a, b) => a + b, 0); extra > 0; i = (i - 1 + counts.length) % counts.length, extra--) counts[i]++;
  let cursor = 0;
  counts.forEach((n, i) => {
    groups.push(outerIdx.slice(cursor, cursor + n));
    radii.push(outerRadii[i]);
    cursor += n;
  });

  const rings: ArcPlacement["rings"] = radii.map(oval);
  const positions: ArcPlacement["positions"] = new Array(options.inner.length);
  groups.forEach((g, ring) => {
    const { rx, ry } = rings[ring];
    const inset = insetFor(ring, radii[ring]);
    // Equal spacing ALONG the arc, not equal angles: on a tall phone arch equal angles bunched the
    // options at the top (measured: Chat Universe, Browser and Work touching).
    const a0 = ((start + inset) * Math.PI) / 180, a1 = ((start + sweep - inset) * Math.PI) / 180;
    const N = 240;
    const pts = Array.from({ length: N + 1 }, (_, i) => a0 + ((a1 - a0) * i) / N);
    const cum = [0];
    for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(Math.cos(pts[i]) * rx - Math.cos(pts[i - 1]) * rx, Math.sin(pts[i]) * ry - Math.sin(pts[i - 1]) * ry));
    const length = cum[N];
    g.forEach((itemIndex, k) => {
      const target = g.length === 1 ? length / 2 : (length * k) / (g.length - 1);
      let i = 0;
      while (i < N && cum[i + 1] < target) i++;
      const a = pts[i];
      positions[itemIndex] = { x: Math.cos(a) * rx, y: Math.sin(a) * ry, angleDeg: (a * 180) / Math.PI, ring };
    });
  });
  return { centerX, centerY, rings, positions, optionSize: size };
}

/** A dial counts as bottom-anchored when its centre is in the lowest quarter of the screen. */
export function isBottomAnchored(anchor: InteractionRect, viewport: InteractionSize): boolean {
  return centerOf(anchor).y > viewport.height * 0.75;
}
