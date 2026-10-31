/**
 * ==========================================================
 * LÉLU — LAYER HIERARCHY
 *
 * One ordering for everything that stacks.
 *
 * Genesis carried twenty distinct hand-written z-index values between 5
 * and 100, each chosen locally to beat whatever it happened to collide
 * with that day. Nothing recorded which things were ABOVE which, so the
 * order was whatever the numbers happened to produce — and the
 * screenshot showed the result: cognition cards over the composer, the
 * dock over the send button, the palette under the tabs it opened from.
 *
 * The fix is not bigger numbers. It is saying, once, what sits above
 * what — and leaving gaps so a future element can slot between two
 * layers without a renumbering that silently reorders everything else.
 *
 * Read top to bottom: later entries paint over earlier ones.
 * ==========================================================
 */

export const LAYERS = {
  /** The 3D scene and anything painted into the world itself. */
  scene: 0,

  /** Persistent workspace furniture: panels, windows, docked surfaces. */
  panel: 100,
  /** A panel the user is actively dragging or resizing. */
  panelActive: 150,

  /**
   * Primary navigation. Above panels, because a panel must never cover
   * the only way to leave it.
   */
  navigation: 200,
  /** Conversation tabs and the workspace switcher. */
  tabs: 250,

  /**
   * The chat composer: input, mic, send, media.
   *
   * Deliberately above navigation. These are the controls the user is
   * most likely to be mid-interaction with, and the brief is explicit
   * that notifications must not cover them.
   */
  composer: 300,

  /** Transient cognition surfaces — suggestions, status, toasts. */
  notification: 400,

  /** Command palette and other summoned overlays. */
  overlay: 500,

  /** Modal dialogs, which block everything beneath by definition. */
  modal: 600,

  /** Drag previews and tooltips that must clear even a modal. */
  tooltip: 700,
} as const;

export type LayerName = keyof typeof LAYERS;

/** The z-index for a named layer. Use this instead of a literal. */
export function layer(name: LayerName): number {
  return LAYERS[name];
}

/**
 * A z-index just above a layer, for the nth element within it.
 *
 * Stacking inside a layer is legitimate — two notifications, a panel and
 * its own resize handle. The offset is clamped below the gap to the next
 * layer so local stacking can never escape its layer, which is exactly
 * how the original numbers drifted into each other.
 */
export function within(name: LayerName, offset: number): number {
  return LAYERS[name] + Math.max(0, Math.min(offset, 49));
}
