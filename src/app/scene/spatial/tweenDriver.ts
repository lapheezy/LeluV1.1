/**
 * ==========================================================
 * LÉLUVERSE — TRANSITION DRIVER
 *
 * GSAP drives cinematic transitions; this module is the one
 * place that talks to it.
 *
 * Two reasons it exists rather than calling gsap directly from
 * the runtime:
 *
 *  1. The package resolves differently under the browser bundler
 *     and under the Node ESM test runner (CJS interop exposes the
 *     API on `gsap`, not as the default export). Resolving once,
 *     here, is what keeps "works in production" and "works under
 *     the test runner" the same code path instead of two.
 *  2. If GSAP cannot be resolved at all, a transition must still
 *     run. The fallback is a plain time-based tween on the same
 *     interface, so a broken dependency degrades the easing, not
 *     the spatial experience.
 * ==========================================================
 */

import * as gsapNamespace from "gsap";

export interface TweenHandle {
  kill: () => void;
}

interface GsapLike {
  to: (target: Record<string, number>, vars: Record<string, unknown>) => TweenHandle;
}

function resolveGsap(): GsapLike | null {
  const namespace = gsapNamespace as unknown as Record<string, unknown>;
  const candidates = [namespace.gsap, namespace.default, namespace];
  for (const candidate of candidates) {
    if (candidate && typeof (candidate as GsapLike).to === "function") {
      return candidate as GsapLike;
    }
  }
  return null;
}

const gsapInstance = resolveGsap();

/*
 * GSAP smooths over slow frames by clamping each tick to a fixed ~33 ms. That is
 * meant to hide a hitch, but a spatial transition is a timed journey: when frames
 * are genuinely slow (software rendering, a busy phone) the clamp makes the
 * transition take minutes instead of its declared duration, so travel starts and
 * never arrives. The driver therefore asks GSAP to use real elapsed time.
 */
(gsapInstance as unknown as {
  ticker?: { lagSmoothing?: (threshold: number, adjustedLag?: number) => void };
} | null)?.ticker?.lagSmoothing?.(0);

/** True when the real GSAP is driving transitions. */
export const gsapDriving = gsapInstance !== null;

/* Minimal easing set for the fallback: the same feel, no dependency. */
const FALLBACK_EASES: Record<string, (t: number) => number> = {
  "power2.out": (t) => 1 - Math.pow(1 - t, 2),
  "power2.inOut": (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  "power3.inOut": (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  "power3.in": (t) => t * t * t,
  "sine.inOut": (t) => -(Math.cos(Math.PI * t) - 1) / 2,
};

/**
 * Tween a scalar 0 → 1 over `durationMs`, calling onUpdate with the eased
 * value, then onComplete.
 */
export function tweenProgress(
  durationMs: number,
  ease: string,
  onUpdate: (progress: number) => void,
  onComplete: () => void,
): TweenHandle {
  if (gsapInstance) {
    const target = { t: 0 };
    return gsapInstance.to(target, {
      // The destination value is what GSAP animates TOWARDS; without it
      // there is nothing to tween and the transition never advances.
      t: 1,
      duration: Math.max(0.001, durationMs / 1000),
      ease,
      onUpdate: () => onUpdate(target.t),
      onComplete,
    });
  }

  const easeFn = FALLBACK_EASES[ease] ?? ((t: number) => t);
  const started = performance.now();
  let frame = 0;
  let cancelled = false;
  const step = () => {
    if (cancelled) return;
    const elapsed = performance.now() - started;
    const linear = Math.min(1, elapsed / Math.max(1, durationMs));
    onUpdate(easeFn(linear));
    if (linear >= 1) {
      onComplete();
      return;
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return {
    kill: () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    },
  };
}

/**
 * Tween a scalar from `start` to `end` (used to reverse a transition
 * back to where it began) with its own duration.
 */
export function tweenScalar(
  start: number,
  end: number,
  durationMs: number,
  onUpdate: (value: number) => void,
  onComplete: () => void,
): TweenHandle {
  if (gsapInstance) {
    const target = { t: start };
    return gsapInstance.to(target, {
      t: end,
      duration: Math.max(0.001, durationMs / 1000),
      ease: "power2.inOut",
      onUpdate: () => onUpdate(target.t),
      onComplete,
    });
  }

  const started = performance.now();
  let frame = 0;
  let cancelled = false;
  const step = () => {
    if (cancelled) return;
    const linear = Math.min(1, (performance.now() - started) / Math.max(1, durationMs));
    const eased = -(Math.cos(Math.PI * linear) - 1) / 2;
    onUpdate(start + (end - start) * eased);
    if (linear >= 1) {
      onComplete();
      return;
    }
    frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return {
    kill: () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    },
  };
}
