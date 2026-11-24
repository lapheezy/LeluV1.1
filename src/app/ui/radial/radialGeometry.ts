/**
 * ==========================================================
 * LÉLU — RADIAL MENU GEOMETRY (pure, no DOM)
 *
 * Where a ring of items goes around the control that opened it, and which
 * item a finger is pointing at. Kept free of React and the DOM so the rules
 * are tested directly (tests/radial-menu.test.ts).
 *
 * Rules:
 *   - Items fan TOWARD the open part of the screen: a control at the bottom
 *     edge fans upward, one in a corner fans into the screen. Only a control
 *     with room on every side gets a full circle.
 *   - Neighbouring items never overlap: the radius grows until the arc
 *     holds them, up to a ceiling; past that the arc widens.
 *   - Every item stays fully on screen (clamped inside the safe margin).
 *   - Selection is by DIRECTION, not by hitting an item exactly: once the
 *     finger leaves the dead zone around the anchor, the nearest item by
 *     angle is the one. That is what makes hold → slide → release usable
 *     with a thumb. Inside the dead zone nothing is selected, so releasing
 *     where you pressed cancels.
 * ==========================================================
 */

export interface Point {
  x: number;
  y: number;
}

export interface RadialLayoutInput {
  /** How many items. */
  count: number;
  /** Centre of the control that opened the menu, in viewport pixels. */
  anchor: Point;
  /** Viewport size. */
  viewport: { width: number; height: number };
  /** Diameter of one item. */
  itemSize: number;
  /** Space kept between neighbouring items. */
  gap?: number;
  /** Starting radius (distance from the anchor to each item's centre). */
  radius?: number;
  /** Largest radius allowed before the arc widens instead. */
  maxRadius?: number;
  /** Margin kept from the viewport edge (safe area included by the caller). */
  margin?: number;
}

export interface RadialItemPlacement {
  /** Direction from the anchor, radians (0 = right, π/2 = down: screen space). */
  angle: number;
  /** Centre of the item in viewport pixels, after clamping. */
  x: number;
  y: number;
}

export interface RadialLayout {
  radius: number;
  /** Direction the arc is centred on. */
  direction: number;
  /** Angle covered from the first to the last item. */
  spread: number;
  fullCircle: boolean;
  items: RadialItemPlacement[];
}

const TAU = Math.PI * 2;

/** Normalise an angle into (-π, π]. */
export function normalizeAngle(angle: number): number {
  let a = angle % TAU;
  if (a <= -Math.PI) a += TAU;
  if (a > Math.PI) a -= TAU;
  return a;
}

/** Smallest absolute difference between two directions. */
export function angleDistance(a: number, b: number): number {
  return Math.abs(normalizeAngle(a - b));
}

