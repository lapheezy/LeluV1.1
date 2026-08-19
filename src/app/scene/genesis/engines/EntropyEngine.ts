/**
 * ==========================================================
 * LÉLUVERSE
 * ENTROPY ENGINE
 * ==========================================================
 */

import type { GenesisState } from "../state/GenesisState";

export default class EntropyEngine {

  update(
    state: GenesisState,
    delta: number,
  ): void {

    if (state.paused) return;

    state.chaos = Math.min(
      1,
      state.chaos +
      delta *
      0.00005,
    );

  }

}