/**
 * ==========================================================
 * LÉLUVERSE
 * CORE VISUAL STATE — THE ONE CORE'S MUTATION CONTROLLER
 *
 * This is the single authoritative derivation of the Genesis
 * Core's per-frame visual state. It is computed ONCE per frame
 * by the EngineBus (the same place the engine weights are
 * smoothed) and consumed by every visual layer of the ONE Core:
 *
 *   - GenesisCoreBody  (surface material)
 *   - CoreEmission     (particles / arcs / rings leaving the Core)
 *   - CoreAtmosphere   (the Core's light source)
 *   - LifeEvolution    (internal life motes)
 *   - CosmicField        (cosmic rings/nodes, now in the environment)
 *
 * There is exactly one activity formula, one pulse, one engine
 * state-weight blend, one color, and one set of feeds. No visual
 * component derives its own copy of this state, so the Core can
 * never wear two different states at once — one mutation
 * controller, one color controller, one unified output.
 *
 * MORPHOLOGY — the named external form of the ONE Core. The
 * EngineBus walks the Core through seven morphologies
 * (HAZARD → AURORA → OCEAN → PLASMA → ELECTRIC → BIOHAZARD
 * → HYBRID) and publishes the current one here and on the
 * canonical universe state. UI 1 (the cosmic world) reads it to
 * label the living Core; UI 2 (the system view) reads the same
 * object, so both surfaces always observe the SAME core.
 * ==========================================================
 */

import { Color } from "three";

import type { GenesisState } from "../state/GenesisState";
import type { EngineWeights } from "../engines/EngineBus";
import {
  blendCoreStateColorInto,
  deriveCoreStateWeights,
  type CoreStateWeights,
} from "../materials/GenesisCoreMaterial";

const WHITE_COLOR = new Color(1, 1, 1);

/** Feed values for the surface's ocean uniforms. */
export interface OceanFeed {
  blend: number;
  flow: number;
  depth: number;
  foam: number;
  current: number;
}

/** ONE per-frame visual state of the Core. */
export interface CoreVisualState {
  /** Shared clock, seconds since the EngineBus was created. */
  time: number;
  /** Named external morphology of the ONE Core (HAZARD/AURORA/OCEAN/PLASMA/ELECTRIC/BIOHAZARD/HYBRID). */
  morphology: string;
  /** 0..1 progress through the current morphology window (crossfade position). */
  morphologyProgress: number;
  /** Liveliness 0..1 — the Core's overall energy response. */
  activity: number;
  /** Breathing heartbeat used by every layer. */
  pulse: number;
  /** Evolution feed for the surface shader. */
  evolutionFeed: number;
  awarenessFeed: number;
  mutationFeed: number;
  growthFeed: number;
  formChange: number;
  instability: number;
  plasmaFeed: number;
  colorShift: number;
  oceanFeed: OceanFeed;
  /** Engine-state weights — the single morphing authority. */
  stateWeights: CoreStateWeights;
  /** Engine-state palette blended by the weights. Reused Color. */
  stateColor: Color;
  /** State color lifted toward white for glow/emission. Reused Color. */
  stateGlow: Color;
  energy: number;
  life: number;
  emergence: number;
}

/** Allocate a persistent visual state (Colors are reused, never reallocated). */
export function createCoreVisualState(): CoreVisualState {
  return {
    time: 0,
    morphology: "PLASMA",
    morphologyProgress: 0,
    activity: 0.3,
    pulse: 0.35,
    evolutionFeed: 0,
    awarenessFeed: 0,
    mutationFeed: 0,
    growthFeed: 0,
    formChange: 0,
    instability: 0,
    plasmaFeed: 0.35,
    colorShift: 0,
    oceanFeed: { blend: 0.25, flow: 0.5, depth: 0.5, foam: 0.2, current: 0.5 },
    stateWeights: { ocean: 0, plasma: 1, electric: 0, crystal: 0, halo: 1, bio: 0 },
    stateColor: new Color("#009CFF"),
    stateGlow: new Color("#4BD9FF"),
    energy: 0,
    life: 0,
    emergence: 0,
  };
}

