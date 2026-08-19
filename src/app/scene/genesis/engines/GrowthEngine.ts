/**
 * ==========================================================
 * LÉLUVERSE
 * GROWTH ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class GrowthEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    state.evolution +=
      delta *
      0.01;

  }

}