export function layoutRadial(input: RadialLayoutInput): RadialLayout {
  const count = Math.max(0, Math.floor(input.count));
  const gap = input.gap ?? 10;
  const margin = input.margin ?? 8;
  const half = input.itemSize / 2;
  let radius = input.radius ?? Math.max(72, input.itemSize * 1.6);
  const maxRadius = input.maxRadius ?? Math.max(radius, 150);
  const { anchor, viewport } = input;

  if (count === 0) return { radius, direction: -Math.PI / 2, spread: 0, fullCircle: false, items: [] };

  // Room on each side of the anchor.
  const room = {
    left: anchor.x - margin,
    right: viewport.width - margin - anchor.x,
    up: anchor.y - margin,
    down: viewport.height - margin - anchor.y,
  };

  // Full circle only when the ring fits on every side.
  const ringFits = (r: number) => Math.min(room.left, room.right, room.up, room.down) >= r + half;
  // Angle one item (plus its gap) needs at radius r.
  const step = (r: number) => 2 * Math.asin(Math.min(1, (input.itemSize + gap) / (2 * r)));

  if (count >= 3) {
    // Grow the radius until a full ring holds every item without overlap.
    let r = radius;
    while (r <= maxRadius && step(r) * count > TAU) r += 4;
    if (r <= maxRadius && ringFits(r)) {
      const items = Array.from({ length: count }, (_, i) => {
        const angle = normalizeAngle(-Math.PI / 2 + (TAU * i) / count);
        return place(anchor, r, angle, half, margin, viewport);
      });
      return { radius: r, direction: -Math.PI / 2, spread: TAU, fullCircle: true, items };
    }
  }

  // An arc that opens toward the screen's open space. Weight each direction
  // by how much room it has, so a control in the bottom-right corner fans
  // up-and-left, and one on the bottom edge fans straight up.
  const vx = room.right - room.left;
  const vy = room.down - room.up;
  const direction = vx === 0 && vy === 0 ? -Math.PI / 2 : Math.atan2(vy, vx);

  // Prefer an arc whose items ALL fit on screen unclamped. Clamping is a last
  // resort: in a corner it pushed the outer items onto their neighbours.
  // Search outward from the preferred direction (5° steps), at the smallest
  // radius that works.
  const fitsAt = (r: number, angle: number) => {
    const x = anchor.x + Math.cos(angle) * r;
    const y = anchor.y + Math.sin(angle) * r;
    return x - half >= margin && x + half <= viewport.width - margin && y - half >= margin && y + half <= viewport.height - margin;
  };
  for (let r = radius; r <= maxRadius; r += 4) {
    const arc = count > 1 ? step(r) * (count - 1) : 0;
    if (arc > Math.PI * 1.5) continue;
    for (let k = 0; k <= 36; k += 1) {
      for (const sign of k === 0 ? [1] : [1, -1]) {
        const centre = direction + sign * k * (Math.PI / 36);
        const first = centre - arc / 2;
        const angles = Array.from({ length: count }, (_, i) => (count === 1 ? centre : first + (arc * i) / (count - 1)));
        if (angles.every((angle) => fitsAt(r, angle))) {
          return {
            radius: r,
            direction: normalizeAngle(centre),
            spread: arc,
            fullCircle: false,
            items: angles.map((angle) => place(anchor, r, normalizeAngle(angle), half, margin, viewport)),
          };
        }
      }
    }
  }

  // Nothing fits unclamped (a tiny screen): the widest arc that stays in the
  // open half-plane, a little less than π, clamped onto the screen.
  const MAX_ARC = Math.PI * 0.9;
  let spread = 0;
  for (;;) {
    spread = step(radius) * (count - 1);
    if (spread <= MAX_ARC || radius >= maxRadius) break;
    radius += 4;
  }
  // Still too many for a half-circle at the largest radius: let the arc widen,
  // but never so far that the first and last items meet.
  if (spread > MAX_ARC) spread = Math.min(spread, TAU - step(radius));
  const start = direction - spread / 2;
  const items = Array.from({ length: count }, (_, i) => {
    const angle = normalizeAngle(count === 1 ? direction : start + (spread * i) / (count - 1));
    return place(anchor, radius, angle, half, margin, viewport);
  });
  return { radius, direction: normalizeAngle(direction), spread, fullCircle: false, items };
}

function place(anchor: Point, radius: number, angle: number, half: number, margin: number, viewport: { width: number; height: number }): RadialItemPlacement {
  const x = anchor.x + Math.cos(angle) * radius;
  const y = anchor.y + Math.sin(angle) * radius;
  return {
    angle,
    x: clamp(x, margin + half, viewport.width - margin - half),
    y: clamp(y, margin + half, viewport.height - margin - half),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

/**
 * Which item the pointer is choosing, or -1.
 *
 * Inside `deadZone` of the anchor nothing is chosen (release = cancel).
 * Outside it, the item whose direction is nearest the pointer's direction
 * wins — unless the pointer is far past every item (more than `reach`
 * beyond the ring), which is read as "slid away", also cancel.
 */
export function pickRadialItem(layout: RadialLayout, anchor: Point, pointer: Point, deadZone = 28, reach = 90): number {
  const dx = pointer.x - anchor.x;
  const dy = pointer.y - anchor.y;
  const distance = Math.hypot(dx, dy);
  if (distance < deadZone || layout.items.length === 0) return -1;
  if (distance > layout.radius + reach) return -1;
  const direction = Math.atan2(dy, dx);
  let best = -1;
  let bestDelta = Infinity;
  layout.items.forEach((item, index) => {
    // Use the item's DRAWN direction (after clamping), so what you see is what you get.
    const drawn = Math.atan2(item.y - anchor.y, item.x - anchor.x);
    const delta = angleDistance(direction, drawn);
    if (delta < bestDelta) {
      bestDelta = delta;
      best = index;
    }
  });
  // On an arc, a direction well outside it chooses nothing.
  if (!layout.fullCircle && layout.items.length > 0) {
    const halfStep = layout.items.length > 1 ? layout.spread / (layout.items.length - 1) / 2 : Math.PI / 4;
    if (bestDelta > Math.max(halfStep, Math.PI / 8) + Math.PI / 12) return -1;
  }
  return best;
}
