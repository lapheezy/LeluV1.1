/**
 * ==========================================================
 * LÉLU — WHERE SHE WAITS
 *
 * Her window has two dockings: beside a floating chat box, and the corner
 * when the chat fills the screen. Phase 2.7 adds a third, for the moment
 * neither applies because the WORLD itself has the screen: looking at a
 * created object, her full window covered a third of a phone frame and the
 * controls under it.
 *
 * Kept out of the component file so the geometry can be tested (and shared)
 * without mounting React or three.js.
 * ==========================================================
 */

export interface CompanionBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

const EDGE = 12;
/** How much room the phone navigation bar needs under her. */
const NAV_CLEARANCE = 116;

export const IMMERSIVE_DOCK = { width: 84, height: 100 } as const;

/** Where she waits while the world itself has the screen. */
export function immersiveDock(viewport: { width: number; height: number }): CompanionBox {
  const { width, height } = IMMERSIVE_DOCK;
  return {
    left: Math.max(EDGE, viewport.width - width - EDGE),
    top: Math.max(EDGE, viewport.height - height - NAV_CLEARANCE),
    width,
    height,
  };
}
