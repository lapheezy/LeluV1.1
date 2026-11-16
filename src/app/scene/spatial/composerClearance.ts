/**
 * LÉLU — keep the spatial navigator off the chat composer.
 *
 * The navigator floats at the bottom of the world (layer "navigation"); the
 * chat composer lives INSIDE the chat window, whose stacking context is the
 * panel layer. So the composer's own higher z-index never reaches the
 * navigator, and an open capability-groups panel sat on top of the textarea
 * and Send button — found live in the 20-turn voice run (Mission 10.3): the
 * typed turn could not be entered.
 *
 * The navigator does not get disabled or shrunk to fix this: it measures the
 * composer and lifts itself just clear of it. Pure, so it is unit-tested.
 */

export interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Space kept between the navigator and the composer, in px. */
export const COMPOSER_GAP = 8;

/**
 * How far (px, ≥ 0) the navigator must move UP so that, at its natural
 * position, it no longer overlaps the composer. `nav` is the navigator's
 * rect at its natural (un-lifted) position.
 *
 * Returns 0 when they do not overlap horizontally, or when the navigator
 * already sits entirely above the composer.
 */
export function composerLift(nav: Box, composer: Box | null | undefined, gap = COMPOSER_GAP): number {
  if (!composer) return 0;
  if (composer.right - composer.left <= 0 || composer.bottom - composer.top <= 0) return 0;
  const horizontal = Math.min(nav.right, composer.right) - Math.max(nav.left, composer.left);
  if (horizontal <= 0) return 0;
  // Already clear above the composer (with the gap)?
  if (nav.bottom <= composer.top - gap) return 0;
  // Entirely below the composer: no overlap, leave it where it is.
  if (nav.top >= composer.bottom) return 0;
  return Math.ceil(nav.bottom - (composer.top - gap));
}

/**
 * Whether the lifted navigator would leave the top of the viewport — then
 * the capability groups (the tall part) should collapse instead of covering
 * the conversation's header.
 */
export function liftOverflowsTop(nav: Box, lift: number, topInset = 0): boolean {
  return nav.top - lift < topInset;
}
