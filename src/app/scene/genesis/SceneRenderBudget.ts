/**
 * ==========================================================
 * LÉLUVERSE — SCENE RENDER BUDGET
 *
 * One small store that decides how much of the frame budget
 * the cosmic layers may use, so the universe yields to the
 * conversation instead of competing with it:
 *
 *   full    — normal: every loop renders every frame.
 *   reduced — the user is typing on a phone: decorative loops
 *             and the 3D canvas drop to ~12 fps until input
 *             has been quiet for a moment.
 *   paused  — an opaque surface (the full-screen phone chat)
 *             covers the scene: nothing visible is lost by not
 *             drawing it, and the GPU/backdrop-blur cost goes
 *             to zero. Also used while typing on a device whose
 *             frames were measured too slow for "reduced".
 *
 * Only PRESENTATION is budgeted. The simulation heartbeat
 * (EngineTick) is not governed by this store, so the universe
 * keeps evolving underneath; it is simply not repainted while
 * nobody can see it.
 * ==========================================================
 */

import { useSyncExternalStore } from "react";
import { mobile } from "./qualityLimits";

export type SceneRenderMode = "full" | "reduced" | "paused";

/** Interval between frames while reduced (~12 fps). */
export const REDUCED_FRAME_MS = 83;
/** How long after the last keystroke typing still counts as active. */
export const TYPING_HOLD_MS = 1200;

type Listener = () => void;

export class SceneRenderBudget {
  private occluders = new Set<string>();
  private typingUntil = 0;
  private typingTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<Listener>();
  private lastFrame = new Map<string, number>();
  private current: SceneRenderMode = "full";
  private slowDevice = false;

  constructor(
    /** Whether typing throttles rendering: phones by default, and any
     *  device whose frames are measured slow (markSlowRendering). */
    private throttleWhileTyping: boolean = mobile,
    private readonly now: () => number = () => Date.now(),
  ) {}

  mode(): SceneRenderMode {
    return this.current;
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SceneRenderMode => this.current;

  /** Mark a surface as covering (or no longer covering) the whole scene. */
  setOccluded(id: string, occluded: boolean): void {
    const had = this.occluders.has(id);
    if (occluded === had) return;
    if (occluded) this.occluders.add(id);
    else this.occluders.delete(id);
    this.recompute();
  }

  /** A canvas measured sustained slow frames: from now on, typing yields
   *  the frame budget on this device too (e.g. a laptop on integrated GPU). */
  markSlowRendering(): void {
    this.throttleWhileTyping = true;
    this.slowDevice = true;
  }

  /** Record a keystroke in a composer. Cheap: safe to call per key. */
  noteTyping(): void {
    if (!this.throttleWhileTyping) return;
    this.typingUntil = this.now() + TYPING_HOLD_MS;
    if (this.typingTimer === null) {
      this.recompute();
      this.scheduleTypingCheck(TYPING_HOLD_MS);
    }
  }

  /** The composer lost focus — typing is over now. */
  endTyping(): void {
    this.typingUntil = 0;
    if (this.typingTimer !== null) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
    this.recompute();
  }

  /**
   * Gate for hand-written requestAnimationFrame loops. Returns false when
   * the loop should skip drawing this frame (keep scheduling, skip work).
   */
  allowFrame(loopId: string, at: number = this.now()): boolean {
    if (this.current === "paused") return false;
    if (this.current === "full") return true;
    const last = this.lastFrame.get(loopId) ?? 0;
    if (at - last < REDUCED_FRAME_MS) return false;
    this.lastFrame.set(loopId, at);
    return true;
  }

  private scheduleTypingCheck(delay: number): void {
    this.typingTimer = setTimeout(() => {
      this.typingTimer = null;
      const remaining = this.typingUntil - this.now();
      if (remaining > 0) {
        this.scheduleTypingCheck(remaining);
        return;
      }
      this.recompute();
    }, delay);
  }

  private recompute(): void {
    const next: SceneRenderMode =
      this.occluders.size > 0
        ? "paused"
        : this.typingUntil > this.now()
          // A device measured slow cannot fit even ~12 fps between keys.
          ? this.slowDevice ? "paused" : "reduced"
          : "full";
    if (next === this.current) return;
    this.current = next;
    for (const listener of this.listeners) listener();
  }
}

let instance: SceneRenderBudget | null = null;

export function getSceneRenderBudget(): SceneRenderBudget {
  instance ??= new SceneRenderBudget();
  return instance;
}

/** React subscription to the current render mode. */
export function useSceneRenderMode(): SceneRenderMode {
  const budget = getSceneRenderBudget();
  return useSyncExternalStore(budget.subscribe, budget.getSnapshot, () => "full");
}
