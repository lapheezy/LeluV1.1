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
 *
 * CAPABILITY HAS A LIFETIME. The evidence a profile is chosen from —
 * the renderer string, whether WebGL exists, how wide the viewport is —
 * is re-read when the viewport, the orientation or the context changes,
 * not only at mount. A profile demoted by MEASUREMENT is a statement
 * about the surface those frames were measured on, so it is re-derived
 * when that surface is replaced; hardware evidence is not, because a
 * window resize cannot change which GPU is installed.
 *
 * AN OVERRIDE IS A FLOOR, NOT A CEILING. `?render=gpu` lets an operator
 * state that a GPU is real and its frames are slow because the machine is
 * constrained. It stops measurement from demoting the profile, but only
 * down to what the hardware can actually do: it can never exceed the
 * capability ceiling, it is refused outright when there is no GPU to paint
 * with (a software rasteriser, no WebGL), and it never bypasses a lost
 * context — that suspends through the budget, which the override does not
 * touch.
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
/**
 * Consecutive slow samples before MEASUREMENT may take the last step — the one
 * out of "balanced", where the world stops being animated and starts being
 * thrown away.
 *
 * Deliberately far longer than DOWNGRADE_AFTER: `full → balanced` costs some
 * motion, `balanced → light` costs the world, and it is the only step whose
 * consequence (a canvas that no longer runs frames) also removes the evidence
 * that could undo it. Three slow seconds is a shader compile; fifteen is a
 * machine that cannot paint.
 */
export const DOWNGRADE_TO_LIGHT_AFTER = 15;
/**
 * How long viewport/orientation events are collected before capability is
 * re-read. A window drag fires `resize` dozens of times; a capability
 * decision does not need recomputing per event, and a decision taken in the
 * middle of a drag describes a surface that no longer exists.
 */
export const CAPABILITY_RECHECK_MS = 250;

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
  /** Few CPU threads (≤ 2) or little memory (≤ 2 GB): a hint for "balanced", never "light" on its own. */
  lowEndCpu?: boolean;
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
  if (input.narrow || input.mobile || input.lowEndCpu) return "balanced";
  return "full";
}

/**
 * A stable description of the evidence a profile was derived from.
 *
 * Used only for EQUALITY: a reassessment whose signature is unchanged is the
 * same decision it was last time, and must not reset counts, rebuild a
 * renderer or notify a subscriber. That is what makes "size changed, profile
 * oscillated" impossible without a cooldown timer.
 */
export function capabilitySignature(input: CapabilityInput): string {
  return [
    input.webgl === false ? "none" : "webgl",
    (input.renderer ?? "").trim().toLowerCase(),
    input.narrow ? "narrow" : "wide",
    input.mobile ? "mobile" : "stationary",
    input.saveData ? "save-data" : "full-data",
    input.lowEndCpu ? "low-cpu" : "cpu",
  ].join("|");
}

/** Why a writer is allowed to move the viewport/renderer, spelled out. */
export type CapabilityTrigger =
  | "mount"
  | "resize"
  | "orientation"
  | "context-restored"
  | "renderer"
  | "manual";

/**
 * An EXPLICIT request that GPU rendering stay on, from configuration rather
 * than from a browser heuristic. `source` exists so an accidental one can be
 * recognised in diagnostics; `reason` is shown to whoever reads it.
 */
export interface RenderOverride {
  profile: RenderProfile;
  reason: string;
  source: string;
}

export type OverrideVerdict = "applied" | "refused:no-webgl" | "refused:software";

/**
 * Whether an override may be granted at all.
 *
 * An override is a statement about a CAPABLE machine whose frames are slow, so
 * it is refused where there is nothing to paint with: no WebGL, or a software
 * rasteriser. Those are not constrained GPUs, and forcing them on would be the
 * "silently force rendering on failing hardware" this exists to avoid.
 */
export function overrideVerdict(input: CapabilityInput): OverrideVerdict {
  if (input.webgl === false) return "refused:no-webgl";
  if (input.renderer && SOFTWARE_GL_RENDERER.test(input.renderer)) return "refused:software";
  return "applied";
}

/**
 * The explicit request in a query string, or null.
 *
 *   ?render=gpu        keep the world painting at the device's own ceiling
 *   ?render=balanced   paint, but never above balanced
 *
 * Anything else — including a typo — is NOT an override: an accidental
 * parameter must degrade to the default policy, never to a guess.
 */
export function readRenderOverride(search: string): RenderOverride | null {
  const value = new URLSearchParams(search).get("render")?.toLowerCase() ?? "";
  if (value === "gpu") {
    return {
      profile: "full",
      reason: "explicit ?render=gpu: a real GPU whose frames are measured slowly (constrained VM, remote session, thermal state)",
      source: "url:render=gpu",
    };
  }
  if (value === "balanced") {
    return {
      profile: "balanced",
      reason: "explicit ?render=balanced: keep painting, but not above balanced",
      source: "url:render=balanced",
    };
  }
  return null;
}

