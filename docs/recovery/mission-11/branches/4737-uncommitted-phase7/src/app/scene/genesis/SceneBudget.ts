/**
 * ==========================================================
 * LÉLU — DECORATIVE RENDER BUDGET
 *
 * The cosmos is decoration. The conversation is the product.
 *
 * Measured in a real browser with the chat open: the WebGL scene was
 * repainting every ~870 ms of main-thread time per frame, and typing
 * into the composer took 1.2–2.2 s to appear. Hiding the scene canvas
 * dropped the same measurement to ~220–400 ms. The chat was not slow
 * because of the network — it was slow because the scenery was winning.
 *
 * So the scene gets a budget, and the budget is owned by whoever is
 * looking at something else:
 *
 *   • chat is the active panel → the 3D scene stops painting. Its last
 *     frame stays on screen, so nothing visibly changes behind the
 *     conversation; the render loop simply stops competing with it.
 *   • the tab is hidden (phone in a pocket, another app in front) →
 *     nothing paints at all.
 *   • everything else → full rate, exactly as before.
 *
 * This is a render-loop switch, not a visual change: no opacity, no
 * layout, no second scene. Resuming is immediate — the loop picks up on
 * the next frame.
 * ==========================================================
 */

import { useEffect, useState } from "react";

type Listener = (paused: boolean) => void;

let paused = false;
const listeners = new Set<Listener>();

/** Is the decorative scene currently paused? */
export function isScenePaused(): boolean {
  return paused;
}

/**
 * Pause or resume decorative painting. Idempotent: repeating the same
 * value notifies nobody, so a state update that changes nothing cannot
 * cascade into every subscriber.
 */
export function setScenePaused(next: boolean): void {
  if (next === paused) return;
  paused = next;
  for (const listener of listeners) {
    try {
      listener(paused);
    } catch {
      // A subscriber's failure must not stop the others from hearing.
    }
  }
}

/** Subscribe to pause changes. Returns the unsubscribe function. */
export function subscribeScenePaused(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React binding: true while decorative painting is suspended. */
export function useScenePaused(): boolean {
  const [value, setValue] = useState(paused);
  useEffect(() => {
    setValue(paused);
    return subscribeScenePaused(setValue);
  }, []);
  return value;
}

/**
 * Feed the budget from the interface's own view of what is on screen.
 *
 * `distracted` is true when something more important than scenery owns
 * the viewport (the chat). Document visibility is folded in here so a
 * backgrounded tab is paused even when no panel changed.
 */
export function useSceneBudget(distracted: boolean): void {
  useEffect(() => {
    const apply = () => {
      setScenePaused(distracted || (typeof document !== "undefined" && document.hidden));
    };

    apply();
    document.addEventListener("visibilitychange", apply);
    return () => {
      document.removeEventListener("visibilitychange", apply);
      // Leaving the surface entirely must not leave the scene frozen for
      // whoever mounts next.
      setScenePaused(false);
    };
  }, [distracted]);
}