/**
 * Refresh `target` from the canonical universe snapshot + the smoothed
 * EngineBus weights. Pure mutation of `target`; no allocation.
 */
export function refreshCoreVisualState(
  target: CoreVisualState,
  state: GenesisState,
  weights: EngineWeights,
  time: number,
): void {
  const evolutionState = state.evolutionSystem;
  const mutation = evolutionState?.mutation ?? 0;
  const colorShift = evolutionState?.colorShift ?? 0;
  const formChange = evolutionState?.formChange ?? 0;
  const plasma = evolutionState?.plasma ?? 0.2;
  const instability = evolutionState?.instability ?? 0;
  const growth = evolutionState?.growth ?? 0;
  const emergence = evolutionState?.emergence ?? 0;
  const energy = state.energy ?? 0;
  const awareness = state.awareness ?? 0;
  const consciousness = state.consciousness ?? 0;
  const ocean = state.ocean;

  target.time = time;

  // Morphology — the named external form, published by the EngineBus
  // cycle. Both interface surfaces read this same value: UI 1 labels the
  // cosmic Core with it, UI 2's system view renders the same form.
  target.morphology = state.morphology ?? "PLASMA";
  target.morphologyProgress = state.morphologyProgress ?? 0;

  // Permanent living heartbeat — the Core is alive before the universe
  // reaches higher states. One pulse for every layer.
  target.pulse = 0.35 + (Math.sin(time * 2.5) + 1) * 0.15;

  // One activity formula for the whole Core.
  target.activity = Math.min(
    1,
    target.pulse +
      (state.pulse?.intensity ?? 0) * 0.12 +
      energy * 0.35 +
      awareness * 0.25 +
      consciousness * 0.25 +
      mutation * 0.35,
  );

  // Evolution feed for the surface.
  target.evolutionFeed = Math.min(
    1,
    evolutionState.stage * 0.7 + formChange * 0.3 + target.pulse * 0.2,
  );
  target.awarenessFeed = awareness + target.pulse * 0.1;
  target.mutationFeed = mutation + target.pulse * 0.15;
  target.growthFeed = Math.min(
    1,
    growth * 0.7 + formChange * 0.2 + target.activity * 0.1,
  );
  target.formChange = formChange;
  target.instability = instability;
  target.plasmaFeed = Math.max(
    0.2,
    plasma * 0.78 + (ocean?.stability ?? 0) * 0.22,
  );

  // Ocean-driven surface feeds.
  const tide = ocean?.tide ?? 0;
  const current = ocean?.current ?? 0;
  const wave = ocean?.wave ?? 0;
  const tsunami = ocean?.tsunami ?? 0;
  target.oceanFeed.blend = tide;
  target.oceanFeed.flow = current;
  target.oceanFeed.depth = wave;
  target.oceanFeed.foam = Math.max(wave, tsunami * 0.5);
  target.oceanFeed.current = current;

  // Spectral drift + mutation blend for the color shimmer.
  target.colorShift = Math.min(
    1,
    colorShift * 0.78 +
      mutation * 0.12 +
      tide * 0.05 +
      (0.5 + 0.5 * Math.sin(state.age * 0.12)) * 0.1,
  );

  // ONE engine-state weighting — the same weights the EngineBus smoothed.
  const stateWeights = deriveCoreStateWeights(weights, {
    life: state.life ?? 0,
    mutation,
    emergence,
  });
  target.stateWeights.ocean = stateWeights.ocean;
  target.stateWeights.plasma = stateWeights.plasma;
  target.stateWeights.electric = stateWeights.electric;
  target.stateWeights.crystal = stateWeights.crystal;
  target.stateWeights.halo = stateWeights.halo;
  target.stateWeights.bio = stateWeights.bio;

  // ONE color — surface, glow, emission, light all read this pair.
  blendCoreStateColorInto(target.stateColor, stateWeights);
  target.stateGlow.copy(target.stateColor).lerp(WHITE_COLOR, 0.35);

  target.energy = energy;
  target.life = state.life ?? 0;
  target.emergence = emergence;
}
