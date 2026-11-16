/**
 * ==========================================================
 * LÉLUVERSE — SCENE RENDER MANAGER
 *
 * ONE owner for the questions the rendering code used to answer
 * separately, and therefore inconsistently:
 *
 *   WHICH SURFACES EXIST      registerSurface / unregisterSurface —
 *                             a canvas, an overlay, a body. Nothing
 *                             paints that is not registered.
 *   HOW MUCH MAY BE PAINTED   profile: full → balanced → light.
 *   IS ANYONE LOOKING         document hidden / page hidden.
 *   IS THE CANVAS ALIVE       webglcontextlost / restored.
 *   IS THE DEVICE CAPABLE     a measured renderer string, not a UA.
 *
 * It does NOT decide the frame loop. SceneRenderBudget already
 * does that, and two mechanisms deciding one thing is the bug
 * this mission is fixing (see GenesisScene's covered-world
 * effect). Every suspension this manager learns about is
 * expressed as a NAMED OCCLUDER on that one budget, so the
 * existing `frameloopFor(mode)` remains the only answer to
 * "should this canvas paint right now".
 *
 * THE PROFILES
 *
 *   full      every loop renders every frame.
 *   balanced  same world, same identity, fewer paints: a phone or a
 *             narrow viewport gets the sky at 20 fps instead of 30
 *             and the avatar at 18 instead of 24. This is a
 *             PRESENTATION reduction — no layer is removed.
 *   light      no continuous WebGL at all. The DOM cosmos
 *             (CosmosSkyBackdrop: atmosphere, sunset, static,
 *             hurricane, lightning, rainbow) carries the identity,
 *             the Core keeps evolving on the simulation heartbeat,
 *             and every panel, module and the chat keep working.
 *
 * Light is chosen from EVIDENCE — a software renderer, no WebGL,
 * Save-Data, or a frame rate measured below 30 for three
 * seconds — never from a user-agent string. A phone is
 * "balanced", because a phone with a real GPU draws this world
 * perfectly well.
 *
 * Recovery is gradual and bounded by the device's ceiling: a
 * software rasteriser can never adapt its way back to WebGL, so
 * the profile it starts at is the highest it may ever reach.
 * ==========================================================
 */

import { useSyncExternalStore } from "react";
import {
  getSceneRenderBudget,
  type SceneRenderBudget,
  type SceneRenderMode,
} from "./SceneRenderBudget";

export type RenderProfile = "full" | "balanced" | "light";
export type RenderSurfaceKind = "world" | "avatar" | "effect";

/** Ascending quality, so a step is an index move in this array. */
export const PROFILE_ORDER: readonly RenderProfile[] = ["light", "balanced", "full"];

/**
 * Driver strings that mean "there is no GPU here". The same test
 * GenesisScene has always used to refuse painting the world.
 */
export const SOFTWARE_GL_RENDERER = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** Below this many frames a second, a visible canvas is not worth its cost. */
export const SLOW_FPS = 30;
/** Above this, there is room to restore quality. */
export const FAST_FPS = 55;
/** Consecutive slow samples before stepping down (one sample = one second). */
export const DOWNGRADE_AFTER = 3;
/**
 * Consecutive fast samples before stepping up. Deliberately far longer
 * than the downgrade: a wrong upgrade is visible as stutter, a late one
 * only costs a few seconds of lower quality.
 */
export const UPGRADE_AFTER = 15;

export interface CapabilityInput {
  /** Unmasked WebGL renderer string, when one could be read. */
  renderer?: string;
  /** False when no WebGL context could be created at all. */
  webgl?: boolean;
  /** Viewport is narrow (a phone-sized surface, whatever the UA says). */
  narrow?: boolean;
  /** UA says mobile — a hint for "balanced", never a reason for "light". */
  mobile?: boolean;
  /** navigator.connection.saveData: the user asked for less data. */
  saveData?: boolean;
}

/**
 * The profile a device starts at, from capability alone.
 *
 * Pure, and the only place a profile is chosen from hardware. Two rules
 * matter and both are deliberate:
 *
 *  - a UA mobile flag can reach "balanced" but never "light": phones
 *    have real GPUs, and treating them as broken was the assumption
 *    that made the cosmos look degraded on good hardware;
 *  - an UNREADABLE renderer string is not evidence of weakness. Safari
 *    hides it, and guessing "light" from a missing string would blank
 *    the world on a capable browser.
 */
export function profileFor(input: CapabilityInput): RenderProfile {
  if (input.webgl === false) return "light";
  if (input.renderer && SOFTWARE_GL_RENDERER.test(input.renderer)) return "light";
  if (input.saveData) return "light";
  if (input.narrow || input.mobile) return "balanced";
  return "full";
}

