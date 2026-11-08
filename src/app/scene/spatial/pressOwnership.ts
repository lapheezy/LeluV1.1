/**
 * ==========================================================
 * LÉLUVERSE — PRESS OWNERSHIP
 *
 * A press belongs to the portal the pointer landed on, for the
 * whole life of that press.
 *
 * The field rotates continuously, so the thing under a fixed
 * screen pixel at pointer-up is frequently a *different* portal
 * from the one under it at pointer-down. Re-resolving the portal
 * at release therefore silently opens the neighbour: measured in
 * Mission 5.4B.8, a press on Studio opened Browser because the
 * field had rotated Browser's mouth under the release pixel.
 *
 * The rule is one line: the identity is resolved once, at
 * pointer-down, and release may only complete or refuse it. It
 * may never replace it.
 *
 * This module is pure so the rule can be tested without a
 * renderer: no three.js, no React, no DOM.
 * ==========================================================
 */

/** Movement beyond this many CSS pixels is a drag, not a press. */
export const PRESS_MOVE_THRESHOLD_PX = 18;

/**
 * One activation per interaction, including the click the renderer
 * derives from the same press: a release followed by a synthesised
 * click is still one press.
 */
export const ACTIVATION_WINDOW_MS = 500;

/** The portal a press was started on: the identity, not a screen point. */
export interface OwnedPress {
  portalId: string;
  destination: string;
  label: string;
  pointerId: number;
  /** Where the pointer was when the press was claimed. */
  x: number;
  y: number;
  at: number;
}

export interface PortalPressTarget {
  id: string;
  destination: string;
  label: string;
}

export interface PointerPosition {
  pointerId: number;
  x: number;
  y: number;
}

export type PressRefusal = "wrong-pointer" | "moved" | "duplicate";

export type PressResolution =
  | { kind: "activate"; press: OwnedPress; moved: number }
  | { kind: "refuse"; press: OwnedPress; moved: number; reason: PressRefusal };

/** Claim a press for a portal. A new press always replaces an older one. */
export function claimPress(
  target: PortalPressTarget,
  pointer: PointerPosition,
  now: number,
): OwnedPress {
  return {
    portalId: target.id,
    destination: target.destination,
    label: target.label,
    pointerId: pointer.pointerId,
    x: pointer.x,
    y: pointer.y,
    at: now,
  };
}

export function pressMovement(press: OwnedPress, release: PointerPosition): number {
  return Math.hypot(release.x - press.x, release.y - press.y);
}

/**
 * Resolve a press against its release.
 *
 * Activation travels to `press.portalId` — the portal the press claimed — and
 * never to whatever happens to be under the release pixel. The release coords
 * are used only to measure movement and to match the pointer.
 */
export function resolvePress(
  press: OwnedPress,
  release: PointerPosition,
  lastActivationAt: number,
  now: number,
): PressResolution {
  const moved = pressMovement(press, release);
  if (release.pointerId !== press.pointerId) {
    return { kind: "refuse", press, moved, reason: "wrong-pointer" };
  }
  if (moved > PRESS_MOVE_THRESHOLD_PX) {
    return { kind: "refuse", press, moved, reason: "moved" };
  }
  /* Zero (or a clock that has not reached the window yet) means "never". */
  if (lastActivationAt > 0 && now - lastActivationAt < ACTIVATION_WINDOW_MS) {
    return { kind: "refuse", press, moved, reason: "duplicate" };
  }
  return { kind: "activate", press, moved };
}

/**
 * A synthesised click that follows a resolved press is the same interaction.
 * Suppressing it here is what keeps one physical press to one activation.
 */
export function shouldSuppressClick(lastActivationAt: number, now: number): boolean {
  return lastActivationAt > 0 && now - lastActivationAt < ACTIVATION_WINDOW_MS;
}

/** Whether a press may start a new flight, given the runtime's own state. */
export function refusesBusyFlight(
  transition: unknown,
  inflightDestination: string | null,
  requested: string,
): boolean {
  return Boolean(transition) && inflightDestination !== requested;
}
