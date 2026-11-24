/**
 * ==========================================================
 * LÉLU — INTERACTION TOKENS
 *
 * One set of numbers for every circular control, radial menu and
 * contextual menu in the project. Components read these values instead
 * of inventing their own durations, icon sizes or touch targets, so the
 * interaction language stays the same while each environment keeps its
 * own colours and surfaces.
 * ==========================================================
 */

export const INTERACTION_TOKENS = {
  /** How long a press must last before it is a hold. */
  holdMs: 260,
  /** Movement past this many pixels cancels the hold, so a scroll is a scroll. */
  moveCancelPx: 12,

  duration: {
    instant: 90,
    fast: 160,
    base: 240,
    slow: 340,
  },

  easing: {
    standard: "cubic-bezier(0.2, 0.8, 0.2, 1)",
    exit: "cubic-bezier(0.4, 0, 1, 1)",
  },

  size: {
    /** Minimum touch target (Apple HIG is 44, Material is 48). */
    touch: 48,
    control: 48,
    controlCompact: 44,
    option: 56,
    icon: 20,
    optionIcon: 22,
    hub: 44,
  },

  gap: {
    /** Space between the control edge and the first option. */
    ring: 14,
    /** Space between a menu and the viewport edge. */
    edge: 12,
    /** Space between option circles. */
    option: 6,
  },

  radius: {
    preferred: 104,
    compact: 88,
  },

  z: {
    menu: 520,
    context: 521,
  },
} as const;

export type InteractionTokens = typeof INTERACTION_TOKENS;

/** The same tokens as CSS custom properties for CSS-only consumers. */
export const INTERACTION_CSS_VARS = {
  "--lelu-touch-target": `${INTERACTION_TOKENS.size.touch}px`,
  "--lelu-control-size": `${INTERACTION_TOKENS.size.control}px`,
  "--lelu-option-size": `${INTERACTION_TOKENS.size.option}px`,
  "--lelu-duration-fast": `${INTERACTION_TOKENS.duration.fast}ms`,
  "--lelu-duration-base": `${INTERACTION_TOKENS.duration.base}ms`,
  "--lelu-ease-standard": INTERACTION_TOKENS.easing.standard,
} as const;