export interface AdaptationState {
  profile: RenderProfile;
  slow: number;
  fast: number;
}

/**
 * One measured second in, the next profile out.
 *
 * Pure so it can be tested without a browser, and so the rule that
 * matters most is checkable: a MISSING measurement never changes
 * anything. `painting: false` means the canvas drew nothing for that
 * second (it was paused, covered, or the tab was hidden), and a
 * paused canvas must never be read as a slow one — that is exactly how
 * "lower the quality while nobody is looking" turns into a permanently
 * degraded scene after one backgrounded minute.
 */
export function nextProfile(
  state: AdaptationState,
  sample: { fps: number; painting: boolean },
  ceiling: RenderProfile = "full",
): AdaptationState {
  const ceil = Math.max(0, PROFILE_ORDER.indexOf(ceiling));
  const at = PROFILE_ORDER.indexOf(state.profile);

  if (!sample.painting || !Number.isFinite(sample.fps) || sample.fps <= 0) {
    return state.slow === 0 && state.fast === 0 ? state : { profile: state.profile, slow: 0, fast: 0 };
  }

  if (sample.fps < SLOW_FPS) {
    const slow = state.slow + 1;
    if (slow < DOWNGRADE_AFTER) return { profile: state.profile, slow, fast: 0 };
    return { profile: PROFILE_ORDER[Math.max(0, at - 1)], slow: 0, fast: 0 };
  }

  if (sample.fps > FAST_FPS) {
    const fast = state.fast + 1;
    if (fast < UPGRADE_AFTER) return { profile: state.profile, slow: 0, fast };
    return { profile: PROFILE_ORDER[Math.min(ceil, at + 1)], slow: 0, fast: 0 };
  }

  // Between the two thresholds: hold, and stop counting toward either edge.
  return state.slow === 0 && state.fast === 0 ? state : { profile: state.profile, slow: 0, fast: 0 };
}

/**
 * How often the DOM cosmos repaints, per profile.
 *
 * At "full" it simply follows the frame loop. Lower profiles slow it down
 * instead of removing it: the sky is the one layer that survives a light
 * device, so it keeps moving — a gradient at 20 fps is indistinguishable
 * from one at 60, and static snow at 12 fps is what a real television did.
 */
export function skyPaintInterval(profile: RenderProfile): number {
  return profile === "full" ? 0 : profile === "balanced" ? 50 : 80;
}

/** The slice of `document`/`window` this manager needs, so tests can drive it. */
export interface VisibilityHost {
  readonly hidden?: boolean;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

export interface RenderEnvironment {
  document?: VisibilityHost | null;
  window?: VisibilityHost | null;
}

export interface RenderSurface {
  id: string;
  kind: RenderSurfaceKind;
}

export interface RenderManagerSnapshot {
  profile: RenderProfile;
  /** The best profile this device may reach — capability, not measurement. */
  ceiling: RenderProfile;
  hidden: boolean;
  /** The one budget's decision, mirrored here for diagnostics only. */
  mode: SceneRenderMode;
  surfaces: RenderSurface[];
  lostContexts: string[];
}

/** Occluder ids this manager owns on the shared budget. */
export const PAGE_HIDDEN_OCCLUDER = "page-hidden";
export const contextLostOccluder = (id: string): string => `context-lost:${id}`;

type Listener = () => void;

export class SceneRenderManager {
  private readonly budget: SceneRenderBudget;
  private readonly env: RenderEnvironment;
  private surfaces = new Map<string, RenderSurfaceKind>();
  private lost = new Set<string>();
  private adaptation: AdaptationState = { profile: "full", slow: 0, fast: 0 };
  private ceiling: RenderProfile = "full";
  private hidden = false;
  private detachVisibility: (() => void) | null = null;
  private listeners = new Set<Listener>();
  private snapshot: RenderManagerSnapshot;

  constructor(budget: SceneRenderBudget = getSceneRenderBudget(), env?: RenderEnvironment) {
    this.budget = budget;
    this.env = env ?? {
      document: typeof document !== "undefined" ? (document as unknown as VisibilityHost) : null,
      window: typeof window !== "undefined" ? (window as unknown as VisibilityHost) : null,
    };
    this.snapshot = this.buildSnapshot();
  }

  profile(): RenderProfile {
    return this.adaptation.profile;
  }