/** Why the effective profile is what it is — the diagnostic this lacked. */
export type RenderReason =
  | "capability"
  | "capability:no-webgl"
  | "capability:software"
  | "capability:save-data"
  | "capability:narrow"
  | "measurement:slow"
  | "override";

/**
 * Explain a profile from the evidence behind it. Pure, so the explanation
 * cannot drift from the decision it describes.
 */
export function profileReason(
  input: CapabilityInput,
  profile: RenderProfile,
  override: RenderOverride | null,
): RenderReason {
  if (override) return "override";
  if (input.webgl === false) return "capability:no-webgl";
  if (input.renderer && SOFTWARE_GL_RENDERER.test(input.renderer)) return "capability:software";
  if (input.saveData) return "capability:save-data";
  if (profile === profileFor(input)) {
    return input.narrow || input.mobile ? "capability:narrow" : "capability";
  }
  // Below what the hardware allows: measurement decided this, not the device.
  return "measurement:slow";
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
    /*
     * Leaving "balanced" removes the world instead of animating it less, so it
     * needs a far longer run of evidence than the cheap step. The count is
     * contiguous either way: any non-slow sample resets it, so a transient can
     * delay the destructive step but never take it.
     */
    const need = state.profile === "balanced" ? DOWNGRADE_TO_LIGHT_AFTER : DOWNGRADE_AFTER;
    if (slow < need) return { profile: state.profile, slow, fast: 0 };
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
  /** Why the effective profile is what it is (see profileReason). */
  reason: RenderReason;
  hidden: boolean;
  /** The one budget's decision, mirrored here for diagnostics only. */
  mode: SceneRenderMode;
  surfaces: RenderSurface[];
  lostContexts: string[];
  /** The explicit request in force, or null when the policy is automatic. */
  override: RenderOverride | null;
  /** Why an explicit request was refused, or null. */
  overrideRefused: string | null;
  /** Capability evidence last decided on, for diagnostics. */
  capability: {
    renderer: string;
    webgl: boolean;
    narrow: boolean;
    saveData: boolean;
  };
  /** When that evidence was last decided on (ms epoch), or 0 before mount. */
  assessedAt: number;
  /**
   * Whether the world can be drawn at all right now: a device that can paint
   * (either an animating profile, or a measured-slow one that the scene keeps
   * painting ON DEMAND), a visible page, no lost context, and a budget that is
   * not paused. The single honest answer to "is there a cosmos to be seen".
   */
  worldPainting: boolean;
  /** Demotions an override has held off — evidence it is doing something. */
  demotionsHeld: number;
  /** When the profile last fell to "light" (ms epoch), or 0. */
  lightSince: number;
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
  private capability: CapabilityInput = {};
  private assessedAt = 0;
  private override: RenderOverride | null = null;
  private overrideRefused: string | null = null;
  private demotionsHeld = 0;
  private lightSince = 0;
  private sample: { fps: number; painting: boolean; at: number } | null = null;
  private hidden = false;
  private detachVisibility: (() => void) | null = null;
  private listeners = new Set<Listener>();
  private snapshot: RenderManagerSnapshot;

  constructor(
    budget: SceneRenderBudget = getSceneRenderBudget(),
    env?: RenderEnvironment,
    private readonly now: () => number = () => Date.now(),
  ) {
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
    this.adopt(input);
    this.publish();
  }

  /**
   * Capability evidence re-read after the environment changed.
   *
   * Returns whether the EVIDENCE changed — which is the only thing that
   * re-derives the profile. Unchanged evidence (the same size, the same GPU,
   * a resize that never crossed the narrow threshold) is not a new decision:
   * it resets nothing and notifies nobody, so holding a window still cannot
   * make the quality oscillate.
   *
   * `trigger` is recorded for legibility rather than control: a restored
   * context and a re-read renderer arrive through their own calls, and no
   * trigger is allowed to bypass the ceiling.
   */
  reassessCapability(input: CapabilityInput, _trigger: CapabilityTrigger = "manual"): boolean {
    if (capabilitySignature(input) === capabilitySignature(this.capability)) return false;
    this.adopt(input);
    this.publish();
    return true;
  }

  /**
   * A different renderer came back with a restored context.
   *
   * The only way capability can change while the page is open without the
   * viewport changing: the GPU process fell back to a software path, or a
   * driver was re-initialised. An IDENTICAL string is not new evidence and
   * changes nothing — that is the common case, and it must stay free.
   */
  observeRenderer(renderer: string): boolean {
    if (renderer === (this.capability.renderer ?? "")) return false;
    return this.reassessCapability({ ...this.capability, renderer, webgl: true }, "renderer");
  }

  /**
   * The last measured second. Read on demand rather than carried in the
   * snapshot: a sample arrives every second while the world paints, and
   * rebuilding the snapshot for it would re-render every profile consumer
   * once a second for a number the stats object already publishes.
   */
  lastSample(): { fps: number; painting: boolean; at: number } | null {
    return this.sample;
  }

  /**
   * Consecutive slow samples behind the next demotion.
   *
   * Read on demand like `lastSample`, and for the same reason: the counters
   * move every measured second, and a snapshot rebuilt for a number nobody is
   * subscribed to would re-render every profile consumer once a second. It is
   * the diagnostic that turns "0 fps" into "eleven of fifteen slow samples
   * before the world would be taken away".
   */
  slowSamples(): number {
    return this.adaptation.slow;
  }

  /**
   * An explicit request to keep the world painting, or null to resume the
   * automatic policy. Reversible in both directions and published either way,
   * including a refusal.
   */
  setOverride(override: RenderOverride | null): boolean {
    if (!override) {
      const had = this.override;
      this.override = null;
      if (!had) return true;
      this.resetAdaptation();
      this.publish();
      return true;
    }

    const verdict = overrideVerdict(this.capability);
    if (verdict !== "applied") {
      this.override = null;
      this.overrideRefused = verdict;
      this.publish();
      return false;
    }

    this.override = override;
    this.overrideRefused = null;
    this.resetAdaptation();
    this.publish();
    return true;
  }

  /**
   * Start a fresh adaptation ladder at the floor.
   *
   * One place, so a profile reset can never forget to record when the world
   * was last taken away (`lightSince`) — the diagnostic that says how long a
   * device has been showing the DOM sky instead of the cosmos.
   */
  private resetAdaptation(): void {
    this.adaptation = { profile: this.floor(), slow: 0, fast: 0 };
    this.lightSince = this.adaptation.profile === "light" ? this.now() : 0;
  }

  /** The profile measurement may not go below: the ceiling, or an override. */
  private floor(): RenderProfile {
    const ceiling = PROFILE_ORDER.indexOf(this.ceiling);
    if (!this.override) return this.ceiling;
    // Never above what the hardware can do, even when asked to be.
    return PROFILE_ORDER[Math.min(ceiling, PROFILE_ORDER.indexOf(this.override.profile))];
  }

  /** One decision, in one place: evidence sets the ceiling, then the floor. */
  private adopt(input: CapabilityInput): void {
    this.capability = { ...input };
    this.assessedAt = this.now();
    this.ceiling = profileFor(input);
    this.resetAdaptation();
  }

  /**
   * One measured second from a canvas. `painting` is false when the canvas
   * drew nothing that second, which is not a performance signal.
   */
  reportFrameRate(fps: number, painting: boolean): void {
    this.sample = { fps, painting, at: this.now() };
    const floor = this.floor();
    const next = nextProfile(this.adaptation, { fps, painting }, floor);

    /*
     * An override holds the floor. A measurement that would go below it is
     * recorded as HELD rather than obeyed: the frame rate is real evidence
     * about THIS machine, but the operator has already said it is a
     * constrained one rather than a weak one. Two honest consequences — the
     * counters reset so the next attempt is a fresh three seconds, and the
     * hold is counted, so "the override is hiding a stutter" is observable
     * instead of invisible.
     */
    // Only an OVERRIDE holds a floor; without one, `floor` is the ceiling and
    // a demotion below it is the whole point of the rule above.
    const held =
      this.override !== null &&
      PROFILE_ORDER.indexOf(next.profile) < PROFILE_ORDER.indexOf(floor);
    if (held) this.demotionsHeld += 1;
    const state = held ? { profile: floor, slow: 0, fast: 0 } : next;

    // Counters are internal: only a profile CHANGE (or a held demotion) is
    // worth waking a subscriber for.
    const changed = state.profile !== this.adaptation.profile;
    this.adaptation = state;
    // The one moment the world is taken away, recorded: the canvas stops
    // running frames from here, so this is the last timestamp it will get.
    if (changed) this.lightSince = state.profile === "light" ? this.now() : 0;
    if (changed || held) this.publish();
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
    const profile = this.adaptation.profile;
    const lost = this.lost.size > 0;
    const mode = this.budget.mode();
    return {
      profile,
      ceiling: this.ceiling,
      reason: profileReason(this.capability, profile, this.override),
      hidden: this.hidden,
      mode,
      surfaces: [...this.surfaces].map(([id, kind]) => ({ id, kind })),
      lostContexts: [...this.lost],
      override: this.override,
      overrideRefused: this.overrideRefused,
      capability: {
        renderer: this.capability.renderer ?? "",
        webgl: this.capability.webgl !== false,
        narrow: Boolean(this.capability.narrow),
        saveData: Boolean(this.capability.saveData),
      },
      assessedAt: this.assessedAt,
      // A measured "light" keeps the canvas mounted, painting on demand, so
      // there is still a world to draw; only a capability "light" (software,
      // no WebGL, Save-Data) has nothing to paint with.
      worldPainting:
        (profile !== "light" || this.ceiling !== "light") &&
        !this.hidden &&
        !lost &&
        mode !== "paused",
      demotionsHeld: this.demotionsHeld,
      lightSince: this.lightSince,
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
