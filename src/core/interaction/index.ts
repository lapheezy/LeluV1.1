/**
 * LÉLU — the shared interaction system.
 *
 * Every environment imports its circular controls and menus from here.
 * There is no per-environment radial implementation.
 */

export { default as CircularControl } from "./CircularControl";
export { default as RadialMenu } from "./RadialMenu";
export { default as RadialMenuItem } from "./RadialMenuItem";
export { default as ContextMenu } from "./ContextMenu";
export { createHoldGesture } from "./GestureController";
export { InteractionStateManager, interactionState } from "./InteractionStateManager";
export { INTERACTION_TOKENS, INTERACTION_CSS_VARS } from "./tokens";
export {
  clamp,
  currentViewport,
  placeContextMenu,
  placeRadial,
  radialOptionPosition,
  radialOptionPositions,
  rectOf,
} from "./geometry";

export type { CircularControlProps } from "./CircularControl";
export type { RadialMenuDefinition } from "./RadialMenu";
export type { RadialMenuItemSpec } from "./RadialMenuItem";
export type { ContextMenuDefinition, ContextMenuItemSpec } from "./ContextMenu";
export type { HoldGestureOptions, HoldGestureBinding } from "./GestureController";
export type { OpenInteractionMenu } from "./InteractionStateManager";
export type { InteractionRect, InteractionSize, RadialPlacement, ContextPlacement } from "./geometry";
