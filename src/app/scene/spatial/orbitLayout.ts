/**
 * ==========================================================
 * LÉLU — ORBITAL NAVIGATION GEOMETRY
 *
 * The navigation of the Cosmos is an orbit, not a bar: the Core
 * sits at the centre of the band, and every navigation category
 * is a small orb on an ellipse around it. This file is the pure
 * geometry behind that composition — no React, no DOM — so the
 * placement can be asserted in a test instead of judged from a
 * screenshot.
 *
 * Why an ellipse and not a row: a row of pills grows with every
 * category and covers the world edge to edge. An orbit keeps each
 * node at its own position, spaced around the Core, and never
 * wider than the band the interface already reserves.
 *
 * Angles are measured from the CORE'S UP AXIS: 0° is straight
 * above the Core, -90° is to its left, +90° to its right. The
 * orbit is drawn ABOVE the Core, because below it is the edge of
 * the screen.
 * ==========================================================
 */

export interface OrbitPoint {
  /** Multiplier of the orbit's horizontal radius (-1..1). */
  x: number;
  /** Multiplier of the orbit's vertical radius (-1..1, negative is up). */
  y: number;
  /** Angle from the Core's up axis, in degrees. */
  angle: number;
}

export interface OrbitOffset {
  /** Horizontal offset from the parent orb, in pixels. */
  dx: number;
  /** Vertical offset from the parent orb, in pixels (negative is up). */
  dy: number;
}

/** How wide the fan of category orbs is, in degrees. */
export const ORBIT_SPAN_DEG = 168;

/** The orbit's angular position for a point. */
export function pointAt(angleDeg: number): OrbitPoint {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: Math.sin(rad), y: -Math.cos(rad), angle: angleDeg };
}

/**
 * `count` orbs evenly fanned across `span` degrees, centred on the
 * Core's up axis (plus `tiltDeg`). One orb sits straight above the
 * Core; the rest step outward, symmetric on both sides. Positions
 * depend only on the count, so adding a destination never moves
 * an existing orb.
 */
export function orbitRing(count: number, spanDeg: number = ORBIT_SPAN_DEG, tiltDeg = 0): OrbitPoint[] {
  if (count <= 0) return [];
  if (count === 1) return [pointAt(tiltDeg)];
  const step = spanDeg / (count - 1);
  const start = tiltDeg - spanDeg / 2;
  return Array.from({ length: count }, (_, index) => pointAt(start + step * index));
}

/**
 * The destinations of an open category fan out around it in a small
 * constellation tilted towards that category's side of the orbit.
 *
 * A full ring centred on the orb puts two destinations roughly 60px
 * *below* it; for the two lower categories that is off the bottom of the
 * band (measured: a destination sat at y=795 in a 768px viewport). A fan
 * that never dips below its category keeps every destination legible, and
 * alternating two radii keeps 46px orbs apart without a full ring.
 */
export function satelliteOffsets(
  count: number,
  parentAngleDeg: number,
  radiusPx = 62,
  options: { spreadDeg?: number; outerScale?: number; tiltFactor?: number } = {},
): OrbitOffset[] {
  if (count <= 0) return [];
  const spread = options.spreadDeg ?? 120;
  /* Two radii, far enough apart that neighbouring 46px orbs clear each
     other as boxes — a single ring only clears them as circles, and
     measured square hit-areas overlapped on the phone. */
  const outerScale = options.outerScale ?? 1.75;
  const tilt = parentAngleDeg * (options.tiltFactor ?? 0.25);
  const step = count > 1 ? spread / (count - 1) : 0;
  const start = tilt - spread / 2;
  return Array.from({ length: count }, (_, index) => {
    const rad = ((start + step * index) * Math.PI) / 180;
    const radius = index % 2 === 0 ? radiusPx : radiusPx * outerScale;
    return {
      dx: Math.round(Math.sin(rad) * radius * 100) / 100,
      dy: Math.round(-Math.cos(rad) * radius * 100) / 100,
    };
  });
}

/**
 * The bounding box (in px, relative to the band's centre-bottom) of a
 * ring of `size` px orbs on an `rx`/`ry` ellipse. Used to prove the
 * composition stays inside the band instead of running off the phone.
 */
export function orbitBounds(points: OrbitPoint[], rx: number, ry: number, orbSize: number) {
  const half = orbSize / 2;
  const xs = points.map((point) => point.x * rx);
  const ys = points.map((point) => point.y * ry);
  return {
    left: Math.min(...xs) - half,
    right: Math.max(...xs) + half,
    top: Math.min(...ys) - half,
    bottom: Math.max(...ys) + half,
    width: Math.max(...xs) - Math.min(...xs) + orbSize,
    height: Math.max(...ys) - Math.min(...ys) + orbSize,
  };
}

/**
 * The smallest gap between two adjacent orbs on the ring — the number
 * that decides whether two orbs can touch. Computed from the real
 * positions rather than assumed from the step, because the ellipse
 * squeezes the top of the arc.
 */
export function adjacentGap(points: OrbitPoint[], rx: number, ry: number): number {
  if (points.length < 2) return Number.POSITIVE_INFINITY;
  let smallest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const distance = Math.hypot((a.x - b.x) * rx, (a.y - b.y) * ry);
    smallest = Math.min(smallest, distance);
  }
  return Math.round(smallest * 100) / 100;
}
