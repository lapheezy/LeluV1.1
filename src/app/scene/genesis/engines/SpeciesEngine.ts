/**
 * ==========================================================
 * LÉLUVERSE
 * SPECIES ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class SpeciesEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    if (state.learning < 0.4) return;

    state.intelligence = Math.min(
      1,
      state.intelligence +
      delta * 0.00008,
    );

  }

}