/**
 * ==========================================================
 * LÉLUVERSE
 * EXPANSION ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class ExpansionEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    state.energy = Math.min(
      1,
      state.energy +
      delta *
      0.00025,
    );

    state.matter = Math.min(
      1,
      state.matter +
      delta *
      0.00015,
    );

  }

}