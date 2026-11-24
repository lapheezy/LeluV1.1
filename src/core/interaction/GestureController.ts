/**
 * ==========================================================
 * LÉLU — GESTURE CONTROLLER
 *
 * Press-and-hold detection for circular controls, written once.
 *
 * The contract that matters: a hold OPENS the menu and the menu stays
 * open after the finger lifts. The user is never asked to keep pressure
 * while choosing an option. A tap stays a tap; a scroll stays a scroll.
 *
 * Keyboard is a first-class path, not a fallback bolted on later:
 * Enter/Space/ArrowDown opens the menu, Escape closes it (the menu owns
 * Escape once it is open).
 * ==========================================================
 */

import { INTERACTION_TOKENS } from "./tokens";

export interface HoldGestureHandlers {
  onTap?: () => void;
  onHold?: () => void;
  /** Called when movement cancels a pending hold (the gesture became a scroll). */
  onCancel?: () => void;
}

export interface HoldGestureOptions extends HoldGestureHandlers {
  holdMs?: number;
  moveCancelPx?: number;
}

interface GestureEvent {
  pointerId?: number;
  clientX: number;
  clientY: number;
  currentTarget?: EventTarget | null;
  preventDefault?: () => void;
}

export interface HoldGestureBinding {
  onPointerDown: (event: GestureEvent) => void;
  onPointerMove: (event: GestureEvent) => void;
  onPointerUp: (event: GestureEvent) => void;
  onPointerCancel: (event: GestureEvent) => void;
  onKeyDown: (event: { key: string; preventDefault?: () => void }) => void;
  onContextMenu: (event: { preventDefault?: () => void }) => void;
  cancel: () => void;
  isHeld: () => boolean;
}

/**
 * Create a binding. `hold` may be absent for a plain control; in that
 * case keyboard activation stays a tap.
 */
export function createHoldGesture(options: HoldGestureOptions = {}): HoldGestureBinding {
  const holdMs = options.holdMs ?? INTERACTION_TOKENS.holdMs;
  const moveCancelPx = options.moveCancelPx ?? INTERACTION_TOKENS.moveCancelPx;

  let timer: ReturnType<typeof setTimeout> | null = null;
  let held = false;
  let startX = 0;
  let startY = 0;
  let pointerId: number | null = null;

  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const reset = () => {
    clearTimer();
    held = false;
    pointerId = null;
  };

  const bind: HoldGestureBinding = {
    onPointerDown(event) {
      if (event.pointerId !== undefined) {
        pointerId = event.pointerId;
        const target = event.currentTarget as HTMLElement | null;
        try {
          target?.setPointerCapture?.(event.pointerId);
        } catch {
          // Capture is an optimization; the timer still works without it.
        }
      }
      startX = event.clientX;
      startY = event.clientY;
      held = false;
      clearTimer();
      if (options.onHold) {
        timer = setTimeout(() => {
          timer = null;
          held = true;
          options.onHold?.();
        }, holdMs);
      }
    },

    onPointerMove(event) {
      if (!timer || (pointerId !== null && event.pointerId !== undefined && event.pointerId !== pointerId)) return;
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (Math.hypot(dx, dy) > moveCancelPx) {
        clearTimer();
        options.onCancel?.();
      }
    },

    onPointerUp(event) {
      if (pointerId !== null && event.pointerId !== undefined && event.pointerId !== pointerId) return;
      const wasHeld = held;
      const wasPending = timer !== null;
      reset();
      if (wasHeld) return; // the menu is open; releasing does not choose anything
      if (wasPending) options.onTap?.();
    },

    onPointerCancel() {
      reset();
    },

    onKeyDown(event) {
      if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar" && event.key !== "ArrowDown") return;
      event.preventDefault?.();
      if (options.onHold) options.onHold();
      else options.onTap?.();
    },

    onContextMenu(event) {
      if (!options.onHold) return;
      event.preventDefault?.();
      options.onHold();
    },

    cancel() {
      reset();
    },

    isHeld() {
      return held;
    },
  };

  return bind;
}
