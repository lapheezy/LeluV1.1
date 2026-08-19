/**
 * ==========================================================
 * LÉLUVERSE
 * ENGINE BUS
 *
 * Central orchestration layer between
 * the EngineRegistry and Genesis Renderer.
 *
 * Responsibilities
 * • Collect engine influence
 * • Smooth transitions
 * • Drive shader uniforms
 * • Drive shell activity
 * • Runtime orchestration
 * ==========================================================
 */

import type EngineRegistry from "./EngineRegistry";
import type { GenesisState } from "../state/GenesisState";
import {
  createCoreVisualState,
  refreshCoreVisualState,
  type CoreVisualState,
} from "../render/CoreVisualState";
import {
  MORPH_ORDER,
  MORPH_PROFILES,
  isMorphName,
  type MorphName,
} from "../render/CoreMorphology";

/** How long a lab-driven transformation visibly morphs (seconds). */
const MORPH_DURATION = 3.6;

export interface EngineWeights {

  plasma: number;

  ocean: number;

  crystal: number;

  electric: number;

  halo: number;

  /** Organic / biological state derived from life, mutation and emergence. */
  bio: number;

}

export default class EngineBus {

  private readonly registry: EngineRegistry;

  private readonly weights: EngineWeights = {

    plasma: 1,

    ocean: 0,

    crystal: 0,

    electric: 0,

    halo: 1,

    bio: 0,

  };

  /*
   * The ONE visual state of the ONE Core. Computed here, once per
   * frame, from the same smoothed weights that drive the surface —
   * every visual layer reads this instead of deriving its own copy.
   */
  private readonly visualState: CoreVisualState = createCoreVisualState();

  private time = 0;

  /*
   * Lab / agent-driven transformation request. When set, the ONE Core
   * morphs toward the requested environment morphology and holds it;
   * when null, the automatic evolution cycle drives the Core. The cycle
   * keeps advancing on the real clock the whole time — releasing a
   * request resumes normal evolution without resetting anything.
   */
  private morphTarget: string | null = null;
  private morphFrom: string | null = null;
  private morphStartedAt = 0;
  private morphHistoryPushed = false;
  private lastMorphology = "PLASMA";

  /* The live bus — lets the agent layer (WorkspaceResolver) request core
     transformations without owning the runtime. */
  private static liveInstance: EngineBus | null = null;

  constructor(

    registry: EngineRegistry,

  ) {

    this.registry = registry;

    EngineBus.liveInstance = this;

  }

  /** The live bus, when an EngineRuntime is running. */
  static getLiveInstance(): EngineBus | null {
    return EngineBus.liveInstance;
  }

  /**
   * Request a transformation of the ONE Core. Pass a MORPH_ORDER name
   * (HAZARD/AURORA/OCEAN/PLASMA/ELECTRIC/BIOHAZARD/HYBRID) to morph the
   * Core toward that environment; pass null to release the request and
   * let the automatic evolution cycle resume. The Core itself is never
   * recreated — only its external form is re-targeted.
   */
  setMorphRequest(target: string | null): void {
    const next = target === null ? null : isMorphName(target) ? target : null;
    if (next === this.morphTarget) {
      return;
    }
    this.morphFrom = next === null ? null : this.lastMorphology;
    this.morphTarget = next;
    this.morphStartedAt = this.time;
    this.morphHistoryPushed = false;
  }

  /** The active lab-driven morph request (null = automatic cycle). */
  getMorphRequest(): string | null {
    return this.morphTarget;
  }