  registerSurface(id: string, kind: RenderSurfaceKind = "effect"): void {
    if (this.surfaces.has(id)) return;
    this.surfaces.set(id, kind);
    this.attachVisibility();
    this.publish();
  }

  unregisterSurface(id: string): void {
    if (!this.surfaces.delete(id)) return;
    // A surface that goes away cannot leave its own suspension behind:
    // a lost context that is never restored must not pause the budget
    // forever after its canvas unmounted.
    if (this.lost.delete(id)) this.budget.setOccluded(contextLostOccluder(id), false);
    if (this.surfaces.size === 0) this.detachVisibilityNow();
    this.publish();
  }

  /** Hardware/capability evidence. Sets the starting profile AND the ceiling. */
  setCapability(input: CapabilityInput): void {
    this.ceiling = profileFor(input);
    this.adaptation = { profile: this.ceiling, slow: 0, fast: 0 };
    this.publish();
  }

  /**
   * One measured second from a canvas. `painting` is false when the canvas
   * drew nothing that second, which is not a performance signal.
   */
  reportFrameRate(fps: number, painting: boolean): void {
    const next = nextProfile(this.adaptation, { fps, painting }, this.ceiling);
    if (next.profile === this.adaptation.profile && next === this.adaptation) return;
    const changed = next.profile !== this.adaptation.profile;
    this.adaptation = next;
    if (changed) this.publish();
  }

  reportContextLost(id: string): void {
    if (this.lost.has(id)) return;
    this.lost.add(id);
    this.budget.setOccluded(contextLostOccluder(id), true);
    this.publish();
  }

  reportContextRestored(id: string): void {
    if (!this.lost.delete(id)) return;
    this.budget.setOccluded(contextLostOccluder(id), false);
    this.publish();
  }

  isContextLost(id: string): boolean {
    return this.lost.has(id);
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): RenderManagerSnapshot => this.snapshot;

  private buildSnapshot(): RenderManagerSnapshot {
    return {
      profile: this.adaptation.profile,
      ceiling: this.ceiling,
      hidden: this.hidden,
      mode: this.budget.mode(),
      surfaces: [...this.surfaces].map(([id, kind]) => ({ id, kind })),
      lostContexts: [...this.lost],
    };
  }

  private publish(): void {
    this.snapshot = this.buildSnapshot();
    if (typeof window !== "undefined") {
      (window as unknown as { __leluRenderManager?: RenderManagerSnapshot }).__leluRenderManager =
        this.snapshot;
    }
    for (const listener of this.listeners) listener();
  }

  /**
   * Page visibility is attached only while a surface exists, and removed
   * with the last one. A manager that keeps a listener after every canvas
   * is gone is a leak that only shows up as a tab that will not sleep.
   */
  private attachVisibility(): void {
    if (this.detachVisibility) return;
    const doc = this.env.document;
    const win = this.env.window;
    if (!doc && !win) return;

    const apply = (hidden: boolean) => {
      if (hidden === this.hidden) return;
      this.hidden = hidden;
      // Through the budget, as an occluder — never as a second opinion on
      // the frame loop. Nothing visible is lost while the page is hidden.
      this.budget.setOccluded(PAGE_HIDDEN_OCCLUDER, hidden);
      this.publish();
    };
    const onVisibility = () => apply(Boolean(doc?.hidden));
    const onHide = () => apply(true);
    const onShow = () => apply(false);

    doc?.addEventListener("visibilitychange", onVisibility);
    win?.addEventListener("pagehide", onHide);
    win?.addEventListener("pageshow", onShow);

    this.detachVisibility = () => {
      doc?.removeEventListener("visibilitychange", onVisibility);
      win?.removeEventListener("pagehide", onHide);
      win?.removeEventListener("pageshow", onShow);
    };

    // Registering while already hidden (a background tab that a bounce
    // restored) must start suspended, not wait for an event that will
    // never come.
    if (doc?.hidden) apply(true);
  }

  private detachVisibilityNow(): void {
    this.detachVisibility?.();
    this.detachVisibility = null;
    if (this.hidden) {
      this.hidden = false;
      this.budget.setOccluded(PAGE_HIDDEN_OCCLUDER, false);
    }
  }
}

let instance: SceneRenderManager | null = null;

export function getSceneRenderManager(): SceneRenderManager {
  instance ??= new SceneRenderManager();
  return instance;
}

/** React subscription to the manager's snapshot (identity-stable between changes). */
export function useRenderManager(): RenderManagerSnapshot {
  const manager = getSceneRenderManager();
  return useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
}

/** Just the profile — what most components need. */
export function useRenderProfile(): RenderProfile {
  return useRenderManager().profile;
}
