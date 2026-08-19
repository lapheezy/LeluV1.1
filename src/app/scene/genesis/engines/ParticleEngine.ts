/**
 * ==========================================================
 * LÉLUVERSE
 * PARTICLE ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class ParticleEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    state.energy = Math.min(
      1,
      state.energy +
      delta *
      0.0001,
    );

  }

}