  update(

    state: GenesisState,

    delta: number,

  ): void {

    // Pausing the universe freezes the ONE Core's morph, color, pulse and
    // weights as one unit — the renderer keeps reading the same frozen
    // visual state, so the Core simply holds still instead of continuing
    // to mutate while the simulation sleeps.
    if (state.paused) {

      return;

    }

    const engines = this.registry.getAll();

    // The registry contains simulation engines, not separate shell
    // engines. Give each visual channel a meaningful state-derived
    // baseline, then let an explicitly named engine override it when
    // one exists. This keeps the renderer connected to the live
    // universe instead of fading every shell to zero after boot.
    const clamp = (value: number) => Math.max(0, Math.min(1, value));

    /*
     * ONE travelling MORPHOLOGY cycle for the ONE Core.
     *
     * The Core does not sit as a single static sphere: it walks a
     * continuous loop through seven named morphologies —
     *
     *   HAZARD → AURORA → OCEAN → PLASMA → ELECTRIC
     *          → BIOHAZARD → HYBRID → HAZARD …
     *
     * Each morphology is a weight PROFILE over the same six engine
     * channels (ocean/plasma/electric/crystal/halo/bio), so the ONE
     * surface, color, glow, emission, arcs and rings all morph together
     * — the Core never disappears and gets replaced by another sphere.
     * The current morphology name is published onto the canonical
     * universe state AND the shared CoreVisualState, so UI 1 labels the
     * cosmic Core and UI 2 renders the same form from the same value.
     *
     * The cycle position runs on the EngineBus REAL clock (this.time,
     * seconds) — NOT state.age. The simulation advances state.age at
     * 120× real time, so a cycle driven by state.age would sweep all
     * seven morphologies in ~1.3 s: the 4/s weight smoothing could
     * never track a leading state, every channel would hover near the
     * average, and the Core would look stuck on one pale blend. On the
     * real clock a full loop takes ~100 s (7 / 0.07), each morphology
     * leads for ~14 s before cross-fading onward — fast enough that the
     * ONE Core's color/morph change is unmistakable when watching the
     * running app — and the smoothing tracks the target, so the Core
     * visibly morphs through its named forms instead of freezing.
     */
    const cycleCount = MORPH_ORDER.length;

    /* The seven environment morphology weight profiles now live in
       render/CoreMorphology.ts — the same table the Genesis v2 lab uses
       for its target previews, so the lab shows exactly what the Core
       will become. */

    /*
     * Position on the seven-morphology loop. Each window is split in
     * half: the leading morphology holds for the first half, then the
     * next morphology cross-fades in over the second half — so every
     * transition is a visible morph, not a hard switch.
     */
    /*
     * Position on the seven-morphology loop. Each window is split in
     * half: the leading morphology holds for the first half, then the
     * next morphology cross-fades in over the second half — so every
     * transition is a visible morph, not a hard switch. The loop always
     * advances on the real clock, even while a lab request is holding
     * the Core — releasing the request resumes evolution mid-cycle.
     */
    const cycle =
      ((this.time * 0.07) % cycleCount + cycleCount) % cycleCount;
    const window = Math.floor(cycle);
    const phase = cycle - window;
    const autoMorph = MORPH_ORDER[window];
    const autoNext = MORPH_ORDER[(window + 1) % cycleCount];
    const autoProgress = Math.min(1, phase * 2);
    const autoCrossfade = Math.max(0, Math.min(1, (phase - 0.5) * 2));

    /*
     * LAB-DRIVEN TRANSFORMATION — when a request is active, the ONE Core
     * morphs toward the requested profile over MORPH_DURATION seconds
     * (visible interpolation, not an instant swap), publishes its
     * progress on the shared state, records the completed transform
     * once, and HOLDS the requested form until the request is cleared.
     */
    const labActive = this.morphTarget !== null;
    const labProgress = labActive
      ? Math.max(0, Math.min(1, (this.time - this.morphStartedAt) / MORPH_DURATION))
      : 0;

    const lead = labActive
      ? MORPH_PROFILES[this.morphTarget as MorphName]
      : MORPH_PROFILES[autoMorph];
    const next = labActive
      ? MORPH_PROFILES[this.morphTarget as MorphName]
      : MORPH_PROFILES[autoNext];
    const crossfade = labActive ? 0 : autoCrossfade;
    const morphName = labActive ? (this.morphTarget as string) : autoMorph;
    const morphProgress = labActive ? labProgress : autoProgress;

    /* Publish the transformation surface onto the ONE shared state. */
    const transform = state.coreTransform;
    transform.request = labActive ? this.morphTarget : null;
    transform.progress = labProgress;
    transform.transforming = labActive && labProgress < 1;
    if (labActive && labProgress >= 1 && !this.morphHistoryPushed) {
      if (this.morphFrom && this.morphFrom !== this.morphTarget) {
        transform.history = [
          { from: this.morphFrom, to: this.morphTarget as string, at: Date.now() },
          ...transform.history,
        ].slice(0, 12);
      }
      this.morphHistoryPushed = true;
    }

    // Life-force amplitude of the whole morph wave — the Core's overall
    // liveliness, so the cycle still reacts to the simulation.
    const lifeForce = clamp(
      0.40 +
      state.energy * 0.22 +
      state.awareness * 0.14 +
      state.pulse.intensity * 0.16 +
      state.pulse.heartbeat * 0.08 +
      state.evolutionSystem.stage * 0.10 +
      (0.5 + 0.5 * Math.sin(state.age * 0.9)) * 0.08,
    );

    // Per-morphology universe bias so the simulation still leaves a
    // fingerprint on each channel without washing out the cycle.
    const bias = {
      ocean: state.ocean.stability * 0.50 + state.ocean.wave * 0.20,
      plasma:
        state.evolutionSystem.plasma * 0.50 +
        state.evolutionSystem.instability * 0.15,
      electric:
        state.energy * 0.30 +
        state.evolutionSystem.mutation * 0.20,
      crystal:
        state.evolutionSystem.formChange * 0.45 +
        state.evolutionSystem.stage * 0.20,
      halo:
        state.evolutionSystem.emergence * 0.35 +
        state.consciousness * 0.20,
      bio:
        state.life * 0.45 +
        state.evolutionSystem.mutation * 0.25,
    };

    // Blend the leading morphology with the incoming one during the
    // crossfade half of the window (a lab request blends with itself,
    // i.e. crossfade = 0 → the requested profile is the target).
    const blendChannel = (
      key: keyof EngineWeights,
    ): number => lead[key] + (next[key] - lead[key]) * crossfade;

    // A small presence floor on every channel keeps ALL six systems visibly
    // layered inside the ONE Core at all times and makes the cross-fades
    // genuine blends instead of hard switches between morphologies.
    const target: EngineWeights = {
      ocean: clamp(blendChannel("ocean") * lifeForce + bias.ocean * 0.22 + 0.06),
      plasma: clamp(blendChannel("plasma") * lifeForce + bias.plasma * 0.22 + 0.06),
      electric: clamp(blendChannel("electric") * lifeForce + bias.electric * 0.22 + 0.06),
      crystal: clamp(blendChannel("crystal") * lifeForce + bias.crystal * 0.22 + 0.06),
      halo: clamp(blendChannel("halo") * lifeForce + bias.halo * 0.22 + 0.06),
      bio: clamp(blendChannel("bio") * lifeForce + bias.bio * 0.22 + 0.06),
    };

    // Publish the named morphology onto the ONE shared core state: the
    // canonical universe snapshot (read by both interface surfaces) and
    // the CoreVisualState (read by the renderer layers).
    state.morphology = morphName;
    state.morphologyProgress = morphProgress;
    this.lastMorphology = morphName;

    for (const engine of engines) {

      if (engine.enabled === false) {

        continue;

      }

      const id =

        (engine.id ??

        engine.constructor.name)

        .toLowerCase();

      const value =

        engine.getWeight?.(state) ??

        engine.weight;

      // Only engines that explicitly expose a visual weight participate
      // in channel overrides. Simulation engines such as OceanEngine
      // should not accidentally become shell controllers just because
      // their class name happens to contain a channel name.
      if (value === undefined) {

        continue;

      }

      const clampedValue = clamp(value);

      if (id.includes("plasma")) {

        target.plasma = clampedValue;

      }

      else if (id.includes("ocean")) {

        target.ocean = clampedValue;

      }

      else if (id.includes("crystal")) {

        target.crystal = clampedValue;

      }

      else if (id.includes("electric")) {

        target.electric = clampedValue;

      }

      else if (id.includes("halo")) {

        target.halo = clampedValue;

      }

      else if (id.includes("bio")) {

        target.bio = clampedValue;

      }

    }

    /* Lab-driven morphs smooth slower so the transformation is a visible
       interpolation; the automatic cycle keeps its snappy cross-fade. */
    const speed = Math.min(delta * (labActive ? 1.35 : 4), 1);

    this.weights.plasma +=

      (target.plasma - this.weights.plasma) *

      speed;

    this.weights.ocean +=

      (target.ocean - this.weights.ocean) *

      speed;

    this.weights.crystal +=

      (target.crystal - this.weights.crystal) *

      speed;

    this.weights.electric +=

      (target.electric - this.weights.electric) *

      speed;

    this.weights.halo +=

      (target.halo - this.weights.halo) *

      speed;

    this.weights.bio +=

      (target.bio - this.weights.bio) *

      speed;

    /*
     * One shared clock and one refresh of the authoritative visual
     * state per frame. The Core body, emission, atmosphere, life and
     * the cosmic field all consume this same object, so the Core is
     * always ONE living system with one color, one pulse, one set of
     * engine-state weights.
     */
    this.time += delta;

    refreshCoreVisualState(

      this.visualState,

      state,

      this.weights,

      this.time,

    );

  }

  getWeights(): EngineWeights {

    return {

      ...this.weights,

    };

  }

  /** The ONE visual state — same object every frame, refreshed in update(). */
  getVisualState(): CoreVisualState {

    return this.visualState;

  }

}